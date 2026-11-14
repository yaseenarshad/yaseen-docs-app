/**
 * EDIT CARD WITH THE PAGE'S EDITOR (YAZ-5026, decision A on YAZ-5026: "we are REUSING it but doesnt mean its 1:1").
 * Edit card mounts a second `createCrepe` inside the card frame, with the card's own on/off list
 * (`cardEditorFeatures.ts`), in place of the raw-text code box. This file is what only a card's editor has:
 *
 *  - SIDES: the card text is cut into sides BEFORE the editor reads it (`cardEditorText.ts`), each side is read alone,
 *    and a `card_side_break` node stands between two sides. `---` never reaches the Markdown reader, so
 *    `Question\n---\nAnswer` stays two sides. Typing `---` on an empty top line, ⌘⇧↵ and the `/` row "New side" make one;
 *    `***` and `___` stay a line (hr).
 *  - HIDDEN WORDS: `{{word}}`, `{{1::word}}` and `{{c1::word}}` are the `cloze` mark (attribute `prefix`: null, `1::`,
 *    `c1::`), read by a remark step from the text of ONE phrasing parent, never from code (inline code and code blocks
 *    hold a value, not text nodes), and written back the same way. ⌘L, the toolbar's "Hide word" and typing `{{word}}`
 *    make one; ⌘L in a hidden word takes the mark off the whole word (`toggleHiddenWord`'s rule).
 *  - THE TEXT OUT (`cardText`): each side is written alone, with the page's tidy form (`markdown`, the page's serializer
 *    and `postProcessMarkdown`). A side whose nodes are still the ones it started with keeps its ORIGINAL bytes; a
 *    card with no change gives back its text exactly.
 *  - KEYS: ⌘↵ and Esc are Done (Esc first closes an open menu or the `[[` picker); ⌘L hides a word; ⌘⇧↵ is a new side in
 *    a line (in a code block or a table it stays "add a line above").
 *
 * The card view (`cardBlockView.ts`) owns the rest: the mirror of the text into the page, Done's one undo step.
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { clearTextInCurrentBlockCommand, insertHrInputRule } from '@milkdown/kit/preset/commonmark'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { Fragment, type MarkType, type Node as ProseNode, type NodeType } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $command, $inputRule, $markSchema, $nodeSchema, $prose, $remark, $shortcut } from '@milkdown/kit/utils'
import { commandsCtx } from '@milkdown/kit/core'
import type { Parent, PhrasingContent } from 'mdast'
import type { Handle } from 'mdast-util-to-markdown'
import { highlightInputRule, highlightKeymap } from '../marks/highlight'
import { wrapInTaskListInputRule } from '../listMarkerTyping'
import { normalizeEmptyItems } from '../listItemRoundTrip'
import type { SlashMenuGroups } from '../slashMenu'
import type { ToolbarBuilder } from '../createCrepe'
import { joinCardParts, sideMarkdown, sideWithEdges, splitCardText, type CardParts } from './cardEditorText'
import { tourEvent } from '../../course/tourBus'

// ---------------------------------------------------------------------------------------------------------------------
// The hidden word: the `cloze` mark
// ---------------------------------------------------------------------------------------------------------------------

/** A hidden word's number prefix, as `shared/cardText.ts` reads it: `1::`, `c1::`. */
const PREFIX_RE = /^c?\d+::/

/** The mdast node of a hidden word. */
export interface ClozeNode extends Parent {
  type: 'cloze'
  prefix: string | null
  children: PhrasingContent[]
}
interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  [key: string]: unknown
}

const textNode = (value: string): MdNode => ({ type: 'text', value })

declare module 'mdast' {
  interface PhrasingContentMap {
    cloze: ClozeNode
  }
  interface RootContentMap {
    cloze: ClozeNode
  }
}

/**
 * Wraps each `{{…}}` of `parent`'s phrasing children in a `cloze` node: from a text child with `{{` to the first `}}`
 * in a text child of the SAME parent (the nodes between, bold or a link, go inside). A pair split over two parents (a
 * bold edge, two paragraphs) stays text, so its bytes stay. Code has no text children: a `{{` there is never read.
 */
