/**
 * The line on the page (YAZ-3164, 🔒 D2 / D5; CONTRACTS rule 41): a ProseMirror NODE VIEW for `hr`,
 * the second node view after images (rule 30), in the same shape. A decoration could draw the
 * line, but a widget beside the node could never write a length back without a transaction that
 * knows the node — which is a node view by another name (rule 30's reason).
 *
 * DOM: `<div class="line-view" contenteditable="false"><hr><span class="line-view__end"></span></div>`.
 * The wrapper is the block: it is as wide as the row, so a node decoration on it (the line number,
 * `data-line`) sits in the lane whatever the line's length. The values go to the custom properties
 * `--line-darkness`, `--line-thickness` and `--line-width` on the wrapper (`line.css` reads them),
 * and the pattern (YAZ-3164 D7) to its `data-line-pattern` attribute,
 * NEVER `style.width`: an inline width beats every stylesheet rule (rule 30's reason). No property
 * when the attribute is `null`, so the stylesheet's default takes over. `update()` patches the
 * properties in place; nothing here is ever rebuilt.
 *
 * SELECTION: a click is ProseMirror's stock `NodeSelection` on the leaf. `selectNode` adds
 * `is-selected` only while `view.editable`, and the round end handle shows only then (S30, S38).
 *
 * THE LENGTH HANDLE (🔒 D5), rule 30's gesture: the length is LIVE on `--line-width` while the
 * pointer moves (a % of the row, clamped to `MIN_LINE_WIDTH` … 100), and ONE `setNodeMarkup` on
 * mouseup writes it, with the line selected again in the same transaction (⌘Z is one step, S37);
 * 100 is stored as `null` (S32). Mouseup or the window losing focus (⌘-Tab, S35) ends it where it
 * stands; Escape ends it, puts the start length back and writes nothing (S34) — captured, so the
 * editor's Escape hand-off to the sidebar never hears it; a mousedown that never moved writes
 * nothing (S36). The travel is a share of the wrapper's own on-screen width, so a document zoom
 * changes nothing (S28). `stopEvent` claims every event on the handle (no node drag, no caret
 * move); `ignoreMutation` answers false only to the `selection` pseudo-mutation, so a click still
 * selects the node. A read-only editor has no gesture.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView, ViewMutationRecord } from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'
import { LINE_WIDTH_DEFAULT, MIN_LINE_WIDTH, PATTERN_ATTR, lineSchema, lineStyleOf, lineStyleProperties } from './lineStyle'
import './line.css'

export const LINE_VIEW_CLASS = 'line-view'
export const LINE_END_CLASS = 'line-view__end'
export const LINE_SELECTED_CLASS = 'is-selected'
export const LINE_DRAGGING_CLASS = 'line-view--dragging'

const PROPERTIES = ['--line-darkness', '--line-thickness', '--line-width']

class LineNodeView implements NodeView {
  readonly dom: HTMLDivElement
  private readonly end: HTMLSpanElement

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = LINE_VIEW_CLASS
    this.dom.setAttribute('contenteditable', 'false')
    this.end = document.createElement('span')
    this.end.className = LINE_END_CLASS
    this.end.addEventListener('mousedown', (event) => this.startDrag(event))
    this.dom.append(document.createElement('hr'), this.end)
    this.patch()
  }

  /** The node's style onto the wrapper: set parts as properties, the pattern as an attribute, everything else removed. */
  private patch(): void {
    const style = lineStyleOf(this.node)
    for (const name of PROPERTIES) this.dom.style.removeProperty(name)
    for (const [name, value] of lineStyleProperties(style)) this.dom.style.setProperty(name, value)
    if (style.pattern === null) this.dom.removeAttribute(PATTERN_ATTR)
    else this.dom.setAttribute(PATTERN_ATTR, style.pattern)
  }

  private startDrag(event: MouseEvent): void {
    if (event.button !== 0 || !this.view.editable) return
    event.preventDefault()
    const pos = this.getPos()
    if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    const startX = event.clientX
    // The row as it is on screen: the pointer's travel is a share of it, at any document zoom.
    const row = this.dom.getBoundingClientRect().width || this.dom.offsetWidth
    const startWidth = lineStyleOf(this.node).width ?? LINE_WIDTH_DEFAULT
    // What Escape puts back: the property as it was — empty for a full line.
    const startStyle = this.dom.style.getPropertyValue('--line-width')
    let width = startWidth
    this.dom.classList.add(LINE_DRAGGING_CLASS)
    const end = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onUp)
      this.dom.classList.remove(LINE_DRAGGING_CLASS)
    }
    const onMove = (e: MouseEvent): void => {
      if (row <= 0) return
      const next = Math.round(startWidth + ((e.clientX - startX) / row) * 100)
      width = Math.min(LINE_WIDTH_DEFAULT, Math.max(MIN_LINE_WIDTH, next))
      this.dom.style.setProperty('--line-width', `${width}%`)
    }
    // Mouseup, or the window losing focus mid-drag: over where it stands. A length that never moved
    // was a click on the handle, and a click is not a document change.
    const onUp = (): void => {
      end()
      if (width !== startWidth) this.commitWidth(width)
    }
    // Escape cancels: the start length back, nothing written. Captured, so the editor's own Escape
    // (the sidebar hand-off) never sees the key that was aimed at the drag.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      end()
      this.dom.style.setProperty('--line-width', startStyle)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onUp)
  }

  /** ONE document change per gesture: the new length, the line selected again, everything else untouched. */
  private commitWidth(width: number): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const stored = width >= LINE_WIDTH_DEFAULT ? null : width
    if (stored === lineStyleOf(this.node).width) return
    // Its own undo step, even right after another change (a pick in the menu, a keystroke).
    const tr = closeHistory(this.view.state.tr).setNodeMarkup(pos, undefined, { ...this.node.attrs, width: stored })
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.patch()
    return true
  }

  selectNode(): void {
    if (this.view.editable) this.dom.classList.add(LINE_SELECTED_CLASS)
  }

  deselectNode(): void {
    this.dom.classList.remove(LINE_SELECTED_CLASS)
  }

  /** The handle's events are the gesture's, never ProseMirror's (no node drag, no caret move). */
  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.end.contains(event.target)
  }

  /** Nothing in here is document content — but a selection landing here is still a selection. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type !== 'selection'
  }
}

/** The node view for `hr`, registered by createCrepe on every editor. */
export const lineView = $view(lineSchema.node, () => (node, view, getPos) => new LineNodeView(node, view, getPos))
