/**
 * The links that the app shares (decision 20; round 10, item 7; YAZ-5087, YAZ-5290): a landing page of the site the app
 * runs on, with the code after `#`. No browser sends the part after `#` to a server: not to Cloudflare, not in a
 * referrer (the site also says `no-referrer`).
 *
 * - `/friend#<pointer>`: a friend's link ("Share my link", 4E2).
 * - `/group#<group>`: a group's link ("Share the group link", 4E3).
 * - `/join#<group>-<pointer>`: a join request that a member sends to the group's admin (4E3).
 *
 * The landing page (`friend.html`, also served as `/group` and `/join`) shows the code and copies it. The app's paste
 * box reads the link or the code (`shared/friendGroups.ts`, `parseAnyLink`).
 */

export const FRIEND_PATH = '/friend'
/** A gist ID as a person pastes it: 20 to 64 hex letters (GitHub's IDs are 20 or 32). Shorter text is a word, not a code. */
const CODE = /^[0-9a-f]{20,64}$/i
const JOIN = /^[0-9a-f]{20,64}-[0-9a-f]{20,64}$/i

export const LANDING_KINDS = ['friend', 'group', 'join'] as const
export type LandingKind = (typeof LANDING_KINDS)[number]

const site = (origin: string) => origin.replace(/\/+$/, '')

/** The link for "Share my link": the site the app runs on (`location.origin`), so the preview and the stable site each make their own. */
export function friendLink(origin: string, id: string): string {
  if (!CODE.test(id)) throw new Error('not a gist ID')
  return `${site(origin)}${FRIEND_PATH}#${id}`
}

/** A group's link on the site the app runs on. */
export function groupLinkFor(origin: string, group: string): string {
  if (!CODE.test(group)) throw new Error('not a gist ID')
  return `${site(origin)}/group#${group.toLowerCase()}`
}

/** A join request on the site the app runs on. */
export function joinLinkFor(origin: string, group: string, pointer: string): string {
  if (!CODE.test(group) || !CODE.test(pointer)) throw new Error('not a gist ID')
  return `${site(origin)}/join#${group.toLowerCase()}-${pointer.toLowerCase()}`
}

/** The friend's code from pasted text: the code alone, or a friend link anywhere in the text. Null: neither. */
export function friendCodeFrom(text: string): string | null {
  const trimmed = text.trim()
  if (CODE.test(trimmed)) return trimmed
  const link = /https:\/\/[a-z0-9.-]+(?::\d+)?\/friend\/?#([0-9a-f]+)(?![0-9a-z])/i.exec(trimmed)
  return link && CODE.test(link[1]) ? link[1] : null
}

/**
 * The landing page's kind (from the path) and its code (from the FRAGMENT only, `location.hash`). Null code: the link
 * has none, or not of its kind.
 */
export function landingCodeFrom(pathname: string, hash: string): { kind: LandingKind; code: string | null } {
  const name = pathname.replace(/\.html$/, '').replace(/\/+$/, '').split('/').pop() ?? ''
  const kind: LandingKind = (LANDING_KINDS as readonly string[]).includes(name) ? (name as LandingKind) : 'friend'
  let raw = ''
  try {
    raw = decodeURIComponent(hash.replace(/^#/, '')).trim()
  } catch {
    raw = ''
  }
  const ok = kind === 'join' ? JOIN.test(raw) : CODE.test(raw)
  return { kind, code: ok ? raw : null }
}

/**
 * What the landing page's Copy puts on the clipboard: what the app's paste box reads. A friend's or a group's code alone
 * (a bare gist ID); a join request as its whole link (a bare `<group>-<pointer>` is not a link that the paste box reads).
 */
export function landingCopy(landing: { kind: LandingKind; code: string }, origin: string): string {
  return landing.kind === 'join' ? `${site(origin)}/join#${landing.code}` : landing.code
}
