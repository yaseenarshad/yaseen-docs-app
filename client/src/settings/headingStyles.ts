/**
 * Text formatting (YAZ-3049 D2; YAZ-3067 D12, D17): a vault's saved formatting
 * (`.yaseendocs/text-formatting.json`, `useTextFormatting`) becomes CSS custom properties on each
 * page layer of that vault: the tab layer, the review layer, the side panel layer and the search
 * preview. `app.css` reads `--text-size` as the editor's base size, and each `h1`-`h6` rule and the
 * `.heading-text` spans of a heading read the `--hN-*` variables; `bullets.css` (the label row of a
 * bullet that starts with a heading) reads both. Each falls back to the look of 1.0.14. Only a
 * changed field gets a variable, so `{}` sets none.
 */
import { TEXT_DEFAULT_SIZE, type TextFormatting } from '@shared/textFormatting'
import { HEADING_KEYS, type HeadingHighlight, type HeadingKey, type HeadingStyle, type HeadingStyles } from '@shared/types'

/** app.css's em scale of each level: a heading with no size of its own is this × the Text size (D17). */
export const HEADING_SCALE: Readonly<Record<HeadingKey, number>> = { h1: 1.802, h2: 1.602, h3: 1.424, h4: 1.266, h5: 1.125, h6: 1 }

/**
 * The size in px, rounded, of a level with no size of its own, at the vault's Text size (D17).
 * Settings shows it, and the first "−" or "+" starts from it. At 16 px: 29, 26, 23, 20, 18, 16.
 */
export const defaultHeadingSize = (key: HeadingKey, textSize = TEXT_DEFAULT_SIZE): number => Math.round(HEADING_SCALE[key] * textSize)

/** The default weight of each level: app.css gives H1 700 and the others 600. */
export const HEADING_DEFAULT_WEIGHTS: Readonly<Record<HeadingKey, number>> = { h1: 700, h2: 600, h3: 600, h4: 600, h5: 600, h6: 600 }

/** The wash of each highlight: the `==highlight==` mark's colours (app.css). Each is one see-through `rgba` that reads in both themes. */
export const HEADING_HIGHLIGHT_VARS: Readonly<Record<HeadingHighlight, string>> = {
  yellow: 'var(--mark-bg)',
  green: 'var(--mark-bg-green)',
  blue: 'var(--mark-bg-blue)',
  pink: 'var(--mark-bg-pink)',
}

/** The custom properties of the changed fields, for example `{ '--h2-size': '24px' }`. */
export function headingVars(styles: HeadingStyles): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const key of HEADING_KEYS) {
    const style = styles[key]
    if (style === undefined) continue
    if (style.size !== undefined) vars[`--${key}-size`] = `${style.size}px`
    if (style.bold === false) vars[`--${key}-weight`] = '400'
    if (style.underline === true) vars[`--${key}-decoration`] = 'underline'
    // The wash hugs the words (D7): app.css paints it on the heading's `.heading-text` spans
    // (outline/headingText.ts), and the heading keeps its full width.
    if (style.highlight !== undefined) vars[`--${key}-bg`] = HEADING_HIGHLIGHT_VARS[style.highlight]
  }
  return vars
}

/** The custom properties of a vault's formatting: `--text-size` when the Text size is set, then the `--hN-*` variables. `{}` sets none. */
export function textVars(formatting: TextFormatting): Record<string, string> {
  const size = formatting.text?.size
  return { ...(size !== undefined && { '--text-size': `${size}px` }), ...headingVars(formatting) }
}

/** Whether a level looks different from the app's own look: any stored field that is not a default. */
export const isChanged = (style: HeadingStyle | undefined): boolean =>
  style !== undefined && (style.size !== undefined || style.bold === false || style.underline === true || style.highlight !== undefined)

/**
 * The map with one level's fields changed. A field set back to its default leaves the map (bold on,
 * underline off, no highlight), and a level with no field left leaves it too, so the map holds only
 * what the reader changed (D1). A size stays once it is set; "Reset" removes the level.
 */
export function withHeadingStyle<T extends HeadingStyles>(styles: T, key: HeadingKey, patch: Partial<HeadingStyle>): T {
  const merged: HeadingStyle = { ...styles[key], ...patch }
  const next: HeadingStyle = {}
  if (merged.size !== undefined) next.size = merged.size
  if (merged.bold === false) next.bold = false
  if (merged.underline === true) next.underline = true
  if (merged.highlight !== undefined) next.highlight = merged.highlight
  return isChanged(next) ? { ...styles, [key]: next } : withoutHeadingStyle(styles, key)
}

/** "Reset" (D1): the map without that level's key. */
export function withoutHeadingStyle<T extends HeadingStyles>(styles: T, key: HeadingKey): T {
  const { [key]: _removed, ...rest } = styles
  return rest as T
}
