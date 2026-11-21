/**
 * INLINE EXCALIDRAW DRAWING NODE VIEW (YAZ-5040 / YAZ-6120 / YAZ-6132 / YAZ-6133 / YAZ-6134):
 * renders a ```` ```excalidraw ```` `code_block` as a lazy `BoardWindow` (pan/zoom/resize/lock/fit/menu)
 * instead of a CodeMirror box.
 *
 * Chains cleanly with `cardNodeView` and Crepe's stock `code_block` node view by delegating any
 * non-drawing `code_block` to the immediately preceding `code_block` factory in `nodeViewCtx`.
 *
 * A companion caret-and-key guard plugin:
 * - promotes any `TextSelection` inside an inline drawing `code_block` to a `NodeSelection`,
 * - blocks stray typing, `beforeinput` inserts, and `paste` from wiping a selected inline drawing
 *   (mirroring `cardKeyGuard` in `cardBlockView.ts`), while allowing Backspace/Delete, cut, drag,
 *   history, external edits, and `INLINE_MOVE_META` / `INLINE_DELETE_META`,
 * - triggers `tellReadOnlyEdit` (unlock-and-resume) when editing on a read-only page,
 * - syncs outline bullet folding (`embedFolds` / `toggleOutlineFold`),
 * - opens the drawing modal on `Enter`, forwards `BoardWindow` keys, and deselects on `Escape`.
 */
import { nodeViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { isHistoryTransaction } from '@milkdown/kit/prose/history'
import type { Fragment, Node as ProseNode } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import type { EmbedOptions } from '@shared/embedOptions'
import { drawingTitleOf, formatDrawingLine, withDrawingTitle } from '@shared/inlineDrawing'
import type { MenuRow } from '../blockHandleMenu'
import { codeWidthSchema } from '../code/codeWidth'
import { menuRowOf, mountInBox, onFlush } from '../embed/hostWindow'
import type { BoardRef, BoardWindowHandle, OpenHow } from '../embed/types'
import { openMenuAt } from '../linkMenu'
import { innermostItemPos } from '../outline/listNodes'
import { embedFolds, toggleOutlineFold } from '../outline/outlineFolding'
import { tellReadOnlyEdit } from '../readOnlyEdit'
import { vaultUnit } from '../../vault/unitWord'
import { BOARD_EMBED_CLASS, BOARD_VIEW_META } from './boardEmbed'
import { landOnInlineDrawing, landWhenShown, takeInlineDrawingLanding, watchInlineDrawingLanding } from './inlineDrawingLand'
import { drawingOptionsOf, isInlineDrawingNode } from './inlineDrawingLine'
import './boardEmbed.css'

export const INLINE_DRAWING_CLASS = 'inline-drawing'
export const INLINE_DRAWING_NAME = 'Inline drawing · Edit'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 14px menu glyph matching `linkMenu.ts` for `renderMenu`'s icon column (YAZ-6139). */
function menuGlyph(shapes: Array<[string, Record<string, string>]>): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  for (const [k, v] of Object.entries({ width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v)
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v)
    svg.appendChild(shape)
  }
  return svg
}

