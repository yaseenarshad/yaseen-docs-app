/**
 * THE LINK REWRITE OF ONE FILE'S TEXT, shared by the front end and the main process: there is one
 * link parser, never two. The front end's rename (`client/src/links/renameLinks.ts`, Links E1
 * GRO-2194) decides WHICH links a rename moved and hands that in as `resolves` / `newTarget`; the
 * main process changes an ID to a new ID (`rewriteIds`, YAZ-2677 D5 to D7).
 *
 * Body rewriting is a string-level scan with the shared regex semantics: fenced code blocks and
 * inline code spans are skipped via a LENGTH-PRESERVING mirror of the index's `stripCode`
 * discipline (`maskCode` — same fence/span rules, offsets intact so the splice edits the original
 * bytes). `|alias` and `#heading`/`#^block` suffixes are preserved, and `![[embeds]]` get the same
 * treatment. Frontmatter follows the index's link extraction: whole-value exact `[[…]]` strings
 * only (top-level and inside lists), rewritten through `setFrontmatterProperty` so everything else
 * in the block survives byte-for-byte. A folder's values (`in`, D19) hold the same links by the
 * same rule, each rewritten where it stands (`setFrontmatterIn`), and the link leaves of a
 * folder's settings come through their own module (`folderSettingsLinks.ts`, YAZ-864).
 */
import { ALSO_IN_KEY, alsoInEntries } from './alsoIn'
import { mapFolderSettingsLinks } from './folderSettingsLinks'
import { FOLDER_VALUES_KEY, folderBlocks, moveFolderValues } from './folderValues'
import { parseFrontmatter, setFrontmatterIn, setFrontmatterProperty, splitFrontmatter } from './frontmatter'
import { NOTE_ID_KEY, canonicalNoteId, isNoteId } from './noteId'

/** Does this raw link target point at what changed? */
export type ResolvesToOld = (target: string) => boolean

/** Raw target text → its replacement. */
export type NewTarget = (target: string) => string

/** Wiki links and embeds; inner brackets are unrepresentable (same shape as the index's WIKILINK_RE). */
export const WIKILINK_RE = /(!?)\[\[([^[\]]+)\]\]/g

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
 * `[[inner]]` → the rewritten inner, or null when this match is not what changed.
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
export function rewriteExactLink(value: string, resolves: ResolvesToOld, newTarget: NewTarget): string | undefined {
  const m = EXACT_WIKILINK_RE.exec(value.trim())
  if (m === null) return undefined
  const inner = rewriteInner(m[1], resolves, newTarget)
  return inner === null ? undefined : `[[${inner}]]`
}

/** A frontmatter VALUE — a whole-value link, or a list holding some — rewritten, else undefined. */
function rewriteLinkValue(value: unknown, resolves: ResolvesToOld, newTarget: NewTarget): unknown {
  if (typeof value === 'string') return rewriteExactLink(value, resolves, newTarget)
  if (!Array.isArray(value)) return undefined
  let changed = false
  const next = value.map((item: unknown) => {
    const r = typeof item === 'string' ? rewriteExactLink(item, resolves, newTarget) : undefined
    if (r !== undefined) changed = true
    return r ?? item
  })
  return changed ? next : undefined
}

/**
 * A frontmatter string's link TARGET (`|alias` / `#heading` stripped) when it is exactly `[[…]]`,
 * or null — what `rewriteInner` decides on, exposed for a probe that only needs to look.
 */
export function exactLinkTarget(value: string): string | null {
  const m = EXACT_WIKILINK_RE.exec(value.trim())
  if (m === null) return null
  const target = m[1].split('|')[0].split('#')[0].trim()
  return target === '' ? null : target
}

/**
 * One note's full rewrite: body scan + frontmatter whole-value links (through
 * `setFrontmatterProperty`, one key at a time) + the ONE reserved key's nested links
 * (YAZ-864 — see the module doc). Null when nothing changed — the caller never writes an
 * unchanged file, so a page carrying settings that reference nobody stays byte-identical.
 */
