/**
 * Standard Markdown link interaction (YAZ-1309).
 *
 * A primary mousedown with an open gesture (Settings › Hotkeys › "Links in a note", YAZ-3936) owns navigation before
 * ProseMirror can move the caret; a read-only note keeps "a click opens". A link that is a pill is one unit, as a
 * `[[link]]` is (YAZ-4021, demo round 4): in an editable note a plain click puts the caret at its nearer edge, a
 * double-click selects it whole, and a drag from it holds it whole (`wikilinkClick.ts`'s rules). `idLinkCaret.ts` keeps
 * the caret out of its words and removes it whole (`markdownPillsAround`), and a letter typed at its end is not part of
 * the link. Typed over the whole selected pill, words rename it and keep the link. Any other link's words are text, as
 * on any text (YAZ-3935). Right-click owns the
 * one link menu (YAZ-3609 D23, `linkMenu.ts`), whose edit/remove actions delegate to Crepe's existing link-tooltip
 * API; no parallel link model or serializer is introduced. Fragment-only hrefs deliberately fall
 * through because they are document-local. A link into a vault of the window opens in a tab here
 * (YAZ-3609 D8, D14) and draws as a pill (D19); every other href goes to the host, and its
 * validation stays at the main process boundary.
 */
import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Mark, MarkType, Node as ProseNode } from '@milkdown/kit/prose/model'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { fileKind } from '@shared/fileKind'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { GestureAction } from '@shared/keys'
import { linkClickAction } from './linkGesture'
import { fileLabel } from '../lib/pageLabel'
import { copyText, linkMenuRows, openMenuAt, placeRows, type LinkActions, type LinkMenu } from './linkMenu'
import { followDrag, nearerEdge } from './wikilink/wikilinkClick'
import { WIKILINK_CLASS, vaultSpan } from './wikilink/wikilinkPlugin'

/** The link menu's place rows (YAZ-3740: `showInSidebar`, Focus and Favorites, "Open in ▸") are App's `LinkActions`: absent, no row. */
export interface MarkdownLinkNav extends LinkActions {
  open: (href: string) => Promise<void> | void
  /** A link to a page, folder or file of this vault (YAZ-3609 D8): its path, or null to leave it to `open`. */
  inApp?: (href: string) => string | null
  /** Opens that path where the open gesture says (YAZ-3936): this tab, a new tab or a background tab. */
  openPath?: (path: string, where: GestureAction) => void
  /** The user's changes of Settings › Hotkeys (`settings.hotkeys`), read at each click: the gestures that open a link. Absent → the defaults. */
  hotkeys?: () => HotkeyOverrides | undefined
  /** A link into a vault the app knows but this window does not show (YAZ-3609 D21): true when the host asked to add it. */
  elsewhere?: (href: string, background: boolean) => boolean
  /** A link into a vault of this window, found or not (YAZ-3609 D19): its absolute path, or null. Such a link is a pill. */
  vaultPath?: (href: string) => string | null
  /** The name of the vault that holds `path` when it is not the note's own (D22), else null: the pill's last piece shows it. */
  vaultTag?: (path: string) => string | null
  /** The pill's icon: the decoration attributes that draw the one the sidebar gives `path` (D13, D19, `fileIconDecoration`). */
  icon?: (path: string, folder: boolean) => Record<string, string>
  /** Injectable for tests; the app uses the platform clipboard by default. */
  copy?: (href: string) => Promise<void> | void
  onNotice: (message: string) => void
}

interface LinkHit {
  href: string
  mark: Mark
  from: number
  to: number
}

/** Its decorations are read by `pillSelection.ts`: a selected link's pieces. */
export const markdownLinkKey = new PluginKey<DecorationSet>('mdapp-markdown-link')
const REDRAW = 'redraw-pills'

const addLinkOf = new WeakMap<EditorView, (range?: { from: number; to: number }) => boolean>()

/**
 * Opens the link box on `range` (default: `view`'s selection), as the note menu's "Add link…" (YAZ-3609 D17).
 * The menu passes the selection it opened on: closing it gives the note its focus back, which can move the
 * selection. False with no words, in a read-only note, or with no link plugin.
 */