const editGlyph = () => menuGlyph([['path', { d: 'M3 21l3.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11z' }], ['path', { d: 'M14 6l3 3' }]])
const renameGlyph = () => menuGlyph([['path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }]])
const openTabGlyph = () => menuGlyph([['path', { d: 'M15 3h6v6' }], ['path', { d: 'M10 14 21 3' }], ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }]])
const moveFileGlyph = () => menuGlyph([['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }], ['polyline', { points: '14 2 14 8 20 8' }], ['path', { d: 'M12 18v-6' }], ['path', { d: 'm9 15 3-3 3 3' }]])
const copyGlyph = () => menuGlyph([['rect', { x: '8', y: '8', width: '13', height: '13', rx: '2' }], ['path', { d: 'M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' }]])
const deleteGlyph = () => menuGlyph([['path', { d: 'M3 6h18' }], ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }], ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]])

/** Transaction meta allowing `moveToFile` to replace a selected inline drawing with its `![[...]]` embed. */
export const INLINE_MOVE_META = 'mdapp-inline-drawing-move'
/** Transaction meta allowing confirmed deletion of a selected inline drawing. */
export const INLINE_DELETE_META = 'mdapp-inline-drawing-delete'
/** `EXTERNAL_EDIT_META` of `external/applyExternalMarkdown.ts`. */
const EXTERNAL_EDIT_META = 'external-edit'

export interface InlineDrawingDeps {
  /** Vault root for resolving asset images (`assets/…`) referenced by the inline scene. */
  root: string | null
  /** Absolute path of the page holding this drawing, used by `landOnInlineDrawing` ("Show in page"). */
  pagePath?: string | null
  /** Opens `DrawingModal` in inline mode for the inline drawing block at `pos`. */
  onEdit?: (pos: number, json: string) => void
  /** Moves the inline drawing at `pos` out to its own `.excalidraw` file. */
  onMoveToFile?: (pos: number) => void
  /** Opens a confirmation sheet before deleting the inline drawing at `pos`. */
  onDelete?: (pos: number) => void
  /** Opens the `index`-th (0-based) inline drawing in its own tab (`background` for Cmd+click). */
  onOpenInTab?: (index: number, background: boolean) => void
  /** Copies `<pagePath>:<line>` for the `index`-th (0-based) inline drawing block. */
  onCopyPath?: (index: number) => void
}

/** 0-based index of the inline drawing `code_block` at `targetPos` among all inline drawings in `doc`, or `-1`. */
export function inlineDrawingIndexAt(doc: ProseNode, targetPos: number): number {
  let index = 0
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (isInlineDrawingNode(node)) {
      if (pos === targetPos) found = index
      index++
      return false
    }
    return !node.isTextblock && !node.isAtom
  })
  return found
}

/** Each inline drawing's node view by its root DOM element, for keyboard forwarding & edit triggers. */
const inlineByDom = new WeakMap<Node, InlineDrawingView>()
/** All inline drawing views mounted in an `EditorView`, for propagating `editable` and outline fold flips. */
const inlineViews = new WeakMap<EditorView, Set<InlineDrawingView>>()

export class InlineDrawingView implements NodeView {
  readonly dom: HTMLDivElement
  private readonly head: HTMLDivElement
  private readonly titleInput: HTMLInputElement
  private readonly editBtn: HTMLButtonElement
  private readonly moreBtn: HTMLButtonElement
  private readonly box: HTMLDivElement
  private handle: BoardWindowHandle | null = null
  private selected = false
  private fold = { foldable: false, folded: false }
  private destroyed = false
  private titleTimer: ReturnType<typeof setTimeout> | undefined
  private closeMenu = () => {}
  private offBoard = () => {}
  private unwatchLanding = () => {}
  private cancelLanding: (() => void) | null = null

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly deps: InlineDrawingDeps,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = `${BOARD_EMBED_CLASS} ${INLINE_DRAWING_CLASS}`
    this.dom.contentEditable = 'false'

    this.head = document.createElement('div')
    this.head.className = 'inline-drawing__head'
    const kind = document.createElement('span')
    kind.className = 'inline-drawing__kind'
    kind.textContent = vaultUnit(this.deps.root ?? '')('In page')

