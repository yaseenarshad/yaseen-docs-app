/**
 * Images as first-class citizens (YAZ-1656 / YAZ-1659, 🔒 D2): a ProseMirror NODE VIEW for the
 * commonmark `image` node the schema ALREADY has.
 *
 * THE RULE, stated once because this is the FIRST node view in the codebase: a node view is
 * allowed ONLY on a node the schema already has, and it NEVER touches the serializer. No schema
 * change, no new node, no `toMarkdown` — `![alt|300](images/a.png)` is those bytes on disk before
 * and after, and `roundtrip.test.ts`'s "keeps image alt text" stays the proof. Everything else in
 * this editor renders through DECORATIONS (wikilinks, drawing previews, folds) because their
 * syntax is plain text with no node to hang anything on. An image is different: the parser
 * already makes it a node, and a node view is the honest tool for what decorations cannot do —
 * host resize handles, hold a load/broken STATE, and answer `NodeSelection` with a selected look.
 * A decoration could hide the node and stand a widget beside it, but that widget could never
 * write a width back without a transaction that knows the node — which is a node view by another
 * name, minus ProseMirror's contract for it.
 *
 * DOM: `<span class="image-view" contenteditable="false"><img …><span class="image-view__handle"/>×8
 * <button class="image-view__fold"/></span>`. The wrapper is not editable so the caret never
 * lands inside. `ignoreMutation` ignores every DOM mutation (nothing in here is document content)
 * EXCEPT the `{ type: 'selection' }` pseudo-mutation ProseMirror asks about: swallowing that
 * would make a click on the image invisible to the selection reader, and the node would never
 * select. STATES mirror the drawing preview's: loading is quiet (no spinner, so a cached image
 * never jitters), ready is the image, broken swaps in a small inert chip naming the src AS
 * WRITTEN — the line the user has to fix is the markdown, and the chip shows them what it says.
 *
 * `update()` — an undo of a resize, an external edit of the alt — patches the live `<img>` in
 * place: the width goes to the `--image-width` custom property (imageView.css reads it as
 * `width: var(--image-width, auto)`; no width in the alt = no property), the text to `alt`, the
 * title to `title`. A custom property rather than `style.width` because an inline width beats
 * every stylesheet rule, and a stylesheet STATE — the folded chip of YAZ-1709, set by the outline
 * fold plugin as a node decoration — must be able to override it without `!important`; this view
 * knows nothing about folding beyond rendering the dumb corner fold button the plugin drives.
 * Only a changed SRC rebuilds it, because only a src means a new load. Rebuilding on every attr
 * change would re-request the bitmap and flash the loading state for a width that only needed a
 * style.
 *
 * SRC: `imageSrc()` — the vault protocol URL for a relative src, pass-through for a schemed one.
 * The note's directory is derived ONCE per mount from `root` + `notePath`.
 *
 * SELECTION: a single click is ProseMirror's stock `NodeSelection` on an atom (the schema says
 * `selectable: true`); `selectNode` / `deselectNode` toggle `is-selected`, which is what shows the
 * handles. Double-click on the image opens the host's lightbox (`onOpenImage`, YAZ-1665's modal)
 * with EVERY image on the page — the gallery is walked from the document at open time, no
 * registry of node views, so it is always current and stateless (a folded image is still in the
 * doc, so it is still in the gallery); a broken image has no `<img>` to double-click, so it can
 * never open one.
 *
 * RESIZE (🔒 D3, YAZ-1664): eight handles — four corners, four edge midpoints — and every one of
 * them changes the WIDTH only, so the aspect ratio can never break (the document stores nothing
 * else). A west-side handle grows the image as the pointer moves left; a north/south handle maps
 * the vertical travel through the aspect ratio; a corner takes whichever axis moved more. The
 * width is LIVE on the `<img>` while dragging (clamped to `MIN_WIDTH` … the editor column) and
 * written to the document ONCE when the gesture ends, as `alt|<width>` via `setNodeMarkup` —
 * Obsidian's syntax, the only carrier a schema-free width has (`imageSrc.ts`). The gesture ends
 * on mouseup OR the window losing focus (⌘-Tab mid-drag), either way where it stands; Escape ends
 * it too but puts the start width back and writes nothing; and a mousedown that never moved is a
 * click, not a resize — no width change, no transaction. Listeners sit on `document` / `window`
 * so a pointer that leaves the editor, or the window, still ends the gesture. `stopEvent` claims
 * every event on a handle so ProseMirror neither starts a node drag (the node is `draggable`) nor
 * moves the selection under the gesture; the mousedown itself selects the node so the handles
 * stay visible for the drag. A read-only editor (`view.editable` false) has no gesture at all.
 *
 * A BOARD SRC (YAZ-4828 2B): `![CloudFront|640x360 view=…](../Other/CloudFront.drawio)`, a board in another vault of
 * the window, mounts the board window (`embed/types.ts`, lazy) in place of the `<img>`. The path resolves as the
 * Markdown link pill's does (`ImageBoards.place`). The options live after the first `|` of the alt, and the window's
 * writes go through `setNodeMarkup` (the alt only), outside undo (D4). The image's handles, broken chip and gallery
 * are not a board's: the window has its own handles and double-click (open). The fold reads the image's outline node
 * decoration (`foldableImage`, `folded`) and its arrow toggles that bullet.
 */
import { imageSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin, Selection } from '@milkdown/kit/prose/state'
import type { Decoration, EditorView, NodeView, ViewMutationRecord } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import { optionsPipe, optionsSuffix, parseEmbedOptions, type EmbedOptions } from '@shared/embedOptions'
import { fileKind } from '@shared/fileKind'
import { holdFrames } from '../../lib/colResize'
import type { MenuRow } from '../blockHandleMenu'
import { BOARD_VIEW_META } from '../drawing/boardEmbed'
import { boardImageName, isBoardSrc } from '../drawing/boardEmbedText'
import { BOX_BROKEN_CLASS, menuRowOf, mountInBox, onFlush } from '../embed/hostWindow'
import type { BoardRef, BoardWindowHandle } from '../embed/types'
import { linkMenuRows, openMenuAt } from '../linkMenu'
import { innermostItemPos } from '../outline/listNodes'
import { toggleOutlineFold } from '../outline/outlineFolding'
import { inCellOrNote } from '../table/cellBlocks'
import type { GalleryImage, ImageOptions } from './imageOptions'
import { formatAlt, imageSrc, noteDirRel, parseAlt } from './imageSrc'
import './imageView.css'

export const IMAGE_VIEW_CLASS = 'image-view'
export const IMAGE_HANDLE_CLASS = 'image-view__handle'
export const IMAGE_BROKEN_CLASS = 'image-view__broken'
export const IMAGE_SELECTED_CLASS = 'is-selected'
/**
 * Corner fold button (YAZ-1709). Dumb on purpose: the outline fold plugin decides when it shows
 * (`data-outline-foldable-image`) and what a press does.
 */
export const IMAGE_FOLD_CLASS = 'image-view__fold'

/** Narrower than this and the handles cover the image; the drag clamps here. */
export const MIN_WIDTH = 40

/** Compass names, also each handle's `data-handle` and `image-view__handle--<dir>` modifier. */
export const HANDLE_DIRECTIONS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandleDirection = (typeof HANDLE_DIRECTIONS)[number]

type Status = 'loading' | 'ready' | 'broken'

/** A board image node's options: the alt after its last `|` when that parses (YAZ-4828; an alias before it stays), or null. */
const boardOptions = (alt: string): EmbedOptions | null => {
  const pipe = optionsPipe(alt)
  return pipe < 0 ? null : parseEmbedOptions(alt.slice(pipe + 1))
}

/** The outline's fold of this node (`outlineFolding.ts` sets the spec on the image's node decoration). */
const foldOf = (decorations: readonly Decoration[]): { foldable: boolean; folded: boolean } => {
  const deco = decorations.find((d) => d.spec.foldableImage === true)
  return { foldable: deco !== undefined, folded: deco?.spec.folded === true }
}

