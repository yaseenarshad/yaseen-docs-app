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
 * CodeMirror when its attribute changes (a button, a key, an undo, a reload), and a CodeMirror that starts (Crepe
 * starts one when its block scrolls into view) reads them itself.
 *
 * THE TOOLBAR AND THE KEYS (D3, D4). Crepe copies CodeMirror's selection to the page, so a selection in the code is a
 * page `TextSelection` inside the `code_block` (`codeSelection`). The page toolbar shows for it (the vendored Crepe
 * patch) with the Text style group only (`CODE_TOOLBAR_KEYS`, `createCrepe.ts`), and its buttons and the page's keys
 * (`codeMarkKeys`) run `codeMarkCommand` there. A note card (`card` language) takes no marks.
 */
import { createSlice, type Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { AttrStep, Mapping } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { Prec, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView as CodeMirrorView, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view'
import { shallowRef, type ShallowRef } from 'vue'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { CARD_LANGUAGE } from '../card/cardBlockLine'
import { pageKeys } from '../pageKeys'
import { cleanSpans, sameSpans, type CodeMarkKind, type CodeSpan } from './codeComment'
import { blockPos, codeSpansOf, marksAttr, mayChangeCodeAttrs } from './codeWidth'

/** The toolbar buttons a selection in code keeps (D4): the Text style group. The others hide there. */
export const CODE_TOOLBAR_KEYS: readonly string[] = ['bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-more']

/** The mark each code toolbar button and key runs; the highlight buttons run through `marks/highlight.ts`. */
export const CODE_BUTTON_KINDS: Readonly<Record<string, CodeMarkKind>> = { bold: 'bold', italic: 'italic', underline: 'underline', strikethrough: 'strike' }

/** True while this editor's selection is in a code block: the toolbar then shows only `CODE_TOOLBAR_KEYS`. `createCrepe` injects one per editor. */
export const codeToolbarCtx = createSlice<ShallowRef<boolean>, 'codeToolbar'>(shallowRef(false), 'codeToolbar')

/** A code block that takes marks: not a note card. */
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
  (kind: CodeMarkKind, color: string | null | undefined = null, mode: 'toggle' | 'apply' | 'remove' = 'toggle'): Command =>
  (state, dispatch) => {
    const range = codeSelection(state)
    if (range === null) return false
    const spans = codeSpansOf(range.node)
    const off = mode === 'remove' || (mode === 'toggle' && codeHasMark(range, kind, kind === 'highlight' ? color : undefined))
    const drop = (span: CodeSpan) => span.kind === kind && (!off || color === undefined || kind !== 'highlight' || span.color === color)
    const next = cut(spans, range.from, range.to, drop)
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
 * The spans of each code block a change typed into, mapped through it, as ONE appended transaction (same undo step).
 * Only a block that had marks and kept the same `marks` attribute: a transaction that set the attribute itself (a
 * button, an undo) already holds the right spans. A span keeps its start before a key typed at it and grows with a
 * key typed at its end, as a page mark does; a span whose text is gone goes; a typed line break splits a span.
 */
function mapTypedSpans(trs: readonly Transaction[], oldState: EditorState, newState: EditorState): Transaction | null {
  if (!trs.some((tr) => tr.docChanged)) return null
  const mapping = new Mapping()
  for (const tr of trs) mapping.appendMapping(tr.mapping)
  const back = mapping.invert()
  const seen = new Set<number>()
  let out: Transaction | null = null
  for (const [from, to] of touchedRanges(trs)) {
    newState.doc.nodesBetween(Math.max(0, from), Math.min(newState.doc.content.size, to), (node, pos) => {
      if (node.type.name !== 'code_block') return !node.isTextblock && !node.isAtom
      if (node.attrs.marks === null || seen.has(pos)) return false
      seen.add(pos)
      const oldPos = back.map(pos, -1)
      const old = oldState.doc.nodeAt(oldPos)
      if (old === null || old.type !== node.type || old.attrs.marks !== node.attrs.marks || old.textContent === node.textContent) return false
      const mapped = codeSpansOf(old).map((span) => ({
        ...span,
        from: mapping.map(oldPos + 1 + span.from, 1) - pos - 1,
        to: mapping.map(oldPos + 1 + span.to, 1) - pos - 1,
      }))
      const clean = cleanSpans(node.textContent, mapped)
      if (!sameSpans(clean, codeSpansOf(node))) out = (out ?? newState.tr).setNodeAttribute(pos, 'marks', marksAttr(clean))
      return false
    })
  }
  return out
}

/** CodeMirror: the spans of its block, sent by the plugin's view (or read at start). */
const setSpans = StateEffect.define<readonly CodeSpan[]>()

/** The class each mark draws with (app.css `.cm-code-mark-*`); a highlight colour as the page's `mark` has it. */
function decorationOf(span: CodeSpan): Decoration {
  if (span.kind !== 'highlight') return Decoration.mark({ class: `cm-code-mark-${span.kind}` })
  if (span.color === null) return Decoration.mark({ class: 'cm-code-mark-highlight' })
  // A custom colour: the page's wash (`customWash`, alpha 0.4), written as `#rrggbb66`.
  if (span.color.startsWith('#')) return Decoration.mark({ class: 'cm-code-mark-highlight', attributes: { 'data-highlight': span.color, style: `--code-mark-bg: ${span.color}66` } })
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
/** Each page editor's started CodeMirrors, and the `marks` attribute each one last drew. */
const started = new WeakMap<EditorView, Map<CodeMirrorView, unknown>>()

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
function sendSpans(cm: CodeMirrorView, node: ProseNode, drawn: Map<CodeMirrorView, unknown>): void {
  if (drawn.get(cm) === node.attrs.marks) return
  drawn.set(cm, node.attrs.marks)
  cm.dispatch({ effects: setSpans.of(codeSpansOf(node)) })
}

/** A started CodeMirror registers with its page editor and draws its block's spans; it leaves when Crepe stops it. */
const startWithBlock = ViewPlugin.fromClass(
  class {
    private page: EditorView | null = null
    constructor(private readonly cm: CodeMirrorView) {
      // A CodeMirror cannot take a transaction while it is being made: the first draw waits a microtask.
      queueMicrotask(() => {
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

/** The plugin's state: how many transactions so far could change a block's attributes. Its view redraws on a change. */
const pluginKey = new PluginKey<number>('mdapp-code-marks')

/** The page side: typing maps the spans; a changed attribute redraws in CodeMirror; the toolbar learns it is in code. */
export const codeMarksPlugin = $prose(
  (ctx: Ctx) =>
    new Plugin<number>({
      key: pluginKey,
      state: {
        init: () => 0,
        apply: (tr, count) => (tr.docChanged && mayChangeCodeAttrs(tr) ? count + 1 : count),
      },
      appendTransaction: mapTypedSpans,
      view: (view) => {
        pageViews.set(view.dom, view)
        const inCode = ctx.isInjected(codeToolbarCtx) ? ctx.get(codeToolbarCtx) : null
        let seen = pluginKey.getState(view.state) ?? 0
        return {
          update(view) {
            const inside = codeSelection(view.state) !== null
            if (inCode !== null && inCode.value !== inside) inCode.value = inside
            const count = pluginKey.getState(view.state) ?? 0
            if (count === seen) return
            seen = count
            const drawn = started.get(view)
            if (drawn === undefined) return
            for (const cm of drawn.keys()) {
              const block = blockOf(cm)
              if (block !== null) sendSpans(cm, block.node, drawn)
            }
          },
          destroy() {
            pageViews.delete(view.dom)
            started.delete(view)
          },
        }
      },
    }),
)