    this.titleInput = document.createElement('input')
    this.titleInput.type = 'text'
    this.titleInput.className = 'inline-drawing__title'
    this.titleInput.placeholder = 'Untitled drawing'
    this.titleInput.setAttribute('aria-label', 'Drawing title')
    this.titleInput.value = drawingTitleOf(this.node.attrs.drawingLine)
    this.titleInput.readOnly = !this.view.editable
    for (const ev of ['mousedown', 'dblclick', 'keyup', 'keypress'] as const) {
      this.titleInput.addEventListener(ev, (e) => e.stopPropagation())
    }
    this.titleInput.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!this.view.editable) {
        tellReadOnlyEdit(this.dom, 'drawing', () => {
          this.titleInput.focus()
          this.titleInput.select()
        })
      }
    })
    this.titleInput.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        this.commitTitle()
        this.titleInput.blur()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        clearTimeout(this.titleTimer)
        this.titleTimer = undefined
        this.titleInput.value = drawingTitleOf(this.node.attrs.drawingLine)
        this.titleInput.blur()
      }
    })
    this.titleInput.addEventListener('input', () => {
      clearTimeout(this.titleTimer)
      this.titleTimer = setTimeout(() => this.commitTitle(), 250)
    })
    this.titleInput.addEventListener('blur', () => this.commitTitle())

    this.editBtn = document.createElement('button')
    this.editBtn.type = 'button'
    this.editBtn.tabIndex = -1
    this.editBtn.className = 'inline-drawing__edit'
    this.editBtn.textContent = 'Edit drawing'
    this.editBtn.title = 'Edit drawing (⌘-click: new tab)'
    this.editBtn.hidden = this.deps.onEdit === undefined
    this.editBtn.addEventListener('mousedown', (e) => e.stopPropagation())
    this.editBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if ((e.metaKey || e.ctrlKey) && this.deps.onOpenInTab !== undefined) {
        const live = this.liveNode()
        if (live === null) return
        const index = inlineDrawingIndexAt(this.view.state.doc, live.pos)
        if (index >= 0) this.deps.onOpenInTab(index, !e.shiftKey)
        return
      }
      this.openEdit()
    })

    this.moreBtn = document.createElement('button')
    this.moreBtn.type = 'button'
    this.moreBtn.tabIndex = -1
    this.moreBtn.className = 'inline-drawing__more'
    this.moreBtn.textContent = '⋯'
    this.moreBtn.setAttribute('aria-label', 'Drawing menu')
    this.moreBtn.title = 'Drawing menu'
    this.moreBtn.addEventListener('mousedown', (e) => e.stopPropagation())
    this.moreBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const rect = this.moreBtn.getBoundingClientRect()
      const synthetic = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.right, clientY: rect.bottom + 4 })
      this.openMenu(synthetic)
    })

    this.head.append(kind, this.titleInput, this.editBtn, this.moreBtn)
    this.head.addEventListener('contextmenu', (e) => {
      if (e.target === this.titleInput && document.activeElement === this.titleInput) return
      e.preventDefault()
      e.stopPropagation()
      this.openMenu(e)
    })

    this.box = document.createElement('div')
    this.box.className = 'inline-drawing__box'
    this.dom.append(this.head, this.box)

    inlineByDom.set(this.dom, this)
    let views = inlineViews.get(this.view)
    if (views === undefined) inlineViews.set(this.view, (views = new Set()))
    views.add(this)
    const offFlush = onFlush(this.view, () => {
      this.commitTitle()
      this.handle?.flush()
    })
    this.offBoard = () => {
      offFlush()
      views.delete(this)
    }

    const pos = this.getPos()
    const entry = pos === undefined ? undefined : embedFolds(this.view.state).get(pos)
    this.fold = { foldable: entry !== undefined, folded: entry?.folded === true }
    this.head.hidden = this.fold.folded
    this.dom.classList.toggle('inline-drawing--folded', this.fold.folded)

    const pagePath = this.deps.pagePath ?? null
    const myIndex = (): number => {
      const p = this.getPos()
      return p === undefined ? -1 : inlineDrawingIndexAt(this.view.state.doc, p)
    }
    if (pagePath !== null) {
      const mountedAt = Date.now()
      const initialIndex = myIndex()
      if (this.view.dom.isConnected && initialIndex >= 0 && takeInlineDrawingLanding(pagePath, initialIndex)) {
        this.cancelLanding = landWhenShown(this.dom, () => {
          if (Date.now() - mountedAt < 2000) landOnInlineDrawing(pagePath, initialIndex)
        })
      }
      this.unwatchLanding = watchInlineDrawingLanding((targetPath, targetIndex) => {
        if (!this.dom.isConnected || targetPath !== pagePath || targetIndex !== myIndex()) return false
        this.cancelLanding = landWhenShown(this.dom)
        return true
      })
    }

    const columnWidth = () => this.view.dom.clientWidth
    mountInBox(this.box, {
      options: drawingOptionsOf(this.node),
      columnWidth,
      host: () => ({
        ref: this.refOf(this.node),
        options: drawingOptionsOf(this.node),
        editable: this.view.editable,
        columnWidth,
        menuButton: false,
        onOptions: (next) => this.writeOptions(next),
        onOpen: (how) => this.handleOpen(how),
        onContextMenu: (event) => this.openMenu(event),
        onSelect: () => this.select(),
        onFold: () => this.toggleFold(),
      }),
      live: () => !this.destroyed,
      done: (handle) => {
        this.handle = handle
      },
      state: () => ({ selected: this.selected, fold: this.fold }),
      name: () => drawingTitleOf(this.node.attrs.drawingLine) || 'Untitled drawing',
    })
  }

  getHandle(): BoardWindowHandle | null {
    return this.handle
  }

  getLivePos(): number | undefined {
    return this.getPos()
  }

  setFold(next: { foldable: boolean; folded: boolean }): void {
    if (next.foldable !== this.fold.foldable) this.handle?.setFoldable(next.foldable)
    if (next.folded !== this.fold.folded) {
      this.handle?.setFolded(next.folded)
      this.head.hidden = next.folded
      this.dom.classList.toggle('inline-drawing--folded', next.folded)
    }
    this.fold = next
  }

  setEditable(editable: boolean): void {
    this.titleInput.readOnly = !editable
    this.handle?.update({ editable })
  }

  private commitTitle(): void {
    clearTimeout(this.titleTimer)
    this.titleTimer = undefined
    if (!this.view.editable) return
    const live = this.liveNode()
    if (live === null) return
    const next = withDrawingTitle(live.node.attrs.drawingLine, this.titleInput.value)
    if (next === (live.node.attrs.drawingLine ?? null)) return
    this.view.dispatch(this.view.state.tr.setNodeAttribute(live.pos, 'drawingLine', next))
  }

  private refOf(node: ProseNode): BoardRef {
    return {
      root: this.deps.root,
      path: null,
      kind: 'drawing',
      name: drawingTitleOf(node.attrs.drawingLine) || 'Untitled drawing',
      vault: null,
      inlineJson: node.textContent,
    }
  }

  private liveNode(): { pos: number; node: ProseNode } | null {
    const pos = this.getPos()
    const node = pos === undefined ? null : this.view.state.doc.nodeAt(pos)
    return pos === undefined || node === null || !isInlineDrawingNode(node) ? null : { pos, node }
  }

  private writeOptions(next: EmbedOptions): void {
    if (!this.view.editable) return
    const live = this.liveNode()
    if (live === null) return
    const line = formatDrawingLine(next, drawingTitleOf(live.node.attrs.drawingLine))
    if (line === (live.node.attrs.drawingLine ?? null)) return
    this.view.dispatch(
      this.view.state.tr
        .setNodeAttribute(live.pos, 'drawingLine', line)
        .setMeta('addToHistory', false)
        .setMeta(BOARD_VIEW_META, true),
    )
  }

  private handleOpen(how: OpenHow): void {
    if ((how === 'backgroundTab' || how === 'newTab') && this.deps.onOpenInTab !== undefined) {
      const live = this.liveNode()
      if (live === null) return
      const index = inlineDrawingIndexAt(this.view.state.doc, live.pos)
      if (index >= 0) this.deps.onOpenInTab(index, how === 'backgroundTab')
      return
    }
    this.openEdit()
  }

  openEdit(): void {
    if (!this.view.editable) {
      tellReadOnlyEdit(this.dom, 'drawing', () => this.openEdit())
      return
    }
    const live = this.liveNode()
    if (live === null) return
    this.deps.onEdit?.(live.pos, live.node.textContent)
  }

  private toggleFold(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const entry = embedFolds(this.view.state).get(pos)
    const item = entry?.itemPos ?? innermostItemPos(this.view.state.doc.resolve(pos))
    if (item !== null) toggleOutlineFold(item)(this.view.state, this.view.dispatch)
  }

  private select(): void {
    const live = this.liveNode()
    if (live === null) return
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, live.pos)))
    this.view.focus()
  }

  private openMenu(event: MouseEvent): void {
    const parent = this.view.dom.parentElement
    if (parent === null) return
    event.preventDefault()
    this.closeMenu()
    const editable = this.view.editable
    const rows: MenuRow[] = []
    const group = (list: Array<MenuRow | null>) => {
      const kept = list.filter((row): row is MenuRow => row !== null)
      if (kept.length === 0) return
      rows.push(rows.length > 0 ? { ...kept[0]!, divider: true } : kept[0]!, ...kept.slice(1))
    }
    group([
      editable && this.deps.onEdit !== undefined ? { label: 'Edit drawing', icon: editGlyph, run: () => this.openEdit() } : null,
      editable
        ? {
            label: 'Rename',
            icon: renameGlyph,
            run: () => {
              this.titleInput.focus()
              this.titleInput.select()
            },
          }
        : null,
      this.deps.onOpenInTab !== undefined
        ? {
            label: 'Open in new tab',
            hint: '⌘↵',
            icon: openTabGlyph,
            run: () => {
              const live = this.liveNode()
              if (live === null) return
              const index = inlineDrawingIndexAt(this.view.state.doc, live.pos)
              if (index >= 0) this.deps.onOpenInTab?.(index, false)
            },
          }
        : null,
      editable && this.deps.onMoveToFile !== undefined
        ? {
            label: 'Move to its own file',
            icon: moveFileGlyph,
            ask: { question: 'Move this drawing to its own file?', yes: 'Move' },
            run: () => {
              const live = this.liveNode()
              if (live !== null) this.deps.onMoveToFile?.(live.pos)
            },
          }
        : null,
      this.deps.onCopyPath !== undefined
        ? {
            label: 'Copy path',
            icon: copyGlyph,
            run: () => {
              const live = this.liveNode()
              if (live === null) return
              const index = inlineDrawingIndexAt(this.view.state.doc, live.pos)
              if (index >= 0) this.deps.onCopyPath?.(index)
            },
          }
        : null,
    ])
    group(this.handle?.menuRows().map(menuRowOf) ?? [])
    group([
      editable
        ? {
            label: 'Delete drawing',
            icon: deleteGlyph,
            danger: true,
            run: () => {
              const live = this.liveNode()
              if (live === null) return
              if (this.deps.onDelete !== undefined) this.deps.onDelete(live.pos)
              else this.view.dispatch(this.view.state.tr.delete(live.pos, live.pos + live.node.nodeSize).setMeta(INLINE_DELETE_META, true))
            },
          }
        : null,
    ])
    if (rows.length > 0) this.closeMenu = openMenuAt(parent, event.clientX, event.clientY, rows)
  }

  update(nextNode: ProseNode): boolean {
    if (!isInlineDrawingNode(nextNode)) return false
    const prev = this.node
    this.node = nextNode
    if (nextNode.attrs.drawingLine !== prev.attrs.drawingLine && document.activeElement !== this.titleInput) {
      this.titleInput.value = drawingTitleOf(nextNode.attrs.drawingLine)
    }
    if (nextNode.textContent !== prev.textContent || nextNode.attrs.drawingLine !== prev.attrs.drawingLine) {
      this.handle?.update({ ref: this.refOf(nextNode), options: drawingOptionsOf(nextNode) })
    }
    return true
  }

  selectNode(): void {
    this.selected = true
    this.dom.classList.add('is-selected')
    this.handle?.setSelected(true)
  }

  deselectNode(): void {
    this.selected = false
    this.dom.classList.remove('is-selected')
    this.handle?.setSelected(false)
  }

  stopEvent(): boolean {
    return true
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type !== 'selection'
  }

  destroy(): void {
    this.destroyed = true
    clearTimeout(this.titleTimer)
    this.titleTimer = undefined
    this.closeMenu()
    this.offBoard()
    this.unwatchLanding()
    this.cancelLanding?.()
    this.cancelLanding = null
    inlineByDom.delete(this.dom)
    this.handle?.destroy()
    this.handle = null
  }
}

