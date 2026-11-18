/**
 * Content width and Card width as CSS variables on `.app` (YAZ-5144), from ONE table of steps (`CONTENT_TEXT_WIDTHS`):
 *  - `--content-text-width`: the pages' text at most (app.css adds the column's 48 px sides: `--content-max-width`);
 *  - `--card-text-width`: a card's text at most in the Inbox, the card window and a card file's tab. Same as pages
 *    (`null`) is the pages' step; Custom its own px (round 2).
 * Full is the window: wider than any column, so a `calc` over it still works. A value that a main process older than
 * the field sent, or that is not a step, reads as the default (Narrow, Same as pages).
 */
import { CONTENT_TEXT_WIDTHS, CONTENT_WIDTHS, isCardWidth, type ContentWidth, type SettingsState } from '@shared/types'
import { ZOOM_MIN } from '../editor/zoomSteps'

const stepOf = (v: unknown): ContentWidth => ((CONTENT_WIDTHS as readonly unknown[]).includes(v) ? (v as ContentWidth) : 'narrow')
/**
 * A step as `--content-text-width`: its px, or Full. Also a page's own width on its scroller (YAZ-5640). The page's
 * column grows with the page zoom (`app.css` `.editor-host`, YAZ-5640 Decision 3), so Full is the window divided by the
 * smallest zoom (`200vw` at 50%): still wider than the window at every zoom.
 */
export const contentTextWidth = (step: ContentWidth): string => {
  const w = CONTENT_TEXT_WIDTHS[step]
  return w === null ? `${Math.ceil(100 / (ZOOM_MIN / 100))}vw` : `${w}px`
}
/** A step as `--card-text-width`: a card's width does not grow with the page zoom's column, so Full is the window. */
const cardTextWidth = (step: ContentWidth): string => {
  const w = CONTENT_TEXT_WIDTHS[step]
  return w === null ? '100vw' : `${w}px`
}

export function contentWidthVars(s: SettingsState): Record<string, string> {
  const page = stepOf(s.contentWidth)
  const card: unknown = (s as Partial<SettingsState>).cardWidth
  return { '--content-text-width': contentTextWidth(page), '--card-text-width': isCardWidth(card) ? `${card}px` : cardTextWidth(page) }
}

/**
 * Table position (YAZ-5136 rounds 2 and 3) as the variables of its one rule (`table.css`): the pages' Centre
 * (`--page-table-inline: auto`), and the cards' own Left or Centre (`--card-table-inline`); none for Left and Same as
 * pages, so a card falls back to the pages' and a page to the look before. A missing or unknown value is the default.
 */
export function tablePositionVars(s: SettingsState): Record<string, string> {
  const card: unknown = (s as Partial<SettingsState>).cardTablePosition
  return {
    ...((s as Partial<SettingsState>).tablePosition === 'center' && { '--page-table-inline': 'auto' }),
    ...(card === 'left' && { '--card-table-inline': '0' }),
    ...(card === 'center' && { '--card-table-inline': 'auto' }),
  }
}

/**
 * The widest the pages' column gets, px, its 48 px sides in (the table of contents' room, `TableOfContents.tsx`), at the
 * page zoom `zoom` (1 is 100%): the text grows with the zoom, the sides do not (YAZ-5640 Decision 3).
 */
export const columnMax = (step: ContentWidth, zoom = 1): number => {
  const w = CONTENT_TEXT_WIDTHS[step]
  return w === null ? Infinity : w * zoom + 96
}
