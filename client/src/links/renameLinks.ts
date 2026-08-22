/**
 * Automatic link updates after an in-app rename (Links E1 GRO-2194 + E1b GRO-2241 —
 * decision E, GRO-2096: Obsidian's default, no prompt). Runs CLIENT-SIDE in the ORIGINATING
 * window, AFTER the rename succeeded, over PRE-rename snapshots (post-rename, the old name
 * no longer resolves, so the referencing set must be computed against the index/tree as
 * they were).
 *
 * Referencing set: records whose `links` or `embeds` resolve to the moved path — markdown
 * targets through THE shared resolver (`resolverFor`, the one behind views and wikilink
 * decorations), `.base` targets through `resolveBasePath` (the documented root-relative-
 * then-BFS rule; `.base` files are never index records) over the pre-rename TREE snapshot
 * (no tree → base embeds are left alone, conservative). For a FOLDER (`kind: 'dir'`) the
 * moved set is everything under the old prefix. Per file: `fs:read` → rewrite → `fs:write`
 * with `expectedMtime`; a CONFLICT re-reads once and retries, a second conflict skips the
 * file (someone is actively writing it — their unsaved changes win over our link fix; the
 * link shows as unresolved until fixed by hand).
 *
 * Body rewriting is a string-level scan with the shared regex semantics: only matches whose
 * `linkPageName` resolves to the old path are touched; fenced code blocks and inline code
 * spans are skipped via a LENGTH-PRESERVING mirror of the index's `stripCode` discipline
 * (`maskCode` — same fence/span rules, offsets intact so the splice edits the original
 * bytes). `|alias` and `#heading`/`#^block` suffixes are preserved; the link FORM is too:
 * a bare `[[B]]` becomes the new bare name, a pathed `[[Sub/B]]` the new root-relative path,
 * and an explicit `.md` extension stays explicit. `![[embeds]]` get the same treatment.
 * Frontmatter follows the index's link extraction: whole-value exact `[[…]]` strings only
 * (top-level and inside lists), rewritten through `setFrontmatterProperty` so everything
 * else in the block survives byte-for-byte.
 *
 * E1b's bare-vs-pathed rules, LOCKED (decision E thread):
 *  - FOLDER rename: bare-name links keep resolving (names unchanged) — they stay
 *    BYTE-IDENTICAL; only PATHED targets rewrite, to the new root-relative path.
 *  - FILE move (and rename): a bare link stays bare only when the bare form still resolves
 *    to the moved file AFTERWARDS — decided through the resolver against a POST-move record
 *    set (the shallowest rule may hand the name to a duplicate); otherwise it escalates to
 *    the pathed form. A kept bare form is never spliced, so padding survives too.
 *  - `.base` embeds: a bare `![[X.base]]` stays only while the (new) name is UNIQUE in the
 *    tree — with a duplicate the rewrite goes pathed (conservative stand-in for a post-move
 *    BFS, correct in both cases).
 */
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import type { IndexRecord, TreeNode } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { resolverFor } from '../bases/engine'
import { resolveBasePath } from '../editor/baseEmbed/resolveBase'
import { WIKILINK_RE } from '../editor/wikilink/wikilinkPlugin'
import { flushRenamedPath } from '../lib/renameContinuity'
import { basename, stripExt } from '../lib/paths'

/** Does this raw link target point at the renamed file? (Wired to THE shared resolver.) */
export type ResolvesToOld = (target: string) => boolean

/** Raw target text → its replacement (form-preserving; see `renamedTarget`). */
export type NewTarget = (target: string) => string

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const CODE_SPAN_RE = /(`+)[\s\S]*?\1/g

/**
 * The index's `stripCode` (desktop/src/main/vaultIndex/scan.ts) mirrored LENGTH-PRESERVING:
 * every character inside a fenced block (``` / ~~~, fence lines included) or an inline code
 * span becomes a space, so match offsets over the mask address the original body directly.
 */
export function maskCode(body: string): string {
  const lines = body.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i])
    if (fence === null) {
      if (m) fence = m[1]
    } else if (m && m[1][0] === fence[0] && m[1].length >= fence.length && lines[i].trim() === m[1]) {
      fence = null
    }
    if (fence !== null || m) lines[i] = ' '.repeat(lines[i].length)
  }
  return lines.join('\n').replace(CODE_SPAN_RE, (span) => ' '.repeat(span.length))
}

/**
 * `[[inner]]` → the rewritten inner, or null when this match is not the renamed file.
 * The target part (before the first `#` or `|`) is replaced; `#heading`/`#^block` and
 * `|alias` ride along untouched. Surrounding whitespace inside the target is dropped
 * (`[[ B ]]` → `[[C]]`), matching how the resolver reads it anyway — EXCEPT when the
 * target text would not change at all (E1b: a bare link kept across a move), where the
 * match is left untouched so the link stays byte-identical, padding included.
 */
