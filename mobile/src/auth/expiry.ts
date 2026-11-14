/**
 * The token's end date and the warning before it (round 10, item 18; the status dot shows it, 4D).
 *
 * GitHub sends the end date of a token that ends in the header `github-authentication-token-expiration`.
 * GOTCHA: GitHub's CORS answer does not list this header in `Access-Control-Expose-Headers`, so a web page
 * cannot read it (checked 2026-11-13). In the phone's browser `readTokenEnd` gives null. The end date then comes
 * from the Mac's code (`scanCode.ts`, `expires`), which reads the header with no CORS. A native app later reads it.
 */

export const EXPIRY_HEADER = 'github-authentication-token-expiration'
/** The warning shows this many days before the end. */
export const WARN_DAYS = 7

const DAY = 86_400_000

/** The end date as an ISO string, or null when the answer has none (no end date, or the browser hides it). */
export function readTokenEnd(headers: Headers): string | null {
  const value = headers.get(EXPIRY_HEADER)
  return value === null ? null : parseEndDate(value)
}

/** Reads `2026-12-31 00:00:00 UTC` (GitHub), `… +0000`, an ISO time, or a day `2026-12-31`. Null when it is none of them. */
export function parseEndDate(text: string): string | null {
  const t = text.trim()
  const github = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/.exec(t)
  let iso: string
  if (github) {
    const zone = github[3] === 'UTC' ? 'Z' : `${github[3].slice(0, 3)}:${github[3].slice(3)}`
    iso = `${github[1]}T${github[2]}${zone}`
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = `${t}T00:00:00Z`
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) iso = t
  else return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  // Date.parse rolls 2026-02-30 over to March: refuse a day that does not exist.
  const day = iso.slice(0, 10)
  if (github?.[3] === 'UTC' || iso.endsWith('Z')) {
    if (new Date(ms).toISOString().slice(0, 10) !== day) return null
  }
  return new Date(ms).toISOString()
}

export type TokenEndWarning =
  | { kind: 'none' }
  /** Ends within `WARN_DAYS` days: "Your token ends in 3 days". `daysLeft` is rounded up. */
  | { kind: 'soon'; endsAt: string; daysLeft: number }
  /** It ended: GitHub answers 401, and the app asks to sign in again (N6). */
  | { kind: 'ended'; endsAt: string }

export function tokenEndWarning(endsAt: string | null, now: number): TokenEndWarning {
  if (endsAt === null) return { kind: 'none' }
  const left = Date.parse(endsAt) - now
  if (Number.isNaN(left)) return { kind: 'none' }
  if (left <= 0) return { kind: 'ended', endsAt }
  if (left > WARN_DAYS * DAY) return { kind: 'none' }
  return { kind: 'soon', endsAt, daysLeft: Math.ceil(left / DAY) }
}
