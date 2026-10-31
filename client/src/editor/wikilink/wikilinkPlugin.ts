/**
 * Wikilink rendering in the editor (Links A, GRO-2190): `[[target]]` stays PLAIN TEXT in the
 * document (Crepe parses it as text; `postProcessMarkdown` un-escapes it on save) and a `$prose`
 * plugin renders it Obsidian-live-preview style with DECORATIONS only — never a schema or
 * serializer change, so round-trip stays byte-identical (`roundtrip.test.ts`).
 *
 * Display (caret outside the match):
 *  - the `[[` / `]]` brackets get `wikilink__syntax` (CSS `display: none`),
 *  - `[[target|alias]]` hides `target|` and shows only the alias,
 *  - `[[target#heading]]` shows `target > heading` (the `#` is hidden; each post-`#` segment
 *    carries `wikilink__sub`, whose CSS `::before` draws the ` > ` separator),
 *  - `[[<id>]]` (YAZ-2293 — the target is a note's permanent id, and the source resolves it) hides
 *    the id as well and shows the note's CURRENT TITLE in its place: the one WIDGET here, every
 *    other decoration only hides or styles characters the document holds. The title is read off
 *    the index at each build, so a rename changes what the link shows and not one byte of the
 *    document. A hand-typed `[[<id>|label]]` shows its label; an id no note has, and any id before
 *    the index loads, shows as the raw id, like a name,
 *  - a link that resolves shows its page's NAME (YAZ-3778 D2, D3): the folders of a pathed
 *    `[[folder/name]]` and an extension the sidebar hides (`.md`, a drawing's, a diagram's) are
 *    syntax too. A dead link keeps its text (S12),
 *  - an ID of this vault that no note has (YAZ-3905 S10) shows "Missing note · YAS-466" in place of
 *    the id, a widget as the title is; an ID of another vault of the window (S23) shows its vault after
 *    it, "INL-4 (In-harness-lab)", a widget too. Both stay dimmed (`wikilink--unresolved`),
 *  - a match whose display would be EMPTY (`[[Note|]]`, `[[|]]`, `[[#]]`) stays raw — no
 *    decorations at all, so nothing ever collapses to a zero-width invisible run (FN12,
 *    GRO-2197),
 *  - visible segments get `wikilink` (accent + pointer cursor), plus `wikilink--unresolved`
 *    (dimmed) when the resolve source cannot find the target. Click handling lives in the
 *    sibling `wikilinkClick.ts` (Links C, GRO-2192), which navigates on mousedown over these
 *    decorated spans; this plugin stays decoration-only.
 *
 * Caret inside or immediately adjacent (selection overlapping the match, boundaries INCLUSIVE):
 * that match's decorations drop entirely — raw `[[syntax]]` is visible and editable. This is
 * also what makes arrow traversal work with `display: none` hiding: the caret can never sit
 * against hidden text, because by the time it reaches a match boundary the match is already raw.
 * The title widget sits INSIDE the match (after the `[[`), so the same rule covers it: no caret
 * is ever beside it, and it is gone before the caret reaches the id.
 *
 * An ID link that shows its title is the exception (YAZ-3744 D1): it opens only with the selection
 * STRICTLY inside it, which "Edit link" alone puts there. Its sibling `idLinkCaret.ts` steps a
 * caret over it and removes it whole, so no caret is left against its hidden text.
 *
 * Exclusions: `![[…]]` embeds (image embeds stay plain),
 * `code_block` nodes and inline-`code` marked text (mirrors the index's `stripCode`,
 * CONTRACTS "Property index").
 *
 * Resolution: the ONE resolver (`views/engine.ts` `resolverFor`) reaches the plugin through a
 * `WikilinkResolveSource` — a mutable holder App owns. Index updates call `source.update(...)`,
 * which pokes every subscribed editor with a meta transaction: decorations recompute live, the
 * Crepe instance is never recreated and the document never changes.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Selection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { WIKILINK_RE } from '@shared/linkRewrite'
import { isNoteId, isNumberId, vaultNoteId } from '@shared/noteId'
import { boardBaseName, fileKind } from '@shared/fileKind'
import { basename, type IndexRecord } from '@shared/types'
import { fileLabel, pageLabel, pathTitles, type PathTitles } from '../../lib/pageLabel'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from './viewOnlyLinkSource'
import './wikilink.css'

export const WIKILINK_CLASS = 'wikilink'
export const WIKILINK_UNRESOLVED_CLASS = 'wikilink--unresolved'
export const WIKILINK_SYNTAX_CLASS = 'wikilink__syntax'
export const WIKILINK_SUB_CLASS = 'wikilink__sub'

/**
 * How a resolved link looks (YAZ-3609 D13): the attributes that draw the icon its file has in the sidebar on
 * the `::before` of the span that shows the link's text (`fileIconDecoration`). Absent → no icon.
 */
