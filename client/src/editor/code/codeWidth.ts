/**
 * A code block's own width (YAZ-4783): drag the right edge of a page's code block (the grey box,
 * `.milkdown-code-block`) to make it wider or narrower, as a table column's edge does.
 *
 * IN THE FILE the width is the `<!-- code: width 1300 -->` line right under the closing fence (`codeComment.ts` reads
 * and writes it), indented with the block inside a bullet. GitHub and Obsidian hide the comment. A block with no width
 * writes no comment, so a plain code block keeps the bytes of before.
 *
 * LOAD: `codeWidthRemark` joins a `code` node with its NEXT sibling when that sibling is our comment, in every
 * container (`joinComment.ts`, shared with the line and the table); the look goes on `node.data.codeLook`, and the
 * comment leaves the tree. A comment that is not ours stays an `html` node, bytes untouched.
 *
 * SAVE: the `code_block` schema gains `width` (px at 100% document zoom, or `null`) and `unknownParts` (the parts this
 * build keeps as text, or `null`); its `toMarkdown` writes the fence, then the comment as an `html` node. A PAGE CARD
 * (YAZ-4961, `card/cardBlockLine.ts`) keeps its `<!-- card: … -->` line in a third attribute, `cardLine`, joined
 * on load before the code comment and written right under the fence before it: one schema extension holds both. The `join`
 * rule `codeCommentJoin` puts the comment on the line right after the fence, with no blank line between, also at the
 * top level (a table's comment gets a blank line there): then the comment is always exactly ONE line of the file, and
 * `lineNumbers.ts` can still pair the block's code lines with the file's (D8). `toDOM` / `parseDOM` carry both
 * attributes on the `<pre>`, so a code block copied inside the app pastes with its width.
 *
 * ON THE PAGE: Crepe's code block node view draws nothing from the attributes, so a NODE DECORATION puts
 * `data-code-width` and `--code-width: <width>px` on the box, and app.css sizes it from them. The box sits inside the
 * zoomed `.ProseMirror`, so a px width already scales with the page zoom; a block with no width keeps the YAZ-4785
 * rule. The decorations ride the position mapping; they are looked at again only for a transaction whose steps can
 * bring or change a width (an attribute step, or a step whose slice holds a code block) — never for a keystroke in a
 * paragraph or inside a code block.
 *
 * THE GRIP: the box's right edge takes the mouse within `GRIP_WIDTH` (8 px, the table column grip's) with the
 * `col-resize` cursor and the table grip's bar (`code-width-grip`, app.css). A `mouseover` on the editor finds the code
 * block under the mouse, and only that block gets `mousemove`, `mousedown` and `dblclick` listeners while the mouse is
 * on it. A drag shows the width live on the box and writes it ONCE, on mouseup (or the window losing focus), in one
 * transaction of its own: one ⌘Z. The travel is divided by the zoom at the box, so the edge stays under the mouse.
 * Smallest `CODE_WIDTH_MIN`; widest, the right edge of the editor's scroll area (`.editor-host`), never under the
 * table of contents beside it (`blockRightEdge`, `blockRoom.ts`). A double-click on the edge removes the width: back to
 * the normal width. A read-only page has no grip. The code, its language, the Copy button, the language picker and the
 * gutter are not touched.
 *
 * THREE LAYERS, the nearest wins (YAZ-4783): this block's own width (here); else the page's `code-width` key (the page
 * cog, `pageSwitches.ts`), `--code-block-width` on the editor's mount; else Settings › Editor › Code blocks › Width,
 * `--code-block-width` on `.app`; else the text column. app.css reads the variable only for a box with no
 * `data-code-width`. After a drag wrote a width, the box sends `CODE_WIDTH_DRAGGED`, and the editor host offers to make
 * it the page's width for every code block (`codeWidthsToPage`).
 */
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import type { DOMOutputSpec, Node as ProseNode } from '@milkdown/kit/prose/model'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { AttrStep, ReplaceAroundStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $remark } from '@milkdown/kit/utils'
import type { Nodes } from 'mdast'
import type { Join } from 'mdast-util-to-markdown'
import { holdColResize } from '../../lib/colResize'
import { cssZoom } from '../../lib/cssZoom'
import { blockRightEdge } from '../blockRoom'
import { joinNextComment } from '../joinComment'
import { CARD_LINE_ATTR, cleanCardLine, isCardCode, CARD_LANGUAGE } from '../card/cardBlockLine'
import { CODE_WIDTH_MAX, CODE_WIDTH_MIN, codeWidth, formatCodeComment, parseCodeComment, type CodeLook, type CodeUnknownPart } from './codeComment'

