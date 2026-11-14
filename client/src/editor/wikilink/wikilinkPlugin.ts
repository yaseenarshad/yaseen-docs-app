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
 *  - `[[<id>]]` (YAZ-2293 — the target is a page's permanent id, and the source resolves it) hides
 *    the id as well and shows the page's CURRENT TITLE in its place: the one WIDGET here, every
 *    other decoration only hides or styles characters the document holds. The title is read off
 *    the index at each build, so a rename changes what the link shows and not one byte of the
 *    document. A hand-typed `[[<id>|label]]` shows its label; an id no page has, and any id before
 *    the index loads, shows as the raw id, like a name,
 *  - a link that resolves shows its page's NAME (YAZ-3778 D2, D3): the folders of a pathed
 *    `[[folder/name]]` and an extension the sidebar hides (`.md`, a drawing's, a diagram's) are
 *    syntax too. A dead link keeps its text (S12),
 *  - an ID of this vault that no page has (YAZ-3905 S10) shows "Missing page · YAS-466" in place of
 *    the id, a widget as the title is; an ID of another vault of the window (S23) shows its vault after
 *    it, "INL-4 (In-harness-lab)", a widget too. Both stay dimmed (`wikilink--unresolved`),
 *  - the vault's link pills look (YAZ-4924, `source.pills`) adds a head and a tail piece, widgets, to every pill
 *    (`pillEnds`): the text before and after, the vault's name, the ID, the folder. Look only: the file keeps `[[Name]]`,
 *  - a link to a PAGE CARD (`[[WIKI-512]]`, YAZ-5030: the ID is a card's, `linkCard`) shows the card's title and its
 *    ID, with a card icon (`wikilink--card`), a widget as an ID link's title is; no vault look adds ends to it,
 *  - a match whose display would be EMPTY (`[[Page|]]`, `[[|]]`, `[[#]]`) stays raw — no
 *    decorations at all, so nothing ever collapses to a zero-width invisible run (FN12,
 *    GRO-2197),
 *  - visible segments get `wikilink` (accent), plus `wikilink--unresolved` (dimmed) when the
 *    resolve source cannot find the target. Click handling lives in the sibling
 *    `wikilinkClick.ts` (Links C, GRO-2192; YAZ-3935), which puts the caret or opens on mousedown
 *    over these decorated spans; this plugin stays decoration-only.
 *
 * Every link is ONE UNIT (YAZ-3744 D1 for ID links; YAZ-3935, point 3 of YAZ-3879, for every link): it
 * opens — its decorations drop and the raw `[[syntax]]` is visible and editable — only with the
 * selection STRICTLY inside it, which "Edit link" alone puts there. A caret next to it keeps the pill.
 * Its sibling `idLinkCaret.ts` steps a caret over it and removes it whole, so no caret is left
 * against its hidden text, and the selection closes it again as it leaves.
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
import { boardBaseName, fileKind } from '@shared/fileKind'
import { NO_LINK_PILLS } from '@shared/linkPills'
import { basename } from '@shared/types'
import { pathTitles } from '../../lib/pageLabel'
import { headKey, headSpan, pathInfo, pillIconPlace, pillParts, pillsNeedInfo, tailKey, tailSpan, type PillMeta } from './linkPillLook'
import type { ViewOnlyLinkSource } from './viewOnlyLinkSource'
import { WIKILINK_CLASS, cardPillSpan } from './cardPill'
import './wikilink.css'
// The link resolution moved to its own file (YAZ-5153), so the review screen loads without this plugin; its names stay here too.
export { WIKILINK_RE, cardLinkTitle, cardResolverOf, createWikilinkResolveSource, idLinkTitle, isLinkUnit, linkCard, linkDisplayText, linkIsResolved, linkPageId, linkPageName, linkPath, linkSplit, linksAsShown, missingId, nameAndId, otherVaultId, showsTitle } from './linkResolve'
export type { LinkLook, MutableWikilinkResolveSource, ResolveLink, VaultsOfLetters, WikilinkResolveSource } from './linkResolve'
import { cardLinkTitle, idLinkTitle, linkCard, linkDisplayText, linkIsResolved, type LinkLook, linkPath, linkSplit, missingId, otherVaultId, pageTrim, type VaultsOfLetters, type WikilinkResolveSource } from './linkResolve'

// The card pill moved to its own file (YAZ-5067), so the card drawing loads without this plugin; its names stay here too.
export { WIKILINK_CARD_CLASS, WIKILINK_CARD_ID_CLASS, WIKILINK_CLASS, cardPillSpan } from './cardPill'
export const WIKILINK_UNRESOLVED_CLASS = 'wikilink--unresolved'
export const WIKILINK_SYNTAX_CLASS = 'wikilink__syntax'
export const WIKILINK_SUB_CLASS = 'wikilink__sub'

/** Its decorations are read by `pillSelection.ts`: a selected link's pieces. */
export const wikilinkKey = new PluginKey<DecorationSet>('mdapp-wikilink')

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

/** The icon of the page a resolved link opens (D13), or undefined: no look, unresolved, or no index yet. */
function linkIcon(inner: string, source: WikilinkResolveSource, viewOnly: ViewOnlyLinkSource | undefined, look: LinkLook | undefined): { key: string; attrs: Record<string, string> } | undefined {
  if (look === undefined) return undefined
  const path = linkPath(inner, source, viewOnly)
  if (path == null) return undefined
  // A folder resolves to its directory: no file kind.
  const folder = fileKind(basename(path)) === null
  return { key: path, attrs: look.icon(path, folder) }
}

/**
 * The pieces a pill gains at its ends under the vault's look (YAZ-4924, `pillParts`): its head and its tail, widgets
 * with the pill's classes, never text. The head stands where the pill's first shown piece starts and the tail where
 * its last shown piece ends (`side: -1` both; an ID link's lone title stands at the link's end, so both stand there
 * too, the head pushed before the title and the tail after it): each is the next sibling of a piece of the pill, so
 * the sibling rules of `wikilink.css` join it to the box, with no hidden syntax span between. Pieces of the pill: a
 * click on one is a click on the pill (`linkPosAtDOM` reads a widget as the position before it, inside the link), and
 * the caret at the link's end shows after the whole pill (YAZ-3738 D4). Today's look gives only the vault's name of
 * an ID of another vault (YAZ-3905 S23), at the tail, as `vaultSpan` drew it.
 */
function pillEnds(inner: string, resolved: boolean, source: WikilinkResolveSource, viewOnly: ViewOnlyLinkSource | undefined, otherVault: string | null, icon: boolean): ReturnType<typeof pillParts> {
  const { pills } = source
  if (pills === NO_LINK_PILLS && otherVault === null) return { head: null, tail: null }
  const path = resolved && pillsNeedInfo(pills) ? linkPath(inner, source, viewOnly) : null
  const meta: PillMeta = { info: path === null ? undefined : pathInfo(source.records, source.folders).get(path), otherVault }
  return pillParts(pills, meta, source.vault, icon)
}

/** Decorations for one collapsed match: `[[inner]]` starting at `start`. */
function decorate(out: Decoration[], start: number, inner: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource, look?: LinkLook, vaultsOf?: VaultsOfLetters): void {
  // A match whose display would be EMPTY ([[Page|]], [[|]], [[#]]) gets NO decorations at all:
  // hiding every character would leave a zero-width invisible run the click handler cannot see
  // and only exact caret placement can recover — raw-and-editable, the revealed state, is the
  // consistent answer (FN12, GRO-2197).
  const titleOf = (target: string) => idLinkTitle(target, source.resolve, pathTitles(source.records, source.folders))
  if (linkDisplayText(inner, titleOf, undefined, source) === '') return
  const resolved = linkIsResolved(inner, source, viewOnly)
  const cls = resolved ? WIKILINK_CLASS : `${WIKILINK_CLASS} ${WIKILINK_UNRESOLVED_CLASS}`
  // The icon where the vault's format puts it (YAZ-4924): on the name's own span (`{icon}{name}`, today's), as a
  // piece of the head or the tail, or nowhere (no `{icon}`: no lookup paid).
  const iconPlace = pillIconPlace(source.pills)
  const found = resolved && iconPlace !== 'none' ? linkIcon(inner, source, viewOnly, look) : undefined
  const icon = iconPlace === 'name' ? found : undefined
  const innerStart = start + 2
  const end = innerStart + inner.length + 2
  const { pipe, pageFirst } = linkSplit(inner, source)
  // A link to a card (YAZ-5030): the whole `[[ID]]` is syntax, and the card's title and ID stand at its end, as a
  // lone ID link's title does (YAZ-3916), one pill with the card icon. `title` in the spec: what ⌘F reads.
  const card = pipe >= 0 || !resolved ? null : linkCard(inner, source)
  if (card !== null) {
    const shown = cardLinkTitle(card)
    hide(out, start, end)
    out.push(Decoration.widget(end, () => cardPillSpan(shown, card.id), { key: `card|${shown}|${card.id}`, title: `${shown} ${card.id}`, side: -1 }))
    return
  }
  const parts = inner.split('#')
  // A missing page shows that it is missing, with its ID (YAZ-3905 S10): in the title's place, as a title is drawn.
  const missing = resolved ? undefined : missingId(inner, source)
  const title = pipe >= 0 ? undefined : titleOf(parts[0].trim()) ?? (missing === undefined ? undefined : `Missing page · ${missing}`)
  // An ID of another vault says which vault (S23), after the ID.
  const other = pipe >= 0 || resolved || missing !== undefined ? null : otherVaultId(inner, source, vaultsOf)
  // The pieces the vault's look adds at the pill's ends (YAZ-4924): the head goes before the first shown piece, the tail after the last.
  const ends = pillEnds(inner, resolved, source, viewOnly, other === null ? null : (other.vault ?? 'another vault'), found !== undefined)
  let lastShown = -1
  /** The first shown piece starts at `pos`: the head stands there, before it. */
  const first = (pos: number) => {
    if (lastShown >= 0) return
    const { head } = ends
    // The key holds the pill's classes: a pill whose page goes missing (or comes back) draws its end again in the new class.
    if (head !== null) out.push(Decoration.widget(pos, () => headSpan(cls, head, found?.attrs), { side: -1, key: `${cls}|${headKey(head)}` }))
    lastShown = pos
  }
  /**
   * The first shown text: its own span carries the file's icon on its `::before`, so icon and text are one box
   * (YAZ-3648) and the text stays real text, which find highlights and the caret walks (YAZ-3657).
   */
  const shown = (from: number, to: number) => {
    first(from)
    // No spellcheck underline on a link's name (YAZ-3778 S13): it is a page's name, not a word to check.
    out.push(Decoration.inline(from, to, icon === undefined ? { class: cls, spellcheck: 'false' } : { ...icon.attrs, class: `${cls} ${icon.attrs.class}`, spellcheck: 'false' }))
    lastShown = to
  }
  hide(out, start, innerStart) // [[
  if (pipe >= 0) {
    // The words are the display, on either side of the `|` (YAZ-4935); the page side and the `|` hide. Never empty: guarded above.
    const at = innerStart + pipe
    if (pageFirst) {
      hide(out, innerStart, at + 1) // target(#heading)?|
      shown(at + 1, end - 2)
    } else {
      shown(innerStart, at)
      hide(out, at, end - 2) // |target(#heading)?
    }
  } else {
    // target, then ` > `-separated sub segments for each `#heading` / `#^block` part
    let at = innerStart
    let segments = 0
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
        first(lone ? end : at)
        out.push(Decoration.widget(lone ? end : at, () => titleSpan(cls, title, icon?.attrs), { key: `${title}|${icon?.key ?? ''}`, title, side: lone ? -1 : 0 }))
        lastShown = lone ? end : at
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
          if (trail > 0 && boardBaseName(name) !== name) {
            out.push(Decoration.inline(at + part.length - trail, at + part.length, { class: `${cls} name-ending`, spellcheck: 'false' }, { syntax: true }))
            lastShown = at + part.length
          } else hide(out, at + part.length - trail, at + part.length)
        } else if (segments === 0) shown(at, at + part.length)
        else {
          out.push(Decoration.inline(at, at + part.length, { class: `${cls} ${WIKILINK_SUB_CLASS}`, spellcheck: 'false' }))
          lastShown = at + part.length
        }
        segments++
      }
      at += part.length
    }
  }
  hide(out, end - 2, end) // ]]
  const { tail } = ends
  if (tail !== null && lastShown >= 0) out.push(Decoration.widget(lastShown, () => tailSpan(cls, tail, found?.attrs), { side: -1, key: `${cls}|${tailKey(tail)}` }))
}