export interface LinkLook {
  icon: (path: string, folder: boolean) => Record<string, string>
}

/** Link target → resolved absolute path — a note's file, else a folder's directory (YAZ-2290 D10) — or null when nothing matches. */
export type ResolveLink = (target: string) => string | null

/**
 * The names of the window's vaults whose ID letters are `letters` (in capitals), read live (YAZ-3905 S23): an
 * unresolved `[[INL-4]]` names the vault it came from. Absent, or [] → no vault.
 */
export type VaultsOfLetters = (letters: string) => readonly string[]

/** How the latest resolver reaches the plugin; see `createWikilinkResolveSource`. */
export interface WikilinkResolveSource {
  /** null until the vault index first loads — every link renders as resolved meanwhile. */
  readonly resolve: ResolveLink | null
  /**
   * The index snapshot `resolve` was built from — `[]` until the first index lands. The
   * decorations never read it; the backlinks section does (Links D, GRO-2193), and pairing it
   * with the resolver in ONE object is what guarantees the two can never come from different
   * snapshots.
   */
  readonly records: readonly IndexRecord[]
  /** The same snapshot's folder settings records (YAZ-2290 D8) — never among `records`. */
  readonly folders: readonly IndexRecord[]
  /** Does the snapshot's vault give its notes IDs (YAZ-2523 🔒 V5)? false until the first index lands. */
  readonly ids: boolean
  /**
   * The vault's ID letters (`IndexResponse.letters`, YAZ-2677 R5), the current ones first; none where
   * it does not use IDs. `vaultNoteId` reads a link target with them: other `LETTERS-NUMBER` text is a name (R6).
   */
  readonly letters: readonly string[]
  /** Wakes subscribed editors (decoration recompute) whenever `resolve` is swapped. */
  subscribe(listener: () => void): () => void
}

export interface MutableWikilinkResolveSource extends WikilinkResolveSource {
  /**
   * Swap in a fresh resolver + its snapshot (index refetch) and notify every subscriber.
   * `records` omitted = no snapshot in play (decoration-only mounts): backlinks have nothing
   * to list, which is exactly right — the resolver alone cannot say who links where.
   * `null` forgets the vault (a change of root): no index has landed for the new one yet.
   */
  update(resolve: ResolveLink | null, records?: readonly IndexRecord[], folders?: readonly IndexRecord[], ids?: boolean, letters?: readonly string[]): void
}

const NO_RECORDS: readonly IndexRecord[] = []
const NO_LETTERS: readonly string[] = []

