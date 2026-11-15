/**
 * THE BEAT (YAZ-5121, the scene kit): one clip's time, as every kit piece reads it. A piece is a pure function of its
 * beat and its content: the same beat draws the same frame. So pause stops the motion (the clock stops), Back and a
 * seek redraw the right frame, and a test can draw any moment (`beatAt`).
 *
 * - `t`, `length`: seconds at 1×, as the layer's clock gives them (`SceneClock.now()`).
 * - `progress`: `t / length`, 0 to 1 (the gap after the words reads as 1).
 * - `marks`: the clip's `marks` in `script.ts` (sorted fractions in (0, 1)); `fired`: how many of them are behind `t`.
 *   A piece reads its cues from `progress`, never from the mark events, so a jump over a mark draws the same frame.
 * - `reduced`: `prefers-reduced-motion`. Geometry snaps to where it goes, and things cross-fade in place: no travel.
 */

export interface Beat {
  t: number
  length: number
  progress: number
  marks: readonly number[]
  fired: number
  reduced: boolean
  playing: boolean
}

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p

/** Easings: each maps 0..1 to 0..1. */
export const ease = {
  linear: (p: number): number => p,
  out: (p: number): number => 1 - Math.pow(1 - p, 3),
  inOut: (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  /** A small overshoot, for a thing that lands. */
  back: (p: number): number => {
    const c1 = 1.5
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
  },
}

/** How many of `marks` are at or behind `progress`. */
export const firedCount = (marks: readonly number[], progress: number): number => marks.filter((m) => progress >= m).length

/** A beat for a test or the preview: the clip at `progress` of `length` seconds. */
export function beatAt(progress: number, length = 6, marks: readonly number[] = [], reduced = false, playing = false): Beat {
  const p = clamp(progress)
  return { t: p * length, length, progress: p, marks, fired: firedCount(marks, p), reduced, playing }
}

/** Linear 0..1 between two fractions of the clip (`a` before: 0; `z` after: 1). */
export function between(b: Beat, a: number, z: number): number {
  if (z <= a) return b.progress >= a ? 1 : 0
  return clamp((b.progress - a) / (z - a))
}

/** Linear 0..1 over `seconds`, from the fraction `at` of the clip: a cue that takes the same time in a long or short clip. */
export function since(b: Beat, at: number, seconds: number): number {
  const start = at * b.length
  if (b.t < start) return 0
  return seconds <= 0 ? 1 : clamp((b.t - start) / seconds)
}

/**
 * The clip's mark at `index` (a fraction), or `fallback` when the clip has no such mark. Scenes place a cue that must
 * land on a word with this, so new voice timings move the picture by changing `marks` in `script.ts` alone.
 */
export const cue = (b: Beat, index: number, fallback: number): number => b.marks[index] ?? fallback

/**
 * The amount a thing has MOVED at progress `p`: eased; with reduced motion it snaps (0 before, 1 once it starts), so
 * geometry never travels. Opacity takes `p` itself, so with reduced motion the change is a cross-fade.
 */
export const moved = (b: Beat, p: number, curve: (p: number) => number = ease.inOut): number => (b.reduced ? (p > 0 ? 1 : 0) : curve(clamp(p)))

/** A style that comes in at `p`: it fades in and rises by `dy` px (no rise with reduced motion). */
export function rise(b: Beat, p: number, dy = 10): { opacity: number; transform?: string } {
  const q = clamp(p)
  if (b.reduced || dy === 0) return { opacity: q }
  return { opacity: q, transform: `translateY(${((1 - ease.out(q)) * dy).toFixed(2)}px)` }
}

/** A style that grows in at `p` from `from` of its size (a pop); with reduced motion only the fade. */
export function pop(b: Beat, p: number, from = 0.6): { opacity: number; transform?: string } {
  const q = clamp(p)
  if (b.reduced) return { opacity: q }
  return { opacity: clamp(q * 2.5), transform: `scale(${lerp(from, 1, ease.back(q)).toFixed(4)})` }
}

/** Part of a text, typed so far at `p` (with reduced motion: all of it once it starts). */
export const typedText = (b: Beat, text: string, p: number): string => (b.reduced ? (p > 0 ? text : '') : text.slice(0, Math.round(text.length * clamp(p))))

/** In from `inP`, out from `outP`: the opacity of a thing that shows for a while (both 0..1). */
export const showFor = (inP: number, outP: number): number => clamp(inP) * (1 - clamp(outP))
