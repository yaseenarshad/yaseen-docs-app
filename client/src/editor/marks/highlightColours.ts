/**
 * The highlight colours as plain data (YAZ-3742): no editor imports, so the folder views can read
 * them without the editor's import cycle. `highlight.ts` re-exports every name.
 */
/** The named colours that are toolbar buttons after yellow (YAZ-4348 demo round 2: pink went into the ▾ panel). */
export const QUICK_HIGHLIGHTS = ['green', 'blue'] as const
/** The named colours only the toolbar's ▾ panel has (YAZ-4348 demo round 2). */
export const MORE_HIGHLIGHTS = ['pink', 'orange', 'purple', 'red', 'gray'] as const
/** Every named colour, each `<mark class="highlight-<name>">`; yellow is `null` (the default, and the only one with Markdown syntax). */
export const HIGHLIGHT_COLORS = [...QUICK_HIGHLIGHTS, ...MORE_HIGHLIGHTS] as const
export type HighlightName = (typeof HIGHLIGHT_COLORS)[number]
/** A custom colour: lowercase `#rrggbb` (YAZ-4348 demo round 2). */
export type CustomHighlight = `#${string}`
export type HighlightColor = HighlightName | CustomHighlight | null

/**
 * Each colour's solid hue, the `rgb` of its app.css wash token: what the panel's Hex code field shows for it, and
 * where its Shades start (YAZ-4348 demo round 2). A shade or a typed hex is a custom colour.
 */
export const HIGHLIGHT_HEX: Record<HighlightName | 'yellow', CustomHighlight> = {
  yellow: '#ffd500',
  green: '#50c878',
  blue: '#50a0ff',
  pink: '#ff78b4',
  orange: '#ff9632',
  purple: '#a06eff',
  red: '#ff5a50',
  gray: '#969696',
}
