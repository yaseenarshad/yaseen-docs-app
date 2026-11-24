/**
 * INLINE LINE RESOLVERS (YAZ-6467): canonical `<pagePath>:<1-based line>` resolvers for inline
 * cards and inline Excalidraw drawings. Kept separate from `shared/inlineRef.ts` so callers that
 * only parse/format synthetic inline refs (such as mobile search/home bundles) never pull in
 * `cardLine`, `inlineDrawing`, or `frontmatterSplit`.
 */
import { cardIdOf, findCards } from './cardLine'
import { splitFrontmatter } from './frontmatterSplit'
import { findInlineDrawings } from './inlineDrawing'
import type { InlineRef } from './inlineRef'

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
