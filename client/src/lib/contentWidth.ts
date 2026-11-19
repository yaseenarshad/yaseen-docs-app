/**
 * Content width and Card width as CSS variables on `.app` (YAZ-5144), from ONE table of steps (`CONTENT_TEXT_WIDTHS`):
 *  - `--content-text-width`: the pages' text at most (app.css adds the column's 48 px sides: `--content-max-width`);
 *  - `--card-text-width`: a card's text at most in the Inbox, the card window and a card file's tab. Same as pages
 *    (`null`) is the pages' step; Custom its own px (round 2).
 * Full is the window: wider than any column, so a `calc` over it still works. A value that a main process older than
 * the field sent, or that is not a step or Custom px (YAZ-5871), reads as the default (Narrow, Same as pages).
 * Page position (YAZ-5871) is `--column-start` here too: the pages' column at Centre or at the Left.
 */
import { CONTENT_TEXT_WIDTHS, isCardWidth, isContentPosition, isContentWidth, type ContentPosition, type ContentWidth, type SettingsState } from '@shared/types'
import { ZOOM_MIN } from '../editor/zoomSteps'

/** A width as Settings or a page holds it: a step or Custom px (YAZ-5871); anything else reads as the default, Narrow. */
export const widthOf = (v: unknown): ContentWidth => (isContentWidth(v) ? v : 'narrow')
/** The text's px of a width, or `null` for Full (the window). */
const textPx = (width: ContentWidth): number | null => (typeof width === 'number' ? width : CONTENT_TEXT_WIDTHS[width])
/**
 * A width as `--content-text-width`: its px (a step's or Custom's), or Full. Also a page's own width on its scroller
 * (YAZ-5640). The page's column grows with the page zoom (`app.css` `.editor-host`, YAZ-5640 Decision 3), so Full is the
 * window divided by the smallest zoom (`200vw` at 50%): still wider than the window at every zoom.
 */
export const contentTextWidth = (width: ContentWidth): string => {
  const w = textPx(width)
  return w === null ? `${Math.ceil(100 / (ZOOM_MIN / 100))}vw` : `${w}px`
}
/** A width as `--card-text-width`: a card's width does not grow with the page zoom's column, so Full is the window. */
export const cardTextWidth = (width: ContentWidth): string => {
  const w = textPx(width)
  return w === null ? '100vw' : `${w}px`
}

/**
 * Page position (YAZ-5871 D2) as `--column-start`, the start margin of the five column rules (`app.css`, `comments.css`,
 * `backlinks.css`, `folderView.css`) and of a card narrower than its column (`card.css`, D3): `0` for Left, `auto` for
 * Centre. Full has no position (its column fills the window), so it is Centre's `auto`.
 */
export const columnStart = (position: ContentPosition, width: ContentWidth): string => (position === 'left' && width !== 'full' ? '0' : 'auto')
/** A position as Settings holds it; anything else reads as the default, Centre. */
export const positionOf = (v: unknown): ContentPosition => (isContentPosition(v) ? v : 'center')

export function contentWidthVars(s: SettingsState): Record<string, string> {
  const page = widthOf(s.contentWidth)
  const card: unknown = (s as Partial<SettingsState>).cardWidth
  return {
    '--content-text-width': contentTextWidth(page),
    '--card-text-width': isCardWidth(card) ? `${card}px` : cardTextWidth(page),
    '--column-start': columnStart(positionOf((s as Partial<SettingsState>).contentPosition), page),
  }
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
 * page zoom `zoom` (1 is 100%): the text grows with the zoom, the sides do not (YAZ-5640 Decision 3). Custom px too.
 */
export const columnMax = (width: ContentWidth, zoom = 1): number => {
  const w = textPx(width)
  return w === null ? Infinity : w * zoom + 96
}