export * from './codeComment'

/** How far in from the box's right edge the grip takes the mouse, in px: the table column grip's `GRIP_WIDTH`. */
const GRIP_WIDTH = 8
/** On the box: its saved width, the attribute app.css sizes it by. */
export const CODE_WIDTH_ATTR = 'data-code-width'
/** On the box while the mouse is on its grip, or it drags. */
export const CODE_GRIP_CLASS = 'code-width-grip'
/** On `.ProseMirror` while a box's edge drags: the `col-resize` cursor over the code too. */
export const CODE_DRAGGING_CLASS = 'code-width-dragging'
const BLOCK = '.milkdown-code-block'
const PARTS_ATTR = 'data-code-parts'

/**
 * Sent from `.ProseMirror` (it bubbles) after a drag of a block's edge wrote a width (YAZ-4783 layer 2): the editor host
 * offers "Use 900 px for all code blocks in this page" (`codeWidthsToPage`). A double-click reset sends none.
 */
export const CODE_WIDTH_DRAGGED = 'mdapp:code-width-dragged'
export interface CodeWidthDragged {
  width: number
}

/** How many code blocks the document holds (the toast's offer needs another one). Walks blocks, never into a textblock. */
export function codeBlockCount(doc: ProseNode): number {
  let count = 0
  doc.descendants((node) => {
    if (node.type.name === 'code_block') count++
    return !node.isTextblock && !node.isAtom
  })
  return count
}

/**
 * "Use 900 px for all code blocks in this page" (YAZ-4783 layer 2), the document's half: ONE transaction, its own undo
 * step, that takes every code block's own width away, so each follows the page's width (the frontmatter `code-width` key
 * the host writes beside it). The blocks' text, language and other comment parts stay. `null` when no block has a width.
 */
export function codeWidthsToPage(state: EditorState): Transaction | null {
  const tr = closeHistory(state.tr)
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') {
      if (codeWidth(node.attrs.width) !== null) tr.setNodeAttribute(pos, 'width', null)
      return false
    }
    return !node.isTextblock && !node.isAtom
  })
  return tr.docChanged ? tr : null
}

/** The parts a node, a paste or a remark node holds, checked: each a one-line text with no `,` and no `-->`. */
function cleanParts(value: unknown): CodeUnknownPart[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((part: unknown) => {
    const { afterWidth, text } = (part ?? {}) as { afterWidth?: unknown; text?: unknown }
    if (typeof text !== 'string' || text.trim() === '' || /[,\r\n]|-->/.test(text)) return []
    return [{ afterWidth: afterWidth === true, text: text.trim() }]
  })
}

/** A code block's look, every value checked. */
export const codeLookOf = (node: ProseNode): CodeLook => ({ width: codeWidth(node.attrs.width), unknownParts: cleanParts(node.attrs.unknownParts) })

/** The attributes for a look: `null` for what is not set. */
const lookAttrs = (look: CodeLook) => ({ width: look.width, unknownParts: look.unknownParts.length === 0 ? null : look.unknownParts })

interface CodeData {
  codeLook?: CodeLook
  /** A card's card line (YAZ-4961, `card/cardBlockLine.ts`), its text. */
  cardLine?: string
}

