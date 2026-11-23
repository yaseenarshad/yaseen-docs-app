/**
 * The parts of a search row to mark (YAZ-3748 D3), out of `completion.ts` (YAZ-5447): only a search that draws its
 * marks reads it, and the phone's first load has the matcher but not this (its marks are in the lazy Search tree chunk).
 */
import { JOINED_MIN, joinedAt, wordStart, type Needle } from './completion'

/**
 * `label` lowercased, with a way back from a [start, end) range of the lowercased text to the same letters of `label`
 * (YAZ-3748 B7). Nearly every label keeps its length, so the range is its own. A few letters grow (Turkish `İ` is `i̇`,
 * two code units): then the label is lowered one character at a time, and each code unit keeps where its character stands.
 */
function lowered(label: string): { lower: string; back: (start: number, end: number) => [number, number] } {
  const whole = label.toLowerCase()
  if (whole.length === label.length) return { lower: whole, back: (start, end) => [start, end] }
  let lower = ''
  const starts: number[] = []
  const ends: number[] = []
  let at = 0
  for (const ch of label) {
    const low = ch.toLowerCase()
    for (let i = 0; i < low.length; i++) starts.push(at), ends.push(at + ch.length)
    lower += low
    at += ch.length
  }
  return { lower, back: (start, end) => [starts[start], ends[end - 1]] }
}

/**
 * Where `needle` shows in `label`, as [start, end) ranges to mark (YAZ-3748 D3), tried in the matcher's own order: the
 * whole text where the label holds it, else each typed word where it starts a word (overlaps as one), else the joined
 * text across the marks it skipped (B5: once it has JOINED_MIN letters). None when nothing fits — an alias or an id
 * matched — or the text is empty. The ranges are the LABEL's positions, even where lowercasing changes its length (B7).
 */
export function matchRanges(label: string, needle: Needle): [number, number][] {
  if (needle.text === '') return []
  const { lower, back } = lowered(label)
  const at = lower.indexOf(needle.text)
  if (at !== -1) return [back(at, at + needle.text.length)]
  if (needle.words.length === 0) return []
  const starts = needle.words.map((q) => wordStart(lower, q))
  if (starts.every((start) => start !== -1)) return merged(starts.map((start, i) => back(start, start + needle.words[i].length)))
  const range = needle.joined.length < JOINED_MIN ? null : joinedAt(lower, needle.joined)
  return range === null ? [] : [back(range[0], range[1])]
}

/** Ranges in label order, overlapping or touching ones as one (`work working` marks `Working` once). Sorts `ranges` in place: its caller makes it new. */
function merged(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1]
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
    else out.push([start, end])
  }
  return out
}
