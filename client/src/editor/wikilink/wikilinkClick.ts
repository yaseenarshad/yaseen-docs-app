/**
 * Click navigation on wiki links (Links C, GRO-2192) — the interaction layer over Links A's
 * decorations (`wikilinkPlugin.ts`), wired through `createCrepe({ wikilinkNav })`.
 *
 * MOUSEDOWN, not click: a plain click's default mousedown would set the caret inside the
 * match, and the adjacency rule would flip the decoration into its revealed raw form — the
 * text would flash to `[[raw]]` before any navigation. Acting on mousedown and calling
 * `preventDefault()` keeps the caret and focus exactly where they were: the collapsed link
 * never reveals, and a ⌘ background open leaves the document's focused/unfocused state
 * untouched. This is the Obsidian live-preview model, matched exactly: click NAVIGATES; to
 * EDIT the link text you place the caret adjacent (click outside, arrow in) and edit the
 * raw syntax — which is why a click on REVEALED raw text never navigates: a revealed match
 * has no `.wikilink` decoration span, so this handler ignores it (normal caret placement).
 *
 * Gestures: plain click → `nav.openCurrent`, where Settings › "Open a link in" says (YAZ-3609 D11; the
 * default, This tab, opens in the CURRENT tab — an already-open path
 * goes to its tab, never a new one — of a file with copies, the active copy, else the first); ⌘(meta)-click → NEW BACKGROUND tab (`nav.openBackground`
 * — appended, never activated, never focused; an already-open path is a no-op). An
 * UNRESOLVED link is created first (`createFromLink` — bare targets under `nav.createFolder()`,
 * the Files & Links "default location for new notes" setting read at CLICK time; C2-,
 * GRO-2240), then opened by the same gesture; failures surface via `nav.onNotice` (App's
 * passive link-notice), never a dialog. A click while its note is being made does nothing, and
 * one after it was made, before the index holds it, opens that note (YAZ-2478): two notes of one
 * title are two files, so the disk refuses no second one.
 * Two more notices (F2, GRO-2197) keep otherwise
 * invisible outcomes visible: a click during the pre-index window (nothing resolvable yet)
 * says the index is still loading, and a ⌘-click that CREATES a note names it — the new page
 * opened in a background tab, so nothing else on screen moves. An ID link (YAZ-2293) is the one
 * unresolved link that is NEVER created: an id names a note that existed, so a page called
 * `<id>.md` would be a different note wearing its name — the click says the note is gone
 * and does nothing else. A resolving one opens from its title widget, which carries `.wikilink`
 * and sits inside the match, so the hit-test below finds it like any segment. `[[#h]]`
 * (same-file, empty target) is a no-op — the heading jump is GRO-2239. Alt-/Shift-/Ctrl-modified
 * clicks keep their defaults (future gestures, context menus).
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { vaultNoteId } from '@shared/noteId'
import { createFromLink } from './createFromLink'
import type { LinkActions } from '../linkMenu'
import { WIKILINK_CLASS, WIKILINK_RE, eachPlainRun, linkPageName, otherVaultId, type VaultsOfLetters, type WikilinkResolveSource } from './wikilinkPlugin'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from './viewOnlyLinkSource'

/**
 * How clicks leave the editor: App threads this window's tabs API + notice setter (via Editor). The link menu's
 * place rows (YAZ-3740: `showInSidebar`, Focus and Favorites, "Open in ▸") are App's `LinkActions`: absent, no row.
 */
export interface WikilinkNav extends LinkActions {
  /** Vault root — every created path is built under it. */
  root: string
  /**
   * Root-relative folder where a BARE unresolved link creates its page ('' = the vault
   * root). A getter, read at CLICK time: the host resolves the Files & Links "default
   * location for new notes" setting against ITS OWN page path (`newNoteBase`, C2- GRO-2240),
   * so right-panel and folder editors create beside themselves, not beside the main
   * tab (YAZ-1643); settings changes land live without remounting any editor. Pathed
   * targets (`[[Sub/Page]]`) ignore it — see `planLinkCreation`.
   */
  createFolder: () => string
  /** Plain click: where Settings › "Open a link in" says (YAZ-3609 D11); an already-open path goes to its tab. */
  openCurrent: (path: string) => void
  /** ⌘-click: append a background tab (already-open → no-op; focus never moves). */
  openBackground: (path: string) => void
  /** Create failure: the passive in-window notice (App's link-notice style), never a dialog. */
  onNotice: (message: string) => void
}

const wikilinkClickKey = new PluginKey('mdapp-wikilink-click')

/**
 * The raw inner text of the wikilink match covering `pos`, or null. Re-runs the decoration
 * pass's own scan (plain runs of the block, embeds skipped) so a hit here is exactly a match
 * the plugin decorated — code and `![[…]]` embeds can never navigate.
 */
export function wikilinkInnerAt(doc: ProseNode, pos: number): string | null {
  return wikilinkMatchAt(doc, pos)?.inner ?? null
}

