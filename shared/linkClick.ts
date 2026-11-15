/**
 * "Clicking a link" (YAZ-4936), a choice per vault, kept in `.yaseendocs/link-click.json`: a plain click on a page pill
 * opens the page (the default) or opens it in Explore, a reading layer. Pure, so the Mac (`client/src/explore/linkClick.ts`)
 * and the phone (`mobile/src/page/openLink.ts`, YAZ-5455) read the file by one rule.
 */
export const LINK_CLICK_FILE = 'link-click.json'
export type LinkClick = 'open' | 'explore'
export interface LinkClickSettings {
  click: LinkClick
}
export const DEFAULT_LINK_CLICK: LinkClickSettings = { click: 'open' }
/** The keys this build's writer owns (YAZ-5483): every other key of the file is kept on a save. */
export const LINK_CLICK_KEYS: readonly string[] = Object.keys(DEFAULT_LINK_CLICK)

/** What the file holds, or the default for anything else. */
export function sanitizeLinkClick(raw: unknown): LinkClickSettings {
  const click = typeof raw === 'object' && raw !== null ? (raw as { click?: unknown }).click : undefined
  return { click: click === 'explore' ? 'explore' : 'open' }
}
