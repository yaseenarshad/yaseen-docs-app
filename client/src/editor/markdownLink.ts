/**
 * Standard Markdown link interaction (YAZ-1309).
 *
 * A primary mousedown owns navigation before ProseMirror can move the caret. Right-click owns the
 * one link menu (YAZ-3609 D23, `linkMenu.ts`), whose edit/remove actions delegate to Crepe's existing link-tooltip
 * API; no parallel link model or serializer is introduced. Fragment-only hrefs deliberately fall
 * through because they are document-local, while all other href validation stays at the main
 * process boundary.
 */
import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Mark, MarkType, Node as ProseNode } from '@milkdown/kit/prose/model'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { fileKind } from '@shared/fileKind'
import { copyLink, linkMenuRows, openMenuAt, type LinkMenu } from './linkMenu'

export interface MarkdownLinkNav {
  open: (href: string) => Promise<void> | void
  /** A link to a page, folder or file of this vault (YAZ-3609 D8): its path, or null to leave it to `open`. */
  inApp?: (href: string) => string | null
  /** Opens that path: in this tab, or in a background tab for a ⌘-click. */
  openPath?: (path: string, background: boolean) => void
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

const markdownLinkKey = new PluginKey<DecorationSet>('mdapp-markdown-link')
const REDRAW = 'redraw-pills'

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
      const path = typeof href === 'string' ? nav.vaultPath?.(href) ?? null : null
      if (run !== null && path !== null && nav.icon !== undefined) {
        const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
        const icon = nav.icon(path, fileKind(name) === null && !name.includes('.'))
        const last = run.pieces.length - 1
        const vault = nav.vaultTag?.(path) ?? null
        run.pieces.forEach(([start, end], i) => {
          const edges = `${i === 0 ? ' link-pill--first' : ''}${i === last ? ' link-pill--last' : ''}`
          const attrs: Record<string, string> = i === 0 ? { ...icon, class: `wikilink link-pill${edges} ${icon.class}` } : { class: `wikilink link-pill${edges}` }
          if (i === last && vault !== null) attrs['data-vault'] = vault
          fresh.push(Decoration.inline(start, end, attrs))
        })
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
 * The one link menu's rows for a Markdown link (YAZ-3609 D23, `linkMenu.ts`). A link into a vault of the window
 * names its page (and its vault, D22) and opens in a new tab too; a web link opens only through the OS.
 */
function menuOf(view: EditorView, hit: LinkHit, ctx: Ctx, nav: MarkdownLinkNav, follow: (href: string, background: boolean) => void): LinkMenu {
  const path = nav.vaultPath?.(hit.href) ?? null
  const name = path === null ? null : path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).replace(/\.md$/i, '')
  const vault = path === null ? null : (nav.vaultTag?.(path) ?? null)
  const local = hit.href.startsWith('#')
  return {
    labels: name === null || name === '' ? [] : [vault === null ? name : `${name} · ${vault}`],
    open: local ? undefined : () => follow(hit.href, false),
    openNew: path === null ? undefined : () => follow(hit.href, true),
    copyLink: () => copyLink(hit.href, nav.onNotice, nav.copy),
    edit: view.editable ? () => ctx.get(linkTooltipAPI.key).editLink(hit.mark, hit.from, hit.to) : undefined,
    remove: view.editable ? () => ctx.get(linkTooltipAPI.key).removeLink(hit.from, hit.to) : undefined,
  }
}

export const createMarkdownLink = (nav: MarkdownLinkNav) =>
  $prose((ctx) => {
    let close = () => {}

    /** Opens `href` as a click on a link does: a page or file of a vault in the window in a tab (⌘: behind, D8, D14), anything else through the OS. */
    const type = linkSchema.type(ctx)
    const follow = (href: string, background: boolean) => {
      const path = nav.inApp?.(href) ?? null
      if (path !== null && nav.openPath !== undefined) nav.openPath(path, background)
      else if (nav.elsewhere?.(href, background) !== true) attempt(() => nav.open(href), 'Could not open link', nav.onNotice)
    }

    return new Plugin<DecorationSet>({
      key: markdownLinkKey,
      // A link into a vault of this window looks like a [[link]] (YAZ-3609 D19): its own text is tinted, and the
      // first piece draws the file's icon on its `::before`. Decorations only, so the text stays real text: the
      // caret, typing next to it (YAZ-3655) and find work as on any text. The look follows the path, not the index.
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
        handleDOMEvents: {
          mousedown: (view, event) => {
            if (event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey) return false
            const hit = linkHit(view, ctx, event.target)
            if (hit === null || hit.href.startsWith('#')) return false
            event.preventDefault()
            follow(hit.href, event.metaKey)
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
        // The text menu's "Add link…" (YAZ-3609 D17): Crepe's own link box, on this editor's selection.
        const offAddLink = window.yaseenDocs?.menu?.onAddLink?.(() => {
          const { from, to, empty } = editorView.state.selection
          if (!editorView.hasFocus() || !editorView.editable || empty) return false
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
          if (href !== '' && !href.startsWith('#')) follow(href, event.metaKey || event.button === 1)
        }
        document.addEventListener('click', onPreviewClick, true)
        document.addEventListener('auxclick', onPreviewClick, true)
        return {
          update: (view, previousState) => {
            if (view.state.doc !== previousState.doc) close()
          },
          destroy: () => {
            offAddLink?.()
            document.removeEventListener('click', onPreviewClick, true)
            document.removeEventListener('auxclick', onPreviewClick, true)
            close()
          },
        }
      },
    })
  })
