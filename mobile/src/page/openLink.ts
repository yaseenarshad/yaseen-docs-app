import type { LinkClick } from '@shared/linkClick'
import type { NavAction } from '../app/nav'

/**
 * THE ONE DOOR OF A LINK TAP IN THE READER (YAZ-5455). Every tap that opens a page or a card from the reader comes here:
 * a `[[link]]` or a Markdown link in a page, a pill in a card (the page's own cards, an embedded card, the card view),
 * an embed's "Embedded from", a "Linked from" row. Today it opens the page or the card over the open one (one Back
 * step). The Explore sheets (YAZ-5472) switch it here, in one place.
 *
 * `click` is the vault's "Clicking a link" (`.yaseendocs/link-click.json`, the Mac's YAZ-4936; `vaultLook.ts` reads it):
 * `explore` in a vault that opens links in Explore. The door hands it on; it does not draw a sheet yet.
 */
export type LinkTarget = { kind: 'page'; path: string; heading?: string } | { kind: 'card'; path: string; id: string }

export interface LinkDoor {
  go: (action: NavAction) => void
  /** The vault's "Clicking a link"; `open` until the vault's file is read, or with no file. */
  click: LinkClick
}

/** What a tap on a link opens: the action the app takes for `target` (the tests read it). */
export function linkAction(target: LinkTarget): NavAction {
  return target.kind === 'card'
    ? { type: 'open', route: { kind: 'card', path: target.path, id: target.id } }
    : { type: 'open', route: { kind: 'page', path: target.path, ...(target.heading !== undefined && target.heading !== '' && { heading: target.heading }) } }
}

/** Opens `target`. The one place a link tap opens anything (the Explore sheet will be chosen here by `door.click`). */
export function openLink(door: LinkDoor, target: LinkTarget): void {
  door.go(linkAction(target))
}