export const codeWidthRemark = $remark('mdapp-code-width', () => () => (tree) => {
  // A card's line first: it is the line right under the fence; a code comment may come after it.
  joinNextComment(
    tree as Nodes,
    'code',
    cleanCardLine,
    (node, cardLine) => {
      node.data = { ...node.data, cardLine } as typeof node.data
    },
    isCardCode,
  )
  joinNextComment(tree as Nodes, 'code', parseCodeComment, (node, look) => {
    node.data = { ...node.data, codeLook: look } as typeof node.data
  })
})

/**
 * The comment goes on the line right under the fence: no blank line between, wherever the block is. A card's line
 * (YAZ-4961) goes there too, and a code comment of the card right under its line.
 */
const codeCommentJoin: Join = (left, right) => {
  if (right.type !== 'html') return undefined
  if (left.type === 'code' && (parseCodeComment(right.value) !== null || (isCardCode(left) && cleanCardLine(right.value) !== null))) return 0
  return left.type === 'html' && cleanCardLine(left.value) !== null && parseCodeComment(right.value) !== null ? 0 : undefined
}

/** Adds `codeCommentJoin`; call in a `crepe.editor.config` (read once, when Milkdown builds remark). */
export function codeCommentStringify(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, join: [...(prev.join ?? []), codeCommentJoin] }))
}

export const codeWidthSchema = codeBlockSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    attrs: { ...base.attrs, width: { default: null }, unknownParts: { default: null }, cardLine: { default: null } },
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs: (dom) => {
          const pre = dom as HTMLElement
          let parts: unknown = null
          try {
            parts = JSON.parse(pre.getAttribute(PARTS_ATTR) ?? 'null')
          } catch {
            // A broken attribute is no parts.
          }
          return { language: pre.dataset.language, ...lookAttrs({ width: codeWidth(Number(pre.getAttribute(CODE_WIDTH_ATTR))), unknownParts: cleanParts(parts) }), cardLine: cleanCardLine(pre.getAttribute(CARD_LINE_ATTR)) }
        },
      },
    ],
    toDOM: (node) => {
      const [tag, attrs, ...content] = base.toDOM!(node) as [string, Record<string, string>, ...DOMOutputSpec[]]
      const { width, unknownParts } = codeLookOf(node)
      const cardLine = cleanCardLine(node.attrs.cardLine)
      return [
        tag,
        {
          ...attrs,
          ...(width !== null && { [CODE_WIDTH_ATTR]: String(width) }),
          ...(unknownParts.length > 0 && { [PARTS_ATTR]: JSON.stringify(unknownParts) }),
          ...(cardLine !== null && { [CARD_LINE_ATTR]: cardLine }),
        },
        ...content,
      ] as DOMOutputSpec
    },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        const look = (node.data as CodeData | undefined)?.codeLook
        const value = node.value as string | null
        const cardLine = (node.data as CodeData | undefined)?.cardLine
        state.openNode(type, { language: (node.lang as string | null | undefined) ?? '', ...(look && lookAttrs(look)), ...(cardLine !== undefined && { cardLine }) })
        if (value) state.addText(value)
        state.closeNode()
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        base.toMarkdown.runner(state, node)
        // A card's line (YAZ-4961): right under the fence, before a code comment. A block that is no card writes none.
        const cardLine = node.attrs.language === CARD_LANGUAGE ? cleanCardLine(node.attrs.cardLine) : null
        if (cardLine !== null) state.addNode('html', undefined, cardLine)
        const comment = formatCodeComment(codeLookOf(node))
        if (comment !== null) state.addNode('html', undefined, comment)
      },
    },
  }
})

const pluginKey = new PluginKey<DecorationSet>('mdapp-code-width')

/** The decorations of the code blocks with a width that touch `from`…`to`, onto `out`. */
function decorate(doc: ProseNode, from: number, to: number, out: Decoration[]): void {
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'code_block') return !node.isTextblock && !node.isAtom
    const width = codeWidth(node.attrs.width)
    if (width !== null) out.push(Decoration.node(pos, pos + node.nodeSize, { [CODE_WIDTH_ATTR]: String(width), style: `--code-width: ${width}px` }))
    return false
  })
}

