/**
 * The custom highlight colours the user picks, most used first (YAZ-4348 demo round 2): the highlight panel's
 * "Most used custom colours" row, kept in the setting `highlightCustomColors`, which travels with the settings.
 *
 * `App.tsx` hands the setting in and gives the door that saves it; the panel counts each custom pick here. The
 * count lands here at once, so an open panel shows it before the setting comes back. No editor import: App reads
 * this before any page opens.
 */
import { HIGHLIGHT_CUSTOM_COLORS_KEPT, HIGHLIGHT_CUSTOM_COLORS_SHOWN, type HighlightCustomColor } from '@shared/types'

let used: readonly HighlightCustomColor[] = []
let save: (next: HighlightCustomColor[]) => void = () => {}

/** The setting as it is now (App, on each change). */
export function setUsedHighlightColors(list: readonly HighlightCustomColor[]): void {
  used = list
}

/** Where a new count goes (App: the settings' door). */
export function setUsedHighlightColorsSaver(fn: (next: HighlightCustomColor[]) => void): void {
  save = fn
}

/** The row: the most used colours, at most `HIGHLIGHT_CUSTOM_COLORS_SHOWN`. */
export const mostUsedHighlightColors = (): string[] => used.slice(0, HIGHLIGHT_CUSTOM_COLORS_SHOWN).map((c) => c.color)

/**
 * `list` with one more use of `color`: the list stays most used first, a colour among equals goes first (the
 * latest wins a tie), and past `HIGHLIGHT_CUSTOM_COLORS_KEPT` the least used OTHER colour goes — never the one
 * just picked, which would then never get a second use counted. The list keeps more than the row shows, so a new
 * colour can climb into the row.
 */
export function countUse(list: readonly HighlightCustomColor[], color: string): HighlightCustomColor[] {
  const uses = (list.find((c) => c.color === color)?.uses ?? 0) + 1
  const rest = list.filter((c) => c.color !== color)
  const at = rest.findIndex((c) => c.uses <= uses)
  const next = at < 0 ? [...rest, { color, uses }] : [...rest.slice(0, at), { color, uses }, ...rest.slice(at)]
  while (next.length > HIGHLIGHT_CUSTOM_COLORS_KEPT) {
    let last = next.length - 1
    if (next[last].color === color) last--
    next.splice(last, 1)
  }
  return next
}

/** One custom pick: counted here, then saved. */
export function recordHighlightColorUse(color: string): void {
  used = countUse(used, color)
  save([...used])
}
