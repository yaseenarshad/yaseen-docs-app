/**
 * The highlight ▾ panel of the selection toolbar (YAZ-4348 demo round 2; refactored onto shared Google Docs 10×8
 * `ColourPanel` / `ColourGrid` in YAZ-6695 D4 & YAZ-6727).
 * Custom highlights paint directly as solid `#rrggbb` or custom opacity `#rrggbbaa` (D8).
 */
import type { MarkType } from '@milkdown/kit/prose/model'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Hex } from '../lib/colour'
import { createColourPanel, readHex, shadesOf } from './colourPanel'
import {
  HIGHLIGHT_HEX,
  type CustomHighlight,
  type HighlightColor,
} from './marks/highlightColours'
import {
  applyHighlight,
  highlightColorsIn,
  highlightSchema,
  isCustomHighlight,
  removeHighlight,
  someHighlightColor,
} from './marks/highlight'
import { getQuickHighlightColorsForView, quickSlotToHighlightColor, recordPageHighlight, type HighlightViewLike } from './highlightQuick'

export { readHex, shadesOf }

/** The ▾'s toolbar key. */
export const MORE_KEY = 'highlight-more'

/**
 * A colour on the selection that is not one of this page's 3 quick toolbar buttons, as its CSS background, or null:
 * the ▾ lights for it and shows a bar of it, as the board's ▾ does (YAZ-4445, YAZ-6729, YAZ-6731).
 */
export function panelColour(state: EditorState, type: MarkType, view?: HighlightViewLike | null): string | null {
  const quick = getQuickHighlightColorsForView(view).map(quickSlotToHighlightColor)
  let found: HighlightColor | undefined
  someHighlightColor(state, type, (c) => {
    if (quick.includes(c)) return false
    found = c
    return true
  })
  if (found === undefined) return null
  return found === null ? 'var(--mark-bg)' : isCustomHighlight(found) ? found : `var(--mark-bg-${found})`
}

const hexOf = (color: HighlightColor): Hex =>
  isCustomHighlight(color) ? (color.slice(0, 7) as Hex) : HIGHLIGHT_HEX[color === null ? 'yellow' : color]

const handle = createColourPanel<HighlightColor>('mdapp-highlight-panel', {
  anchorKey: MORE_KEY,
  ariaLabel: 'Highlight colours',
  panelId: 'highlight',
  noneLabel: 'No highlight',
  defaultBoxHex: () => '#ffff00',
  allowAlpha: true,
  normalizeCustom: (raw) => (isCustomHighlight(raw) ? (raw as CustomHighlight) : null),
  hexOf,
  colorsIn: (ctx, state) => highlightColorsIn(state, highlightSchema.type(ctx)),
  apply: (ctx, color) => applyHighlight(highlightSchema.type(ctx), color),
  remove: (ctx) => removeHighlight(highlightSchema.type(ctx)),
  onCommit: (view, color) => {
    recordPageHighlight(view, color)
  },
})

/** The ▾'s press (Crepe runs it on pointerdown): open this editor's panel, or close it. */
export const toggleHighlightPanel = handle.toggle

/** The panel of each page. */
export const highlightPanel = handle.plugin