/** A step that can bring or change a width: an attribute step, or one whose slice holds a code block. */
function mayChangeWidth(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    if (step instanceof AttrStep) return true
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false
    let found = false
    step.slice.content.descendants((node) => {
      if (node.type.name === 'code_block') found = true
      return !found && !node.isTextblock
    })
    return found
  })
}

/** The position of the code block a box draws, or null. */
function blockPos(view: EditorView, block: HTMLElement): number | null {
  if (!view.dom.contains(block)) return null
  let inside: number
  try {
    inside = view.posAtDOM(block, 0)
  } catch {
    // A box ProseMirror does not draw (another editor's, inside this one): not ours.
    return null
  }
  const $pos = view.state.doc.resolve(inside)
  return $pos.parent.type.name === 'code_block' ? $pos.before() : null
}

/** On the box's grip: within `GRIP_WIDTH` of its right edge, on a box wider than two grips. */
function onGrip(block: HTMLElement, event: MouseEvent): boolean {
  const { left, right } = block.getBoundingClientRect()
  return event.clientX <= right && right - event.clientX <= GRIP_WIDTH && event.clientX - left > GRIP_WIDTH
}

/** The grip on the box under the mouse, and its drag. */
class CodeWidthGrip {
  /** The box the mouse is on, with its listeners; null for none. */
  private block: HTMLElement | null = null
  /** The running drag's end (its listeners off, nothing written), or null. */
  private drag: (() => void) | null = null

  constructor(private readonly view: EditorView) {
    view.dom.addEventListener('mouseover', this.onOver)
  }

  private onOver = (event: MouseEvent): void => {
    if (this.drag !== null) return
    const block = event.target instanceof Element ? event.target.closest<HTMLElement>(BLOCK) : null
    if (block === this.block) return
    this.leave()
    // A card's editor (YAZ-4961) has no grip: the card line, not a width, sits under a card's fence.
    if (block === null || !this.view.dom.contains(block) || block.closest('.card') !== null) return
    this.block = block
    block.addEventListener('mousemove', this.onMove)
    block.addEventListener('mouseleave', this.onLeave)
    block.addEventListener('mousedown', this.onDown, true)
    block.addEventListener('dblclick', this.onDouble, true)
  }

  private leave(): void {
    const block = this.block
    if (block === null) return
    block.classList.remove(CODE_GRIP_CLASS)
    block.removeEventListener('mousemove', this.onMove)
    block.removeEventListener('mouseleave', this.onLeave)
    block.removeEventListener('mousedown', this.onDown, true)
    block.removeEventListener('dblclick', this.onDouble, true)
    this.block = null
  }

  private onLeave = (): void => {
    if (this.drag === null) this.leave()
  }

  private onMove = (event: MouseEvent): void => {
    if (this.drag !== null || this.block === null) return
    this.block.classList.toggle(CODE_GRIP_CLASS, this.view.editable && onGrip(this.block, event))
  }

  private onDown = (event: MouseEvent): void => {
    const block = this.block
    if (block === null || event.button !== 0 || !this.view.editable || !onGrip(block, event)) return
    // The edge's, never CodeMirror's or ProseMirror's: no caret, no text selection.
    event.preventDefault()
    event.stopPropagation()
    this.startDrag(block, event)
  }

  /** A double-click on the edge: the normal width again, in one undo step. */
  private onDouble = (event: MouseEvent): void => {
    const block = this.block
    if (block === null || !this.view.editable || !onGrip(block, event)) return
    event.preventDefault()
    event.stopPropagation()
    this.commit(block, null)
  }