/** True when the selection touches [from, to] with inclusive boundaries — the reveal rule. */
function touches(sel: Selection, from: number, to: number): boolean {
  return sel.from <= to && sel.to >= from
}

/**
 * Does the selection open the `[[inner]]` at `from`..`to` (raw, editable syntax)? Every link is one unit (YAZ-3935,
 * D1 extended to name links): it opens only with the selection strictly inside it, which "Edit link" alone puts there
 * (`idLinkCaret.ts` steps any other caret to an edge). A caret next to it keeps the pill.
 */
function opens(sel: Selection, from: number, to: number): boolean {
  return touches(sel, from, to) && sel.from > from && sel.to < to
}

/** One textblock's link decorations: the unit of both the full build and the incremental update. */
function decorateBlock(out: Decoration[], block: ProseNode, pos: number, sel: Selection, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource, look?: LinkLook, vaultsOf?: VaultsOfLetters): void {
  eachPlainRun(block, pos + 1, (text, runPos) => {
    for (const m of text.matchAll(WIKILINK_RE)) {
      if (m[1] === '!') continue // embeds are someone else's (or nobody's) business
      const from = runPos + m.index
      const to = from + m[0].length
      if (opens(sel, from, to)) continue // "Edit link" put the selection inside → raw, editable syntax
      decorate(out, from, m[2], source, viewOnly, look, vaultsOf)
    }
  })
}

/**
 * A link of a textblock that shows as a pill (YAZ-3744 S9): its range, the ranges it hides (`wikilink__syntax`: the
 * brackets, an ID, an alias's target, hidden folders and extensions, each `#`), and the text the title widget
 * shows in place of its ID (an ID link's title, or "Missing page · YAS-466", S10), else null.
 */
export interface PillLink {
  from: number
  to: number
  hidden: readonly (readonly [number, number])[]
  title: string | null
}

/**
 * The pills of one textblock at `pos`, drawn by `decorate` itself, so they hide exactly what the page hides. For ⌘F
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
      if (opens(sel, from, to)) continue
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

/** Draws every `[[link]]` of the page again, with no edit: the host calls it when the file icons change (YAZ-3609 D13). */
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
