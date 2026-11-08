/**
 * Highlight mark (YAZ-1480): one mark, one optional `color`, two forms on disk. The contract is
 * CONTRACTS rule 31; this header is the mechanism.
 *
 *  - `color: null` (yellow) is real Markdown, Obsidian's `==text==`: a vendored micromark
 *    tokenizer (gfm-strikethrough's attention run with `=` and exactly two), the mdast handlers,
 *    and stringify `unsafe` rules that write `\=` for any `=` touching another `=`.
 *  - A named colour has no Markdown syntax, so — like underline's `<u>` — it is inline HTML
 *    `<mark class="highlight-<name>">`, read back through the shared `htmlPairs.ts` walk.
 *  - A custom colour (YAZ-4348 demo round 2, the ▾ panel's shades, hex code and picker) is `color: '#rrggbb'`, inline
 *    HTML `<mark style="background-color: #rrggbb">`: the one form that renders in any Markdown
 *    viewer without our CSS. Only that exact spelling (lowercase hex) is read, so any other
 *    `<mark style>` stays HTML with its bytes. The note paints it as a translucent wash, as the
 *    named colours, so the text keeps its own colour and stays readable in both themes.
 *  - `setHighlightCommand(color)` is the one command behind the toolbar's highlight buttons,
 *    `Mod-Shift-h` (yellow) and the `==x==` typing rule (yellow) — Bold's toggle rule (🔒 D5).
 */
import { commandsCtx } from '@milkdown/kit/core'
import { markRule } from '@milkdown/kit/prose'
import type { Mark, MarkType } from '@milkdown/kit/prose/model'
import type { Command, EditorState } from '@milkdown/kit/prose/state'
import { $command, $inputRule, $markSchema, $remark, $useKeymap } from '@milkdown/kit/utils'
import type { Parent, PhrasingContent } from 'mdast'
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { ConstructName, Handle, Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { splice } from 'micromark-util-chunked'
import { classifyCharacter } from 'micromark-util-classify-character'
import { resolveAll } from 'micromark-util-resolve-all'
import type { Event, Extension, Resolver, State, Token, TokenizeContext, Tokenizer } from 'micromark-util-types'
import { isHighlightHex } from '@shared/types'
import { rgbOf, solidHex } from '../../lib/colour'
import { visibleRangeHasMark, visibleRanges } from '../lineSelection'
import { wrapHtmlPairs, type HtmlPairSpec } from './htmlPairs'
import { HIGHLIGHT_COLORS, HIGHLIGHT_HEX, type CustomHighlight, type HighlightColor } from './highlightColours'

export { QUICK_HIGHLIGHTS, MORE_HIGHLIGHTS, HIGHLIGHT_COLORS, HIGHLIGHT_HEX, type HighlightName, type CustomHighlight, type HighlightColor } from './highlightColours'

/** A custom colour as the mark keeps it: exactly lowercase `#rrggbb` (the setting's own test, `@shared/types`). */
export const isCustomHighlight: (value: unknown) => value is CustomHighlight = isHighlightHex

/** How strong a custom colour's wash is: the named colours' 0.35–0.4, so text on it stays readable in both themes. */
export const CUSTOM_WASH = 0.4

/** A custom colour's see-through wash, `rgba(r, g, b, 0.4)`. */
export function customWash(hex: CustomHighlight): string {
  const [r, g, b] = rgbOf(hex)
  return `rgba(${r}, ${g}, ${b}, ${CUSTOM_WASH})`
}

/** mdast node for a highlight; registered with mdast so remark-stringify's `Handlers` knows the type. */
export interface Highlight extends Parent {
  type: 'highlight'
  /** Absent or null = the default yellow, written as `==…==`. */
  color?: HighlightColor
  children: PhrasingContent[]
}

declare module 'mdast' {
  interface PhrasingContentMap {
    highlight: Highlight
  }
  interface RootContentMap {
    highlight: Highlight
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    highlight: 'highlight'
    highlightSequence: 'highlightSequence'
    highlightSequenceTemporary: 'highlightSequenceTemporary'
    highlightText: 'highlightText'
  }
}

const EQUALS = 61 // '='

/** Pair each closing `==` with the nearest same-length opener; unmatched runs fall back to text. */
const resolveAllHighlight: Resolver = (events, context) => {
  let index = -1
  while (++index < events.length) {
    const closer = events[index][1]
    if (events[index][0] !== 'enter' || closer.type !== 'highlightSequenceTemporary' || !closer._close) continue
    let open = index
    while (open--) {
      const opener = events[open][1]
      if (events[open][0] !== 'exit' || opener.type !== 'highlightSequenceTemporary' || !opener._open) continue
      if (closer.end.offset - closer.start.offset !== opener.end.offset - opener.start.offset) continue
      closer.type = 'highlightSequence'
      opener.type = 'highlightSequence'
      const highlight: Token = { type: 'highlight', start: { ...opener.start }, end: { ...closer.end } }
      const text: Token = { type: 'highlightText', start: { ...opener.end }, end: { ...closer.start } }
      const next: Event[] = [
        ['enter', highlight, context],
        ['enter', opener, context],
        ['exit', opener, context],
        ['enter', text, context],
      ]
      const insideSpan = context.parser.constructs.insideSpan.null
      if (insideSpan) splice(next, next.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context))
      splice(next, next.length, 0, [
        ['exit', text, context],
        ['enter', closer, context],
        ['exit', closer, context],
        ['exit', highlight, context],
      ])
      splice(events, open - 1, index - open + 3, next)
      index = open + next.length - 2
      break
    }
  }
  for (const event of events) if (event[1].type === 'highlightSequenceTemporary') event[1].type = 'data'
  return events
}

