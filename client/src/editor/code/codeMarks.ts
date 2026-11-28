/**
 * Formatting inside a code block (YAZ-5794): bold, italic, underline, strike and highlight on the code's own text.
 *
 * IN THE FILE the code lines stay plain. The marks are parts of the `<!-- code: … -->` comment under the fence
 * (`codeComment.ts`, D1); a load fits each mark to its text (`fitMarks`, D2). ON THE NODE they are the `code_block`'s
 * `marks` attribute: spans of offsets into the code (`codeWidth.ts` reads and writes it).
 *
 * TYPING. A code block is a CodeMirror editor; Crepe copies each CodeMirror change into the node as plain text. The
 * plugin's `appendTransaction` maps the spans of each changed block through that change, so the marks move with
 * their text. ProseMirror's history puts an appended transaction in the same undo step: one ⌘Z undoes a typed key
 * and the move of its marks. A block with no marks does no mark work: its attribute is `null`.
 *
 * ON THE SCREEN. `codeMarkDecorations` (in every code block's CodeMirror extensions, `createCrepe.ts`) draws the spans
 * as CodeMirror mark decorations and maps them while the user types. The plugin's view sends a block's spans to its
 * CodeMirror when the block changed (a button, a key, an undo, an outside edit: YAZ-5876), and a CodeMirror that starts
 * (Crepe starts one when its block scrolls into view) reads them itself.
 *
 * THE TOOLBAR AND THE KEYS (D3, D4). Crepe copies CodeMirror's selection to the page, so a selection in the code is a
 * page `TextSelection` inside the `code_block` (`codeSelection`). The page toolbar shows for it (the vendored Crepe
 * patch) with the Text style group only (`CODE_TOOLBAR_KEYS`, `createCrepe.ts`), and its buttons and the page's keys
 * (`codeMarkKeys`) run `codeMarkCommand` there. A card (`card` language) takes no marks.
 */
