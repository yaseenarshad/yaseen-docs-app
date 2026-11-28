/**
 * Inline font size mark (`font_size`, YAZ-6694 D3): whole `px` integers from 8 to 96.
 *
 *  - Saves as `<span style="font-size: Npx">` (only exact integer 8–96 is read back, leaving any other `<span>` HTML
 *    untouched).
 *  - Setting Default (`null`) or `16` removes the mark cleanly so normal body text stays plain Markdown.
 *  - Uses `htmlPairs.ts` with `nest: isSpanOpen` so nested `<span>` marks (e.g. `text_color` + `font_size`) match
 *    the right `</span>`.
 *  - `fontSizeKeymap` binds `page.fontSizeUp` / `page.fontSizeDown` from `shared/keys/page.ts` (both unbound by
 *    default so `CmdOrCtrl+Shift+.` stays `page.zoomOut`).
 */
import type { Ctx } from '@milkdown/kit/ctx'
import type { Mark, MarkType } from '@milkdown/kit/prose/model'
import type { Command, EditorState } from '@milkdown/kit/prose/state'
import { $markSchema, $remark, $shortcut } from '@milkdown/kit/utils'
import type { Parent, PhrasingContent } from 'mdast'
import type { Handle, Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { visibleRangeHasMark, visibleRanges } from '../lineSelection'
import { rowShortcuts } from '../pageKeys'
import { wrapHtmlPairs, type HtmlPairSpec } from './htmlPairs'
import { isSpanOpen } from './textColor'

export const FONT_SIZE_MIN = 8
export const FONT_SIZE_MAX = 96
export const DEFAULT_FONT_SIZE = 16
export const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 36, 48, 60, 72, 96] as const

export const isFontSize = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= FONT_SIZE_MIN && v <= FONT_SIZE_MAX

export const clampFontSize = (n: number): number =>
  Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)))

/** Parse an inline CSS `font-size` (`Npx` or `Npt`, where 1pt = 4/3 px) to a clamped integer 8–96, or null. */
export function parseFontSizeCss(value: string): number | null {
  const raw = value.trim().toLowerCase()
  const px = /^(\d+(?:\.\d+)?)px$/.exec(raw)
  if (px !== null) {
    const n = Number(px[1])
    return n > 0 ? clampFontSize(n) : null
  }
  const pt = /^(\d+(?:\.\d+)?)pt$/.exec(raw)
  if (pt !== null) {
    const n = Number(pt[1])
    return n > 0 ? clampFontSize(n * (4 / 3)) : null
  }
  return null
}

/** mdast node for `<span style="font-size: Npx">`. */
export interface FontSizeNode extends Parent {
  type: 'fontSize'
  size: number
  children: PhrasingContent[]
}

declare module 'mdast' {
  interface PhrasingContentMap {
    fontSize: FontSizeNode
  }
  interface RootContentMap {
    fontSize: FontSizeNode
  }
}

const FONT_SIZE_OPEN = /^<span style="font-size: ([1-9]\d?)px">$/

const FONT_SIZE_PAIRS: HtmlPairSpec<{ size: number }> = {
  open: (value) => {
    const match = FONT_SIZE_OPEN.exec(value)
    if (match === null) return null
    const size = Number(match[1])
    return isFontSize(size) ? { size } : null
  },
  nest: isSpanOpen,
  close: '</span>',
  make: ({ size }, children) => ({ type: 'fontSize', size, children }),
}

const fontSizeHandle: Handle & { peek?: Handle } = (node: FontSizeNode, _parent, state, info) =>
  `<span style="font-size: ${node.size}px">${state.containerPhrasing(node, { ...info, before: '>', after: '<' })}</span>`
fontSizeHandle.peek = () => '<'

const toMarkdownExtension: ToMarkdownOptions = { handlers: { fontSize: fontSizeHandle } }

export const fontSizeRemark = $remark('mdapp-font-size', () => function fontSize() {
  const data = this.data()
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), toMarkdownExtension]
  return (tree) => wrapHtmlPairs(tree, FONT_SIZE_PAIRS)
})