/** Exactly two `=`: a lone `=` is text, a third `=` cancels the run, `\==` is an escape. */
const tokenizeHighlight: Tokenizer = function (this: TokenizeContext, effects, ok, nok) {
  const { previous, events } = this
  let size = 0
  const more: State = (code) => {
    const before = classifyCharacter(previous)
    if (code === EQUALS) {
      if (size > 1) return nok(code)
      effects.consume(code)
      size++
      return more
    }
    if (size < 2) return nok(code)
    const token = effects.exit('highlightSequenceTemporary')
    const after = classifyCharacter(code)
    token._open = !after || (after === 2 && Boolean(before))
    token._close = !before || (before === 2 && Boolean(after))
    return ok(code)
  }
  return (code) => {
    if (previous === EQUALS && events[events.length - 1][1].type !== 'characterEscape') return nok(code)
    effects.enter('highlightSequenceTemporary')
    return more(code)
  }
}

const highlightSyntax = (): Extension => {
  const tokenizer = { name: 'highlight', tokenize: tokenizeHighlight, resolveAll: resolveAllHighlight }
  return { text: { [EQUALS]: tokenizer }, insideSpan: { null: [tokenizer] }, attentionMarkers: { null: [EQUALS] } }
}

const fromMarkdown: FromMarkdownExtension = {
  canContainEols: ['highlight'],
  enter: {
    highlight(token) {
      this.enter({ type: 'highlight', children: [] }, token)
    },
  },
  exit: {
    highlight(token) {
      this.exit(token)
    },
  },
}

/** A coloured highlight's opening tag on disk: the class form for a named colour, the style form for a custom one. */
const openTag = (color: Exclude<HighlightColor, null>): string =>
  isCustomHighlight(color) ? `<mark style="background-color: ${color}">` : `<mark class="highlight-${color}">`

const highlightHandle: Handle & { peek?: Handle } = (node: Highlight, _parent, state, info) =>
  node.color
    ? `${openTag(node.color)}${state.containerPhrasing(node, { ...info, before: '>', after: '<' })}</mark>`
    : `==${state.containerPhrasing(node, { ...info, before: '=', after: '=' })}==`
highlightHandle.peek = (node: Highlight) => (node.color ? '<' : '=')

/** The coloured half: inline HTML, read through the same walk underline uses. Each form only exactly as written, so it reads back byte for byte. */
const MARK_OPEN = new RegExp(`^<mark class="highlight-(${HIGHLIGHT_COLORS.join('|')})">$`)
const MARK_CUSTOM_OPEN = /^<mark style="background-color: (#[0-9a-f]{6})">$/
const HIGHLIGHT_PAIRS: HtmlPairSpec<{ color: HighlightColor }> = {
  open: (value) => {
    if (value === '<mark>') return { color: null }
    const match = MARK_OPEN.exec(value) ?? MARK_CUSTOM_OPEN.exec(value)
    return match === null ? null : { color: match[1] as HighlightColor }
  },
  close: '</mark>',
  make: ({ color }, children) => ({ type: 'highlight', color, children }),
}

