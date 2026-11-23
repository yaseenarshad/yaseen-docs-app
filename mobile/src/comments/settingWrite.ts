import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import type { PageSwitchKey } from '@shared/pageSwitches'
import { isMap, isScalar, parseDocument } from 'yaml'

/**
 * THE PHONE'S THIRD WRITE TO A PAGE (YAZ-5568): one of the page cog's on/off rows, from the page's ⋯ ("Folding on this
 * page"). The Mac keeps these IN the page's frontmatter (`shared/pageSwitches.ts`, YAZ-4094 G4: `folding: true |
 * false`), so the value is the Mac's own writer's (`writePageSwitch`), and the Mac reads it back with its own parser
 * (`readPageSwitches`).
 *
 * As the comment write (`write.ts`), the phone SPLICES: the Mac's writer lays the whole block out again (`yaml`'s
 * Document), and the phone must not touch what it did not change. So it takes only the key's line from the Mac's
 * result and puts it in place of the page's own line for the key, or, when the page has none, as the last line of the
 * block. A page with no block gets the Mac's new block, in the page's own line ends. Every other byte stays. The result
 * is checked: it must read with the new value, and with exactly the page's other properties and body; else it is
 * refused (`layout`) and nothing is written.
 *
 * IDEMPOTENT: an entry says what the switch must BECOME, so a retry that finds it so writes nothing (`already`). It goes
 * the comments' safe path (the list, the send on the fresh page, compare-and-swap, the dot). Pure.
 *
 * The Mac's read and write of a switch are `readPageSwitches` and `writePageSwitch` (`shared/pageSwitches.ts`): a
 * boolean under the key, written by `setFrontmatterProperty`. They are the two lines below (`switchOf`, the write in
 * `applySetting`), not imported: importing that module here made it a chunk of its own, and the first load's list of
 * chunks grew. `settingWrite.test.ts` holds them equal to the Mac's.
 */
export interface PageSetting {
  key: PageSettingKey
  /** YAZ-5658: `null` takes the page's own key away (the row's "Mobile Vault Default"). */
  on: boolean | null
}

/**
 * YAZ-5591: the phone's own page key, `sticky-headings: true | false` ("Sticky headings on this page"). Not a Mac switch
 * (the Mac has no sticky headings): the Mac keeps it as any other property, byte for byte (`useAutosave` puts the block
 * back as it was read; `setFrontmatterIn` lays out only its own key: `client/src/hooks/useAutosave.test.tsx`).
 */
export const STICKY_HEADINGS_KEY = 'sticky-headings'
/**
 * YAZ-5658: the phone's own page key for Wide tables, `fit-tables: true | false` (Fit Screen | Same as Desktop); none:
 * Mobile Vault Default (`mobile.json`'s `fitTables`). The Mac keeps it byte for byte, as `sticky-headings`.
 */
export const FIT_TABLES_KEY = 'fit-tables'
export type PageSettingKey = PageSwitchKey | typeof STICKY_HEADINGS_KEY | typeof FIT_TABLES_KEY

export type SettingRefusedWhy = 'invalid' | 'layout'

export type SettingResult = { kind: 'set'; content: string } | { kind: 'already' } | { kind: 'refused'; why: SettingRefusedWhy }

/** The page's own value for `key` (the Mac's `readPageSwitches`: a boolean, else none). */
export const switchOf = (content: string, key: PageSettingKey): boolean | undefined => {
  const value: unknown = parseFrontmatter(splitFrontmatter(content).frontmatter).properties[key]
  return typeof value === 'boolean' ? value : undefined
}

const OPEN_FENCE_RE = /^\uFEFF?---[ \t]*\r?\n/
const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')
const bodyOf = (text: string): string => {
  const { frontmatter, body } = splitFrontmatter(text)
  return frontmatter === '' ? body.replace(/^\uFEFF/, '') : body
}

function blockOf(frontmatter: string): { open: number; close: number; interior: string } {
  const open = OPEN_FENCE_RE.exec(frontmatter)?.[0].length ?? 0
  const close = Math.max(open, frontmatter.replace(/\r?\n$/, '').lastIndexOf('\n') + 1)
  return { open, close, interior: frontmatter.slice(open, close) }
}

