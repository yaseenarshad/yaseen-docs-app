import { open, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileKind, isAtomicTmp, isSkipped } from '@shared/fileKind'
import { EDIT_GAP_MS, rootOfPath, type EditEntry, type WatchEvent } from '@shared/types'
import { git, resolveGit, zList } from '../git/exec'
import { rootsOf, syncPerRoot } from '../ipc/broadcast'
import type { Store } from '../store'
import { onColdStartDiff, type ColdStartDiff } from '../vaultIndex'
import {
  DEFAULT_SUPPRESS_TTL_MS,
  _clearExternalEditSuppressions,
  isSuppressedExternalEdit,
  suppressExternalEdit,
  suppressExternalRoot,
  withSuppressedEdit,
  withSuppressedRoot,
} from './externalEditSuppress'
import { subscribe } from './watchers'

export {
  DEFAULT_SUPPRESS_TTL_MS,
  isSuppressedExternalEdit,
  suppressExternalEdit,
  suppressExternalRoot,
  withSuppressedEdit,
  withSuppressedRoot,
}

/**
 * External AI / editor / CLI edit capture for Recents (YAZ-6501).
 *
 * - Suppression registry (`./externalEditSuppress`): lets quiet in-app writes, background system
 *   sweeps, renames, copies, and built-in GitHub Sync rebases silence their macOS FSEvents settle
 *   echo without touching Recents.
 * - Live listener: reuses the existing shared `TreeWatcher` via `syncPerRoot` + `subscribe(root)`
 *   (zero new OS watchers). Ignores dot-segments, non-openable files, old file moves, and external
 *   git pull/reset/rebase/checkout operations while keeping local `commit:` entries unfiltered.
 * - Cold-start diff handler: hooked via `onColdStartDiff`, logs files edited while the app was
 *   closed at their real disk `mtime` in ONE batched `store.addEdits` commit, excluding cold-start
 *   renames, git-pulled files, and bulk >50-file copies.
 */

/** Maximum age of an `add` event's `mtime` to count as a fresh create rather than a move/copy of an old file. */
export const FRESH_ADD_MAX_AGE_MS = EDIT_GAP_MS
/** Time window around a working-tree-mutating reflog entry in which live watcher events are checked against it. */
export const REFLOG_LIVE_WINDOW_MS = 5_000
/** Fallback suppression window when a mutating reflog entry cannot be diffed (e.g. git missing or initial clone). */
export const REFLOG_FALLBACK_WINDOW_MS = 3_000
/** Cold-start candidate count cap to protect Recents from non-git bulk copies. */
export const COLD_START_MAX_FILES = 50
/** Bytes read from the tail of `.git/logs/HEAD` (covers ~60-80 recent reflog lines in a single page read). */
const REFLOG_TAIL_BYTES = 8192
const MAX_DIFF_CACHE = 64
const MAX_REFLOG_CACHE = 32
const REBASE_PAIR_WINDOW_MS = 120_000

const ZERO_SHA_RE = /^0+$/
const REFLOG_LINE_RE = /^([0-9a-f]{40,64}) ([0-9a-f]{40,64}) .+ (\d+) [+-]\d{4}\t(.*)$/
const MUTATING_ACTION_RE = /^(pull|rebase|reset|checkout|merge|cherry-pick|revert|clone|switch)\b/i
const GIT_OP_MARKERS = ['index.lock', 'rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'] as const

// ---------- Path filtering ----------

/** Relative POSIX path inside `root`, or `null` when `filePath` is not strictly inside `root`. */
function relativePosix(root: string, filePath: string): string | null {
  const rel = path.relative(root, filePath)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

/** True when `filePath` is an openable, non-hidden, non-tmp file strictly inside `root`. */
export function isTrackableVaultFile(root: string, filePath: string): boolean {
  const rel = relativePosix(root, filePath)
  if (rel === null) return false
  if (rel.split('/').some(isSkipped)) return false
  if (isAtomicTmp(filePath)) return false
  return fileKind(filePath) !== null
}

// ---------- Git reflog & diff filter (zero subprocesses on hot path) ----------

export interface ReflogEntry {
  oldSha: string
  newSha: string
  /** Epoch ms (`unixSec * 1000`). */
  at: number
  action: string
}

/** True for reflog actions that rewrite working-tree files; local `commit:` entries NEVER suppress. */
export function isWorkingTreeMutatingReflog(action: string): boolean {
  const trimmed = action.trimStart()
  if (trimmed.startsWith('commit:') || trimmed.startsWith('commit (')) return false
  return MUTATING_ACTION_RE.test(trimmed)
}

/** Parses lines from `.git/logs/HEAD` into structured entries (oldest first). */
export function parseReflogLines(text: string): ReflogEntry[] {
  const out: ReflogEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') continue
    const m = REFLOG_LINE_RE.exec(raw)
    if (m === null) continue
    const sec = Number.parseInt(m[3]!, 10)
    if (!Number.isFinite(sec)) continue
    out.push({ oldSha: m[1]!, newSha: m[2]!, at: sec * 1000, action: m[4]! })
  }
  return out
}