  private startDrag(block: HTMLElement, event: MouseEvent): void {
    const { view } = this
    // Screen px to the box's own px: the travel and the room are divided by the zoom at the box.
    const zoom = cssZoom(block)
    const box = block.getBoundingClientRect()
    // The scroller's right edge, never under the Contents rail: an edge dragged under it could not be grabbed again (demo check).
    const room = blockRightEdge(view.dom, GRIP_WIDTH) - box.left
    const max = Math.max(CODE_WIDTH_MIN, Math.min(CODE_WIDTH_MAX, Math.floor(room / zoom)))
    const startX = event.clientX
    const startWidth = box.width / zoom
    // What the box had before the drag: the decoration's values, put back before the one transaction writes the new ones.
    const startAttr = block.getAttribute(CODE_WIDTH_ATTR)
    const startProperty = block.style.getPropertyValue('--code-width')
    let width: number | null = null
    const end = (): void => {
      this.drag = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
      holdColResize(false)
      view.dom.classList.remove(CODE_DRAGGING_CLASS)
      block.classList.remove(CODE_GRIP_CLASS)
      if (startAttr === null) block.removeAttribute(CODE_WIDTH_ATTR)
      else block.setAttribute(CODE_WIDTH_ATTR, startAttr)
      if (startProperty === '') block.style.removeProperty('--code-width')
      else block.style.setProperty('--code-width', startProperty)
    }
    // Live on the box only: no transaction while the mouse moves.
    const onMove = (e: MouseEvent): void => {
      width = Math.min(max, Math.max(CODE_WIDTH_MIN, Math.round(startWidth + (e.clientX - startX) / zoom)))
      block.setAttribute(CODE_WIDTH_ATTR, String(width))
      block.style.setProperty('--code-width', `${width}px`)
    }
    // Mouseup, or the window losing focus mid-drag: the width where it stands. A press that never moved writes nothing.
    const onUp = (): void => {
      end()
      if (width !== null && this.commit(block, width)) view.dom.dispatchEvent(new CustomEvent<CodeWidthDragged>(CODE_WIDTH_DRAGGED, { bubbles: true, detail: { width } }))
    }
    this.drag = end
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    holdColResize(true)
    view.dom.classList.add(CODE_DRAGGING_CLASS)
    block.classList.add(CODE_GRIP_CLASS)
  }

  /** ONE transaction, its own undo step: the block's width, nothing else (its text, language and selection stay). True when it wrote. */
  private commit(block: HTMLElement, width: number | null): boolean {
    const pos = blockPos(this.view, block)
    const node = pos === null ? null : this.view.state.doc.nodeAt(pos)
    if (pos === null || node === null || codeWidth(node.attrs.width) === width) return false
    this.view.dispatch(closeHistory(this.view.state.tr).setNodeAttribute(pos, 'width', width))
    return true
  }

  destroy(): void {
    this.drag?.()
    this.leave()
    this.view.dom.removeEventListener('mouseover', this.onOver)
  }
}

export const codeWidthPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: pluginKey,
      state: {
        init: (_, { doc }) => {
          const out: Decoration[] = []
          decorate(doc, 0, doc.content.size, out)
          return DecorationSet.create(doc, out)
        },
        apply: (tr, set, oldState) => {
          if (!tr.docChanged) return set
          const mapped = set.map(tr.mapping, tr.doc)
          if (!mayChangeWidth(tr)) return mapped
          // Only the changed stretch is looked at again: from where the two documents part to where they meet.
          const start = oldState.doc.content.findDiffStart(tr.doc.content)
          const end = oldState.doc.content.findDiffEnd(tr.doc.content)
          if (start === null || end === null) return mapped
          const from = Math.min(start, end.b)
          const to = Math.max(start, end.b)
          const out: Decoration[] = []
          decorate(tr.doc, Math.max(0, from - 1), Math.min(tr.doc.content.size, to + 1), out)
          return mapped.remove(mapped.find(from, to)).add(tr.doc, out)
        },
      },
      props: { decorations: (state) => pluginKey.getState(state) },
      view: (view) => new CodeWidthGrip(view),
    }),
)

/** Register with `editor.use(codeBlockWidth)` and `editor.config(codeCommentStringify)` in createCrepe. */
export const codeBlockWidth = [codeWidthRemark, codeWidthSchema, codeWidthPlugin].flat()
