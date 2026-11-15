import { VAULT_CONFIG_DIR } from '@shared/types'
import type { AppModel } from '../app/AppState'
import type { Route } from '../app/nav'
import { isSheetRoute, openSheet } from './sheets'

/**
 * THE ONE DOOR TO OPEN A FILE (YAZ-5472): `openFile(app, route)`. Every place of the app that opens a page, a card or a
 * card file calls it (Search's rows and tree, Favorites, Focus, Recent, Review's "Open page"). The vault says how
 * (`.yaseendocs/link-click.json`, the Mac's "Clicking a link", YAZ-4936):
 *  - `"explore"`: the file opens in a SHEET over where you are (`openSheet`);
 *  - `"open"`, or no file: it opens full screen, as before (`go`).
 * A screen that is not a file (Settings, a friend) always opens full screen.
 */

/** The Mac's own words and default (`client/src/explore/linkClick.ts`, which the phone cannot import: it calls the Mac's bridge). */
export type LinkClick = 'open' | 'explore'
export const LINK_CLICK_PATH = `${VAULT_CONFIG_DIR}/link-click.json`
/** With no file, a link opens the page, as the Mac does (`DEFAULT_LINK_CLICK`). */
export const DEFAULT_LINK_CLICK: LinkClick = 'open'

/** What the file holds, or the default for anything else (the Mac's `sanitizeLinkClick`). */
export function sanitizeLinkClick(raw: unknown): LinkClick {
  const click = typeof raw === 'object' && raw !== null ? (raw as { click?: unknown }).click : undefined
  return click === 'explore' ? 'explore' : click === 'open' ? 'open' : DEFAULT_LINK_CLICK
}

/** Each vault's choice, as the host read it last (`ExploreHost`): read at each tap, with no wait. */
const choices = new Map<string, LinkClick>()
export const setLinkClick = (vault: string, click: LinkClick): void => void choices.set(vault, click)
export const linkClickOf = (vault: string | null): LinkClick => (vault === null ? DEFAULT_LINK_CLICK : (choices.get(vault) ?? DEFAULT_LINK_CLICK))

/** Opens `route`: in a sheet when the vault says "explore", else full screen. */
export function openFile(app: Pick<AppModel, 'go' | 'vaultKey'>, route: Route): void {
  if (isSheetRoute(route) && linkClickOf(app.vaultKey) === 'explore') openSheet(route)
  else app.go({ type: 'open', route })
}