function wrapClozes(parent: MdNode): void {
  const kids = parent.children
  if (kids === undefined) return
  for (const kid of kids) wrapClozes(kid)
  let i = 0
  while (i < kids.length) {
    const open = kids[i]
    const at = open.type === 'text' ? (open.value ?? '').indexOf('{{') : -1
    if (at < 0) {
      i++
      continue
    }
    const value = open.value ?? ''
    let j = i
    let close = value.indexOf('}}', at + 2)
    if (close < 0)
      for (j = i + 1; j < kids.length; j++) {
        if (kids[j].type !== 'text') continue
        close = (kids[j].value ?? '').indexOf('}}')
        if (close >= 0) break
      }
    if (close < 0 || j >= kids.length) {
      i++
      continue
    }
    const inner: MdNode[] =
      j === i
        ? [textNode(value.slice(at + 2, close))]
        : [textNode(value.slice(at + 2)), ...kids.slice(i + 1, j), textNode((kids[j].value ?? '').slice(0, close))]
    const after = (j === i ? value : (kids[j].value ?? '')).slice(close + 2)
    let prefix: string | null = null
    const first = inner[0]
    const match = first.type === 'text' ? PREFIX_RE.exec(first.value ?? '') : null
    if (match !== null) {
      prefix = match[0]
      first.value = (first.value ?? '').slice(prefix.length)
    }
    const children = inner.filter((n) => n.type !== 'text' || (n.value ?? '') !== '')
    if (children.length === 0) {
      // `{{}}` hides nothing: it stays text.
      i++
      continue
    }
    const cloze = { type: 'cloze', prefix, children }
    const before = value.slice(0, at)
    const replaced: MdNode[] = [...(before === '' ? [] : [textNode(before)]), cloze as unknown as MdNode, ...(after === '' ? [] : [textNode(after)])]
    kids.splice(i, j - i + 1, ...replaced)
    i += replaced.length - (after === '' ? 0 : 1)
  }
}

/** `{{` + prefix + the phrasing + `}}`. */
const clozeHandle: Handle & { peek?: Handle } = (node: ClozeNode, _parent, state, info) => {
  const tracker = state.createTracker(info)
  let value = tracker.move(`{{${node.prefix ?? ''}`)
  value += tracker.move(state.containerPhrasing(node as never, { before: value, after: '}', ...tracker.current() }))
  value += tracker.move('}}')
  return value
}
clozeHandle.peek = () => '{'

/** Reads `{{…}}` into `cloze` nodes, and writes them back. The card's editor only. */
export const clozeRemark = $remark('mdapp-card-cloze', () => function cloze() {
  const data = this.data()
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), { handlers: { cloze: clozeHandle } }]
  return (tree) => wrapClozes(tree as unknown as MdNode)
})

/** Each hidden word read or made gets its own key: two words side by side stay two (`{{a}}{{b}}`), never one. */
let clozeKeys = 0