export function rewriteNoteLinks(content: string, resolves: ResolvesToOld, newTarget: NewTarget): string | null {
  const { frontmatter, body } = splitFrontmatter(content)
  let out = frontmatter + rewriteBodyLinks(body, resolves, newTarget)
  if (frontmatter !== '') {
    const { properties, error } = parseFrontmatter(frontmatter)
    if (error === undefined) {
      for (const [key, value] of Object.entries(properties)) {
        const next = rewriteLinkValue(value, resolves, newTarget)
        if (next !== undefined) out = setFrontmatterProperty(out, key, next)
      }
      // A folder's values (D19): each block's links by the same rule, each written where it stands.
      for (const [id, block] of folderBlocks(properties)) {
        for (const [key, value] of Object.entries(block)) {
          const next = rewriteLinkValue(value, resolves, newTarget)
          if (next !== undefined) out = setFrontmatterIn(out, [FOLDER_VALUES_KEY, id, key], next)
        }
      }
      // The nested leaves go back as the WHOLE key — the one door's own write shape
      // (`writeFolderSettings`), so nothing about that block is serialised two ways.
      const settings = mapFolderSettingsLinks(properties, (link) => rewriteExactLink(link, resolves, newTarget))
      if (settings !== null) out = setFrontmatterProperty(out, settings.key, settings.value)
    }
  }
  return out === content ? null : out
}

/** An ID as the app writes it (R2) → the ID that takes its place; no entry, or undefined, for an ID that stays. */
export type IdChange = ReadonlyMap<string, string> | ((id: string) => string | undefined)

/**
 * THE ID REWRITE (YAZ-2677 🔒 D5, D6, D7): `content` with each ID that `change` names written as
 * its new ID, wherever a file names a note or a folder by its ID —
 *  - a link in the body, in every form: `[[id]]`, `[[id|label]]`, `[[id#heading]]`, `![[id]]`;
 *  - a link that is a property's whole value, in a list, in a folder's values, and in the link
 *    leaves of a folder's settings (a view's order, an outline line, a column's target);
 *  - an `also_in` entry;
 *  - a folder-value key: the block `in.<id>` moves to the new ID with its values (never over a
 *    block the new ID already has);
 *  - with `own`, the file's own `id:` line.
 *
 * An ID is matched WHOLE — `YAZ-1` is never found in `YAZ-12` — and in any case, and `change` is
 * asked with the form the app writes (`canonicalNoteId`): one entry `YAZ-1` covers `[[yaz-1]]`.
 * Code blocks and code spans are left as they are, and so is every byte of a file that names no
 * changed ID: `changed` is then 0 and `content` the same string. Safe to run again: the second
 * run finds nothing to change. Properties that do not parse keep each byte; the body still changes.
 *
 * The three callers hand in: one ID to its next number (a clash fix), every ID of a vault from its
 * old letters to its new ones (a function), each old 12-character ID to its number (a map).
 */
export function rewriteIds(content: string, change: IdChange, opts: { own?: boolean } = {}): { content: string; changed: number } {
  const ask = typeof change === 'function' ? change : (id: string): string | undefined => change.get(id)
  /** What `written` becomes; undefined when it is no ID, or one that stays. */
  const next = (written: unknown): string | undefined => {
    if (!isNoteId(written)) return undefined
    const id = canonicalNoteId(written)
    const to = ask(id)
    return to === undefined || to === id ? undefined : to
  }
  let changed = 0
  const moved = (target: string): string => {
    changed++
    return next(target) as string
  }
  let out = rewriteNoteLinks(content, (target) => next(target) !== undefined, moved) ?? content
  const { properties, error } = parseFrontmatter(splitFrontmatter(out).frontmatter)
  if (error !== undefined) return { content: out, changed }
  const entries = alsoInEntries(properties)
  const named = entries.map((entry) => next(entry) ?? entry)
  const renamed = entries.filter((entry, i) => named[i] !== entry).length
  if (renamed > 0) {
    // A scalar stays a scalar: `also_in: YAZ-1` is one entry (`alsoInEntries`).
    out = setFrontmatterProperty(out, ALSO_IN_KEY, Array.isArray(properties[ALSO_IN_KEY]) ? named : named[0])
    changed += renamed
  }
  for (const [key] of folderBlocks(properties)) {
    const to = next(key)
    const carried = to === undefined ? out : moveFolderValues(out, key, to)
    if (carried !== out) changed++
    out = carried
  }
  const own = opts.own === true ? next(properties[NOTE_ID_KEY]) : undefined
  if (own !== undefined) {
    out = setFrontmatterProperty(out, NOTE_ID_KEY, own)
    changed++
  }
  return { content: out, changed }
}
