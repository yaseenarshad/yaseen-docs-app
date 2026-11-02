/**
 * Times of day in a calendar table (YAZ-4162, YAZ-4159 D1 / D2): `readTime` reads column A's text. Shared, because
 * the time format setting (YAZ-4163, D15) must refuse a style that it cannot read back, and the main process checks
 * the stored setting too.
 */

/**
 * Minutes from midnight of a time of day, or `null`: `9:00 am`, `9:00am`, `9am`, `9:00 AM` (12-hour, with am / pm),
 * `09:00` and `21:30` (24-hour, the minutes needed). A bare number is no time, so a column of numbers is not one.
 */
export function readTime(text: string): number | null {
  const match = /^(\d{1,2})(?::([0-5]\d))?\s*(?:([ap])m)?$/i.exec(text.trim())
  if (match === null) return null
  const [, h, mm, ap] = match
  const hour = Number(h)
  const minute = mm === undefined ? 0 : Number(mm)
  if (ap === undefined) return mm === undefined || hour > 23 ? null : hour * 60 + minute
  if (hour < 1 || hour > 12) return null
  return ((hour % 12) + (ap.toLowerCase() === 'p' ? 12 : 0)) * 60 + minute
}
