/**
 * THE PAGE COG'S ON/OFF ROWS, stored IN the note (YAZ-4094 G4), the way `readonly` is (`readOnly.ts`):
 * they move with the file, GitHub sync carries them to the other Mac, a rename by any tool keeps them,
 * and an agent that reads the file sees them. Each open editor reads them off the note's text, so a
 * toggle in one tab shows in every tab at once (G1).
 *
 *  - `toc: true | false`: "Table of contents" (YAZ-2950).
 *  - `section-indent: true | false`: "Section indent" (YAZ-2709).
 *  - `guide-lines: true | false`: "Guide lines" (YAZ-4094 D2).
 *  - `folding: true | false`: "Folding" (YAZ-4094 F1).
 *  - `bullet-threading: true | false`: "Bullet threading" (YAZ-4277 D29, YAZ-4432).
 *
 * The cog's one choice that is not on/off lives here too, by the same rules: `outside-glow` (YAZ-4272 D2), this page's
 * glow for outside changes, one of `OUTSIDE_CHANGE_GLOWS`.
 *
 * NO KEY MEANS "FOLLOW THE APP DEFAULT", so old files and files from other tools need no migration.
 * Both `true` and `false` are stored: the page's choice wins over the default in both directions. Any
 * other value counts as no key. The same value again returns the SAME string, so the caller writes
 * nothing. Pure: no fs, no DOM. Tests: `pageSwitches.test.ts`.
 */
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'
import { OUTSIDE_CHANGE_GLOWS, type OutsideChangeGlow } from './types'

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
 * The note's own choices. A block that names none of the keys is not parsed at all (read once per
 * change of the note, never per keystroke); a block that does not parse holds no choice.
 */
export function notePageSwitches(content: string): PageSwitches {
  const { frontmatter } = splitFrontmatter(content)
  if (!PAGE_SWITCH_KEYS.some((key) => frontmatter.includes(key))) return {}
  return pageSwitchesOf(parseFrontmatter(frontmatter).properties)
}

/**
 * The note with the page's choice for `key`, every other byte kept (`setFrontmatterProperty`). Throws
 * `FrontmatterWriteError` on a block that does not parse.
 */
export function setNotePageSwitch(content: string, key: PageSwitchKey, on: boolean): string {
  return notePageSwitches(content)[key] === on ? content : setFrontmatterProperty(content, key, on)
}

/** This page's glow for outside changes (YAZ-4272 D2): Settings › Editor › Outside changes › Glow when absent. */
export const OUTSIDE_GLOW_KEY = 'outside-glow'

/** The page's own glow, or null: no key, or a value that is not a glow (the block is parsed only when it names the key). */
export function noteOutsideGlow(content: string): OutsideChangeGlow | null {
  const { frontmatter } = splitFrontmatter(content)
  if (!frontmatter.includes(OUTSIDE_GLOW_KEY)) return null
  const value = parseFrontmatter(frontmatter).properties[OUTSIDE_GLOW_KEY]
  return OUTSIDE_CHANGE_GLOWS.includes(value as OutsideChangeGlow) ? (value as OutsideChangeGlow) : null
}

/** The note with the page's glow; `null` removes the key, so the page follows the app setting again. */
export function setNoteOutsideGlow(content: string, glow: OutsideChangeGlow | null): string {
  return noteOutsideGlow(content) === glow ? content : setFrontmatterProperty(content, OUTSIDE_GLOW_KEY, glow ?? undefined)
}