import { createSlice, type Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Slice } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { AttrStep, Mapping } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { Prec, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView as CodeMirrorView, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view'
import type { ShallowRef } from 'vue'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { CARD_LANGUAGE } from '../card/cardBlockLine'
import { MORE_KEY } from '../highlightPanel'
import { pageKeys } from '../pageKeys'
import { cleanSpans, marksFromSpans, sameSpans, spansFromMarks, type CodeMarkKind, type CodeSpan } from './codeComment'
import { blockPos, codeSpansOf, marksAttr } from './codeWidth'

/** The toolbar buttons a selection in code keeps (D4): the Text style group. The others hide there. */
export const CODE_TOOLBAR_KEYS: readonly string[] = ['bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', MORE_KEY]

/** The mark each code toolbar button and key runs; the highlight buttons run through `marks/highlight.ts`. */
export const CODE_BUTTON_KINDS: Readonly<Record<string, CodeMarkKind>> = { bold: 'bold', italic: 'italic', underline: 'underline', strikethrough: 'strike' }

/** True while this editor's selection is in a code block: the toolbar then shows only `CODE_TOOLBAR_KEYS`. `createCrepe` injects one per editor. */
export const codeToolbarCtx = createSlice<ShallowRef<boolean> | null, 'codeToolbar'>(null, 'codeToolbar')

/** A code block that takes marks: not a card. */
const takesMarks = (node: ProseNode): boolean => node.type.name === 'code_block' && node.attrs.language !== CARD_LANGUAGE

/** A selection inside one code block: the block's position and node, and the selection as offsets into its code. */
export interface CodeRange {
  pos: number
  node: ProseNode
  from: number
  to: number
}

/** The selection as a range of one code block's code, or null: an empty selection, one outside code, or over two blocks. */
export function codeSelection(state: EditorState): CodeRange | null {
  const { selection } = state
  if (selection.empty || !(selection instanceof TextSelection)) return null
  const { $from, $to } = selection
  const node = $from.parent
  if (!takesMarks(node) || $to.parent !== node) return null
  const start = $from.start()
  return { pos: start - 1, node, from: $from.pos - start, to: $to.pos - start }
}

/** Whether any of the range carries `kind` (for a highlight, `color`; `undefined` is any colour): the page's lit rule. */
export function codeHasMark(range: CodeRange, kind: CodeMarkKind, color?: string | null): boolean {
  return codeSpansOf(range.node).some((s) => s.kind === kind && (color === undefined || s.color === color) && s.from < range.to && s.to > range.from)
}

/** The highlight colours on the range (`null` is yellow), in the code's order. */
export function codeColorsIn(range: CodeRange): (string | null)[] {
  const colours = codeSpansOf(range.node).filter((s) => s.kind === 'highlight' && s.from < range.to && s.to > range.from).map((s) => s.color)
  return [...new Set(colours)]
}

/** `spans` with `from`…`to` cut out of each span that `drop` takes; a span over the cut keeps its two ends. */
function cut(spans: readonly CodeSpan[], from: number, to: number, drop: (span: CodeSpan) => boolean): CodeSpan[] {
  return spans.flatMap((span) => {
    if (!drop(span) || span.to <= from || span.from >= to) return [span]
    return [
      ...(span.from < from ? [{ ...span, to: from }] : []),
      ...(span.to > to ? [{ ...span, from: to }] : []),
    ]
  })
}

/** Write a block's new spans in one transaction. Declines when nothing changes. */
function writeSpans(state: EditorState, range: CodeRange, next: CodeSpan[], dispatch: ((tr: Transaction) => void) | undefined): boolean {
  const clean = cleanSpans(range.node.textContent, next)
  if (sameSpans(clean, codeSpansOf(range.node))) return false
  dispatch?.(state.tr.setNodeAttribute(range.pos, 'marks', marksAttr(clean)))
  return true
}

/**
 * A mark on the selected code, as a page button or key does it (D4).
 *  - `toggle`: lit (any of the selection has it; for a highlight, that colour) → off the selection; else on.
 *  - `apply`: on, never off (the ▾ panel's pick).
 *  - `remove`: off (for a highlight with `color` `undefined`: every colour).
 * A highlight that goes on first takes any other colour off the selection: one colour replaces another, as on the page.
 * Declines outside code, and when nothing changes.
 */
export const codeMarkCommand =
  (kind: CodeMarkKind, color?: string | null, mode: 'toggle' | 'apply' | 'remove' = 'toggle'): Command =>
  (state, dispatch) => {
    const range = codeSelection(state)
    if (range === null) return false
    const spans = codeSpansOf(range.node)
    const off = mode === 'remove' || (mode === 'toggle' && codeHasMark(range, kind, kind === 'highlight' ? (color ?? null) : undefined))
    const drop = (span: CodeSpan) => span.kind === kind && (!off || color === undefined || kind !== 'highlight' || span.color === color)
    const next = cut(spans, range.from, range.to, drop)
    // `undefined` means every colour only for `remove`; to put a highlight on, it is yellow (`null`).
    if (!off) next.push({ from: range.from, to: range.to, kind, color: kind === 'highlight' ? (color ?? null) : null })
    return writeSpans(state, range, next, dispatch)
  }

/** ⌘\ in code: every mark off the selection. Declines outside code and when the selection has none. */
export const clearCodeMarks: Command = (state, dispatch) => {
  const range = codeSelection(state)
  if (range === null) return false
  return writeSpans(state, range, cut(codeSpansOf(range.node), range.from, range.to, () => true), dispatch)
}

/** The final-document ranges each step of `trs` touched; an attribute step touches its node. */
function touchedRanges(trs: readonly Transaction[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  trs.forEach((tr, t) => {
    const later = new Mapping()
    for (const next of trs.slice(t + 1)) later.appendMapping(next.mapping)
    tr.steps.forEach((step, i) => {
      const after = tr.mapping.slice(i + 1)
      const toEnd = (pos: number, assoc: number) => later.map(after.map(pos, assoc), assoc)
      if (step instanceof AttrStep) ranges.push([toEnd(step.pos, 1), toEnd(step.pos, 1) + 1])
      else step.getMap().forEach((_oldStart, _oldEnd, start, end) => ranges.push([toEnd(start, -1), toEnd(end, 1)]))
    })
  })
  return ranges
}

/**
 * The stamp the app puts on a change that came from outside (`EXTERNAL_EDIT_META`, `external/applyExternalMarkdown.ts`;
 * not imported: that module imports `createCrepe`, which imports this one). The test pins the two together.
 */
export const OUTSIDE_EDIT = 'external-edit'

/**
 * The spans of each code block a change typed into, mapped through it, as ONE appended transaction (same undo step).
 * Only a block that had marks and kept the same `marks` attribute: a transaction that set the attribute itself (a
 * button, an undo) already holds the right spans. A span keeps its start before a key typed at it and grows with a
 * key typed at its end, as a page mark does; a span whose text is gone goes; a typed line break splits a span.
 */
function mapTypedSpans(trs: readonly Transaction[], oldState: EditorState, newState: EditorState): Transaction | null {
  if (!trs.some((tr) => tr.docChanged)) return null
  // The blocks with marks that the change touched; most changes (a key in a paragraph, in a plain block) find none.
  const touched: Array<{ node: ProseNode; pos: number }> = []
  const seen = new Set<number>()
  for (const [from, to] of touchedRanges(trs))
    newState.doc.nodesBetween(Math.max(0, from), Math.min(newState.doc.content.size, to), (node, pos) => {
      if (node.type.name !== 'code_block') return !node.isTextblock && !node.isAtom
      if (node.attrs.marks !== null && !seen.has(pos)) touched.push({ node, pos })
      seen.add(pos)
      return false
    })
  if (touched.length === 0) return null
  const mapping = new Mapping()
  for (const tr of trs) mapping.appendMapping(tr.mapping)
  const back = mapping.invert()
  // An outside edit (Claude, git, another editor) is no typing (YAZ-5851): each mark is fitted to the new code as a
  // fresh load fits it (D2), by its text on its line. Mapped like typing, a mark grew over new text next to it, or went
  // with a range the outside edit rewrote around it.
  const outside = trs.some((tr) => tr.getMeta(OUTSIDE_EDIT) === true)
  let out: Transaction | null = null
  for (const { node, pos } of touched) {
    const oldPos = back.map(pos, -1)
    const old = oldState.doc.nodeAt(oldPos)
    if (old === null || old.type !== node.type || old.attrs.marks !== node.attrs.marks || old.textContent === node.textContent) continue
    const clean = outside
      ? spansFromMarks(node.textContent, marksFromSpans(old.textContent, codeSpansOf(old)))
      : cleanSpans(
          node.textContent,
          codeSpansOf(old).map((span) => ({
            ...span,
            from: mapping.map(oldPos + 1 + span.from, 1) - pos - 1,
            to: mapping.map(oldPos + 1 + span.to, 1) - pos - 1,
          })),
        )
    if (!sameSpans(clean, codeSpansOf(node))) out = (out ?? newState.tr).setNodeAttribute(pos, 'marks', marksAttr(clean))
  }
  return out
}

/**
 * A copy that starts inside a code block (YAZ-5853): ProseMirror cuts the block and keeps its attributes, so the
 * spans still count from the WHOLE block's start. They move back by the cut, and a span outside the copied code goes,
 * before the copy is written (`toDOM` writes each mark with its text). A copy that starts elsewhere is unchanged.
 */
function trimCopiedSpans(slice: Slice, state: EditorState): Slice {
  const { $from } = state.selection
  if (slice.openStart === 0 || $from.parent.type.name !== 'code_block') return slice
  const cut = $from.parentOffset
  // The cut block is the deepest node down the slice's open start (its first child at each open level).
  const trim = (node: ProseNode, depth: number): ProseNode => {
    if (depth < slice.openStart) {
      const child = node.firstChild
      return child === null ? node : node.copy(node.content.replaceChild(0, trim(child, depth + 1)))
    }
    if (node.type.name !== 'code_block' || node.attrs.marks === null) return node
    const spans = cleanSpans(node.textContent, (node.attrs.marks as CodeSpan[]).map((s) => ({ ...s, from: s.from - cut, to: s.to - cut })))
    return node.type.create({ ...node.attrs, marks: marksAttr(spans) }, node.content, node.marks)
  }
  const first = slice.content.firstChild
  if (first === null) return slice
  const trimmed = trim(first, 1)
  return trimmed === first ? slice : new Slice(slice.content.replaceChild(0, trimmed), slice.openStart, slice.openEnd)
}

/** CodeMirror: the spans of its block, sent by the plugin's view (or read at start). */
const setSpans = StateEffect.define<readonly CodeSpan[]>()

/** The class each mark draws with (app.css `.cm-code-mark-*`); a highlight colour as the page's `mark` has it. */
function decorationOf(span: CodeSpan): Decoration {
  if (span.kind !== 'highlight') return Decoration.mark({ class: `cm-code-mark-${span.kind}` })
  if (span.color === null) return Decoration.mark({ class: 'cm-code-mark-highlight' })
  // A custom colour (D8): solid `#rrggbb` or custom opacity `#rrggbbaa` directly.
  if (span.color.startsWith('#')) return Decoration.mark({ class: 'cm-code-mark-highlight', attributes: { 'data-highlight': span.color, style: `--code-mark-bg: ${span.color}` } })
  return Decoration.mark({ class: `cm-code-mark-highlight highlight-${span.color}` })
}

const decorate = (spans: readonly CodeSpan[], length: number): DecorationSet =>
  Decoration.set(
    spans.filter((s) => s.to <= length).map((s): Range<Decoration> => decorationOf(s).range(s.from, s.to)),
    true,
  )

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) if (effect.is(setSpans)) return decorate(effect.value, tr.state.doc.length)
    return tr.docChanged ? decorations.map(tr.changes) : decorations
  },
  provide: (field) => CodeMirrorView.decorations.from(field),
})