export const clozeSchema = $markSchema('cloze', () => ({
  attrs: { prefix: { default: null }, key: { default: 0 } },
  inclusive: false,
  // Opened before bold and the rest: `{{**a** b}}`, the hidden word around them.
  priority: 10,
  parseDOM: [{ tag: 'span[data-cloze]', getAttrs: (dom) => ({ prefix: (dom as HTMLElement).dataset.clozePrefix ?? null, key: ++clozeKeys }) }],
  toDOM: (mark) => ['span', { 'data-cloze': '', class: 'card__cloze', ...(mark.attrs.prefix === null ? {} : { 'data-cloze-prefix': String(mark.attrs.prefix) }) }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'cloze',
    runner: (state, node, markType) => {
      state.openMark(markType, { prefix: (node.prefix as string | null | undefined) ?? null, key: ++clozeKeys })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'cloze',
    runner: (state, mark) => {
      // `key` goes into the node so two words side by side are not merged into one.
      state.withMark(mark, 'cloze', undefined, { prefix: mark.attrs.prefix as string | null, key: mark.attrs.key as number })
    },
  },
}))

/** The run of one hidden word around `from`..`to` in its textblock, or null when the selection is not inside one. */
function clozeRunAround(state: EditorState, type: MarkType, from: number, to: number): { from: number; to: number } | null {
  const $from = state.doc.resolve(from)
  const $to = state.doc.resolve(to)
  if ($from.parent !== $to.parent || !$from.parent.isTextblock) return null
  const start = $from.start()
  let found: { from: number; to: number } | null = null
  let run: { from: number; to: number; key: unknown } | null = null
  const end = () => {
    if (run !== null && found === null && from >= run.from && to <= run.to) found = { from: run.from, to: run.to }
    run = null
  }
  $from.parent.forEach((child, offset) => {
    const mark = type.isInSet(child.marks)
    const at = start + offset
    if (mark === undefined) return end()
    if (run !== null && run.key === mark.attrs.key && run.to === at) run.to = at + child.nodeSize
    else {
      end()
      run = { from: at, to: at + child.nodeSize, key: mark.attrs.key }
    }
  })
  end()
  return found
}

/**
 * ⌘L (YAZ-5008's rule, `toggleHiddenWord`): a selection inside a hidden word takes the mark off the whole word; any
 * other selection becomes one. No selection, a selection in code, or one that holds `{{` or `}}`: nothing.
 */
export const toggleCloze =
  (type: MarkType): Command =>
  (state, dispatch) => {
    const { selection } = state
    if (selection.empty || !(selection instanceof TextSelection)) return true
    const { from, to, $from } = selection
    if ($from.parent.type.spec.code === true) return true
    const code = state.schema.marks.inlineCode
    if (code !== undefined && state.doc.rangeHasMark(from, to, code)) return true
    const text = state.doc.textBetween(from, to, '\n')
    if (text.includes('{{') || text.includes('}}')) return true
    const run = clozeRunAround(state, type, from, to)
    if (dispatch === undefined) return true
    if (run !== null) dispatch(state.tr.removeMark(run.from, run.to, type).scrollIntoView())
    else {
      dispatch(state.tr.addMark(from, to, type.create({ prefix: null, key: ++clozeKeys })).scrollIntoView())
      tourEvent('card-word-hidden')
    }
    return true
  }

/** Is any of the selection a hidden word? The toolbar's "Hide word" lights then. */
export const selectionHasCloze = (state: EditorState, type: MarkType): boolean => {
  const { from, to, empty, $from } = state.selection
  return empty ? type.isInSet(state.storedMarks ?? $from.marks()) !== undefined : state.doc.rangeHasMark(from, to, type)
}

export const toggleClozeCommand = $command('ToggleCardCloze', (ctx) => () => toggleCloze(clozeSchema.type(ctx)))

/** Typing `{{word}}` hides the word: on its last `}`. Not in code. */
export const clozeInputRule = $inputRule(
  (ctx) =>
    new InputRule(/\{\{([^{}\n]+)\}\}$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start)
      const code = state.schema.marks.inlineCode
      if (code !== undefined && code.isInSet($start.marks()) !== undefined) return null
      let word = match[1]
      const prefix = PREFIX_RE.exec(word)?.[0] ?? null
      if (prefix !== null) word = word.slice(prefix.length)
      if (word.trim() === '') return null
      const marks = $start.marks()
      const cloze = clozeSchema.type(ctx).create({ prefix, key: ++clozeKeys })
      return state.tr.replaceWith(start, end, state.schema.text(word, cloze.addToSet(marks))).removeStoredMark(clozeSchema.type(ctx))
    }),
)

// ---------------------------------------------------------------------------------------------------------------------
// The side break
// ---------------------------------------------------------------------------------------------------------------------

export const SIDE_BREAK = 'card_side_break'

/**
 * The line between two sides. Never read from Markdown (the sides are cut before the read); a copy writes it as `---`.
 */
export const sideBreakSchema = $nodeSchema(SIDE_BREAK, () => ({
  group: 'block',
  atom: true,
  selectable: true,
  parseDOM: [{ tag: 'div[data-card-side-break]' }],
  toDOM: () => ['div', { 'data-card-side-break': '', class: 'card__side-break', contenteditable: 'false' }],
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: {
    match: (node) => node.type.name === SIDE_BREAK,
    runner: (state) => {
      state.addNode('html', undefined, '---')
    },
  },
}))

/**
 * A new side at the caret: in a top line the line splits there (the caret goes to the start of the new side); at a
 * line's start the break goes above it; at its end, below it with an empty line. In a list or a quote the break goes
 * after the top block. In a code block or a table: false (⌘⇧↵ stays "add a line above" there).
 */
