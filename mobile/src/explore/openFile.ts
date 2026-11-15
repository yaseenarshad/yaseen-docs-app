import { DEFAULT_LINK_CLICK as MAC_DEFAULT, LINK_CLICK_FILE, sanitizeLinkClick as sanitizeSettings, type LinkClick } from '@shared/linkClick'
import { VAULT_CONFIG_DIR } from '@shared/types'
import type { AppModel } from '../app/AppState'
import type { Route } from '../app/nav'
import { isSheetRoute, openSheet } from './sheets'

/**
 * THE ONE DOOR TO OPEN A FILE: `openFile(app, route, { from })`. Every place of the app that opens a page, a
 * card, a card file, a drawing or a folder's page calls it, and says WHERE the tap came from.
 *
 * THE RULE (Yaseen's, YAZ-5472 Q4 "the first open is a full page"):
 *  - `from: 'tab'`: the FIRST open from a tab screen ALWAYS opens a FULL PAGE (`go`), whatever `link-click.json` says:
 *    Search's tree and results (`SearchTree.tsx`), Favorites, Focus and Recent (`ListTree.tsx`), the Today button
 *    (`TodayTab.tsx`), Review's "Open page" and "Open card" (`Review.tsx`), a held folder's "Open folder page"
 *    (`holdFolder.tsx`). Back from that page goes back to the tab screen.
 *  - `from: 'inside'`: a link or a row tapped INSIDE a page, a card view, a folder page or an Explore panel follows the
 *    vault (`.yaseendocs/link-click.json`, the Mac's "Clicking a link"): `"explore"` opens an Explore panel
 *    over where you are (`openSheet`; Back closes the panel); `"open"`, or no file, opens it full screen (`go`). That is
 *    every link of the reader through its own door (`page/openLink.ts`: a link, a pill, "Linked from", "Embedded
 *    from") and a folder page's rows (`FolderBody.tsx`, `FolderTable.tsx`, `FolderCards.tsx`).
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

/** Where an open comes from: a tab screen (always a full page), or inside a page, a card, a folder page or a panel. */
export type OpenFrom = 'tab' | 'inside'

export interface OpenHow {
  from: OpenFrom
  /** For `from: 'inside'`: the caller's own read of the vault's file (a panel's links: `explore`); else the app's copy. */
  click?: LinkClick
}

/** Opens `route`: full screen from a tab screen; from inside, in an Explore panel when the vault says "explore", else full screen. */
export function openFile(app: Pick<AppModel, 'go' | 'vaultKey'>, route: Route, how: OpenHow): void {
  const click = how.click ?? linkClickOf(app.vaultKey)
  if (how.from === 'inside' && isSheetRoute(route) && click === 'explore') openSheet(route)
  else app.go({ type: 'open', route })
}
