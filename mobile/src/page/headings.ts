import { FLASH_FRAMES, FLASH_MS, reducedMotion } from '@client/editor/toc/tocMotion'
import { DEEPEST_TOC_LEVEL, ENOUGH_ROWS } from '@client/editor/toc/tocChannel'

/**
 * A DRAWN PAGE'S HEADINGS (YAZ-5455, YAZ-5456): the rows of the headings list, the heading a link names, and the landing.
 *
 * The rows follow the Mac's table of contents (`tocPlugin.ts`, `tocChannel.ts`): every H1 to H5 of the page
 * (`DEEPEST_TOC_LEVEL`; H6 is never a row), in page order, at its level; an empty heading is "Untitled heading". A card's
 * text is the card's, not the page's: a heading inside a card is no row. The Mac shows the list only with
 * `ENOUGH_ROWS` rows or more; under that it lists the bullets, which the phone does not (it lists headings only).
 *
 * The landing is the Mac's `landOn` (`tocMotion.ts`): the element a little under the scroller's top, then the one flash.
 */

export { ENOUGH_ROWS }

export const UNTITLED_HEADING = 'Untitled heading'

export interface HeadingRow {
  level: number
  text: string
  element: HTMLElement
}

const HEADINGS = Array.from({ length: DEEPEST_TOC_LEVEL }, (_, i) => `h${i + 1}`).join(', ')

/** The headings of the drawn page under `root`, in page order (not those inside a card). */
export function headingRows(root: ParentNode): HeadingRow[] {
  const out: HeadingRow[] = []
  for (const el of root.querySelectorAll<HTMLElement>(HEADINGS)) {
    if (el.closest('.card') !== null) continue
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    out.push({ level: Number(el.tagName.slice(1)), text: text === '' ? UNTITLED_HEADING : text, element: el })
  }
  return out
}

/**
 * A heading's words compared loosely, as Obsidian and GitHub name one: letter case, spaces, `-` and `_` alike, other
 * marks left out. So `[[Page#Getting started]]`, `[x](Page.md#getting-started)` and `#Getting-Started` name one heading.
 */
export const headingKey = (text: string): string =>
  text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\-_]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()

/**
 * The element a link's `#part` names in the drawn page: a heading by its words (`[[Page#A#B]]` names B, under A), or an
 * element of the page with that id (a footnote, `#fn-1`). A block reference (`#^id`) names none: the page opens at its top.
 */
export function headingTarget(root: ParentNode, part: string): HTMLElement | null {
  const name = part.replace(/^#+/, '')
  if (name === '' || name.startsWith('^')) return null
  const last = name.split('#').filter((p) => p !== '').at(-1) ?? name
  const key = headingKey(last)
  if (key !== '') for (const row of headingRows(root)) if (headingKey(row.text) === key) return row.element
  for (const el of root.querySelectorAll<HTMLElement>('[id]')) if (el.id === name) return el
  return null
}

/** How far under the scroller's top a landing puts its element (the Mac's `LANDING_PX`), in px. */
export const LANDING_PX = 24

/** Where `scroller` must stand for `element` to sit `at` px under its top (a share of its height when `at` < 1), as far as it can scroll. */
export function landingTop(scroller: HTMLElement, element: HTMLElement | Range, at: number = LANDING_PX): number {
  const offset = at < 1 ? scroller.clientHeight * at : at
  const top = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect().top : 0
  return Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + top - scroller.getBoundingClientRect().top - offset))
}

/** Lands on `element` in its `.screen` (the only scroller, YAZ-5436), then the Mac's one flash (none with Reduce Motion). */
export function landOn(element: HTMLElement, scroller: HTMLElement | null = element.closest<HTMLElement>('.screen')): void {
  if (scroller !== null) scroller.scrollTop = landingTop(scroller, element)
  if (typeof element.animate === 'function' && !reducedMotion()) element.animate(FLASH_FRAMES, { duration: FLASH_MS, easing: 'ease-out' })
}