export const newSide =
  (breakType: NodeType): Command =>
  (state, dispatch) => {
    const { $from } = state.selection
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.spec.code === true || $from.node(d).type.name === 'table') return false
    if (dispatch === undefined) return true
    const tr = state.tr.deleteSelection()
    const $at = tr.selection.$from
    const paragraph = state.schema.nodes.paragraph
    if ($at.depth === 1 && $at.parent.isTextblock) {
      const block = $at.parent
      const before = $at.before(1)
      if ($at.parentOffset === 0) {
        // An empty line stays the new side's first line.
        tr.insert(before, breakType.create())
        tr.setSelection(TextSelection.create(tr.doc, before + 2))
      } else if ($at.parentOffset === block.content.size) {
        const after = $at.after(1)
        tr.insert(after, [breakType.create(), paragraph.create()])
        tr.setSelection(TextSelection.create(tr.doc, after + 2))
      } else {
        // The spaces at the split go, as the raw editor's ⌘⇧↵ did.
        const text = block.textBetween(0, block.content.size, '\n', '￼')
        let left = $at.parentOffset
        while (left > 0 && text[left - 1] === ' ') left--
        let right = $at.parentOffset
        while (right < text.length && text[right] === ' ') right++
        const start = $at.start()
        tr.delete(start + left, start + right)
        tr.split(start + left)
        // `at` is the end of the first half; the second half opens after its close.
        const at = start + left
        tr.insert(at + 1, breakType.create())
        tr.setSelection(TextSelection.create(tr.doc, at + 3))
      }
    } else {
      const after = $at.after(1)
      tr.insert(after, [breakType.create(), paragraph.create()])
      tr.setSelection(TextSelection.create(tr.doc, after + 2))
    }
    dispatch(tr.scrollIntoView())
    tourEvent('card-side-added')
    return true
  }

export const newSideCommand = $command('CardNewSide', (ctx) => () => newSide(sideBreakSchema.type(ctx)))

/**
 * `---` on an otherwise empty TOP line is a new side; in a list or a quote it stays a line, as before. `***` and `___`
 * (then a space) stay a line: Milkdown's own rule, without its `---`.
 */
export const sideBreakInputRule = $inputRule(
  (ctx) =>
    new InputRule(/^(?:---|___\s|\*\*\*\s)$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start)
      const hr = state.schema.nodes.hr
      if (match[0] === '---' && $start.depth === 1 && $start.parent.type.name === 'paragraph' && $start.parent.content.size === end - start) {
        const tr = state.tr.replaceWith($start.before(), $start.after(), [sideBreakSchema.type(ctx).create(), state.schema.nodes.paragraph.create()])
        return tr.setSelection(TextSelection.create(tr.doc, $start.before() + 2))
      }
      return hr === undefined ? null : state.tr.replaceWith(start - 1, end, hr.create())
    }),
)

/** The `/` row "New side" (`/side`): the `/query` cleared, then a new side at the caret. */
export function newSideSlashRow(builder: SlashMenuGroups): void {
  builder.getGroup('text').addItem('card-side', {
    label: 'New side',
    icon: SIDE_ICON,
    keywords: ['side', 'back', 'flip'],
    onRun: (ctx: Ctx) => {
      const commands = ctx.get(commandsCtx)
      commands.call(clearTextInCurrentBlockCommand.key)
      commands.call(newSideCommand.key)
    },
  })
}

/**
 * The toolbar's "Hide word ⌘L": lit while the selection holds a hidden word; a click is ⌘L. It sits right after the
 * heading buttons (H1 H2 H3 T), where Yaseen marked it on the strip (YAZ-5026 round 2: "change the position of the
 * cloze caption?"): the card's own action, under the hand after a double click, not last after the link.
 */
export function hideWordButton(builder: ToolbarBuilder): { after: string } {
  builder.getGroup('formatting').addItem('cloze', {
    icon: HIDE_ICON,
    label: 'Hide word',
    shortcut: '⌘L',
    active: (ctx) => selectionHasCloze(ctx.get(editorViewCtx).state, clozeSchema.type(ctx)),
    onRun: (ctx) => {
      ctx.get(commandsCtx).call(toggleClozeCommand.key)
    },
  })
  return { after: 'lineType' }
}

