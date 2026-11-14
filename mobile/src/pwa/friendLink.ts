/**
 * The friend link (decision 20; round 10, item 7; YAZ-5087): `https://<site>/friend#<ID>`, where the ID is the friend's
 * pointer gist (round 16). The ID is after `#`, so no browser sends it to any server: not to Cloudflare, not in a
 * referrer (the site also says `no-referrer`). The landing page (`friend.html`) shows it and copies it; the app's
 * "Paste a friend's link" (4E2) reads either the link or the code with `friendCodeFrom`.
 */

export const FRIEND_PATH = '/friend'
/** A gist ID as a person pastes it: 20 to 64 hex letters (GitHub's IDs are 20 or 32). Shorter text is a word, not a code. */
const CODE = /^[0-9a-f]{20,64}$/i

/** The link for "Share my link": the site the app runs on (`location.origin`), so the preview and the stable site each make their own. */
export function friendLink(origin: string, id: string): string {
  if (!CODE.test(id)) throw new Error('not a gist ID')
  return `${origin.replace(/\/+$/, '')}${FRIEND_PATH}#${id}`
}

/** The friend's code from pasted text: the code alone, or a friend link anywhere in the text. Null: neither. */
export function friendCodeFrom(text: string): string | null {
  const trimmed = text.trim()
  if (CODE.test(trimmed)) return trimmed
  const link = /https:\/\/[a-z0-9.-]+(?::\d+)?\/friend\/?#([0-9a-f]+)(?![0-9a-z])/i.exec(trimmed)
  return link && CODE.test(link[1]) ? link[1] : null
}
