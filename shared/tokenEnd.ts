/**
 * A GitHub token's end date, read from the text GitHub gives (`github-authentication-token-expiration`) or from the
 * Mac's code (`scanCode.ts`, `expires`). Moved from `mobile/src/auth/expiry.ts` (YAZ-5098), unchanged.
 */

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
