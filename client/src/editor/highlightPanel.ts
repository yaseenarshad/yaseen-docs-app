/**
 * The highlight ▾ panel of the selection toolbar (YAZ-4348 demo round 2; refactored onto shared `colourPanel.ts` in
 * YAZ-6695 D4): Most used custom colours, Colours (None + 8 named washes), Shades, and Hex code + `ColourBox`.
 * Custom highlights paint directly as solid `#rrggbb` or custom opacity `#rrggbbaa` (D8).
 */
import type { MarkType } from '@milkdown/kit/prose/model'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Hex } from '../lib/colour'
import { createColourPanel, readHex, shadesOf, type ColourSwatchSpec } from './colourPanel'
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_HEX,
  QUICK_HIGHLIGHTS,
  type CustomHighlight,
  type HighlightColor,
  type HighlightName,
} from './marks/highlightColours'
import {
  applyHighlight,
  highlightColorsIn,
  highlightSchema,
  isCustomHighlight,
  removeHighlight,
  someHighlightColor,
} from './marks/highlight'

export { readHex, shadesOf }

/** The ▾'s toolbar key. */
export const MORE_KEY = 'highlight-more'

/**
 * A colour on the selection that is not a toolbar button, as its CSS background, or null: the ▾ lights for it and
 * shows a bar of it, as the board's ▾ does (YAZ-4445). Custom hex colours paint directly (D8).
 */
export function panelColour(state: EditorState, type: MarkType): string | null {
  let found: HighlightColor = null
  someHighlightColor(state, type, (c) => {
    if (c === null || (QUICK_HIGHLIGHTS as readonly string[]).includes(c)) return false
    found = c
    return true
  })
  const colour = found as HighlightColor
  return colour === null ? null : isCustomHighlight(colour) ? colour : `var(--mark-bg-${colour})`
}

const nameOf = (color: HighlightColor): string => (color === null ? 'yellow' : color)
const hexOf = (color: HighlightColor): Hex =>
  isCustomHighlight(color) ? (color.slice(0, 7) as Hex) : HIGHLIGHT_HEX[color === null ? 'yellow' : color]

let highlightSwatchesCache: readonly ColourSwatchSpec<HighlightColor>[] | undefined
const highlightSwatches = (): readonly ColourSwatchSpec<HighlightColor>[] =>
  (highlightSwatchesCache ??= ([null, ...HIGHLIGHT_COLORS] as (HighlightName | null)[]).map((c) => ({
    key: nameOf(c),
    label: `Highlight ${nameOf(c)}`,
    value: c,
    swatch: c === null ? 'var(--mark-bg)' : `var(--mark-bg-${c})`,
    hex: HIGHLIGHT_HEX[c === null ? 'yellow' : c],
  })))

const handle = createColourPanel<HighlightColor>('mdapp-highlight-panel', {
  anchorKey: MORE_KEY,
  ariaLabel: 'Highlight colours',
  panelId: 'highlight',
  noneLabel: 'None',
  swatches: highlightSwatches,
  defaultBoxHex: () => HIGHLIGHT_HEX.yellow,
  allowAlpha: true,
  customSwatch: (hex) => hex,
  normalizeCustom: (raw) => (isCustomHighlight(raw) ? (raw as CustomHighlight) : null),
  isCustom: (c): c is CustomHighlight => isCustomHighlight(c),
  hexOf,
  colorsIn: (ctx, state) => highlightColorsIn(state, highlightSchema.type(ctx)),
  apply: (ctx, color) => applyHighlight(highlightSchema.type(ctx), color),
  remove: (ctx) => removeHighlight(highlightSchema.type(ctx)),
})

/** The ▾'s press (Crepe runs it on pointerdown): open this editor's panel, or close it. */
export const toggleHighlightPanel = handle.toggle

/** The panel of each page. */
export const highlightPanel = handle.plugin