export function addLinkOn(view: EditorView, range?: { from: number; to: number }): boolean {
  return addLinkOf.get(view)?.(range) ?? false
}

/**
 * The link pills of the textblock that holds `pos` (YAZ-4021): each pill's words, from its first piece to its last. A
 * pill's pieces share one spec object (`pillsIn`), so a bold piece inside a link is the same pill. Only that textblock's
 * decorations are read.
 */
export function markdownPillsAround(state: EditorState, pos: number): Array<{ from: number; to: number }> {
  const set = markdownLinkKey.getState(state)
  if (set === undefined || set === DecorationSet.empty) return []
  const $pos = state.doc.resolve(pos)
  if (!$pos.parent.isTextblock) return []
  const pills = new Map<object, { from: number; to: number }>()
  for (const piece of set.find($pos.start(), $pos.end(), (spec) => spec.pill !== undefined)) {
    if (piece.from >= piece.to) continue
    const pill = pills.get(piece.spec.pill)
    pills.set(piece.spec.pill, pill === undefined ? { from: piece.from, to: piece.to } : { from: Math.min(pill.from, piece.from), to: Math.max(pill.to, piece.to) })
  }
  return [...pills.values()]
}

/** Draws every link pill of the note again (YAZ-3664): the host calls it when the window's vaults change. No document change. */
export function redrawLinkPills(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(markdownLinkKey, REDRAW).setMeta('addToHistory', false))
}

const failureMessage = (prefix: string, error: unknown): string =>
  `${prefix}: ${error instanceof Error ? error.message : String(error)}`

/** Normalize synchronous throws and promise rejections onto the same passive-notice path. */
const attempt = (run: () => Promise<void> | void, prefix: string, onNotice: MarkdownLinkNav['onNotice']): void => {
  try {
    void Promise.resolve(run()).catch((error: unknown) => onNotice(failureMessage(prefix, error)))
  } catch (error) {
    onNotice(failureMessage(prefix, error))
  }
}

/**
 * Maps a rendered anchor back to its one ProseMirror link mark and complete inline range.
 * ProseMirror can render `[**bold** plain](href)` as adjacent anchors around differently marked
 * inline nodes, so the DOM anchor's range is not the logical link's range. Expand across every
 * contiguous sibling carrying the same link mark instead.
 */
function linkHit(view: EditorView, ctx: Ctx, target: EventTarget | null): LinkHit | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a')
  if (anchor === null || !view.dom.contains(anchor)) return null
  const probe = view.posAtDOM(anchor, 0)
  const $probe = view.state.doc.resolve(probe)
  if (!$probe.parent.isTextblock) return null
  const type = linkSchema.type(ctx)
  const start = $probe.start()
  const spans: Array<{ from: number; to: number; mark: Mark | null }> = []
  $probe.parent.forEach((node, offset) => {
    spans.push({ from: start + offset, to: start + offset + node.nodeSize, mark: type.isInSet(node.marks) ?? null })
  })
  const index = spans.findIndex((span) => span.mark !== null && probe >= span.from && probe < span.to)
  if (index < 0) return null
  const mark = spans[index]!.mark!
  let first = index
  let last = index
  while (first > 0 && spans[first - 1]!.mark?.eq(mark) === true) first -= 1
  while (last + 1 < spans.length && spans[last + 1]!.mark?.eq(mark) === true) last += 1
  if (typeof mark.attrs.href !== 'string') return null
  return { href: mark.attrs.href, mark, from: spans[first]!.from, to: spans[last]!.to }
}

/**
 * The link pills of the textblocks between `from` and `to` (D19), in `set` with those blocks' old pills
 * replaced: each run of one link mark whose path is in a vault of the window. The first piece of a run
 * carries the icon; a bold or code piece inside the link is part of the same pill, with no second icon (YAZ-3656).
 */
