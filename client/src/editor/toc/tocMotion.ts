/**
 * How a jump from a table of contents MOVES (YAZ-2700; shared since YAZ-3486): the glide to the row
 * and the one flash on it. A note's table of contents (`tocPlugin.ts`) and a code tab's Outline
 * (`code/outline/codeJump.ts`) move the same way, so both read these numbers.
 */

/** How long a jump's glide takes, however far it goes. */
export const GLIDE_MS = 420
/** A glide never crosses more than this many windows of the text. */
export const GLIDE_SCREENS = 3
/** Where a row lands below the scroller's top edge. */
export const LANDING_PX = 24

/** One flash of the row a jump landed on: held, then faded. */
export const FLASH_MS = 1300
/** The flash holds for this share of `FLASH_MS` before it fades. */
export const FLASH_HOLD = 0.45
/** The landing flash: the accent at a third of its strength — `--accent-soft` is nearly the page's own colour in the dark theme. */
export const FLASH_COLOUR = 'color-mix(in srgb, var(--accent) 34%, transparent)'
/** A band, not a tight box: the shadow carries the colour 6px past the text on every side. */
const FLASH_ON = { background: FLASH_COLOUR, boxShadow: `0 0 0 6px ${FLASH_COLOUR}`, borderRadius: '4px' }
const FLASH_OFF = { background: 'transparent', boxShadow: '0 0 0 6px transparent', borderRadius: '4px' }
/** The flash's keyframes for `element.animate`, with `FLASH_MS`: held, then faded. */
export const FLASH_FRAMES: Keyframe[] = [{ ...FLASH_ON, offset: 0 }, { ...FLASH_ON, offset: FLASH_HOLD }, { ...FLASH_OFF, offset: 1 }]

/** Ease in and out (cubic): a glide leaves gently and settles gently. `t` from 0 to 1. */
export const glideEase = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** "Reduce Motion" is on: a jump lands at once, with no glide and no flash. */
export const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