export function createWikilinkResolveSource(): MutableWikilinkResolveSource {
  let current: ResolveLink | null = null
  let snapshot: readonly IndexRecord[] = NO_RECORDS
  let settings: readonly IndexRecord[] = NO_RECORDS
  let usesIds = false
  let idLetters = NO_LETTERS
  const listeners = new Set<() => void>()
  return {
    get resolve() {
      return current
    },
    get records() {
      return snapshot
    },
    get folders() {
      return settings
    },
    get ids() {
      return usesIds
    },
    get letters() {
      return idLetters
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(resolve, records = NO_RECORDS, folders = NO_RECORDS, ids = false, letters = NO_LETTERS) {
      current = resolve
      snapshot = records
      settings = folders
      usesIds = ids
      idLetters = letters
      listeners.forEach((l) => l())
    },
  }
}

// The wiki link pattern is the shared rewrite's (YAZ-2677): the editor and the rewrite read one shape.
export { WIKILINK_RE }

/**
 * The page-name half of a raw `[[inner]]` text: `|alias` and `#heading` / `#^block` stripped,
 * trimmed. '' for the same-file `[[#h]]` form. The ONE strip shared by the decorations below,
 * click navigation and create-on-click (`wikilinkClick.ts` / `createFromLink.ts`, Links C).
 */
export function linkPageName(inner: string): string {
  return inner.split('|')[0].split('#')[0].trim()
}

/**
 * The title an id link shows (YAZ-2293): `target` is a note's id and `resolve` finds the note →
 * its title, by `titles` (YAZ-2420 🔒 D14). undefined for a name, for an id no note has, and before
 * the index has loaded — all of which show the target as written. The ONE answer shared by the
 * decorations, the backlinks snippets and the right-click menu (`wikilinkMenu.ts`).
 *
 * The target is tested by its SHAPE, old or number (YAZ-2677): the vault is not known here. So a
 * name that reads like a number ID and finds a note by that name (R6, S26) shows that note's title.
 */
export function idLinkTitle(target: string, resolve: ResolveLink | null, titles: PathTitles): string | undefined {
  const path = resolve !== null && isNoteId(target) ? resolve(target) : null
  return path === null ? undefined : pageLabel(path, false, titles)
}

/** An unpiped ID link that shows its note's title (YAZ-3744 D1): one unit, which the caret steps over (`idLinkCaret.ts`). */
export function showsTitle(inner: string, source: WikilinkResolveSource): boolean {
  return !inner.includes('|') && idLinkTitle(linkPageName(inner), source.resolve, pathTitles(source.records, source.folders)) !== undefined
}

/**
 * The ID of THIS vault that a link's page part is, as the app writes it (YAZ-2677 R2), or undefined: a vault with no IDs
 * (YAZ-2523 🔒 V5), a name, and other `LETTERS-NUMBER` text (R6). `[[yas-466]]` is "YAS-466".
 */
export function linkNoteId(page: string, { ids, letters }: Pick<WikilinkResolveSource, 'ids' | 'letters'>): string | undefined {
  return ids ? vaultNoteId(page, letters) : undefined
}

/** "AR v2 plan (YAS-466)" (YAZ-3744 S8): the one text of an ID link's name and ID, for a plain-text copy and "Copy name and ID". */
export const nameAndId = (title: string, id: string): string => `${title} (${id})`

/**
 * The ID of THIS vault a link names whose note is gone (YAZ-3905 S10), as the app writes it, or undefined: a found
 * link, a name, a vault that does not use IDs, and any link before the index loads (nothing is known yet).
 */
export function missingId(inner: string, source: WikilinkResolveSource): string | undefined {
  if (!source.ids || source.resolve === null) return undefined
  const page = linkPageName(inner)
  const id = vaultNoteId(page, source.letters)
  return id !== undefined && source.resolve(page) === null ? id : undefined
}

/**
 * An unresolved `[[LETTERS-NUMBER]]` whose letters are another vault's of the window (YAZ-3905 S23): the ID as
 * written, and the one vault it names, or null when two or more have those letters ("another vault"). Null for
 * the rest: this vault's letters win (then it is this vault's ID), a found link, and before the index loads.
 */
export function otherVaultId(inner: string, source: WikilinkResolveSource, vaultsOf: VaultsOfLetters | undefined): { id: string; vault: string | null } | null {
  const page = linkPageName(inner)
  if (vaultsOf === undefined || source.resolve === null || !isNumberId(page) || vaultNoteId(page, source.letters) !== undefined || source.resolve(page) !== null) return null
  const names = vaultsOf(page.slice(0, page.indexOf('-')).toUpperCase())
  return names.length === 0 ? null : { id: page, vault: names.length === 1 ? names[0]! : null }
}

/**
 * The hidden ends of a link's page part (YAZ-3778 D2, D3): the folders before its name, and an extension the
 * sidebar hides (`fileLabel`: a note's, a drawing's, a diagram's). `[0, 0]` when nothing would be left.
 */
function pageTrim(page: string): [lead: number, trail: number] {
  const lead = page.lastIndexOf('/') + 1
  const name = page.slice(lead)
  const bare = fileLabel(name)
  return bare.trim() === '' ? [0, 0] : [lead, name.length - bare.length]
}

/**
 * The DISPLAY text the collapsed decorations show for a raw `[[inner]]` match: the alias after
 * the first `|` when piped, else the non-empty `#`-split parts joined with the ` > ` separator
 * the CSS draws between segments — the page part replaced by `titleOf`'s answer when it has one
 * (an id link's title, `idLinkTitle`), else, when `named` says the page is found, by its name
 * (`pageTrim`, YAZ-3778 D2, D3; a dead link keeps its text, S12). '' means NOTHING would be
 * visible (`[[Note|]]`, `[[|]]`, `[[#]]`) — such a match stays raw (FN12, GRO-2197; see
 * `decorate`). Exported for the backlinks snippets (FN9, GRO-2197), which must read exactly as
 * the editor renders: one mapping, never a second regex.
 */
export function linkDisplayText(inner: string, titleOf?: (target: string) => string | undefined, named?: (page: string) => boolean): string {
  const pipe = inner.indexOf('|')
  if (pipe >= 0) return inner.slice(pipe + 1)
  const parts = inner.split('#')
  const page = parts[0]
  const [lead, trail] = named?.(page.trim()) === true ? pageTrim(page) : [0, 0]
  parts[0] = titleOf?.(page.trim()) ?? page.slice(lead, page.length - trail)
  return parts.filter((part) => part.length > 0).join(' > ')
}

/**
 * `text` with each `[[link]]` as the note shows it (YAZ-3744 D6): a crumb, a tab's label, a TOC row, a plain-text
 * copy. Embeds and links with nothing to show stay as written. `withId` adds an ID link's ID after its title
 * (YAZ-3744 S8): "AR v2 plan (YAS-466)", for a copy that leaves the app.
 */
export function linksAsShown(text: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource, withId = false): string {
  if (!text.includes('[[')) return text
  const titles = pathTitles(source.records, source.folders)
  const titleOf = (target: string) => {
    const title = idLinkTitle(target, source.resolve, titles)
    const id = withId ? linkNoteId(target, source) : undefined
    return title === undefined || id === undefined ? title : nameAndId(title, id)
  }
  return text.replace(WIKILINK_RE, (raw, bang: string, inner: string) =>
    bang === '!' ? raw : linkDisplayText(inner, titleOf, () => linkIsResolved(inner, source, viewOnly)) || raw)
}

const wikilinkKey = new PluginKey<DecorationSet>('mdapp-wikilink')

/**
 * Calls `cb` for every maximal run of plain text (consecutive text children WITHOUT the
 * inlineCode mark) in `block`. Adjacent text children are contiguous in document positions,
 * so `runPos + offset-in-run` addresses any character of the run. Exported for
 * `wikilinkClick.ts`, which re-finds the clicked match over the same runs.
 */
export function eachPlainRun(block: ProseNode, base: number, cb: (text: string, runPos: number) => void): void {
  let text = ''
  let start = -1
  block.forEach((child, offset) => {
    if (child.isText && !child.marks.some((m) => m.type.name === 'inlineCode')) {
      if (start < 0) start = offset
      text += child.text ?? ''
      return
    }
    if (start >= 0) cb(text, base + start)
    text = ''
    start = -1
  })
  if (start >= 0) cb(text, base + start)
}

/** Push a hidden-syntax decoration (empty ranges are skipped). */
function hide(out: Decoration[], from: number, to: number): void {
  // `syntax` in the spec: what ⌘F reads as hidden (`pillLinks`, YAZ-3744 S9).
  if (from < to) out.push(Decoration.inline(from, to, { class: WIKILINK_SYNTAX_CLASS }, { syntax: true }))
}

/** The DOM an id link's title widget draws: the classes its id text would have worn, and the file's icon (D13). */
function titleSpan(cls: string, title: string, icon?: Record<string, string>): HTMLElement {
  const span = document.createElement('span')
  for (const [name, value] of Object.entries(icon ?? {})) span.setAttribute(name, value)
  span.className = icon === undefined ? cls : `${cls} ${icon.class}`
  span.spellcheck = false
  span.textContent = title
  return span
}

/** The file or folder a `[[link]]` opens, or null: unresolved, a heading of a view-only file, or no index yet. The link menu's place rows (YAZ-3740). */
export function linkPath(inner: string, source: WikilinkResolveSource, viewOnly: ViewOnlyLinkSource | undefined): string | null {
  const view = viewOnly === undefined ? null : viewOnlyLinkTarget(inner)
  return view !== null ? (view.hasSubtarget ? null : viewOnly?.resolve?.(view.page) ?? null) : source.resolve?.(linkPageName(inner)) ?? null
}

/** The icon of the page a resolved link opens (D13), or undefined: no look, unresolved, or no index yet. */
function linkIcon(inner: string, source: WikilinkResolveSource, viewOnly: ViewOnlyLinkSource | undefined, look: LinkLook | undefined): { key: string; attrs: Record<string, string> } | undefined {
  if (look === undefined) return undefined
  const path = linkPath(inner, source, viewOnly)
  if (path == null) return undefined
  // A folder resolves to its directory: no file kind.
  const folder = fileKind(basename(path)) === null
  return { key: path, attrs: look.icon(path, folder) }
}

/** Whether a link counts as found: what it opens is there, or nothing is known yet (no index, `[[#heading]]`). The rule `linkDisplayText`'s `named` takes. */
export function linkIsResolved(inner: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): boolean {
  const viewSource = viewOnly
  const viewTarget = viewSource === undefined ? null : viewOnlyLinkTarget(inner)
  if (viewTarget !== null && viewSource !== undefined) {
    if (viewTarget.hasSubtarget) return false
    return viewSource.resolve === null || viewSource.resolve(viewTarget.page) !== null
  }
  const target = linkPageName(inner)
  return source.resolve === null || target === '' || source.resolve(target) !== null
}

/**
 * The DOM of a vault's name at a link's end, " (In-harness-lab)", with `cls` and `link-pill__vault`: a pill into another
 * vault (D22, YAZ-3738 D4, `markdownLink.ts`) and an ID of another vault (YAZ-3905 S23). A piece of the pill, never text.
 */
export function vaultSpan(cls: string, vault: string): HTMLElement {
  const span = document.createElement('span')
  span.className = `${cls} link-pill__vault`
  span.spellcheck = false
  span.textContent = ` (${vault})`
  return span
}

/** Decorations for one collapsed match: `[[inner]]` starting at `start`. */
function decorate(out: Decoration[], start: number, inner: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource, look?: LinkLook, vaultsOf?: VaultsOfLetters): void {
  // A match whose display would be EMPTY ([[Note|]], [[|]], [[#]]) gets NO decorations at all:
  // hiding every character would leave a zero-width invisible run the click handler cannot see
  // and only exact caret placement can recover — raw-and-editable, the revealed state, is the
  // consistent answer (FN12, GRO-2197).
  const titleOf = (target: string) => idLinkTitle(target, source.resolve, pathTitles(source.records, source.folders))
  if (linkDisplayText(inner, titleOf) === '') return
  const resolved = linkIsResolved(inner, source, viewOnly)
  const cls = resolved ? WIKILINK_CLASS : `${WIKILINK_CLASS} ${WIKILINK_UNRESOLVED_CLASS}`
  const icon = resolved ? linkIcon(inner, source, viewOnly, look) : undefined
  /**
   * The first shown text: its own span carries the file's icon on its `::before`, so icon and text are one box
   * (YAZ-3648) and the text stays real text, which find highlights and the caret walks (YAZ-3657).
   */
  const shown = (from: number, to: number) => {
    // No spellcheck underline on a link's name (YAZ-3778 S13): it is a page's name, not a word to check.
    out.push(Decoration.inline(from, to, icon === undefined ? { class: cls, spellcheck: 'false' } : { ...icon.attrs, class: `${cls} ${icon.attrs.class}`, spellcheck: 'false' }))
  }
  const innerStart = start + 2
  const end = innerStart + inner.length + 2
  hide(out, start, innerStart) // [[
  const pipe = inner.indexOf('|')
  if (pipe >= 0) {
    hide(out, innerStart, innerStart + pipe + 1) // target(#heading)?| — the alias is the display
    shown(innerStart + pipe + 1, end - 2) // never empty: guarded above
  } else {
    // target, then ` > `-separated sub segments for each `#heading` / `#^block` part
    let at = innerStart
    let segments = 0
    const parts = inner.split('#')
    // A missing note shows that it is missing, with its ID (YAZ-3905 S10): in the title's place, as a title is drawn.
    const missing = resolved ? undefined : missingId(inner, source)
    const title = titleOf(parts[0].trim()) ?? (missing === undefined ? undefined : `Missing note · ${missing}`)
    // An ID of another vault says which vault (S23), after the ID.
    const other = resolved || missing !== undefined ? null : otherVaultId(inner, source, vaultsOf)
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        hide(out, at, at + 1) // the #
        at += 1
      }
      const part = parts[i]
      if (i === 0 && title !== undefined) {
        // An id link: the id is syntax too, and the title stands where it was. Keyed by the
        // title, so a rebuild that changes nothing redraws nothing. `title` in the spec: what ⌘F reads (`pillLinks`).
        hide(out, at, at + part.length)
        // With nothing after it, the title is drawn at the link's END, before the caret there (YAZ-3916): a click past it,
        // or ↓ onto its right half, reads as the link's end, an edge, and never as a point inside the link. With a
        // heading after it (`[[id#h]]`) it stands where the id was, so it reads before the heading.
        const lone = parts.length === 1
        out.push(Decoration.widget(lone ? end : at, () => titleSpan(cls, title, icon?.attrs), { key: `${title}|${icon?.key ?? ''}`, title, side: lone ? -1 : 0 }))
        segments++
      } else if (part.length > 0) {
        if (i === 0) {
          // The page's name (YAZ-3778 D2, D3): its folders and an extension the sidebar hides are syntax too; the
          // icon says the kind, the hover and the menu the place. A dead link keeps its text (S12): it shows what is missing.
          const [lead, trail] = resolved ? pageTrim(part) : [0, 0]
          hide(out, at, at + lead)
          shown(at + lead, at + part.length - trail)
          // A drawing's or a diagram's extension is the pill's last piece, shown only with File icons Off, as the sidebar's
          // `name-ending` (app.css; YAZ-3924). ⌘F reads it as hidden text (`syntax`), as it is with the icons on.
          const name = part.slice(lead)
          if (trail > 0 && boardBaseName(name) !== name)
            out.push(Decoration.inline(at + part.length - trail, at + part.length, { class: `${cls} name-ending`, spellcheck: 'false' }, { syntax: true }))
          else hide(out, at + part.length - trail, at + part.length)
          if (other !== null) out.push(Decoration.widget(at + part.length, () => vaultSpan(cls, other.vault ?? 'another vault'), { side: -1, key: `vault:${other.vault ?? ''}` }))
        } else if (segments === 0) shown(at, at + part.length)
        else out.push(Decoration.inline(at, at + part.length, { class: `${cls} ${WIKILINK_SUB_CLASS}`, spellcheck: 'false' }))
        segments++
      }
      at += part.length
    }
  }
  hide(out, end - 2, end) // ]]
}