/** The match at `pos` of `wikilinkInnerAt`, with its range: what the link menu edits and removes (YAZ-3609 D23). */
export function wikilinkMatchAt(doc: ProseNode, pos: number): { from: number; to: number; inner: string } | null {
  const $pos = doc.resolve(pos)
  const block = $pos.parent
  if (!block.isTextblock) return null
  let found: { from: number; to: number; inner: string } | null = null
  eachPlainRun(block, $pos.start(), (text, runPos) => {
    for (const m of text.matchAll(WIKILINK_RE)) {
      if (m[1] === '!') continue
      const from = runPos + m.index
      if (pos >= from && pos < from + m[0].length) found = { from, to: from + m[0].length, inner: m[2] }
    }
  })
  return found
}

/**
 * Follows the raw `[[inner]]` as a click does: opens it, in a background tab for `background`; an
 * unresolved link is created first. One for an editor, so the click and the link menu's Open rows
 * (YAZ-3609 D23) share the notes being made.
 */
export function wikilinkFollower(source: WikilinkResolveSource, nav: WikilinkNav, viewOnly?: ViewOnlyLinkSource, vaultsOf?: VaultsOfLetters): (inner: string, background: boolean) => void {
  /** The dead links whose note is being made (null), or was made at that path and is not in the index yet (YAZ-2478): a click on one makes nothing more. */
  const making = new Map<string, string | null>()
  return (inner, background) => {
    const page = linkPageName(inner)
    if (page === '') return // same-file [[#h]] — the heading jump is GRO-2239, not this unit
    const open = background ? nav.openBackground : nav.openCurrent
    const viewSource = viewOnly
    const viewTarget = viewSource === undefined ? null : viewOnlyLinkTarget(inner)
    if (viewTarget !== null && viewSource !== undefined) {
      if (viewTarget.hasSubtarget) {
        nav.onNotice(`Can't open "${viewTarget.raw}": headings and blocks aren't supported for read-only files`)
        return
      }
      if (viewSource.resolve === null) {
        nav.onNotice('File catalog is still loading — try that link again in a moment')
        return
      }
      const viewPath = viewSource.resolve(viewTarget.page)
      if (viewPath === null) nav.onNotice(`Can't open "${viewTarget.page}": file not found`)
      else open(viewPath)
      return
    }
    const resolve = source.resolve
    // Pre-index window: every link renders resolved but nothing can be resolved yet;
    // creating here could shadow an existing note, so the gesture is swallowed — but
    // SAID (GRO-2197): a silently dead click reads as breakage.
    if (resolve === null) {
      nav.onNotice('Vault index is still loading — try that link again in a moment')
      return
    }
    const path = resolve(page)
    const made = making.get(page)
    let other: ReturnType<typeof otherVaultId> = null
    if (path !== null) {
      making.delete(page)
      open(path)
    }
    // An ID of THIS vault that no note has is a deleted note's (YAZ-2677 S25): nothing is
    // created under an ID. Other `LETTERS-NUMBER` text is a name, created like any name
    // (R6, S21, S22); a vault that does not use IDs has no letters, so only an old ID is one there.
    else if (vaultNoteId(page, source.letters) !== undefined) nav.onNotice(source.ids ? 'That note no longer exists' : 'This vault does not use IDs, so this link cannot be opened')
    // An ID of another vault of the window (YAZ-3905 S23): no page of that name is made here; the notice says
    // whose it is. This narrows R6 for this one case: other `LETTERS-NUMBER` text is still a name.
    else if ((other = otherVaultId(inner, source, vaultsOf)) !== null) nav.onNotice(`This ID belongs to ${other.vault === null ? 'another vault' : `the ${other.vault} vault`}. Use a link to that vault.`)
    else if (made === undefined) {
      making.set(page, null)
      void createFromLink(nav.root, inner, source.ids, nav.createFolder(), undefined, source.folders).then((result) => {
        if (result.status === 'created') making.set(page, result.path)
        else making.delete(page)
        if (result.status === 'error') nav.onNotice(result.message)
        else if (result.status === 'created') {
          open(result.path)
          // A ⌘-click's freshly CREATED page landed in a background tab (locked I3
          // ruling — never activated), so name what just appeared (GRO-2197).
          if (background) nav.onNotice(`Created "${page}" in a background tab`)
        }
      })
    } else if (made !== null) open(made)
  }
}

/** The click: `follow` is the editor's one `wikilinkFollower`, shared with the link menu's Open rows. */
export function createWikilinkClick(follow: (inner: string, background: boolean) => void) {
  return $prose(
    () =>
      new Plugin({
        key: wikilinkClickKey,
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey) return false
              if (!(event.target instanceof Element)) return false
              const span = event.target.closest(`.${WIKILINK_CLASS}`)
              // A `.wikilink` span exists ONLY while the match is collapsed (the adjacency rule
              // drops every decoration of a revealed match) — raw text falls through to editing.
              if (span === null || !view.dom.contains(span)) return false
              const inner = wikilinkInnerAt(view.state.doc, view.posAtDOM(span, 0))
              if (inner === null) return false
              // From here the gesture is ours: no caret placement, no focus change, no reveal.
              event.preventDefault()
              follow(inner, event.metaKey)
              return true
            },
          },
        },
      }),
  )
}
