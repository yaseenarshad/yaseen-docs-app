/**
 * Highlight mark (YAZ-1480): one mark, one optional `color` attribute, two forms on disk.
 *
 *  - `color: null` is the default yellow and is REAL Markdown: Obsidian's `==text==`.
 *  - `color: 'green' | 'blue' | 'pink'` has no Markdown syntax, so — exactly like underline's
 *    `<u>` — the vault stores inline HTML: `<mark class="highlight-green">text</mark>`. The file
 *    holds a NAME; app.css owns the actual colour per theme.
 *
 * Four pieces, underline.ts's shape plus a tokenizer for the Markdown half:
 *
 *  1. `highlightRemark` ($remark): a micromark syntax extension — the attention tokenizer of
 *     micromark-extension-gfm-strikethrough with `~` → `=` and the run fixed at exactly two —
 *     plus the mdast from/to-markdown handlers for a `highlight` node and the `unsafe` rules:
 *     any `=` touching another `=` is written `\=` (so `a == b` saves as `a \=\= b` and reads
 *     back as the same text); a lone `=` is never escaped, URLs never. Its transformer then runs
 *     the shared `htmlPairs.ts` walk for the coloured `<mark class=…>` pairs; a bare `<mark>` is
 *     read as yellow (and saved back as `==…==`), and any other `<mark …>` is left untouched as
 *     inline HTML.
 *  2. `highlightSchema` ($markSchema): `<mark>` / `<mark class="highlight-<name>">` in the DOM,
 *     `highlight` mdast node carrying `color`.
 *  3. `setHighlightCommand` ($command, payload = the colour) shared by the toolbar's four
 *     swatches (createCrepe.ts) and the `Mod-Shift-h` shortcut. Bold's toggle semantics (🔒 D5):
 *     a dot is lit when ANY of the selection carries its colour, a lit colour is removed from the
 *     selection, an unlit one applied (replacing any other colour).
 *  4. `highlightInputRule` (typing `==x==` converts like `**x**`) — yellow only; colours are
 *     click-only.
 */
import { commandsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { markRule } from '@milkdown/kit/prose'
import { toggleMark } from '@milkdown/kit/prose/commands'
import type { MarkType } from '@milkdown/kit/prose/model'
import type { Command, EditorState } from '@milkdown/kit/prose/state'
import { $command, $inputRule, $markSchema, $remark, $shortcut } from '@milkdown/kit/utils'
import type { Parent, PhrasingContent } from 'mdast'
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { Handle, Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { splice } from 'micromark-util-chunked'
import { classifyCharacter } from 'micromark-util-classify-character'
import { resolveAll } from 'micromark-util-resolve-all'
import type { Event, Extension, Resolver, State, Token, TokenizeContext, Tokenizer } from 'micromark-util-types'
// Side-effect only: registers `micromarkExtensions` / `fromMarkdownExtensions` on unified's `Data`.
import type {} from 'remark-parse'
import { wrapHtmlPairs, type HtmlPairSpec } from './htmlPairs'

/** The named colours; yellow is `null` (the default, and the only one with Markdown syntax). */
export const HIGHLIGHT_COLORS = ['green', 'blue', 'pink'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number] | null

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

const highlightHandle: Handle & { peek?: Handle } = (node: Highlight, _parent, state, info) =>
  node.color
    ? `<mark class="highlight-${node.color}">${state.containerPhrasing(node, { ...info, before: '>', after: '<' })}</mark>`
    : `==${state.containerPhrasing(node, { ...info, before: '=', after: '=' })}==`
highlightHandle.peek = (node: Highlight) => (node.color ? '<' : '=')

/** The coloured half: inline HTML, read through the same walk underline uses. */
const HIGHLIGHT_PAIRS: HtmlPairSpec<{ color: HighlightColor }> = {
  open: (value) => {
    if (value === '<mark>') return { color: null }
    const match = /^<mark class="highlight-(green|blue|pink)">$/.exec(value)
    return match === null ? null : { color: match[1] as HighlightColor }
  },
  close: '</mark>',
  make: ({ color }, children) => ({ type: 'highlight', color, children }),
}

/** Phrasing constructs that can never contain a highlight (mirrors mdast-util-gfm-strikethrough). */
const NOT_IN_CONSTRUCT = ['autolink', 'destinationLiteral', 'destinationRaw', 'reference', 'titleQuote', 'titleApostrophe'] as const

/**
 * Any `=` touching another `=` is written `\=`: a run of two could open or close a highlight on
 * reload, and a text `=` beside a highlight's own `==` would merge into its run and kill the mark.
 * A lone `=` (`a = b`, `x=5`) is never touched; URLs never (notInConstruct).
 */
const toMarkdown: ToMarkdownOptions = {
  unsafe: [
    { character: '=', after: '=', inConstruct: 'phrasing', notInConstruct: [...NOT_IN_CONSTRUCT] },
    { character: '=', before: '=', inConstruct: 'phrasing', notInConstruct: [...NOT_IN_CONSTRUCT] },
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

/** The element's `highlight-<known>` class, else null (a bare `<mark>` is yellow). */
const colorOf = (dom: HTMLElement): HighlightColor => HIGHLIGHT_COLORS.find((c) => dom.classList.contains(`highlight-${c}`)) ?? null

export const highlightSchema = $markSchema('highlight', () => ({
  attrs: { color: { default: null } },
  parseDOM: [{ tag: 'mark', getAttrs: (dom) => ({ color: colorOf(dom as HTMLElement) }) }],
  toDOM: (mark) => ['mark', mark.attrs.color ? { class: `highlight-${mark.attrs.color}` } : {}, 0],
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
 * At a caret: the marks it would type with.
 */
export const rangeHasHighlight = (state: EditorState, type: MarkType, color: HighlightColor): boolean => {
  const { empty, $from, from, to } = state.selection
  const mark = type.create({ color })
  return empty ? mark.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, mark)
}

/** One click, one step: a lit colour is removed from the selection, an unlit one applied (addMark replaces any other colour). */
const setHighlight = (type: MarkType, color: HighlightColor): Command => (state, dispatch) => {
  const { from, to, empty } = state.selection
  if (empty) return toggleMark(type, { color })(state, dispatch)
  const mark = type.create({ color })
  const tr = rangeHasHighlight(state, type, color) ? state.tr.removeMark(from, to, mark) : state.tr.addMark(from, to, mark)
  dispatch?.(tr.scrollIntoView())
  return true
}

/** ONE command: the four toolbar swatches and the shortcut all go through it. */
export const setHighlightCommand = $command('SetHighlight', (ctx) => (color: HighlightColor = null) =>
  setHighlight(highlightSchema.type(ctx), color),
)

/** Priority above Crepe's keymaps (default 50), like underline.ts. */
const PRIORITY = 100

export const highlightKeymap = $shortcut((ctx: Ctx) => ({
  ToggleHighlight: {
    key: 'Mod-Shift-h',
    priority: PRIORITY,
    onRun: () => () => ctx.get(commandsCtx).call(setHighlightCommand.key, null),
  },
}))

/** Typing `==text==` converts as the second `==` lands — the `**bold**` typing experience. */
export const highlightInputRule = $inputRule((ctx) => markRule(/(?<![\w=])==(\S(?:[^=]*\S)?)==(?![\w=])$/, highlightSchema.type(ctx)))

/** Register with `editor.use(highlight)`. */
export const highlight = [highlightRemark, highlightSchema, setHighlightCommand, highlightKeymap, highlightInputRule].flat()
