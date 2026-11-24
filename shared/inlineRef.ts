/**
 * INLINE REFS (YAZ-6467): the single source of truth for synthetic row paths representing an
 * inline card (`<page>#<cardId>`) or an inline Excalidraw drawing (`<page>#drawing-<index>`)
 * inside a Markdown page, plus canonical `<page>:<1-based line>` resolvers.
 *
 * Pure: no DOM, no React, no Node, no YAML parser.
 */
import { cardIdOf, findCards } from './cardLine'
import { isMarkdown } from './fileKind'
import { splitFrontmatter } from './frontmatterSplit'
import { findInlineDrawings } from './inlineDrawing'

/** Reference to a single inline card block inside a Markdown page. */
export type InlineCardRef = { kind: 'card'; page: string; id: string }

/** Reference to a single inline Excalidraw drawing block (0-based index) inside a Markdown page. */
export type InlineDrawingRef = { kind: 'drawing'; page: string; index: number }

/** Discriminated union of all synthetic inline-item references rooted at a Markdown page. */
export type InlineRef = InlineCardRef | InlineDrawingRef

const DRAWING_SUFFIX_RE = /^drawing-(\d+)$/

/** Canonical synthetic row path for an inline card in a Markdown page (keys rows, never a disk read). */
export const inlineCardRowPath = (page: string, id: string): string => `${page}#${id}`

/** Canonical synthetic row path for an inline Excalidraw drawing in a Markdown page (0-based index). */
export const inlineDrawingRowPath = (page: string, index: number): string => `${page}#drawing-${index}`

/**
 * Parses a synthetic inline ref (`<page>.md#<cardId>` or `<page>.md#drawing-<index>`), or returns
 * `null` for normal file paths (including Markdown filenames containing `#`, such as `C# Notes.md`).
 *
 * Splits on the LAST `#` and verifies that the prefix is a Markdown file (`isMarkdown(page)`) and
 * the suffix is non-empty.
 */
export function parseInlineRef(path: string): InlineRef | null {
  const hash = path.lastIndexOf('#')
  if (hash <= 0) return null
  const page = path.slice(0, hash)
  const suffix = path.slice(hash + 1)
  if (suffix === '' || !isMarkdown(page)) return null
  const drawing = DRAWING_SUFFIX_RE.exec(suffix)
  if (drawing !== null) return { kind: 'drawing', page, index: Number(drawing[1]) }
  return { kind: 'card', page, id: suffix }
}

/** True when `path` is a synthetic inline card or inline drawing reference. */
export const isInlineRef = (path: string): boolean => parseInlineRef(path) !== null

/** The underlying file path on disk: `ref.page` for an inline ref, or `path` unchanged otherwise. */
export function diskPathOf(path: string): string {
  const ref = parseInlineRef(path)
  return ref === null ? path : ref.page
}

/** Computes `<pagePath>:<1-based line>` of the `index`-th ```` ```excalidraw ```` opening fence, or `pagePath` if not found on disk. */
export function inlineDrawingPathAtLine(pagePath: string, diskContent: string, index: number): string {
  const { frontmatter, body } = splitFrontmatter(diskContent)
  const block = findInlineDrawings(body)[index]
  if (block === undefined) return pagePath
  const fmLines = (frontmatter.match(/\n/g) ?? []).length
  return `${pagePath}:${fmLines + block.open + 1}`
}

/**
 * Computes `<pagePath>:<1-based line>` of the ```` ```card ```` opening fence matching `cardId`
 * (preferring `cards[fallbackIndex]` when it holds `cardId`, else the first card with `cardId`,
 * else `cards[fallbackIndex]` when `fallbackIndex !== undefined`), or `pagePath` if not found.
 */
export function inlineCardPathAtLine(pagePath: string, diskContent: string, cardId: string, fallbackIndex?: number): string {
  const { frontmatter, body } = splitFrontmatter(diskContent)
  const cards = findCards(body)
  let block = fallbackIndex !== undefined && cards[fallbackIndex] !== undefined && cardIdOf(cards[fallbackIndex].line) === cardId ? cards[fallbackIndex] : undefined
  if (block === undefined) block = cards.find((c) => cardIdOf(c.line) === cardId)
  if (block === undefined && fallbackIndex !== undefined) block = cards[fallbackIndex]
  if (block === undefined) return pagePath
  const fmLines = (frontmatter.match(/\n/g) ?? []).length
  return `${pagePath}:${fmLines + block.open + 1}`
}

/** Computes `<pagePath>:<1-based line>` for any `InlineRef`, or `ref.page` if not found on disk. */
export function inlineRefPathAtLine(ref: InlineRef, diskContent: string, fallbackIndex?: number): string {
  return ref.kind === 'drawing'
    ? inlineDrawingPathAtLine(ref.page, diskContent, ref.index)
    : inlineCardPathAtLine(ref.page, diskContent, ref.id, fallbackIndex)
}