/** True when the selection touches [from, to] with inclusive boundaries — the reveal rule. */
function touches(sel: Selection, from: number, to: number): boolean {
  return sel.from <= to && sel.to >= from
}

/**
 * Does the selection open the `[[inner]]` at `from`..`to` (raw, editable syntax)? A link the caret is inside or next to
 * opens; an ID link that shows its title opens only with the selection strictly inside it: "Edit link" (YAZ-3744 D1).
 * `showsTitle` (a resolve and a title lookup) runs only for a link the selection touches: most links do not.
 */
function opens(sel: Selection, from: number, to: number, inner: string, source: WikilinkResolveSource): boolean {
  return touches(sel, from, to) && (!showsTitle(inner, source) || (sel.from > from && sel.to < to))
}

/** One textblock's link decorations: the unit of both the full build and the incremental update. */
function decorateBlock(out: Decoration[], block: ProseNode, pos: number, sel: Selection, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource, look?: LinkLook, vaultsOf?: VaultsOfLetters): void {
  eachPlainRun(block, pos + 1, (text, runPos) => {
    for (const m of text.matchAll(WIKILINK_RE)) {
      if (m[1] === '!') continue // embeds are someone else's (or nobody's) business
      const from = runPos + m.index
      const to = from + m[0].length
      if (opens(sel, from, to, m[2], source)) continue // caret inside/adjacent → raw, editable syntax
      decorate(out, from, m[2], source, viewOnly, look, vaultsOf)
    }
  })
}

