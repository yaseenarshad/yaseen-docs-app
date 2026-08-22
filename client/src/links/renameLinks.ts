/**
 * Automatic link updates after an in-app rename (Links E1, GRO-2194 — decision E, GRO-2096:
 * Obsidian's default, no prompt). Runs CLIENT-SIDE in the ORIGINATING window, AFTER the
 * rename succeeded, over the PRE-rename index snapshot (post-rename, the old name no longer
 * resolves, so the referencing set must be computed against the index as it was).
 *
 * Referencing set: records whose `links` or `embeds` resolve — through THE shared resolver
 * (`resolverFor`, the one behind views and wikilink decorations) — to the old path. Per file:
 * `fs:read` → rewrite → `fs:write` with `expectedMtime`; a CONFLICT re-reads once and retries,
 * a second conflict skips the file (someone is actively writing it — their unsaved changes
 * win over our link fix; the link shows as unresolved until fixed by hand).
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
 */
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import type { IndexRecord } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { resolverFor } from '../bases/engine'
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
 * (`[[ B ]]` → `[[C]]`), matching how the resolver reads it anyway.
 */
export function rewriteInner(inner: string, resolves: ResolvesToOld, newTarget: NewTarget): string | null {
  const pipe = inner.indexOf('|')
  const head = pipe >= 0 ? inner.slice(0, pipe) : inner
  const alias = pipe >= 0 ? inner.slice(pipe) : ''
  const hash = head.indexOf('#')
  const target = (hash >= 0 ? head.slice(0, hash) : head).trim()
  const suffix = hash >= 0 ? head.slice(hash) : ''
  if (target === '' || !resolves(target)) return null
  return newTarget(target) + suffix + alias
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

export interface UpdateLinksOptions {
  root: string
  oldPath: string
  newPath: string
  /** The PRE-rename index snapshot (fetched before `fs:rename` — see the module doc). */
  records: readonly IndexRecord[]
}

/** Rewrite every referencing note on disk; see the module doc for the whole discipline. */
export async function updateLinksAfterRename({ root, oldPath, newPath, records }: UpdateLinksOptions): Promise<RenameRewriteSummary> {
  const resolver = resolverFor(records, root)
  const resolves: ResolvesToOld = (target) => resolver(target)?.record.path === oldPath
  const newName = basename(newPath)
  const newRel = newPath.startsWith(`${root}/`) ? newPath.slice(root.length + 1) : newPath
  const newTarget: NewTarget = (target) => renamedTarget(target, { newName, newRel })
  const summary: RenameRewriteSummary = { updated: 0, skipped: 0 }
  for (const record of records) {
    if (![...record.links, ...record.embeds].some(resolves)) continue
    // A self-link travels with the file: the renamed note itself is read/written at its NEW path.
    const filePath = record.path === oldPath ? newPath : record.path
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