function pillsIn(doc: ProseNode, from: number, to: number, type: MarkType, nav: MarkdownLinkNav, set: DecorationSet): DecorationSet {
  const stale: Decoration[] = []
  const fresh: Decoration[] = []
  doc.nodesBetween(Math.max(0, from), Math.min(doc.content.size, Math.max(from, to)), (block, pos) => {
    if (!block.isTextblock) return true
    stale.push(...set.find(pos, pos + block.nodeSize))
    let run: { mark: Mark; pieces: Array<[number, number]> } | null = null
    const close = () => {
      const href = run?.mark.attrs.href
      // A `#heading` link stays text (YAZ-4033): the host resolves its empty path to the note's folder.
      const path = typeof href === 'string' && !href.startsWith('#') ? nav.vaultPath?.(href) ?? null : null
      if (run !== null && path !== null && nav.icon !== undefined) {
        const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
        const icon = nav.icon(path, fileKind(name) === null && !name.includes('.'))
        const last = run.pieces.length - 1
        const vault = nav.vaultTag?.(path) ?? null
        // One object for the pill's pieces: `markdownPillsAround` finds the whole pill from any piece (YAZ-4021).
        const pill = {}
        run.pieces.forEach(([start, end], i) => {
          const edges = `${i === 0 ? ' link-pill--first' : ''}${i === last ? ' link-pill--last' : ''}`
          const attrs: Record<string, string> = i === 0 ? { ...icon, class: `wikilink link-pill${edges} ${icon.class}`, spellcheck: 'false' } : { class: `wikilink link-pill${edges}`, spellcheck: 'false' }
          fresh.push(Decoration.inline(start, end, attrs, { pill }))
        })
        // Its vault's name is the pill's last piece (YAZ-3738 D4): drawn before the caret at the link's end, so the
        // caret shows after the whole pill. Inside the link's anchor: a click on it opens the link, as on the text.
        const mark = run.mark
        if (vault !== null) fresh.push(Decoration.widget(run.pieces[last]![1], () => vaultSpan('wikilink link-pill link-pill--last', vault), { side: -1, marks: [mark], key: `vault:${vault}` }))
      }
      run = null
    }
    block.forEach((node, offset) => {
      const mark = node.isText ? type.isInSet(node.marks) : undefined
      const start = pos + 1 + offset
      if (mark === undefined) close()
      else if (run !== null && run.mark.eq(mark)) run.pieces.push([start, start + node.nodeSize])
      else {
        close()
        run = { mark, pieces: [[start, start + node.nodeSize]] }
      }
    })
    close()
    return false
  })
  return set.remove(stale).add(doc, fresh)
}

/**
 * The one link menu's rows for a Markdown link (YAZ-3609 D23, YAZ-3740, `linkMenu.ts`). A link into a vault of the
 * window opens in a new tab too, and copies its name; one whose page is there
 * has the place rows (Show in sidebar, Copy path, Focus, Favorites, "Open in ▸"). Any other link opens only through
 * the OS, and "Copy address" copies its href.
 */
function menuOf(view: EditorView, hit: LinkHit, ctx: Ctx, nav: MarkdownLinkNav, follow: (href: string, where: GestureAction) => void): LinkMenu {
  const path = nav.vaultPath?.(hit.href) ?? null
  // The page's name as the sidebar shows it (YAZ-3778 D2): no `.md`, no drawing's or diagram's extension.
  const name = path === null ? null : fileLabel(path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1))
  const local = hit.href.startsWith('#')
  // Only a file or folder that is there, found as a click finds it.
  const found = path === null ? null : (nav.inApp?.(hit.href) ?? null)
  return {
    // No top line (YAZ-3747 demo): the pill already shows the name and its vault.
    labels: [],
    open: local ? undefined : () => follow(hit.href, 'thisTab'),
    openNew: path === null ? undefined : () => follow(hit.href, 'backgroundTab'),
    copyName: name === null || name === '' ? undefined : () => copyText(name, 'name', nav.onNotice, nav.copy, true),
    copyAddress: path === null ? () => copyText(hit.href, 'address', nav.onNotice, nav.copy) : undefined,
    ...(found === null ? {} : placeRows(found, nav, nav.onNotice, nav.copy)),
    edit: view.editable ? () => ctx.get(linkTooltipAPI.key).editLink(hit.mark, hit.from, hit.to) : undefined,
    remove: view.editable ? () => ctx.get(linkTooltipAPI.key).removeLink(hit.from, hit.to) : undefined,
  }
}