/** The page editor of each `.ProseMirror`, so a CodeMirror inside it finds its block. */
const pageViews = new WeakMap<Element, EditorView>()
/** Each page editor's started CodeMirrors, and the block node each one last drew (`null`: none yet). */
const started = new WeakMap<EditorView, Map<CodeMirrorView, ProseNode | null>>()

/** The page editor and the block of a CodeMirror, or null (not drawn by a page editor). */
function blockOf(cm: CodeMirrorView): { view: EditorView; pos: number; node: ProseNode } | null {
  const editor = cm.dom.parentElement?.closest('.ProseMirror')
  const view = editor == null ? undefined : pageViews.get(editor)
  const box = cm.dom.closest<HTMLElement>('.milkdown-code-block')
  if (view === undefined || box === null) return null
  const pos = blockPos(view, box)
  const node = pos === null ? null : view.state.doc.nodeAt(pos)
  return pos === null || node === null ? null : { view, pos, node }
}

/** Draw a block's spans in its CodeMirror when its `marks` attribute is not the one it drew. */
function sendSpans(cm: CodeMirrorView, node: ProseNode, drawn: Map<CodeMirrorView, ProseNode | null>): void {
  const last = drawn.get(cm) ?? null
  // The same node is drawn. A block with no marks, before and now, has nothing to draw: a key in a plain block sends
  // nothing. Any other change of the node is sent (YAZ-5876): an outside edit replaces CodeMirror's text as ONE change
  // over the marks, which wipes their drawing, though the fitted `marks` can be the same value as before.
  if (last === node || (node.attrs.marks === null && (last === null || last.attrs.marks === null))) return
  drawn.set(cm, node)
  cm.dispatch({ effects: setSpans.of(codeSpansOf(node)) })
}

