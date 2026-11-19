/**
 * "Clicking a link" (YAZ-4936), a choice per vault, kept in `.yaseendocs/link-click.json`: a plain click on a page pill
 * opens it in Explore, a reading layer (the default, YAZ-5973), or opens the page. Pure, so the Mac (`client/src/explore/linkClick.ts`)
 * and the phone (`mobile/src/page/openLink.ts`, YAZ-5455) read the file by one rule.
 */
export const LINK_CLICK_FILE = 'link-click.json'
export type LinkClick = 'open' | 'explore'
export interface LinkClickSettings {
  click: LinkClick
}
export const DEFAULT_LINK_CLICK: LinkClickSettings = { click: 'explore' }
/** The keys this build's writer owns (YAZ-5483): every other key of the file is kept on a save. */
export const LINK_CLICK_KEYS: readonly string[] = Object.keys(DEFAULT_LINK_CLICK)

/** The phone's own default with no file (YAZ-5973): a link opens full screen, as before; the file, when there is one, wins. */
export const PHONE_DEFAULT_LINK_CLICK: LinkClick = 'open'

/** What the file holds, or `fallback` (the Mac's default) for anything else. */
export function sanitizeLinkClick(raw: unknown, fallback: LinkClick = DEFAULT_LINK_CLICK.click): LinkClickSettings {
  const click = typeof raw === 'object' && raw !== null ? (raw as { click?: unknown }).click : undefined
  return { click: click === 'open' || click === 'explore' ? click : fallback }
}