/** Two cards, the front over the back. */
const SIDE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <path d="M4 4H20V10H4V4ZM6 6V8H18V6H6ZM4 14H20V20H4V14ZM6 16V18H18V16H6ZM3 11.25H21V12.75H3V11.25Z" />
  </svg>
`

/** Braces around a hidden box: `{ ▮ }`. */
const HIDE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <path d="M8 4C6.3 4 5.5 4.9 5.5 6.5V9.5C5.5 10.4 5 11 4 11.2V12.8C5 13 5.5 13.6 5.5 14.5V17.5C5.5 19.1 6.3 20 8 20H9V18H8.3C7.7 18 7.5 17.7 7.5 17.1V14.2C7.5 13.1 7 12.4 6.2 12C7 11.6 7.5 10.9 7.5 9.8V6.9C7.5 6.3 7.7 6 8.3 6H9V4H8ZM16 4H15V6H15.7C16.3 6 16.5 6.3 16.5 6.9V9.8C16.5 10.9 17 11.6 17.8 12C17 12.4 16.5 13.1 16.5 14.2V17.1C16.5 17.7 16.3 18 15.7 18H15V20H16C17.7 20 18.5 19.1 18.5 17.5V14.5C18.5 13.6 19 13 20 12.8V11.2C19 11 18.5 10.4 18.5 9.5V6.5C18.5 4.9 17.7 4 16 4ZM10 9H14V15H10V9Z" />
  </svg>
`

// ---------------------------------------------------------------------------------------------------------------------
// The mount
// ---------------------------------------------------------------------------------------------------------------------

/** What the card view gives the editor of one Edit card. */
export interface CardEditorDoors {
  /** Done: ⌘↵, or Esc that no menu took. */
  done: () => void
  /** The document changed (typing, ⌘Z): the card view mirrors the text into the page. */
  changed: () => void
}

/** The page's editor for a card, from its host (`createCrepe`'s `cardEditor`): the Crepe, and its Markdown of a doc. */
export interface CardCrepe {
  crepe: Crepe
  markdown: (doc: ProseNode) => string
}

/** One open Edit card. */
export interface CardEditor {
  /** Made: the card's text is in it and it has the keyboard. */
  ready: Promise<void>
  /** The card's text now: what Done writes. The text it started from until it is ready. */
  text: () => string
  view: () => EditorView | null
  destroy: () => void
}

/** Empty paragraphs at either end of a side are no part of it: the side's own blank lines say that. */
function trimEmpty(nodes: readonly ProseNode[]): ProseNode[] {
  let from = 0
  let to = nodes.length
  const empty = (n: ProseNode) => n.type.name === 'paragraph' && n.content.size === 0
  while (from < to && empty(nodes[from])) from++
  while (to > from && empty(nodes[to - 1])) to--
  return nodes.slice(from, to)
}

/** The doc's top blocks cut at each side break. */
function sidesOf(doc: ProseNode): ProseNode[][] {
  const sides: ProseNode[][] = [[]]
  doc.forEach((child) => {
    if (child.type.name === SIDE_BREAK) sides.push([])
    else sides[sides.length - 1].push(child)
  })
  return sides.map(trimEmpty)
}

const sameNodes = (a: readonly ProseNode[], b: readonly ProseNode[]): boolean => a.length === b.length && a.every((n, i) => n.eq(b[i]))

/** The card's editor's own plugins: the sides, the hidden word, the keys, the change watch. */
function cardPlugins(doors: CardEditorDoors, escapeTaken: () => boolean) {
  const keys = $shortcut((ctx) => ({
    CardDone: { key: 'Mod-Enter', priority: 1000, onRun: () => () => (doors.done(), true) },
    // Below the `[[` picker's Esc (100); above the page's Esc to the sidebar (10). A menu that took Esc (the `/` menu
    // hears it on the window first) keeps it: nothing more.
    CardEscape: { key: 'Escape', priority: 50, onRun: () => () => (escapeTaken() || doors.done(), true) },
    CardHideWord: { key: 'Mod-l', priority: 1000, onRun: () => toggleCloze(clozeSchema.type(ctx)) },
    CardNewSide: { key: 'Mod-Shift-Enter', priority: 250, onRun: () => newSide(sideBreakSchema.type(ctx)) },
  }))
  const watch = $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-card-editor-watch'),
        // Spell check in the card's text, as in a page.
        props: {
          attributes: { spellcheck: 'true' },
          // The course's guided tour (YAZ-5123): the person typed in the card. Typing goes on as always.
          handleTextInput: () => (tourEvent('card-text-changed'), false),
        },
        view: () => ({
          update: (view, prev) => {
            if (view.state.doc !== prev.doc) doors.changed()
          },
        }),
      }),
  )
  return [clozeRemark, clozeSchema, toggleClozeCommand, clozeInputRule, sideBreakSchema, newSideCommand, sideBreakInputRule, keys, watch].flat()
}