export const createMarkdownLink = (nav: MarkdownLinkNav) =>
  $prose((ctx) => {
    let close = () => {}
    /** A paste event came, and its change has not yet: Milkdown's own paste dispatches with no `paste` meta. */
    let pasting = false

    /** Opens `href` as an open gesture does: a page or file of a vault in the window in a tab, `where` it says (D8, D14, YAZ-3936), anything else through the OS. */
    const type = linkSchema.type(ctx)
    const follow = (href: string, where: GestureAction) => {
      const path = nav.inApp?.(href) ?? null
      if (path !== null && nav.openPath !== undefined) nav.openPath(path, where)
      else if (nav.elsewhere?.(href, where === 'backgroundTab') !== true) attempt(() => nav.open(href), 'Could not open link', nav.onNotice)
    }

    return new Plugin<DecorationSet>({
      key: markdownLinkKey,
      // Text pasted at a pill's edge is not part of the link either (YAZ-4034): only that pill's mark comes off it, so a
      // pasted link keeps its own. Only a paste pays the lookup.
      appendTransaction: (trs, before, state) => {
        if (!trs.some((tr) => tr.docChanged)) return null
        const pasted = pasting || trs.some((tr) => tr.getMeta('paste') === true)
        pasting = false
        if (!pasted || !before.selection.empty) return null
        const at = before.selection.from
        const mark = type.isInSet(before.doc.resolve(at).marks())
        if (mark === undefined || !markdownPillsAround(before, at).some((p) => p.to === at || p.from === at)) return null
        return state.selection.from > at ? state.tr.removeMark(at, state.selection.from, mark) : null
      },
      // A link into a vault of this window looks like a [[link]] (YAZ-3609 D19): its own text is tinted, and the
      // first piece draws the file's icon on its `::before`. Decorations only, so the text stays real text: find and
      // typing next to it (YAZ-3655) work as on any text, and the caret stays out of it (YAZ-4021). The look follows the
      // path, not the index.
      state: {
        init: (_, state) => (nav.vaultPath === undefined ? DecorationSet.empty : pillsIn(state.doc, 0, state.doc.content.size, type, nav, DecorationSet.empty)),
        apply: (tr, set, before, state) => {
          if (nav.vaultPath === undefined) return set
          // The window's vaults changed (YAZ-3664): every link of the note is a pill, or not, again.
          if (tr.getMeta(markdownLinkKey) === REDRAW) return pillsIn(state.doc, 0, state.doc.content.size, type, nav, set)
          if (!tr.docChanged) return set
          const mapped = set.map(tr.mapping, tr.doc)
          // Only the lines the change touched are drawn again: the step ranges, and the doc diff (a mark step maps no positions).
          let from = state.doc.content.size
          let to = 0
          tr.mapping.maps.forEach((map, i) => {
            const later = tr.mapping.slice(i + 1)
            map.forEach((_a, _b, start, end) => {
              from = Math.min(from, later.map(start, -1))
              to = Math.max(to, later.map(end, 1))
            })
          })
          const diff = before.doc.content.findDiffStart(state.doc.content)
          if (diff !== null) {
            from = Math.min(from, diff)
            to = Math.max(to, before.doc.content.findDiffEnd(state.doc.content)?.b ?? diff)
          }
          return from > to ? mapped : pillsIn(state.doc, from, to, type, nav, mapped)
        },
      },
      props: {
        decorations: (state) => markdownLinkKey.getState(state),
        // A letter typed at a pill's edge is not part of the link (YAZ-4021): the link mark would take it in, at its end,
        // or at its start when it starts a line (YAZ-4032). Only a caret in a link pays the lookup. A composition (an
        // accent, a Japanese word) is the browser's (YAZ-4035).
        handleTextInput: (view, from, to, text) => {
          if (from !== to || view.composing) return false
          const mark = type.isInSet(view.state.doc.resolve(from).marks())
          if (mark === undefined || !markdownPillsAround(view.state, from).some((p) => p.to === from || p.from === from)) return false
          view.dispatch(view.state.tr.insertText(text, from, to).removeMark(from, from + text.length, mark).scrollIntoView())
          return true
        },
        handleDOMEvents: {
          paste: () => {
            pasting = true
            return false
          },
          mousedown: (view, event) => {
            if (event.button !== 0) return false
            const hit = linkHit(view, ctx, event.target)
            if (hit === null || hit.href.startsWith('#')) return false
            // Only an open gesture opens (YAZ-3936). A click no gesture has: on a pill, as on a [[link]] (YAZ-4021); on any
            // other link, the editor's, as on text (YAZ-3935).
            const where = linkClickAction(view, event, nav.hotkeys?.())
            if (where !== null) {
              event.preventDefault()
              follow(hit.href, where)
              return true
            }
            if (!view.editable || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.detail > 2) return false
            const span = event.target instanceof Element ? event.target.closest(`.${WIKILINK_CLASS}`) : null
            const pill = span === null ? undefined : markdownPillsAround(view.state, hit.from).find((p) => p.from <= hit.from && hit.to <= p.to)
            if (span === null || pill === undefined) return false
            event.preventDefault()
            const selection = event.detail === 2 ? TextSelection.create(view.state.doc, pill.from, pill.to) : TextSelection.create(view.state.doc, nearerEdge(view, span, pill.from, pill.to, event.clientX))
            view.dispatch(view.state.tr.setSelection(selection))
            view.focus()
            if (event.detail !== 2) followDrag(view, pill, selection.head, event)
            return true
          },
          contextmenu: (view, event) => {
            const hit = linkHit(view, ctx, event.target)
            if (hit === null) return false
            const parent = view.dom.parentElement
            if (parent === null) return false
            event.preventDefault()
            close()
            close = openMenuAt(parent, event.clientX, event.clientY, linkMenuRows(menuOf(view, hit, ctx, nav, follow)))
            return true
          },
        },
      },
      view: (editorView) => {
        // The note menu's "Add link…" (YAZ-3609 D17, `noteMenu.tsx`): Crepe's own link box, on this editor's selection.
        addLinkOf.set(editorView, (range) => {
          const { from, to } = range ?? editorView.state.selection
          if (!editorView.editable || from >= to || to > editorView.state.doc.content.size) return false
          // The words get their selection back first: the box stands by them, and they are what it links.
          editorView.dispatch(editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, from, to)))
          editorView.focus()
          ctx.get(linkTooltipAPI.key).addLink(from, to)
          return true
        })
        // The address in Crepe's link popup is an `<a target="_blank">`: a click there left as a new browser
        // window, and a relative path became the dev server's address and opened in the browser (YAZ-3645).
        // It follows the link as a click on the link does.
        const onPreviewClick = (event: MouseEvent) => {
          const anchor = event.target instanceof Element ? event.target.closest('a.link-display') : null
          const root = editorView.dom.closest('.milkdown')
          // A right-click also sends `auxclick` (button 2): only a left or a middle click follows (YAZ-3650).
          if (anchor === null || root === null || !root.contains(anchor) || event.button > 1) return
          event.preventDefault()
          event.stopPropagation()
          const href = anchor.getAttribute('href') ?? ''
          if (href !== '' && !href.startsWith('#')) follow(href, event.metaKey || event.button === 1 ? 'backgroundTab' : 'thisTab')
        }
        document.addEventListener('click', onPreviewClick, true)
        document.addEventListener('auxclick', onPreviewClick, true)
        return {
          update: (view, previousState) => {
            if (view.state.doc !== previousState.doc) close()
          },
          destroy: () => {
            addLinkOf.delete(editorView)
            document.removeEventListener('click', onPreviewClick, true)
            document.removeEventListener('auxclick', onPreviewClick, true)
            close()
          },
        }
      },
    })
  })