export function rewriteInner(inner: string, resolves: ResolvesToOld, newTarget: NewTarget): string | null {
  const pipe = inner.indexOf('|')
  const head = pipe >= 0 ? inner.slice(0, pipe) : inner
  const alias = pipe >= 0 ? inner.slice(pipe) : ''
  const hash = head.indexOf('#')
  const target = (hash >= 0 ? head.slice(0, hash) : head).trim()
  const suffix = hash >= 0 ? head.slice(hash) : ''
  if (target === '' || !resolves(target)) return null
  const next = newTarget(target)
  if (next === target) return null
  return next + suffix + alias
}

/**
 * Form preservation for one matched target: bare stays bare (the new basename), pathed
 * stays pathed (the new ROOT-RELATIVE path), and an explicit vault extension stays explicit.
 * `newName` is the new file name WITH extension; `newRel` the new root-relative path WITH it.
 */
export function renamedTarget(target: string, opts: { newName: string; newRel: string }): string {
  const withExt = target.includes('/') ? opts.newRel : opts.newName
  return /\.(md|markdown|base)$/i.test(target) ? withExt : stripExt(withExt)
}

/** Body `[[links]]` and `![[embeds]]` outside code, spliced in place; the input when nothing matched. */
export function rewriteBodyLinks(body: string, resolves: ResolvesToOld, newTarget: NewTarget): string {
  const masked = maskCode(body)
  let out = ''
  let last = 0
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const replaced = rewriteInner(m[2], resolves, newTarget)
    if (replaced === null) continue
    const innerStart = m.index + m[1].length + 2 // after `[[` / `![[`
    out += body.slice(last, innerStart) + replaced
    last = innerStart + m[2].length
  }
  return out + body.slice(last)
}

const EXACT_WIKILINK_RE = /^\[\[([^[\]]+)\]\]$/

/** A frontmatter string that is exactly `[[…]]` → its rewrite, else undefined. */
function rewriteExactLink(value: string, resolves: ResolvesToOld, newTarget: NewTarget): string | undefined {
  const m = EXACT_WIKILINK_RE.exec(value.trim())
  if (m === null) return undefined
  const inner = rewriteInner(m[1], resolves, newTarget)
  return inner === null ? undefined : `[[${inner}]]`
}

/**
 * One note's full rewrite: body scan + frontmatter whole-value links (through
 * `setFrontmatterProperty`, one key at a time). Null when nothing changed — the caller
 * never writes an unchanged file.
 */
export function rewriteNoteLinks(content: string, resolves: ResolvesToOld, newTarget: NewTarget): string | null {
  const { frontmatter, body } = splitFrontmatter(content)
  let out = frontmatter + rewriteBodyLinks(body, resolves, newTarget)
  if (frontmatter !== '') {
    const { properties, error } = parseFrontmatter(frontmatter)
    if (error === undefined) {
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === 'string') {
          const next = rewriteExactLink(value, resolves, newTarget)
          if (next !== undefined) out = setFrontmatterProperty(out, key, next)
        } else if (Array.isArray(value)) {
          let changed = false
          const next = value.map((item) => {
            const r = typeof item === 'string' ? rewriteExactLink(item, resolves, newTarget) : undefined
            if (r !== undefined) changed = true
            return r ?? (item as unknown)
          })
          if (changed) out = setFrontmatterProperty(out, key, next)
        }
      }
    }
  }
  return out === content ? null : out
}

export interface RenameRewriteSummary {
  /** Files whose links were rewritten on disk. */
  updated: number
  /** Files left alone after a repeated write conflict (or an unreadable/unwritable file). */
  skipped: number
}

/** The ONE passive summary notice — shown only when the rename touched (or spared) anything. */
export function renameNotice({ updated, skipped }: RenameRewriteSummary): string {
  const head = `Updated links in ${updated} note${updated === 1 ? '' : 's'}`
  return skipped > 0 ? `${head}; ${skipped} skipped (unsaved changes)` : head
}

/** Files named `name` (case-insensitive) anywhere in the tree, EXCLUDING `except` — the bare-form ambiguity probe for `.base` targets. */
function countTreeFilesNamed(nodes: readonly TreeNode[], name: string, except: string): number {
  let count = 0
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.path !== except && node.name.toLowerCase() === name.toLowerCase()) count++
    } else count += countTreeFilesNamed(node.children, name, except)
  }
  return count
}