/**
 * A link of a textblock that shows as a pill (YAZ-3744 S9): its range, the ranges it hides (`wikilink__syntax`: the
 * brackets, an ID, an alias's target, hidden folders and extensions, each `#`), and the text the title widget
 * shows in place of its ID (an ID link's title, or "Missing note · YAS-466", S10), else null.
 */
export interface PillLink {
  from: number
  to: number
  hidden: readonly (readonly [number, number])[]
  title: string | null
}

/**
 * The pills of one textblock at `pos`, drawn by `decorate` itself, so they hide exactly what the note hides. For ⌘F
 * (`findInPage.ts`). A link the selection opens (`decorateBlock`'s reveal rule) is plain text and left out, and so is
 * a link with nothing to show.
 */
export function pillLinks(block: ProseNode, pos: number, sel: Selection, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): PillLink[] {
  if (!block.textContent.includes('[[')) return []
  const pills: PillLink[] = []
  eachPlainRun(block, pos + 1, (text, runPos) => {
    for (const m of text.matchAll(WIKILINK_RE)) {
      if (m[1] === '!') continue
      const from = runPos + m.index
      const to = from + m[0].length
      if (opens(sel, from, to, m[2], source)) continue
      const drawn: Decoration[] = []
      decorate(drawn, from, m[2], source, viewOnly)
      if (drawn.length === 0) continue
      const hidden = drawn.filter((d) => d.from < d.to && d.spec.syntax === true).map((d) => [d.from, d.to] as const)
      const title = drawn.find((d) => typeof d.spec.title === 'string')?.spec.title as string | undefined
      pills.push({ from, to, hidden, title: title ?? null })
    }
  })
  return pills
}