interface ReflogCacheEntry {
  mtimeMs: number
  size: number
  entries: ReflogEntry[]
}

const reflogCache = new Map<string, ReflogCacheEntry>()
const diffCache = new Map<string, ReadonlySet<string> | null>()
const diffInFlight = new Map<string, Promise<ReadonlySet<string> | null>>()

/** Resolves the `.git` directory for `root` (supports both normal repos and worktrees), or `null` if not a git repo. */
async function resolveGitDir(root: string): Promise<string | null> {
  const dotGit = path.join(root, '.git')
  const st = await stat(dotGit).catch(() => null)
  if (st === null) return null
  if (st.isDirectory()) return dotGit
  if (st.isFile()) {
    const content = await readFile(dotGit, 'utf8').catch(() => '')
    const m = /^gitdir:\s*(.+)$/m.exec(content)
    if (m !== null) return path.resolve(root, m[1]!.trim())
  }
  return null
}

async function hasActiveGitOp(gitDir: string): Promise<boolean> {
  const checks = await Promise.all(GIT_OP_MARKERS.map((name) => stat(path.join(gitDir, name)).then(() => true, () => false)))
  return checks.some(Boolean)
}

/** Reads only the tail of `<gitDir>/logs/HEAD`, cached by `(mtimeMs, size)`. */
async function readReflogTail(gitDir: string): Promise<ReflogEntry[]> {
  const logPath = path.join(gitDir, 'logs', 'HEAD')
  const st = await stat(logPath).catch(() => null)
  if (st === null || !st.isFile() || st.size === 0) return []
  const cached = reflogCache.get(logPath)
  if (cached !== undefined && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.entries
  const start = Math.max(0, st.size - REFLOG_TAIL_BYTES)
  const len = st.size - start
  let text = ''
  const fh = await open(logPath, 'r').catch(() => null)
  if (fh === null) return []
  try {
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, start)
    text = buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close().catch(() => undefined)
  }
  if (start > 0) {
    const nl = text.indexOf('\n')
    text = nl === -1 ? '' : text.slice(nl + 1)
  }
  const entries = parseReflogLines(text)
  if (reflogCache.size >= MAX_REFLOG_CACHE) {
    const first = reflogCache.keys().next().value
    if (first !== undefined) reflogCache.delete(first)
  }
  reflogCache.set(logPath, { mtimeMs: st.mtimeMs, size: st.size, entries })
  return entries
}

interface MutatingSpan {
  oldSha: string
  newSha: string
  start: number
  end: number
}

/**
 * Extracts diffable working-tree-mutating spans from `entries`, pairing `rebase (finish)` lines
 * (where `oldSha === newSha`) with their preceding `rebase (start)` line.
 */
function mutatingSpansOf(entries: readonly ReflogEntry[]): MutatingSpan[] {
  const spans: MutatingSpan[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (!isWorkingTreeMutatingReflog(entry.action)) continue
    let oldSha = entry.oldSha
    let start = entry.at
    if (oldSha === entry.newSha && /^(?:pull\s+--rebase|rebase)\s*\(finish\)/i.test(entry.action)) {
      for (let j = i - 1; j >= 0; j--) {
        const prev = entries[j]!
        if (entry.at - prev.at > REBASE_PAIR_WINDOW_MS) break
        if (/^(?:pull\s+--rebase|rebase)\s*\(start\)/i.test(prev.action)) {
          oldSha = prev.oldSha
          start = prev.at
          break
        }
      }
    }
    spans.push({ oldSha, newSha: entry.newSha, start, end: entry.at })
  }
  return spans
}