export interface UpdateLinksOptions {
  root: string
  oldPath: string
  newPath: string
  /** `dir` for a folder rename/move (E1b, GRO-2241): everything under `oldPath/` moved. Defaults to `file`. */
  kind?: 'file' | 'dir'
  /** The PRE-rename index snapshot (fetched before `fs:rename` — see the module doc). */
  records: readonly IndexRecord[]
  /**
   * The PRE-rename TREE snapshot, for `.base` embed targets only (they resolve through
   * `resolveBasePath`, never the index). Absent → base embeds are left alone (conservative).
   */
  tree?: readonly TreeNode[]
}

/** Rewrite every referencing note on disk; see the module doc for the whole discipline. */
export async function updateLinksAfterRename({ root, oldPath, newPath, kind = 'file', records, tree }: UpdateLinksOptions): Promise<RenameRewriteSummary> {
  const resolver = resolverFor(records, root)
  const prefix = `${oldPath}/`
  const isMoved = kind === 'dir' ? (p: string) => p.startsWith(prefix) : (p: string) => p === oldPath
  const mapMoved = kind === 'dir' ? (p: string) => (p.startsWith(prefix) ? newPath + p.slice(oldPath.length) : p) : (p: string) => (p === oldPath ? newPath : p)
  const relOf = (p: string) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)
  const isBaseTarget = (t: string) => /\.base$/i.test(t)
  const targetPaths = new Map<string, string | null>()
  const resolveTargetPath = (t: string): string | null => {
    let hit = targetPaths.get(t)
    if (hit === undefined) {
      hit = isBaseTarget(t) ? (tree !== undefined ? resolveBasePath(tree, root, t) : null) : resolver(t)?.record.path ?? null
      targetPaths.set(t, hit)
    }
    return hit
  }
  const resolves: ResolvesToOld = (target) => {
    // LOCKED (E1b): across a FOLDER rename, bare-name links keep resolving (names are
    // unchanged) and stay byte-identical — only PATHED targets rewrite in dir mode.
    if (kind === 'dir' && !target.includes('/')) return false
    const hit = resolveTargetPath(target)
    return hit !== null && isMoved(hit)
  }
  // File mode: whether a bare form still wins AFTER the move is decided by RESOLUTION, not
  // text — the post-move record set (the moved record re-pathed) answers it (shallowest rule).
  const newName = basename(newPath)
  const newRel = relOf(newPath)
  const postRecords =
    kind === 'file'
      ? records.map((r) =>
          r.path === oldPath
            ? { ...r, path: newPath, name: newName, basename: stripExt(newName), folder: newRel.includes('/') ? newRel.slice(0, newRel.lastIndexOf('/')) : '' }
            : r,
        )
      : records
  const postResolver = resolverFor(postRecords, root)
  const newTarget: NewTarget = (target) => {
    const moved = mapMoved(resolveTargetPath(target) as string) // non-null: `resolves` vetted this target
    const movedName = basename(moved)
    const movedRel = relOf(moved)
    if (!target.includes('/')) {
      // Bare form (file mode only — dir mode filtered bare targets out above): keep it only
      // when the bare name still resolves to the moved file post-move; otherwise escalate
      // to the pathed form. `.base` targets use the tree-uniqueness probe instead.
      const stillBare = isBaseTarget(target)
        ? tree !== undefined && countTreeFilesNamed(tree, movedName, oldPath) === 0
        : postResolver(stripExt(movedName))?.record.path === moved
      if (!stillBare) return /\.(md|markdown|base)$/i.test(target) ? movedRel : stripExt(movedRel)
    }
    return renamedTarget(target, { newName: movedName, newRel: movedRel })
  }
  const summary: RenameRewriteSummary = { updated: 0, skipped: 0 }
  for (const record of records) {
    if (![...record.links, ...record.embeds].some(resolves)) continue
    // A self-link travels with the file: a moved note is read/written at its NEW path
    // (for a dir, every record under the old prefix relocated).
    const filePath = mapMoved(record.path)
    try {
      // An own-window dirty editor of the referencing note flushes FIRST, so the read below
      // sees its buffer and our write does not race it (the editor then auto-reloads clean).
      await flushRenamedPath(filePath)
      let file = await api.readFile(filePath)
      for (let attempt = 0; ; attempt++) {
        const next = rewriteNoteLinks(file.content, resolves, newTarget)
        if (next === null) break
        try {
          await api.writeFile({ path: filePath, content: next, expectedMtime: file.mtime })
          summary.updated++
          break
        } catch (err) {
          if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT' || attempt > 0) throw err
          file = await api.readFile(filePath) // raced another writer: re-read once, retry
        }
      }
    } catch {
      summary.skipped++
    }
  }
  return summary
}