/** Node view for ```` ```excalidraw ```` blocks; chains non-drawing `code_block` nodes to the preceding factory. */
export function inlineDrawingNodeView(deps: InlineDrawingDeps) {
  return $view(codeWidthSchema.node, (ctx: Ctx): NodeViewConstructor => {
    const ours: NodeViewConstructor = (node, editor, getPos, decorations, inner) => {
      if (isInlineDrawingNode(node)) return new InlineDrawingView(node, editor, getPos, deps)
      const factories = ctx
        .get(nodeViewCtx)
        .filter(([id]) => id === 'code_block')
        .map(([, make]) => make)
      const idx = factories.lastIndexOf(ours)
      const prev = idx > 0 ? factories[idx - 1]! : null
      return prev === null ? (undefined as unknown as NodeView) : prev(node, editor, getPos, decorations, inner)
    }
    return ours
  })
}

const INLINE_DRAWING_GUARD_KEY = new PluginKey('mdapp-inline-drawing-guard')

/** Text or a leaf (an image, a rule) in `content`, outside an inline drawing: what typing or a paste puts there. */
function holdsOtherContent(content: Fragment): boolean {
  let found = false
  content.descendants((node) => {
    if (found || isInlineDrawingNode(node)) return false
    if (node.isText || node.isLeaf) found = true
    return !found
  })
  return found
}

