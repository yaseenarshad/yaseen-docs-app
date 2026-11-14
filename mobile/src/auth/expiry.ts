/**
 * The token's end date and the warning before it (round 10, item 18; the status dot shows it, 4D).
 *
 * GitHub sends the end date of a token that ends in the header `github-authentication-token-expiration`.
 * GOTCHA: GitHub's CORS answer does not list this header in `Access-Control-Expose-Headers`, so a web page
 * cannot read it (checked 2026-11-13). In the phone's browser `readTokenEnd` gives null. The end date then comes
 * from the Mac's code (`scanCode.ts`, `expires`), which reads the header with no CORS. A native app later reads it.
 */

import { parseEndDate } from '@shared/tokenEnd'

/** In `shared/` since YAZ-5098: the Mac's code (`shared/scanCode.ts`) reads the same end date. */
export { parseEndDate }

export const EXPIRY_HEADER = 'github-authentication-token-expiration'
/** The warning shows this many days before the end. */
export const WARN_DAYS = 7

const DAY = 86_400_000

/** The end date as an ISO string, or null when the answer has none (no end date, or the browser hides it). */
export function readTokenEnd(headers: Headers): string | null {
  const value = headers.get(EXPIRY_HEADER)
  return value === null ? null : parseEndDate(value)
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
