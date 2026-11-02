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
 *
 * NO KEY MEANS "FOLLOW THE APP DEFAULT", so old files and files from other tools need no migration.
 * Both `true` and `false` are stored: the page's choice wins over the default in both directions. Any
 * other value counts as no key. The same value again returns the SAME string, so the caller writes
 * nothing. Pure: no fs, no DOM. Tests: `pageSwitches.test.ts`.
 */
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'

export const PAGE_SWITCH_KEYS = ['toc', 'section-indent', 'guide-lines', 'folding'] as const
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