/** Phrasing constructs that can never contain a highlight (mirrors mdast-util-gfm-strikethrough). */
const CONSTRUCTS_WITHOUT_HIGHLIGHT: ConstructName[] = ['autolink', 'destinationLiteral', 'destinationRaw', 'reference', 'titleQuote', 'titleApostrophe']

/**
 * Any `=` touching another `=` is written `\=`: a run of two could open or close a highlight on
 * reload, and a text `=` beside a highlight's own `==` would merge into its run and kill the mark.
 * A lone `=` (`a = b`, `x=5`) is never touched; URLs never (notInConstruct).
 */
const toMarkdown: ToMarkdownOptions = {
  unsafe: [
    { character: '=', after: '=', inConstruct: 'phrasing', notInConstruct: CONSTRUCTS_WITHOUT_HIGHLIGHT },
    { character: '=', before: '=', inConstruct: 'phrasing', notInConstruct: CONSTRUCTS_WITHOUT_HIGHLIGHT },
  ],
  handlers: { highlight: highlightHandle },
}

/** remark plugin, the remark-gfm shape: syntax + from + to, all through `this.data()`. */
export const highlightRemark = $remark('mdapp-highlight', () => function highlight() {
  const data = this.data()
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), highlightSyntax()]
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), fromMarkdown]
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), toMarkdown]
  return (tree) => wrapHtmlPairs(tree, HIGHLIGHT_PAIRS)
})

/**
 * The element's colour: our own `data-highlight` (a custom colour, from the editor's DOM and the copy-out), a
 * `highlight-<known>` class, or a pasted `<mark style="background-color: …">` as a custom colour; else null (a
 * bare `<mark>` is yellow).
 */
function colorOf(dom: HTMLElement): HighlightColor {
  const own = dom.getAttribute('data-highlight')
  if (isCustomHighlight(own)) return own
  const named = HIGHLIGHT_COLORS.find((c) => dom.classList.contains(`highlight-${c}`))
  if (named !== undefined) return named
  return solidHex(dom.style.backgroundColor)
}

/** A highlight's DOM: a named colour's class; a custom colour's wash inline, with its exact value to read back. */
const domAttrs = (color: HighlightColor): Record<string, string> =>
  color === null ? {} : isCustomHighlight(color) ? { 'data-highlight': color, style: `background-color: ${customWash(color)}` } : { class: `highlight-${color}` }

export const highlightSchema = $markSchema('highlight', () => ({
  attrs: { color: { default: null } },
  parseDOM: [{ tag: 'mark', getAttrs: (dom) => ({ color: colorOf(dom as HTMLElement) }) }],
  toDOM: (mark) => ['mark', domAttrs((mark.attrs.color ?? null) as HighlightColor), 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType, { color: (node.color as HighlightColor | undefined) ?? null })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'highlight', undefined, { color: (mark.attrs.color ?? null) as HighlightColor })
    },
  },
}))

/**
 * Whether ANY of the selection carries a highlight of exactly this colour — Bold's toggle
 * semantics (🔒 D5): a partly highlighted line still lights the dot, and the click then removes.
 * Only VISIBLE lines count: a highlighted kid under a fold does not light it (YAZ-3209 D4). At a
 * caret: the marks it would type with.
 */
export const rangeHasHighlight = (state: EditorState, type: MarkType, color: HighlightColor): boolean => {
  const { empty, $from } = state.selection
  const mark = type.create({ color })
  if (empty) return mark.isInSet(state.storedMarks ?? $from.marks())
  return visibleRangeHasMark(state, mark)
}

/** ProseMirror's own guard: a command that cannot apply anywhere declines, so it never eats the key. */
const markApplies = (state: EditorState, type: MarkType): boolean => {
  const { $from, from, to, empty } = state.selection
  if (empty) return $from.parent.type.allowsMarkType(type)
  let can = false
  state.doc.nodesBetween(from, to, (node) => {
    if (!can) can = node.inlineContent && node.type.allowsMarkType(type)
    return !can
  })
  return can
}

/**
 * One click, one step (🔒 D5): a lit colour is removed from the selection, an unlit one applied
 * (addMark replaces any other colour). At a caret the same flip goes to the stored marks. Edge
 * whitespace stays outside the mark, as Bold does — `==word ==` would not read back as a mark.
 * Over hidden lines only the visible ones change (YAZ-3209 `visibleRanges`); nothing visible
 * selected declines.
 */
