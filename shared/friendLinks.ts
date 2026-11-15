/**
 * The friend, group and join links (YAZ-5092 D1, A5): the ONE place for the address they open, and for the sites a
 * pasted link may name.
 *
 * The phone makes its links on the site it runs on (`location.origin`: `ownSiteLink` in
 * `mobile/src/friends/ui/parts.tsx`), so the preview and the stable site each make their own. The Mac has no site of its
 * own: its links open the phone app at `PHONE_APP_ORIGIN`.
 */

/**
 * The phone app's address: the real one, docs.yaseenarshad.com (YAZ-5579), a custom domain of the Worker
 * (`mobile/wrangler.jsonc`). Links made on the old preview addresses still paste (`SITES`).
 */
export const PHONE_APP_ORIGIN = 'https://docs.yaseenarshad.com'

/** The friend link: the landing page of the app's site (5-) with the pointer ID after `#`, which no server log sees. */
export const FRIEND_LINK_BASE = `${PHONE_APP_ORIGIN}/friend`
/** A group's link, and a member's join request to the admin (4E3). */
export const GROUP_LINK_BASE = `${PHONE_APP_ORIGIN}/group`
export const JOIN_LINK_BASE = `${PHONE_APP_ORIGIN}/join`

/**
 * The app's sites (round 12, item 14): a link from another host is "a link of another app". Each site counts with its
 * sub-sites (`preview.docs…`, `preview.notecard…`). YAZ-5476: the app is Yaseen Docs, at `docs.yaseenarshad.com`. The
 * old names stay, so a link shared before still pastes: `notecard.yaseenarshad.com` (2026-11-14 until YAZ-5476) and
 * `notecards.yaseenarshad.com` (before that). Each carries the same code.
 */
const SITES = ['docs.yaseenarshad.com', 'notecard.yaseenarshad.com', 'notecards.yaseenarshad.com']
export const isOurSite = (host: string): boolean => SITES.some((site) => host === site || host.endsWith(`.${site}`))

/** A gist ID: 20 (old gists) or 32 hex characters. */
export const LINK_ID = /^[0-9a-f]{20,40}$/i

/**
 * A pasted link's path, part by part, without regard to case (YAZ-5524, sweep3 N-5): `/GROUP#…`, `/Join#…` and
 * `/Friend/<id>` read as the app's own (some apps capitalise a pasted first word). An ID in it is hex, read in any case.
 */
export const linkPath = (url: URL): string[] =>
  url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => part.toLowerCase())
