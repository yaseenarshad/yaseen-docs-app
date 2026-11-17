/**
 * YAZ-5377: the IANA time zone helpers, with no import. Settings (in the phone's first load) needs only these two. Before,
 * it took them from `friendStats.ts`, and that brought the friends stats, the card schedule (`ts-fsrs`) and the YAML
 * parser into the first load. `friendStats.ts` keeps the same two functions until its builder re-exports them from here
 * (`mobile/src/screens/timeZone.test.ts` holds the two equal).
 */

/** A zone name this runtime knows (`Intl` accepts it). */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The device's own IANA time zone, or null when the runtime does not say. */
export function deviceZone(): string | null {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone
  return isTimeZone(zone) ? zone : null
}
