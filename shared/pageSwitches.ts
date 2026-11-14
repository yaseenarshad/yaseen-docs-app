/**
 * THE PAGE COG'S ON/OFF ROWS, stored IN the page (YAZ-4094 G4), the way `readonly` is (`readOnly.ts`):
 * they move with the file, GitHub sync carries them to the other Mac, a rename by any tool keeps them,
 * and an agent that reads the file sees them. Each open editor reads them off the page's text, so a
 * toggle in one tab shows in every tab at once (G1).
 *
 *  - `toc: true | false`: "Table of contents" (YAZ-2950).
 *  - `section-indent: true | false`: "Section indent" (YAZ-2709).
 *  - `guide-lines: true | false`: "Guide lines" (YAZ-4094 D2).
 *  - `folding: true | false`: "Folding" (YAZ-4094 F1).
 *  - `bullet-threading: true | false`: "Bullet threading" (YAZ-4277 D29, YAZ-4432).
 *
 * The cog's one choice that is not on/off lives here too, by the same rules: `outside-glow` (YAZ-4272 D2), this page's
 * glow for outside changes, one of `OUTSIDE_CHANGE_GLOWS`. So does `find-folds` (YAZ-4787), this page's ⌘F fold choice,
 * one of `FIND_FOLDS`, set from the find bar. So do `code-width` and `table-width` (YAZ-4783), this page's width for its
 * code blocks and its tables, whole px.
 *
 * NO KEY MEANS "FOLLOW THE APP DEFAULT", so old files and files from other tools need no migration.
 * Both `true` and `false` are stored: the page's choice wins over the default in both directions. Any
 * other value counts as no key. The same value again returns the SAME string, so the caller writes
 * nothing. Pure: no fs, no DOM. Tests: `pageSwitches.test.ts`.
 */
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'
import { FIND_FOLDS, isBlockWidth, OUTSIDE_CHANGE_GLOWS, type FindFolds, type OutsideChangeGlow } from './types'

export const PAGE_SWITCH_KEYS = ['toc', 'section-indent', 'guide-lines', 'folding', 'bullet-threading'] as const
export type PageSwitchKey = (typeof PAGE_SWITCH_KEYS)[number]
/** The page's own choices; a key that is absent follows the app default. */
export type PageSwitches = Partial<Record<PageSwitchKey, boolean>>

/** The same rule on properties already parsed. */
function pageSwitchesOf(properties: Readonly<Record<string, unknown>>): PageSwitches {
  const out: PageSwitches = {}
  for (const key of PAGE_SWITCH_KEYS) {
    const value = properties[key]
    if (typeof value === 'boolean') out[key] = value
  }
  return out
}

/**
 * The page's own choices. A block that names none of the keys is not parsed at all (read once per
 * change of the page, never per keystroke); a block that does not parse holds no choice.
 */
export function readPageSwitches(content: string): PageSwitches {
  const { frontmatter } = splitFrontmatter(content)
  if (!PAGE_SWITCH_KEYS.some((key) => frontmatter.includes(key))) return {}
  return pageSwitchesOf(parseFrontmatter(frontmatter).properties)
}

/**
 * The page with the page's choice for `key`, every other byte kept (`setFrontmatterProperty`). Throws
 * `FrontmatterWriteError` on a block that does not parse.
 */
export function writePageSwitch(content: string, key: PageSwitchKey, on: boolean): string {
  return readPageSwitches(content)[key] === on ? content : setFrontmatterProperty(content, key, on)
}

/** This page's ⌘F fold choice (YAZ-4787): Settings › Editor › Find › Folded bullets when absent. */
export const FIND_FOLDS_KEY = 'find-folds'

/** The page's own ⌘F fold choice, or null: no key, or a value that is not one (parsed only when the block names the key). */
export function readFindFolds(content: string): FindFolds | null {
  const { frontmatter } = splitFrontmatter(content)
  if (!frontmatter.includes(FIND_FOLDS_KEY)) return null
  const value = parseFrontmatter(frontmatter).properties[FIND_FOLDS_KEY]
  return FIND_FOLDS.includes(value as FindFolds) ? (value as FindFolds) : null
}

/** The page with its ⌘F fold choice; `null` removes the key, so the page follows the app setting again. */
export function writeFindFolds(content: string, folds: FindFolds | null): string {
  return readFindFolds(content) === folds ? content : setFrontmatterProperty(content, FIND_FOLDS_KEY, folds ?? undefined)
}

/** This page's glow for outside changes (YAZ-4272 D2): Settings › Editor › Outside changes › Glow when absent. */
export const OUTSIDE_GLOW_KEY = 'outside-glow'

/** The page's own glow, or null: no key, or a value that is not a glow (the block is parsed only when it names the key). */
export function readOutsideGlow(content: string): OutsideChangeGlow | null {
  const { frontmatter } = splitFrontmatter(content)
  if (!frontmatter.includes(OUTSIDE_GLOW_KEY)) return null
  const value = parseFrontmatter(frontmatter).properties[OUTSIDE_GLOW_KEY]
  return OUTSIDE_CHANGE_GLOWS.includes(value as OutsideChangeGlow) ? (value as OutsideChangeGlow) : null
}

/** The page with the page's glow; `null` removes the key, so the page follows the app setting again. */
export function writeOutsideGlow(content: string, glow: OutsideChangeGlow | null): string {
  return readOutsideGlow(content) === glow ? content : setFrontmatterProperty(content, OUTSIDE_GLOW_KEY, glow ?? undefined)
}

/**
 * This page's width for its code blocks and its tables (YAZ-4783 layer 2): `code-width: 900`, `table-width: 1000`, whole
 * px at 100% zoom (`isBlockWidth`). The page cog's "Code block width" / "Table width" write them; "Default" removes the
 * key, and the page follows Settings › Editor › Code blocks › Width / Settings › Tables › All tables › Width again. A
 * block's own width (`<!-- code: width … -->`, a table's dragged columns) wins over it.
 */
export const CODE_WIDTH_KEY = 'code-width'
export const TABLE_WIDTH_KEY = 'table-width'
export type BlockWidthKey = typeof CODE_WIDTH_KEY | typeof TABLE_WIDTH_KEY

/** The page's own width for `key`, or null: no key, or a value that is not a width (parsed only when the block names the key). */
export function readBlockWidth(content: string, key: BlockWidthKey): number | null {
  const { frontmatter } = splitFrontmatter(content)
  if (!frontmatter.includes(key)) return null
  const value = parseFrontmatter(frontmatter).properties[key]
  return isBlockWidth(value) ? value : null
}

/** The page with its width for `key`; `null` removes the key, so the page follows the app setting again. */
export function writeBlockWidth(content: string, key: BlockWidthKey, width: number | null): string {
  return readBlockWidth(content, key) === width ? content : setFrontmatterProperty(content, key, width ?? undefined)
}