/** Resolves vault-relative POSIX paths changed between `oldSha` and `newSha`, cached + deduplicated in flight. `null` = unavailable (caller uses time-window fallback). */
async function diffPathsBetween(root: string, oldSha: string, newSha: string, gitCandidates?: readonly string[]): Promise<ReadonlySet<string> | null> {
  if (oldSha === newSha) return new Set()
  if (ZERO_SHA_RE.test(oldSha) || ZERO_SHA_RE.test(newSha)) return null
  const key = `${path.resolve(root)}\0${oldSha}\0${newSha}`
  if (diffCache.has(key)) return diffCache.get(key)!
  const existing = diffInFlight.get(key)
  if (existing !== undefined) return existing
  const run = (async (): Promise<ReadonlySet<string> | null> => {
    const bin = await resolveGit(gitCandidates)
    if (bin === null) return null
    const res = await git(bin, root, ['diff', '--name-only', '-z', oldSha, newSha], { timeoutMs: 5_000 }).catch(() => null)
    if (res === null || res.code !== 0) return null
    const set = new Set(zList(res))
    if (diffCache.size >= MAX_DIFF_CACHE) {
      const first = diffCache.keys().next().value
      if (first !== undefined) diffCache.delete(first)
    }
    diffCache.set(key, set)
    return set
  })().finally(() => {
    diffInFlight.delete(key)
  })
  diffInFlight.set(key, run)
  return run
}

/**
 * Checks whether a live watcher event on `filePath` was caused by an external git operation
 * (`pull`, `rebase`, `reset`, `checkout`, `merge`, `cherry-pick`, `revert`, `clone`, `switch`).
 * Zero subprocesses on the hot path when no working-tree-mutating reflog entry is within 5 s.
 */
export async function isExternalGitMutation(
  root: string,
  filePath: string,
  mtime: number,
  now: number,
  opts?: { gitCandidates?: readonly string[] },
): Promise<boolean> {
  const gitDir = await resolveGitDir(root)
  if (gitDir === null) return false
  if (await hasActiveGitOp(gitDir)) return true
  const entries = await readReflogTail(gitDir)
  if (entries.length === 0) return false
  const spans = mutatingSpansOf(entries)
  if (spans.length === 0) return false
  const rel = relativePosix(root, filePath)
  if (rel === null) return false
  for (const span of spans) {
    const nearNow = now >= span.start - REFLOG_LIVE_WINDOW_MS && now <= span.end + REFLOG_LIVE_WINDOW_MS
    const nearMtime = mtime >= span.start - REFLOG_LIVE_WINDOW_MS && mtime <= span.end + REFLOG_LIVE_WINDOW_MS
    if (!nearNow && !nearMtime) continue
    const touched = await diffPathsBetween(root, span.oldSha, span.newSha, opts?.gitCandidates)
    if (touched === null) {
      const inFallback =
        (now >= span.start - REFLOG_FALLBACK_WINDOW_MS && now <= span.end + REFLOG_FALLBACK_WINDOW_MS) ||
        (mtime >= span.start - REFLOG_FALLBACK_WINDOW_MS && mtime <= span.end + REFLOG_FALLBACK_WINDOW_MS)
      if (inFallback) return true
    } else if (touched.has(rel)) {
      return true
    }
  }
  return false
}

// ---------- Live watcher handler ----------

/** Processes one shared-watcher event for `root` and records external AI / editor edits in `store`. */
export async function handleExternalWatchEvent(
  store: Pick<Store, 'get' | 'addEdits'>,
  root: string,
  ev: WatchEvent,
  opts?: { now?: number; gitCandidates?: readonly string[] },
): Promise<boolean> {
  if (ev.type !== 'change' && ev.type !== 'add') return false
  const now = opts?.now ?? Date.now()
  if (!isTrackableVaultFile(root, ev.path)) return false
  // If multiple nested vaults are open, only the most specific vault records the edit.
  const openRoots = rootsOf(store.get())
  if (openRoots.length > 0 && rootOfPath(openRoots, ev.path) !== root) return false
  if (isSuppressedExternalEdit(root, ev.path, now)) return false
  if (ev.type === 'add' && now - ev.mtime > FRESH_ADD_MAX_AGE_MS) return false
  if (await isExternalGitMutation(root, ev.path, ev.mtime, now, opts)) return false
  // Re-check suppression after async git checks in case a quiet write or rename landed concurrently.
  if (isSuppressedExternalEdit(root, ev.path, opts?.now ?? Date.now())) return false
  const at = Math.min(ev.mtime, now)
  const before = store.get().folders[root]?.edits[ev.path]
  store.addEdits(root, [{ file: ev.path, at }], { onlyNewer: true })
  return store.get().folders[root]?.edits[ev.path] !== before
}

// ---------- Cold-start diff handler ----------

/**
 * Logs files created or edited on disk while the app was closed (YAZ-6501) from a `ColdStartDiff`
 * with `cacheStatus === 'hit'`, excluding cold-start renames, git-pulled files, and >50-file bulk copies.
 */