export const fontSizeSchema = $markSchema('font_size', () => ({
  attrs: { size: { default: null } },
  parseDOM: [
    {
      tag: 'span[data-font-size]',
      getAttrs: (dom) => {
        const size = Number((dom as HTMLElement).getAttribute('data-font-size'))
        return isFontSize(size) ? { size } : false
      },
    },
    {
      style: 'font-size',
      getAttrs: (value) => {
        const size = parseFontSizeCss(value as string)
        return size !== null ? { size } : false
      },
    },
  ],
  toDOM: (mark) => {
    const size = mark.attrs.size as number | null
    return isFontSize(size) ? ['span', { 'data-font-size': String(size), style: `font-size: ${size}px` }, 0] : ['span', 0]
  },
  parseMarkdown: {
    match: (node) => node.type === 'fontSize',
    runner: (state, node, markType) => {
      state.openMark(markType, { size: node.size as number })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'font_size',
    runner: (state, mark) => {
      const size = mark.attrs.size as number | null
      if (isFontSize(size)) state.withMark(mark, 'fontSize', undefined, { size })
    },
  },
}))

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

/** Remove `font_size` from the visible selection (or stored marks at a caret). Declines when none is present. */
export const removeFontSize = (type: MarkType): Command => (state, dispatch) => {
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

/**
 * Apply `size` (clamped 8–96) to the visible selection (or stored marks at a caret).
 * Passing `null` or `DEFAULT_FONT_SIZE` (16) removes the mark cleanly.
 */
export const applyFontSize = (type: MarkType, size: number | null): Command => (state, dispatch) => {
  if (size === null) return removeFontSize(type)(state, dispatch)
  const clamped = clampFontSize(size)
  if (clamped === DEFAULT_FONT_SIZE) return removeFontSize(type)(state, dispatch)
  const ranges = visibleRanges(state)
  if (!markApplies(state, type) || (!state.selection.empty && ranges.length === 0)) return false
  const mark = type.create({ size: clamped })
  const tr = state.tr
  if (state.selection.empty) tr.addStoredMark(mark)
  else for (const { from, to } of ranges) tr.addMark(from, to, mark)
  dispatch?.(tr.scrollIntoView())
  return true
}

/**
 * The selection's font size: `number` when all selected text has that size, `null` when none has a `font_size`
 * mark (default), or `undefined` when mixed.
 */
export function selectionFontSize(state: EditorState, type: MarkType): number | null | undefined {
  const sizeOf = (marks: readonly Mark[]): number | null => {
    const s = type.isInSet(marks)?.attrs.size
    return isFontSize(s) ? s : null
  }
  if (state.selection.empty) return sizeOf(state.storedMarks ?? state.selection.$from.marks())
  let found: number | null | undefined
  let mixed = false
  for (const { from, to } of visibleRanges(state)) {
    state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !node.isText) return !mixed
      const size = sizeOf(node.marks)
      if (found === undefined) found = size
      else if (found !== size) mixed = true
      return !mixed
    })
    if (mixed) return undefined
  }
  return found ?? null
}

/** Step the selection's font size by `delta` (`+1` or `-1` px, clamped 8–96). Stepping onto 16 removes the mark. */
export const stepFontSize = (type: MarkType, delta: number): Command => (state, dispatch) => {
  const current = selectionFontSize(state, type)
  const base = typeof current === 'number' ? current : DEFAULT_FONT_SIZE
  const next = clampFontSize(base + delta)
  if (next === base && current !== undefined) return false
  return applyFontSize(type, next)(state, dispatch)
}

const PRIORITY = 100

/** Bound from `shared/keys/page.ts` (`page.fontSizeUp` / `page.fontSizeDown`, both unbound by default). */
export const fontSizeKeymap = $shortcut((ctx: Ctx) => ({
  ...rowShortcuts(ctx, 'page.fontSizeUp', 'FontSizeUp', { priority: PRIORITY, onRun: () => stepFontSize(fontSizeSchema.type(ctx), 1) }),
  ...rowShortcuts(ctx, 'page.fontSizeDown', 'FontSizeDown', { priority: PRIORITY, onRun: () => stepFontSize(fontSizeSchema.type(ctx), -1) }),
}))

/** Register with `editor.use(fontSize)`. */
export const fontSize = [fontSizeRemark, fontSizeSchema, fontSizeKeymap].flat()