class ImageNodeView implements NodeView {
  readonly dom: HTMLSpanElement
  private img: HTMLImageElement | null = null
  private handles: HTMLSpanElement[] = []
  private status: Status = 'loading'
  private resolved = ''
  private text = ''
  /** A board src's window (YAZ-4828), once its chunk is there; `boardOn` while the node shows a board. */
  private board: BoardWindowHandle | null = null
  private boardOn = false
  private selected = false
  private fold = { foldable: false, folded: false }
  /** A board in a table cell (out of scope): its pill line, never a live window. */
  private cell = false
  private closeMenu = () => {}
  /** Ends this board's flush and its place in `boardViews`. */
  private offBoard = () => {}

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly opts: ImageOptions,
    private readonly fromDir: string,
    decorations: readonly Decoration[] = [],
  ) {
    this.dom = document.createElement('span')
    this.dom.className = IMAGE_VIEW_CLASS
    this.dom.setAttribute('contenteditable', 'false')
    this.fold = foldOf(decorations)
    this.render()
  }

  /** (Re)builds the wrapper's children from `this.node`; the wrapper itself is stable for PM. */
  private render(): void {
    const { src, alt, title } = this.node.attrs as { src: string; alt: string; title: string }
    this.unmountBoard()
    if (this.opts.boards !== undefined && isBoardSrc(src)) return this.renderBoard()
    this.resolved = imageSrc(this.opts.root, this.fromDir, src)
    this.setStatus('loading')
    this.dom.replaceChildren()
    const img = document.createElement('img')
    img.draggable = false
    // Decode off the frame (YAZ-2197): a 6 MP photo scrolling in no longer holds the frame while it
    // decodes. The box is sized as before, so nothing moves; `loading="lazy"` stays off for that reason.
    img.decoding = 'async'
    img.addEventListener('load', () => this.setStatus('ready'))
    img.addEventListener('error', () => this.broken(src))
    img.addEventListener('dblclick', () => this.openGallery())
    this.img = img
    this.patch(alt, title)
    // Listeners first, then src: a cached image can fire `load` synchronously in some engines.
    img.src = this.resolved
    this.handles = HANDLE_DIRECTIONS.map((dir) => {
      const handle = document.createElement('span')
      handle.className = `${IMAGE_HANDLE_CLASS} ${IMAGE_HANDLE_CLASS}--${dir}`
      handle.dataset.handle = dir // the selector tests and the e2e spec drag by
      handle.addEventListener('mousedown', (event) => this.startResize(event, dir))
      return handle
    })
    const fold = document.createElement('button')
    fold.type = 'button'
    fold.tabIndex = -1
    fold.className = IMAGE_FOLD_CLASS
    fold.setAttribute('aria-label', 'Collapse image')
    fold.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>'
    this.dom.append(img, ...this.handles, fold)
  }

  /**
   * Every image on the page, in document order, and which one this is. Computed from the document
   * at open time rather than kept in a registry of node views: nothing to keep in sync, and the
   * list is exactly what the document holds this instant.
   */
  private openGallery(): void {
    const onOpenImage = this.opts.onOpenImage
    const pos = this.getPos()
    if (onOpenImage === undefined || pos === undefined) return
    const images: GalleryImage[] = []
    let index = 0
    this.view.state.doc.descendants((node, nodePos) => {
      if (node.type.name !== 'image') return
      const { src, alt } = node.attrs as { src: string; alt: string }
      // A board is a window, never a picture of the gallery (YAZ-4828).
      if (this.opts.boards !== undefined && isBoardSrc(src)) return
      if (nodePos === pos) index = images.length
      images.push({ src: imageSrc(this.opts.root, this.fromDir, src), alt: parseAlt(alt).text })
    })
    onOpenImage({ images, index })
  }

  /** Alt text, `|width` and title onto the live `<img>` — no rebuild, no reload. */
  private patch(alt: string, title: string): void {
    const img = this.img
    if (img === null) return
    const { text, width } = parseAlt(alt)
    this.text = text
    img.alt = text
    // No width in the markdown = no property on the element; the stylesheet's `auto` fallback
    // takes over.
    if (width === null) img.style.removeProperty('--image-width')
    else img.style.setProperty('--image-width', `${width}px`)
    if (title) img.title = title
    else img.removeAttribute('title')
  }

  private setStatus(status: Status): void {
    this.dom.classList.remove(`${IMAGE_VIEW_CLASS}--${this.status}`)
    this.status = status
    this.dom.classList.add(`${IMAGE_VIEW_CLASS}--${status}`)
  }

  /** The chip replaces the image and the handles: there is nothing to resize or open. */
  private broken(src: string): void {
    this.setStatus('broken')
    this.img = null
    this.handles = []
    const chip = document.createElement('span')
    chip.className = IMAGE_BROKEN_CLASS
    chip.textContent = `Broken image: ${src}`
    this.dom.replaceChildren(chip)
  }

  private startResize(event: MouseEvent, dir: HandleDirection): void {
    const img = this.img
    if (img === null || event.button !== 0 || !this.view.editable) return
    event.preventDefault()
    const pos = this.getPos()
    if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    // Which way is "bigger" for this handle: east/south handles grow with +x/+y, west/north with -x/-y.
    const sx = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0
    const sy = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0
    const startX = event.clientX
    const startY = event.clientY
    const rect = img.getBoundingClientRect()
    const startWidth = rect.width || img.offsetWidth
    const startHeight = rect.height || img.offsetHeight
    // Vertical travel becomes width through the aspect ratio; no measurable height → ignore it.
    const aspect = startHeight > 0 ? startWidth / startHeight : 0
    // The editor column is the ceiling — an image wider than the text has nowhere to go.
    const max = Math.max(MIN_WIDTH, this.view.dom.clientWidth || Number.POSITIVE_INFINITY)
    // What Escape puts back: the width property as it was — empty when the alt carried none,
    // and setting a custom property to '' removes it again.
    const startStyle = img.style.getPropertyValue('--image-width')
    let width = startWidth
    this.dom.classList.add(`${IMAGE_VIEW_CLASS}--resizing`)
    const end = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onUp)
      holdFrames(false)
      this.dom.classList.remove(`${IMAGE_VIEW_CLASS}--resizing`)
    }
    const onMove = (e: MouseEvent): void => {
      const dx = sx * (e.clientX - startX)
      const dy = sy * (e.clientY - startY) * aspect
      // A corner follows whichever axis the pointer moved more along; an edge has only one axis.
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy
      width = Math.min(max, Math.max(MIN_WIDTH, startWidth + delta))
      img.style.setProperty('--image-width', `${width}px`)
    }
    // Mouseup, or the window losing focus mid-drag: over where it stands. A width that never moved
    // was a click on the handle, and a click is not a document change.
    const onUp = (): void => {
      end()
      if (width !== startWidth) this.commitWidth(Math.round(width))
    }
    // Escape cancels: the start width back, nothing written. Captured, so the editor's own Escape
    // (the sidebar hand-off) never sees the key that was aimed at the drag.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      end()
      img.style.setProperty('--image-width', startStyle)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onUp)
    holdFrames(true)
  }

  /** ONE document change per gesture: the new width into the alt, everything else untouched. */
  private commitWidth(width: number): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const alt = formatAlt(this.text, width)
    if (alt === this.node.attrs.alt) return
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, alt }))
  }

  update(node: ProseNode, decorations: readonly Decoration[] = []): boolean {
    if (node.type !== this.node.type) return false
    const prev = this.node
    this.node = node
    this.setFold(foldOf(decorations))
    if (node.attrs.src !== prev.attrs.src) this.render()
    else if (this.boardOn) {
      if (node.attrs.alt !== prev.attrs.alt) this.board?.update({ options: boardOptions(node.attrs.alt), ref: this.boardRef() })
    } else if (node.attrs.alt !== prev.attrs.alt || node.attrs.title !== prev.attrs.title) this.patch(node.attrs.alt, node.attrs.title)
    return true
  }

  selectNode(): void {
    this.dom.classList.add(IMAGE_SELECTED_CLASS)
    this.selected = true
    this.board?.setSelected(true)
  }

  deselectNode(): void {
    this.dom.classList.remove(IMAGE_SELECTED_CLASS)
    this.selected = false
    this.board?.setSelected(false)
  }

  destroy(): void {
    this.unmountBoard()
  }

  /** A handle's events are the resize gesture's, never ProseMirror's (no node drag, no caret move). A board's window owns all of its own. */
  stopEvent(event: Event): boolean {
    if (this.boardOn) return true
    const target = event.target
    return target instanceof Node && this.handles.some((h) => h.contains(target))
  }

  // ---- a board src (YAZ-4828) ----

  private boardRef(): BoardRef {
    const { src, alt } = this.node.attrs as { src: string; alt: string }
    const place = this.opts.boards?.place(src) ?? null
    const icon = place === null ? undefined : this.opts.boards?.icon?.(place.path)
    const kind = fileKind(src.replace(/[?#].*$/, '')) === 'diagram' ? 'diagram' : 'drawing'
    return { root: place?.root ?? this.opts.root, path: place?.path ?? null, kind, name: boardImageName(src, alt) ?? src, vault: place?.vault ?? null, ...(icon === undefined ? {} : { icon }) }
  }

  private renderBoard(): void {
    this.boardOn = true
    this.dom.classList.add('board-embed')
    this.setStatus('ready')
    this.img = null
    this.handles = []
    this.dom.replaceChildren()
    const pos = this.getPos()
    this.cell = pos !== undefined && inCellOrNote(this.view.state.doc.resolve(pos))
    const board = () => this.board
    boardWindows.set(this.dom, board)
    let views = boardViews.get(this.view)
    if (views === undefined) boardViews.set(this.view, (views = new Set()))
    views.add(board)
    const offFlush = onFlush(this.view, () => this.board?.flush())
    this.offBoard = () => {
      offFlush()
      views.delete(board)
    }
    const columnWidth = () => this.view.dom.clientWidth
    mountInBox(this.dom, {
      options: boardOptions(this.node.attrs.alt as string),
      columnWidth,
      host: () => ({
        ref: this.boardRef(),
        options: boardOptions(this.node.attrs.alt as string),
        editable: this.view.editable,
        columnWidth,
        onOptions: (next) => this.writeBoardOptions(next),
        onOpen: (how) => {
          const path = this.boardRef().path
          if (path !== null) this.opts.boards?.open?.(path, how)
        },
        onContextMenu: (event) => this.openBoardMenu(event),
        onSelect: () => {
          const pos = this.getPos()
          if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
        },
        onFold: () => {
          const pos = this.getPos()
          const item = pos === undefined ? null : innermostItemPos(this.view.state.doc.resolve(pos))
          if (item !== null) toggleOutlineFold(item)(this.view.state, this.view.dispatch)
        },
      }),
      // A src changed from one board to another mounts again: only the first chunk answer mounts.
      live: () => this.boardOn && this.board === null,
      done: (handle) => {
        this.board = handle
      },
      state: () => ({ selected: this.selected, fold: this.cell ? { foldable: false, folded: true } : this.fold }),
      name: () => this.boardRef().name,
    })
  }

  private unmountBoard(): void {
    if (!this.boardOn) return
    this.boardOn = false
    this.closeMenu()
    this.offBoard()
    boardWindows.delete(this.dom)
    this.board?.destroy()
    this.board = null
    this.dom.classList.remove('board-embed', BOX_BROKEN_CLASS)
    this.dom.style.removeProperty('--board-embed-height')
  }

  private setFold(next: { foldable: boolean; folded: boolean }): void {
    if (this.cell) return
    if (next.foldable !== this.fold.foldable) this.board?.setFoldable(next.foldable)
    if (next.folded !== this.fold.folded) this.board?.setFolded(next.folded)
    this.fold = next
  }

  /** The node at this view's live position, if it is still this board. */
  private liveNode(): { pos: number; node: ProseNode } | null {
    const pos = this.getPos()
    const node = pos === undefined ? null : this.view.state.doc.nodeAt(pos)
    return pos === undefined || node === null || node.type !== this.node.type || node.attrs.src !== this.node.attrs.src ? null : { pos, node }
  }

  /** D4: the options into the alt after its name, outside undo, only in an editable note and only when the text changes. */
  private writeBoardOptions(next: EmbedOptions): void {
    const live = this.view.editable ? this.liveNode() : null
    if (live === null) return
    const alt = live.node.attrs.alt as string
    const pipe = optionsPipe(alt)
    const written = `${pipe < 0 ? alt : alt.slice(0, pipe)}${optionsSuffix(next)}`
    if (written === alt) return
    this.view.dispatch(this.view.state.tr.setNodeMarkup(live.pos, undefined, { ...live.node.attrs, alt: written }).setMeta('addToHistory', false).setMeta(BOARD_VIEW_META, true))
  }

  /** The board link's rows, the window's, then Show as link and Remove embed (D12). */
  private openBoardMenu(event: MouseEvent): void {
    const parent = this.view.dom.parentElement
    const ref = this.boardRef()
    if (parent === null) return
    event.preventDefault()
    this.closeMenu()
    const link = ref.path === null ? undefined : this.opts.boards?.linkMenu?.(ref.path)
    const rows = linkMenuRows({ ...(link ?? { labels: [] }), edit: undefined, remove: undefined, showAsEmbed: undefined })
    const group = (list: MenuRow[]) => {
      if (list.length > 0) rows.push({ ...list[0]!, divider: true }, ...list.slice(1))
    }
    group(this.board?.menuRows().map(menuRowOf) ?? [])
    if (this.view.editable) {
      const edit = this.opts.boards?.onEditInPopup
      group([
        // D12, A11: a drawing in another vault opens in the drawing popup at its own root and path.
        ...(ref.kind === 'drawing' && ref.root !== null && ref.path !== null && edit !== undefined ? [{ label: 'Edit in a popup', run: () => edit(ref.root!, ref.path!) }] : []),
        {
          label: 'Show as link',
          run: () => {
            const live = this.liveNode()
            const mark = this.view.state.schema.marks.link
            if (live === null || mark === undefined) return
            const text = this.view.state.schema.text(ref.name, [mark.create({ href: live.node.attrs.src })])
            this.view.dispatch(this.view.state.tr.replaceWith(live.pos, live.pos + live.node.nodeSize, text))
          },
        },
        {
          label: 'Remove embed',
          danger: true,
          run: () => {
            const live = this.liveNode()
            if (live !== null) this.view.dispatch(this.view.state.tr.delete(live.pos, live.pos + live.node.nodeSize))
          },
        },
      ])
    }
    this.closeMenu = openMenuAt(parent, event.clientX, event.clientY, rows)
  }

  /** Nothing in here is document content — but a selection landing here is still a selection. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type !== 'selection'
  }
}

/** Each board image's window, by its node view's DOM (only while it shows a board): the key plugin below reaches the selected one (D10). */
const boardWindows = new WeakMap<Node, () => BoardWindowHandle | null>()
/** The board images of each editor view: a note that turns read-only tells their windows (item 24), as the text host does. */
const boardViews = new WeakMap<EditorView, Set<() => BoardWindowHandle | null>>()

/**
 * The keys of a selected board image (an embed from another vault, D1), as `boardEmbed.ts` has them for `![[…]]`: the
 * editor keeps the focus, so ⌘+ ⌘− ⌘0 and Shift+1 come here and go to that image's window; Escape first deselects it,
 * the caret after the node (item 20, A2), before the note's Escape leaves for the sidebar. Its plugin view tells the
 * windows when the note turns read-only or editable (item 24).
 */
export const imageBoardKeys = $prose(
  () =>
    new Plugin({
      view: (editorView) => {
        let editable = editorView.editable
        return {
          update: (view) => {
            if (view.editable === editable) return
            editable = view.editable
            boardViews.get(view)?.forEach((board) => board()?.update({ editable }))
          },
        }
      },
      props: {
        handleKeyDown: (view, event) => {
          const sel = view.state.selection
          if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return false
          const dom = view.nodeDOM(sel.from)
          const board = dom === null ? undefined : boardWindows.get(dom)
          if (board === undefined) return false
          if (board()?.handleKey(event) === true) return true
          if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
          view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(sel.to))))
          return true
        },
      },
    }),
)

/** The node view for `image`, registered by createCrepe when the host supplies `opts.image`. */
export function createImageView(opts: ImageOptions) {
  // Derived once per mount: the note does not move while its editor is open (a rename remounts).
  const fromDir = noteDirRel(opts.root, opts.notePath)
  return $view(imageSchema.node, () => (node, view, getPos, decorations) => new ImageNodeView(node, view, getPos, opts, fromDir, decorations))
}

/**
 * An image read from Markdown with no title (or no alt) gets `''`, as every image the editor makes does (Milkdown's
 * schema default); Milkdown's own parser keeps the file's `null`. The file writes both the same way, so two values for
 * one image made a pasted image differ from the same image read back: the next outside save glowed it as a change
 * (YAZ-3704 4I2). One value, so a diff of the note sees no change there.
 */
export const imageParseDefaults = imageSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.addNode(type, { src: node.url, alt: node.alt ?? '', title: node.title ?? '' })
      },
    },
  }
})