/** A started CodeMirror registers with its page editor and draws its block's spans; it leaves when Crepe stops it. */
const startWithBlock = ViewPlugin.fromClass(
  class {
    private page: EditorView | null = null
    private destroyed = false
    constructor(private readonly cm: CodeMirrorView) {
      // A CodeMirror cannot take a transaction while it is being made: the first draw waits a microtask. Crepe can
      // stop it before then (its block scrolled away): then it never registers.
      queueMicrotask(() => {
        if (this.destroyed) return
        const block = blockOf(cm)
        if (block === null) return
        this.page = block.view
        let drawn = started.get(block.view)
        if (drawn === undefined) started.set(block.view, (drawn = new Map()))
        drawn.set(cm, null)
        if (block.node.attrs.marks !== null) sendSpans(cm, block.node, drawn)
      })
    }
    destroy(): void {
      this.destroyed = true
      if (this.page !== null) started.get(this.page)?.delete(this.cm)
    }
  },
)

/** In every code block's CodeMirror extensions (`createCrepe.ts`): the marks drawn on the code. */
export const codeMarkDecorations: Extension = [markField, startWithBlock]

/**
 * The page's keys in code (D4), as the user set them (`page.bold`, … `page.clearFormatting`): each runs on the page
 * editor, whose selection is CodeMirror's. High precedence, so ⌘I and ⌘\ reach the marks before CodeMirror's own keys.
 * A key outside a mark's reach (a read-only page, a card, an empty selection) is not taken.
 */
