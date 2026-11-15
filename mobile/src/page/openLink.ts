import type { LinkClick } from '@shared/linkClick'
import type { NavAction, Route } from '../app/nav'
import { openFile } from '../explore/openFile'

/**
 * THE ONE DOOR OF A LINK TAP IN THE READER (YAZ-5455). Every tap that opens a page, a card or a drawing from the reader
 * comes here: a `[[link]]` or a Markdown link in a page, a pill in a card (the page's own cards, an embedded card, the
 * card view), an embed's "Embedded from", a "Linked mentions" row, a properties link, a link in an Explore sheet.
 *
 * A link is always tapped INSIDE a page, a card or a panel, so it opens with `from: 'inside'` (YAZ-5472 Q4: only a
 * tab screen's first open is always a full page). It hands the route to the app's ONE door, `openFile`: the vault's "Clicking a link"
 * (`.yaseendocs/link-click.json`, the Mac's YAZ-4936) says how. `explore`: the file opens in a sheet over where you are;
 * `open` (the Mac's default, and with no file): it opens over the open one, full screen (one Back step).
 */
export type LinkTarget = { kind: 'page'; path: string; heading?: string } | { kind: 'card'; path: string; id: string } | { kind: 'drawing'; path: string } | { kind: 'folder'; path: string }

export interface LinkDoor {
  go: (action: NavAction) => void
  /** The open vault: `openFile` reads its "Clicking a link" when `click` is not given. */
  vaultKey: string | null
  /**
   * The vault's "Clicking a link" as the reader read it (`vaultLook.ts`); undefined until the file is read, and then the
   * app's own copy (`ExploreHost`) decides. A sheet's door says `explore`: a link in a sheet opens another sheet.
   */
  click?: LinkClick
}

/** The route a link opens. */
export function linkRoute(target: LinkTarget): Route {
  if (target.kind === 'card') return { kind: 'card', path: target.path, id: target.id }
  if (target.kind === 'drawing') return { kind: 'drawing', path: target.path }
  // YAZ-5550: a folder's page (in a panel when the vault says explore, as a page's link).
  if (target.kind === 'folder') return { kind: 'folder', path: target.path }
  return { kind: 'page', path: target.path, ...(target.heading !== undefined && target.heading !== '' && { heading: target.heading }) }
}

/** What a tap on a link opens full screen: the action the app takes for `target` with "Clicking a link" `open` (the tests read it). */
export function linkAction(target: LinkTarget): NavAction {
  return { type: 'open', route: linkRoute(target) }
}

/** Opens `target`. The one place a link tap opens anything: through `openFile`, which picks a sheet or full screen. */
export function openLink(door: LinkDoor, target: LinkTarget): void {
  openFile(door, linkRoute(target), { from: 'inside', ...(door.click !== undefined && { click: door.click }) })
}
