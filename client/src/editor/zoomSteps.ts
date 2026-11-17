/**
 * THE ZOOM STEPS of a page, the Inbox and Review (`DocumentZoom`'s − / + and its presets) and of the phone's Review
 * (YAZ-5706, its ⋯ menu's Zoom row): one ladder, so the phone zooms all the way in and out as the Mac does. No DOM,
 * no storage: the phone bundles it.
 */
export const ZOOM_STEPS = [50, 75, 90, 100, 125, 150, 200, 300, 400] as const
export const ZOOM_MIN = ZOOM_STEPS[0]
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]

/**
 * Next step above (`1`) or below (`-1`) `value`; a custom value snaps to the nearest step in
 * that direction (117 → 125 / 100). `null` past the last step, which is what disables the button.
 * (Reverse-then-find because the client lib is ES2022: no `findLast`.)
 */
export const stepZoom = (value: number, direction: 1 | -1): number | null =>
  (direction === 1 ? ZOOM_STEPS.find((p) => p > value) : [...ZOOM_STEPS].reverse().find((p) => p < value)) ?? null