/** Where the `key` entry sits in a block's interior: [start, end) from its key to its value's end; null: no such key. */
function entryOf(interior: string, key: string): { start: number; end: number } | null | 'unsure' {
  const doc = parseDocument(interior)
  if (doc.errors.length > 0) return 'unsure'
  if (doc.contents === null) return null
  if (!isMap(doc.contents) || doc.contents.flow === true) return 'unsure'
  for (const pair of doc.contents.items) {
    const k = isScalar(pair.key) ? pair.key : null
    if (k?.value !== key || k.range == null) continue
    const value = pair.value as { range?: [number, number, number] } | null
    let end = value?.range?.[1] ?? k.range[1]
    while (end > k.range[0] && (interior[end - 1] === '\n' || interior[end - 1] === '\r')) end--
    return { start: k.range[0], end }
  }
  return null
}

/** `before` without its `key` entry (its whole line), every other byte as it was; null when it cannot be sure. */
function spliceOut(before: string, key: string): string | null {
  const b = splitFrontmatter(before)
  if (b.frontmatter === '') return null
  const { interior, open } = blockOf(b.frontmatter)
  const at = entryOf(interior, key)
  if (at === null || at === 'unsure' || (at.start > 0 && interior[at.start - 1] !== '\n')) return null
  // To the end of its line (a YAML comment after the value goes with it).
  const eol = interior.indexOf('\n', at.end)
  const end = eol === -1 ? interior.length : eol + 1
  return `${before.slice(0, open + at.start)}${before.slice(open + end)}`
}

/** `before` with only its `key` entry taken from `mac` (the Mac's writer's result of the same page), or null. */
function splice(before: string, mac: string, key: string): string | null {
  const b = splitFrontmatter(before)
  const m = splitFrontmatter(mac)
  if (m.body !== bodyOf(before) || m.frontmatter === '') return null
  if (b.frontmatter === '') return eolOf(b.body) === '\r\n' ? `${m.frontmatter.replace(/\r?\n/g, '\r\n')}${m.body}` : mac
  const macBlock = blockOf(m.frontmatter)
  const macAt = entryOf(macBlock.interior, key)
  if (macAt === null || macAt === 'unsure') return null
  const eol = eolOf(b.frontmatter)
  const entry = macBlock.interior.slice(macAt.start, macAt.end).replace(/\r\n/g, '\n').replace(/\n/g, eol)
  const { close, interior, open } = blockOf(b.frontmatter)
  const at = entryOf(interior, key)
  if (at === 'unsure') return null
  if (at === null) return `${before.slice(0, close)}${entry}${eol}${before.slice(close)}`
  if (at.start > 0 && interior[at.start - 1] !== '\n') return null
  return `${before.slice(0, open + at.start)}${entry}${before.slice(open + at.end)}`
}

/** The check: `out` reads `key` as `on` (the Mac's parser), with the page's own body and other properties. */
function sameBut(before: string, out: string, setting: PageSetting): boolean {
  if (bodyOf(out) !== bodyOf(before)) return false
  if (switchOf(out, setting.key) !== (setting.on ?? undefined)) return false
  const rest = (text: string) => {
    const { properties, error } = parseFrontmatter(splitFrontmatter(text).frontmatter)
    const { [setting.key]: _key, ...others } = properties
    return error === undefined ? JSON.stringify(others) : null
  }
  const was = rest(before)
  return was !== null && was === rest(out)
}

/** `content` with the page's `setting.key` set to `setting.on`, or why not. */
export function applySetting(content: string, setting: PageSetting): SettingResult {
  if (parseFrontmatter(splitFrontmatter(content).frontmatter).error !== undefined) return { kind: 'refused', why: 'invalid' }
  if (switchOf(content, setting.key) === (setting.on ?? undefined)) return { kind: 'already' }
  if (setting.on === null) {
    const out = spliceOut(content, setting.key)
    return out !== null && sameBut(content, out, setting) ? { kind: 'set', content: out } : { kind: 'refused', why: 'layout' }
  }
  let mac: string
  try {
    mac = setFrontmatterProperty(content, setting.key, setting.on)
  } catch {
    return { kind: 'refused', why: 'invalid' }
  }
  const out = splice(content, mac, setting.key)
  return out !== null && sameBut(content, out, setting) ? { kind: 'set', content: out } : { kind: 'refused', why: 'layout' }
}