/** True when `tr` deletes the inline drawing at `from`..`to` and puts text or a leaf in its place. */
function replacesInlineDrawing(tr: Transaction, from: number, to: number): boolean {
  if (!tr.mapping.mapResult(from, 1).deleted) return false
  const start = tr.mapping.map(from, -1)
  const end = tr.mapping.map(to, 1)
  return end > start && holdsOtherContent(tr.doc.slice(start, end).content)
}

const selectedInlinePos = (state: EditorState): number | null => {
  const { selection } = state
  return selection instanceof NodeSelection && isInlineDrawingNode(selection.node) ? selection.from : null
}

/**
 * Keeps the caret out of raw inline drawing JSON, guards a selected inline drawing against accidental
 * typing/paste replacement (mirroring `cardKeyGuard`), opens the drawing modal on `Enter` (or prompts
 * unlock-and-resume when read-only), forwards `BoardWindow` shortcuts, deselects on `Escape`, and
 * propagates `editable` and outline fold changes to mounted windows.
 */
function inlineDrawingGuard(deps: InlineDrawingDeps) {
  return $prose(
    () =>
      new Plugin({
        key: INLINE_DRAWING_GUARD_KEY,
        filterTransaction: (tr, state) => {
          if (!tr.docChanged || selectedInlinePos(state) === null) return true
          if (
            tr.getMeta(INLINE_MOVE_META) === true ||
            tr.getMeta(INLINE_DELETE_META) === true ||
            tr.getMeta(EXTERNAL_EDIT_META) === true ||
            isHistoryTransaction(tr)
          ) {
            return true
          }
          return !replacesInlineDrawing(tr, state.selection.from, state.selection.to)
        },
        appendTransaction: (_trs, _oldState, newState) => {
          const sel = newState.selection
          if (!(sel instanceof TextSelection)) return null
          if (!sel.$from.sameParent(sel.$to) || !isInlineDrawingNode(sel.$from.parent)) return null
          const pos = sel.$from.before()
          return newState.tr.setSelection(NodeSelection.create(newState.doc, pos)).setMeta('addToHistory', false)
        },
        view: (editorView) => {
          let editable = editorView.editable
          let folds = embedFolds(editorView.state)
          const syncFolds = (before: ReadonlyMap<number, unknown> | null) => {
            if (before !== null && before.size === 0 && folds.size === 0) return
            inlineViews.get(editorView)?.forEach((inst) => {
              const pos = inst.getLivePos()
              const entry = pos === undefined ? undefined : folds.get(pos)
              inst.setFold({ foldable: entry !== undefined, folded: entry?.folded === true })
            })
          }
          syncFolds(null)
          return {
            update: (view) => {
              if (view.editable !== editable) {
                editable = view.editable
                inlineViews.get(view)?.forEach((inst) => inst.setEditable(editable))
              }
              const nextFolds = embedFolds(view.state)
              if (nextFolds !== folds) {
                const before = folds
                folds = nextFolds
                syncFolds(before)
              }
            },
          }
        },
        props: {
          handleTextInput: (view) => selectedInlinePos(view.state) !== null,
          handleDOMEvents: {
            beforeinput: (view, event) => {
              const { inputType } = event as InputEvent
              if (selectedInlinePos(view.state) === null || !inputType.startsWith('insert') || inputType === 'insertFromDrop') return false
              event.preventDefault()
              return true
            },
            paste: (view, event) => {
              if (selectedInlinePos(view.state) === null) return false
              event.preventDefault()
              return true
            },
          },
          handleKeyDown: (view, event) => {
            const sel = view.state.selection
            if (!(sel instanceof NodeSelection) || !isInlineDrawingNode(sel.node)) return false
            const dom = view.nodeDOM(sel.from)
            const inst = dom === null ? undefined : inlineByDom.get(dom)
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && deps.onOpenInTab !== undefined) {
              event.preventDefault()
              const index = inlineDrawingIndexAt(view.state.doc, sel.from)
              if (index >= 0) deps.onOpenInTab(index, event.shiftKey)
              return true
            }
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
              event.preventDefault()
              if (inst !== undefined) inst.openEdit()
              else if (!view.editable && dom instanceof Element) tellReadOnlyEdit(dom, 'drawing', () => deps.onEdit?.(sel.from, sel.node.textContent))
              else deps.onEdit?.(sel.from, sel.node.textContent)
              return true
            }
            if (inst?.getHandle()?.handleKey(event) === true) return true
            if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
              view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(sel.to))))
              return true
            }
            return false
          },
        },
      }),
  )
}

/** Register with `crepe.editor.use(inlineDrawingPlugins(deps))` in `createCrepe.ts`. */
export function inlineDrawingPlugins(deps: InlineDrawingDeps) {
  return [inlineDrawingNodeView(deps), inlineDrawingGuard(deps)]
}