export async function handleColdStartDiff(
  store: Pick<Store, 'get' | 'addEdits'>,
  diff: ColdStartDiff,
  opts?: { now?: number; gitCandidates?: readonly string[] },
): Promise<number> {
  if (diff.cacheStatus !== 'hit') return 0
  const openRoots = rootsOf(store.get())
  // Only record cold-start edits for vaults currently open in a window (skips internal vaults like cardSkillVault).
  if (openRoots.length > 0 && !openRoots.includes(diff.root)) return 0
  const ownsFile = (file: string): boolean => openRoots.length === 0 || rootOfPath(openRoots, file) === diff.root
  const now = opts?.now ?? Date.now()

  // 1. Exclude cold-start renames (1:1 join on (size, mtime) between removed and added).
  const removedCounts = new Map<string, number>()
  for (const r of diff.removed) {
    const key = `${r.size}:${r.mtime}`
    removedCounts.set(key, (removedCounts.get(key) ?? 0) + 1)
  }
  const trackableAdded: EditEntry[] = []
  for (const a of diff.added) {
    const key = `${a.size}:${a.mtime}`
    const left = removedCounts.get(key) ?? 0
    if (left > 0) {
      removedCounts.set(key, left - 1)
      continue
    }
    if (!isTrackableVaultFile(diff.root, a.path) || !ownsFile(a.path)) continue
    trackableAdded.push({ file: a.path, at: Math.min(a.mtime, now) })
  }

  const trackableChangedPaths = diff.changed.filter((p) => isTrackableVaultFile(diff.root, p) && ownsFile(p))
  const totalRaw = trackableAdded.length + trackableChangedPaths.length
  if (totalRaw === 0) return 0

  // 2. Check git reflog before statting large non-git bulk diffs.
  const gitDir = await resolveGitDir(diff.root)
  const entries = gitDir === null ? [] : await readReflogTail(gitDir)
  const spans = mutatingSpansOf(entries)
  if (spans.length === 0 && totalRaw > COLD_START_MAX_FILES) return 0

  // 3. Stat changed files for their real disk mtime.
  const changedStats = await Promise.all(
    trackableChangedPaths.map(async (file): Promise<EditEntry | null> => {
      const st = await stat(file).catch(() => null)
      return st === null || !st.isFile() ? null : { file, at: Math.min(st.mtimeMs, now) }
    }),
  )
  const candidates: EditEntry[] = [...trackableAdded, ...changedStats.filter((x): x is EditEntry => x !== null)]
  if (candidates.length === 0) return 0

  // 4. Filter out files touched by working-tree-mutating git reflog spans near the file's mtime.
  let remaining = candidates
  if (spans.length > 0) {
    const earliest = Math.min(...candidates.map((c) => c.at))
    const relevantSpans = spans.filter((s) => s.end >= earliest - REFLOG_LIVE_WINDOW_MS)
    if (relevantSpans.length > 0) {
      const resolved = await Promise.all(
        relevantSpans.map(async (span) => ({
          span,
          paths: await diffPathsBetween(diff.root, span.oldSha, span.newSha, opts?.gitCandidates),
        })),
      )
      remaining = candidates.filter((c) => {
        const rel = relativePosix(diff.root, c.file)
        if (rel === null) return false
        for (const { span, paths } of resolved) {
          const margin = paths === null ? REFLOG_FALLBACK_WINDOW_MS : REFLOG_LIVE_WINDOW_MS
          if (c.at < span.start - margin || c.at > span.end + margin) continue
          if (paths === null || paths.has(rel)) return false
        }
        return true
      })
    }
  }

  // 5. Protect Recents from bulk non-git copies (> 50 remaining files).
  if (remaining.length === 0 || remaining.length > COLD_START_MAX_FILES) return 0
  store.addEdits(diff.root, remaining, { onlyNewer: true })
  return remaining.length
}

// ---------- Main-process registration ----------

/**
 * Registers the live external-edit listener (reusing the shared `TreeWatcher` via `syncPerRoot`)
 * and the cold-start diff listener (`onColdStartDiff`) once at app startup.
 */
export function registerExternalEdits(store: Store): void {
  syncPerRoot(store, (root) =>
    subscribe(root, (ev) => {
      void handleExternalWatchEvent(store, root, ev)
    }),
  )
  onColdStartDiff((diff) => {
    void handleColdStartDiff(store, diff)
  })
}

/** Test hook: clears suppression registries and git reflog/diff caches. */
export function _resetExternalEditsForTest(): void {
  _clearExternalEditSuppressions()
  reflogCache.clear()
  diffCache.clear()
  diffInFlight.clear()
}
