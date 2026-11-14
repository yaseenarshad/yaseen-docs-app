/**
 * Content width and Card width as CSS variables on `.app` (YAZ-5144), from ONE table of steps (`CONTENT_TEXT_WIDTHS`):
 *  - `--content-text-width`: the pages' text at most (app.css adds the column's 48 px sides: `--content-max-width`);
 *  - `--card-text-width`: a card's text at most in the Inbox, the card window and a card file's tab. Same as pages is
 *    the pages' step; a step of its own otherwise.
 * Full is the window (`100vw`: wider than any column, so a `calc` over it still works). A value that a main process
 * older than the field sent, or that is not a step, reads as the default (Narrow, Same as pages).
 */
import { CONTENT_TEXT_WIDTHS, CONTENT_WIDTHS, type ContentWidth, type SettingsState } from '@shared/types'

const stepOf = (v: unknown): ContentWidth => ((CONTENT_WIDTHS as readonly unknown[]).includes(v) ? (v as ContentWidth) : 'narrow')
const px = (step: ContentWidth): string => {
  const w = CONTENT_TEXT_WIDTHS[step]
  return w === null ? '100vw' : `${w}px`
}

export function contentWidthVars(s: SettingsState): Record<string, string> {
  const page = stepOf(s.contentWidth)
  const card = (s as Partial<SettingsState>).cardWidth
  return { '--content-text-width': px(page), '--card-text-width': px(card === undefined || card === 'pages' ? page : stepOf(card)) }
}

/** The widest the pages' column gets, px, its 48 px sides in (the table of contents' room, `TableOfContents.tsx`). */
export const columnMax = (step: ContentWidth): number => {
  const w = CONTENT_TEXT_WIDTHS[step]
  return w === null ? Infinity : w + 96
}