function build(state: EditorState, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource, look?: LinkLook, vaultsOf?: VaultsOfLetters): DecorationSet {
  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') return false
    if (!node.isTextblock) return true
    decorateBlock(decorations, node, pos, state.selection, source, viewOnly, look, vaultsOf)
    return false
  })
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, decorations)
}

/**
 * A keystroke or a caret move can only change the links of the textblocks it touched (YAZ-2131 5C):
 * the ranges its steps replaced, the doc diff (mark steps map no positions), and the blocks under
 * the old and the new selection (the reveal rule). The rest of the set is mapped; only those blocks
 * are decorated again. A randomized test pins the result to `build`.
 */
function updateDecorations(
  set: DecorationSet,
  tr: Transaction,
  oldState: EditorState,
  state: EditorState,
  source: WikilinkResolveSource,
  viewOnly?: ViewOnlyLinkSource,
  look?: LinkLook,
  vaultsOf?: VaultsOfLetters,
): DecorationSet {
  const { doc } = state
  const ranges: [number, number][] = [
    [tr.mapping.map(oldState.selection.from, -1), tr.mapping.map(oldState.selection.to, 1)],
    [state.selection.from, state.selection.to],
  ]
  if (tr.docChanged) {
    set = set.map(tr.mapping, doc)
    tr.mapping.maps.forEach((map, i) => {
      const later = tr.mapping.slice(i + 1)
      map.forEach((_oldFrom, _oldTo, from, to) => ranges.push([later.map(from, -1), later.map(to, 1)]))
    })
    const diffStart = oldState.doc.content.findDiffStart(doc.content)
    if (diffStart !== null) ranges.push([diffStart, oldState.doc.content.findDiffEnd(doc.content)!.b])
  }
  const blocks = new Map<number, ProseNode>()
  for (const [a, b] of ranges) {
    // One position beyond each end, so an edit at a block boundary reaches the blocks on both sides.
    doc.nodesBetween(Math.max(0, Math.min(a, b) - 1), Math.min(doc.content.size, Math.max(a, b) + 1), (node, pos) => {
      if (!node.isTextblock) return true
      blocks.set(pos, node)
      return false
    })
  }
  // One remove and one add for all of them: a select-all edit touches every block in one tree pass.
  const stale: Decoration[] = []
  const fresh: Decoration[] = []
  for (const [pos, block] of blocks) {
    stale.push(...set.find(pos, pos + block.nodeSize))
    if (block.type.name !== 'code_block') decorateBlock(fresh, block, pos, state.selection, source, viewOnly, look, vaultsOf)
  }
  return set.remove(stale).add(doc, fresh)
}