const setHighlight = (type: MarkType, color: HighlightColor, always = false): Command => (state, dispatch) => {
  const ranges = visibleRanges(state)
  if (!markApplies(state, type) || (!state.selection.empty && ranges.length === 0)) return false
  const mark = type.create({ color })
  const lit = !always && rangeHasHighlight(state, type, color)
  const tr = state.tr
  if (state.selection.empty) lit ? tr.removeStoredMark(mark) : tr.addStoredMark(mark)
  else
    for (let { from, to } of ranges) {
      if (lit) {
        tr.removeMark(from, to, mark)
        continue
      }
      const lead = state.doc.resolve(from).nodeAfter?.text?.match(/^\s*/)?.[0].length ?? 0
      const trail = state.doc.resolve(to).nodeBefore?.text?.match(/\s*$/)?.[0].length ?? 0
      if (from + lead < to) (from += lead), (to -= trail)
      tr.addMark(from, to, mark)
    }
  dispatch?.(tr.scrollIntoView())
  return true
}

/** ONE command: the toolbar's highlight buttons and the shortcut go through it. */
export const setHighlightCommand = $command('SetHighlight', (ctx) => (color: HighlightColor = null) =>
  setHighlight(highlightSchema.type(ctx), color),
)

/**
 * The ▾ panel's pick (YAZ-4348 demo round 2): the same rules as a button press, but never a toggle — a lit
 * colour picked again stays, as in the board's colour panel, which stays open for the next pick.
 */
export const applyHighlight = (type: MarkType, color: HighlightColor): Command => setHighlight(type, color, true)

/**
 * The ▾ panel's None (YAZ-4348 demo round 2): every colour off the visible selection, and off the marks a
 * caret would type with. Declines where there is no highlight to remove.
 */
export const removeHighlight = (type: MarkType): Command => (state, dispatch) => {
  if (state.selection.empty) {
    if (type.isInSet(state.storedMarks ?? state.selection.$from.marks()) === undefined) return false
    dispatch?.(state.tr.removeStoredMark(type))
    return true
  }
  if (!visibleRangeHasMark(state, type)) return false
  const tr = state.tr
  for (const { from, to } of visibleRanges(state)) tr.removeMark(from, to, type)
  dispatch?.(tr.scrollIntoView())
  return true
}

/** Every highlight colour on the visible selection (at a caret: the marks it would type with), in no set order. */
export function highlightColorsIn(state: EditorState, type: MarkType): HighlightColor[] {
  const found = new Set<HighlightColor>()
  const add = (marks: readonly Mark[]) => {
    for (const mark of marks) if (mark.type === type) found.add((mark.attrs.color ?? null) as HighlightColor)
  }
  if (state.selection.empty) add(state.storedMarks ?? state.selection.$from.marks())
  else
    for (const { from, to } of visibleRanges(state))
      state.doc.nodesBetween(from, to, (node) => {
        if (node.isText) add(node.marks)
      })
  return [...found]
}

/**
 * Whether a highlight on the visible selection (at a caret: the marks it would type with) has a colour that passes
 * `test`. The walk stops at the first one: the toolbar's ▾ asks on each update, also after ⌘A on a long note.
 */
export function someHighlightColor(state: EditorState, type: MarkType, test: (color: HighlightColor) => boolean): boolean {
  const hit = (marks: readonly Mark[]) => marks.some((mark) => mark.type === type && test((mark.attrs.color ?? null) as HighlightColor))
  if (state.selection.empty) return hit(state.storedMarks ?? state.selection.$from.marks())
  let found = false
  for (const { from, to } of visibleRanges(state)) {
    state.doc.nodesBetween(from, to, (node) => {
      if (!found && node.isText) found = hit(node.marks)
      return !found
    })
    if (found) return true
  }
  return false
}

/** A `$useKeymap` (not `$shortcut`) so Crepe's `keymapRef` can label the yellow swatch from it. Priority above Crepe's 50, like underline.ts. */
export const highlightKeymap = $useKeymap('highlightKeymap', {
  ToggleHighlight: {
    shortcuts: 'Mod-Shift-h',
    priority: 100,
    command: (ctx) => () => ctx.get(commandsCtx).call(setHighlightCommand.key, null),
  },
})

/** Typing `==text==` converts as the second `==` lands — the `**bold**` typing experience. */
export const highlightInputRule = $inputRule((ctx) => markRule(/(?<![\w=])==(\S(?:[^=]*\S)?)==$/, highlightSchema.type(ctx)))

/** Register with `editor.use(highlight)`. */
export const highlight = [highlightRemark, highlightSchema, setHighlightCommand, highlightKeymap, highlightInputRule].flat()
