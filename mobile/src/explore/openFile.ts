import { DEFAULT_LINK_CLICK as MAC_DEFAULT, LINK_CLICK_FILE, sanitizeLinkClick as sanitizeSettings, type LinkClick } from '@shared/linkClick'
import { VAULT_CONFIG_DIR } from '@shared/types'
import type { AppModel } from '../app/AppState'
import type { Route } from '../app/nav'
import { isSheetRoute, openSheet } from './sheets'

/**
 * THE ONE DOOR TO OPEN A FILE (YAZ-5472): `openFile(app, route)`. Every place of the app that opens a page, a card or a
 * card file calls it (Search's rows and tree, Favorites, Focus, Recent, Review's "Open page", the Today button, and every
 * link of the reader through its own door, `page/openLink.ts`: a link, a pill, "Linked from"). The vault says how
 * (`.yaseendocs/link-click.json`, the Mac's "Clicking a link", YAZ-4936):
 *  - `"explore"`: the file opens in a SHEET over where you are (`openSheet`);
 *  - `"open"`, or no file: it opens full screen, as before (`go`).
 * A screen that is not a file (Settings, a friend) always opens full screen.
 */

/** The Mac's own words, file and default (`@shared/linkClick`, which the Mac's `client/src/explore/linkClick.ts` reads too). */
export type { LinkClick }
export const LINK_CLICK_PATH = `${VAULT_CONFIG_DIR}/${LINK_CLICK_FILE}`
/** With no file, a link opens the page: the Mac's `DEFAULT_LINK_CLICK`. */
export const DEFAULT_LINK_CLICK: LinkClick = MAC_DEFAULT.click

/** What the file holds, or the default for anything else (the Mac's `sanitizeLinkClick`). */
export const sanitizeLinkClick = (raw: unknown): LinkClick => sanitizeSettings(raw).click

/** Each vault's choice, as the host read it last (`ExploreHost`): read at each tap, with no wait. */
const choices = new Map<string, LinkClick>()
export const setLinkClick = (vault: string, click: LinkClick): void => void choices.set(vault, click)
export const linkClickOf = (vault: string | null): LinkClick => (vault === null ? DEFAULT_LINK_CLICK : (choices.get(vault) ?? DEFAULT_LINK_CLICK))

/** Opens `route`: in a sheet when the vault says "explore", else full screen. `click`: the caller's own read of the file (a sheet's links: `explore`). */
export function openFile(app: Pick<AppModel, 'go' | 'vaultKey'>, route: Route, click: LinkClick = linkClickOf(app.vaultKey)): void {
  if (isSheetRoute(route) && click === 'explore') openSheet(route)
  else app.go({ type: 'open', route })
}