export function codeMarkKeys(hotkeys: HotkeyOverrides | undefined): Extension {
  const run = (command: Command) => (cm: CodeMirrorView): boolean => {
    const block = blockOf(cm)
    if (block === null || !block.view.editable) return false
    return command(block.view.state, block.view.dispatch, block.view)
  }
  const rows: Array<[string, Command]> = [
    ['page.bold', codeMarkCommand('bold')],
    ['page.italic', codeMarkCommand('italic')],
    ['page.underline', codeMarkCommand('underline')],
    ['page.strikethrough', codeMarkCommand('strike')],
    ['page.highlight', codeMarkCommand('highlight', null)],
    ['page.clearFormatting', clearCodeMarks],
  ]
  return Prec.high(keymap.of(rows.flatMap(([row, command]) => pageKeys(row, hotkeys).map((key) => ({ key, run: run(command) })))))
}

/** The page side: typing maps the spans; a changed attribute redraws in CodeMirror; the toolbar learns it is in code. */
export const codeMarksPlugin = $prose(
  (ctx: Ctx) =>
    new Plugin({
      key: new PluginKey('mdapp-code-marks'),
      appendTransaction: mapTypedSpans,
      props: { transformCopied: (slice, view) => trimCopiedSpans(slice, view.state) },
      view: (view) => {
        pageViews.set(view.dom, view)
        const inCode = ctx.get(codeToolbarCtx)
        return {
          update(view, prev) {
            const inside = codeSelection(view.state) !== null
            if (inCode !== null && inCode.value !== inside) inCode.value = inside
            if (view.state.doc === prev.doc) return
            const drawn = started.get(view)
            if (drawn === undefined || drawn.size === 0) return
            redrawChanged(view, prev.doc, drawn)
          },
          destroy() {
            pageViews.delete(view.dom)
            started.delete(view)
          },
        }
      },
    }),
)

/**
 * Send new spans to the started CodeMirrors of the blocks whose `marks` changed: only the part of the page that
 * differs from `before` is walked (ProseMirror's own fragment diff, which shares the untouched nodes), and a block
 * whose attribute is the one its CodeMirror drew is skipped. A key in a plain block finds nothing to send.
 */
function redrawChanged(view: EditorView, before: ProseNode, drawn: Map<CodeMirrorView, ProseNode | null>): void {
  const doc = view.state.doc
  const start = doc.content.findDiffStart(before.content)
  const end = doc.content.findDiffEnd(before.content)
  if (start === null || end === null) return
  doc.nodesBetween(start, Math.max(start, end.a), (node, pos) => {
    if (node.type.name !== 'code_block') return !node.isTextblock && !node.isAtom
    const box = view.nodeDOM(pos)
    const cm = box instanceof HTMLElement ? CodeMirrorView.findFromDOM(box) : null
    if (cm !== null && drawn.has(cm)) sendSpans(cm, node, drawn)
    return false
  })
}