/** Draws every `[[link]]` of the note again, with no edit: the host calls it when the file icons change (YAZ-3609 D13). */
export function redrawWikilinks(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(wikilinkKey, 'look-updated').setMeta('addToHistory', false))
}

export function createWikilink(source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource, look?: LinkLook, vaultsOf?: VaultsOfLetters) {
  return $prose(
    () =>
      new Plugin({
        key: wikilinkKey,
        state: {
          init: (_, state) => build(state, source, viewOnly, look, vaultsOf),
          apply: (tr, set, oldState, state) => {
            if (tr.getMeta(wikilinkKey) !== undefined) return build(state, source, viewOnly, look, vaultsOf) // the resolver changed
            return tr.docChanged || tr.selectionSet ? updateDecorations(set, tr, oldState, state, source, viewOnly, look, vaultsOf) : set
          },
        },
        props: {
          decorations: (state) => wikilinkKey.getState(state),
        },
        view: (editorView) => {
          const unsubscribe = source.subscribe(() => {
            editorView.dispatch(editorView.state.tr.setMeta(wikilinkKey, 'resolver-updated'))
          })
          const unsubscribeViewOnly = viewOnly?.subscribe(() => {
            editorView.dispatch(editorView.state.tr.setMeta(wikilinkKey, 'view-only-resolver-updated'))
          })
          return {
            destroy: () => {
              unsubscribe()
              unsubscribeViewOnly?.()
            },
          }
        },
      }),
  )
}