/**
 * Mounts the card's editor in `root` with the card's `text`. `select`: offsets in the card's text to select in its first
 * line (`/card`'s "Title"); absent → the caret at the end.
 */
export function mountCardEditor(o: { root: HTMLElement; text: string; make: (root: HTMLElement) => CardCrepe; doors: CardEditorDoors; select?: { from: number; to: number } }): CardEditor {
  const parts: CardParts = splitCardText(o.text)
  const { crepe, markdown } = o.make(o.root)
  let escapeTaken = false
  // The `/` menu hears Esc on the window, in the capture phase, before the editor: it closed itself then.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') escapeTaken = event.defaultPrevented
  }
  o.root.addEventListener('keydown', onKeyDown, true)
  // What a card cannot hold, or the Inbox cannot draw: `---` as a line, the highlight's keys and typing, check lists.
  for (const plugin of [insertHrInputRule, highlightInputRule, wrapInTaskListInputRule, ...highlightKeymap]) void crepe.editor.remove(plugin)
  crepe.editor.use(cardPlugins(o.doors, () => escapeTaken))
  let destroyed = false
  let view: EditorView | null = null
  /** Each side's nodes as the editor started: a side still equal to them keeps its bytes. */
  let start: ProseNode[][] = []
  const ready = crepe.create().then(() => {
    if (destroyed) return
    const v = crepe.editor.ctx.get(editorViewCtx)
    const parse = crepe.editor.ctx.get(parserCtx)
    const { schema } = v.state
    const nodes: ProseNode[] = []
    parts.sides.forEach((side, i) => {
      if (i > 0) nodes.push(schema.nodes[SIDE_BREAK].create())
      const doc = parse(normalizeEmptyItems(sideMarkdown(side)))
      if (doc.childCount === 0) nodes.push(schema.nodes.paragraph.create())
      else doc.forEach((child) => nodes.push(child))
    })
    const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, Fragment.from(nodes))
    // Where the edit starts: ⌘Z in the card never goes back past it.
    v.dispatch(tr.setMeta('addToHistory', false))
    start = sidesOf(v.state.doc)
    const { doc } = v.state
    let selection: Selection = Selection.atEnd(doc)
    if (o.select !== undefined) {
      const first = Selection.atStart(doc).$from
      const size = first.parent.content.size
      selection = TextSelection.create(doc, first.start() + Math.min(o.select.from, size), first.start() + Math.min(o.select.to, size))
    }
    v.dispatch(v.state.tr.setSelection(selection).scrollIntoView())
    view = v
    v.focus()
  })
  ready.catch((err: unknown) => console.error('[card-editor] create failed:', err))
  return {
    ready,
    view: () => view,
    text: () => {
      if (view === null || view.isDestroyed) return o.text
      const now = sidesOf(view.state.doc)
      const sides = now.map((nodes, i) => {
        const was = parts.sides[i]
        if (was !== undefined && start[i] !== undefined && sameNodes(nodes, start[i])) return was
        const md = nodes.length === 0 ? '' : markdown(view!.state.schema.topNodeType.create(null, nodes)).replace(/\n+$/, '')
        return sideWithEdges(md, was)
      })
      const text = joinCardParts({ sides, breaks: parts.breaks })
      // A card with every side as it was, but a break line of its own (` --- `): the same card, its bytes.
      return now.length === parts.sides.length && now.every((nodes, i) => start[i] !== undefined && sameNodes(nodes, start[i])) ? o.text : text
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      o.root.removeEventListener('keydown', onKeyDown, true)
      view = null
      void ready.then(() => crepe.destroy()).catch((err: unknown) => console.error('[card-editor] destroy failed:', err))
    },
  }
}
