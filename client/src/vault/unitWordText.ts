/**
 * The pure half of the vault's unit word (YAZ-4938): the settings, the word, and THE helper `unitTextOf`. No React,
 * no bridge, so the phone (YAZ-5077, round 15 item 5) uses the very same helper as the Mac. `unitWord.ts` re-exports
 * all of it and adds the Mac's reading of `.yaseendocs/unit-word.json` through the bridge.
 *
 * rename-note-to-page: skip-file (the word "note" here is the vault's choice "Note", not a page).
 */
export const UNIT_WORD_FILE = 'unit-word.json'

export type UnitChoice = 'page' | 'doc' | 'note' | 'own'

export interface UnitWordSettings {
  unit: UnitChoice
  /** The user's own word and its plural; read only with `unit: 'own'`. */
  own: { one: string; many: string }
}

/** The two forms of the word, lower-case for the middle of a sentence. */
export interface UnitWord {
  one: string
  many: string
}

export const PAGE_WORD: UnitWord = Object.freeze({ one: 'page', many: 'pages' })
export const DEFAULT_UNIT_WORD: UnitWordSettings = Object.freeze({ unit: 'page', own: Object.freeze({ one: '', many: '' }) })

/** The three built-in words, in the order the Settings row shows them. */
export const UNIT_WORDS: Readonly<Record<Exclude<UnitChoice, 'own'>, UnitWord>> = Object.freeze({
  page: PAGE_WORD,
  doc: Object.freeze({ one: 'doc', many: 'docs' }),
  note: Object.freeze({ one: 'note', many: 'notes' }),
})

/** An own word is one word of letters and digits (a hyphen inside is fine), at most this long. */
export const OWN_WORD_MAX = 24
const OWN_WORD = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u

/** The own word as the user may type it, or '' for anything that is not one word. */
export function cleanOwnWord(raw: unknown): string {
  const word = typeof raw === 'string' ? raw.trim() : ''
  return word.length <= OWN_WORD_MAX && OWN_WORD.test(word) ? word : ''
}

/**
 * What the file holds, or the default for anything else. An own choice keeps, even with no usable word yet: the word
 * then reads as "page". `card` (a choice before YAZ-5036) reads as the default.
 */
export function sanitizeUnitWord(raw: unknown): UnitWordSettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as { unit?: unknown; own?: unknown }) : {}
  const ownRaw = typeof o.own === 'object' && o.own !== null ? (o.own as { one?: unknown; many?: unknown }) : {}
  const one = cleanOwnWord(ownRaw.one)
  const many = cleanOwnWord(ownRaw.many)
  const own = { one, many: many === '' ? (one === '' ? '' : `${one}s`) : many }
  const unit = o.unit === 'own' || o.unit === 'doc' || o.unit === 'note' ? o.unit : 'page'
  return { unit, own }
}

/**
 * The lower-case form of a typed word: "Entry" → "entry", for the middle of a sentence. An all-caps word stays
 * ("SOP": "New SOP", "12 SOPs"), since its second letter is a capital too.
 */
const lowerForm = (word: string): string => (word.length > 1 && word[1] === word[1].toUpperCase() && word[1] !== word[1].toLowerCase() ? word : word.charAt(0).toLowerCase() + word.slice(1))


/** The word the settings choose, in both forms. */
export function unitWordOf(settings: UnitWordSettings): UnitWord {
  if (settings.unit !== 'own') return UNIT_WORDS[settings.unit]
  if (settings.own.one === '') return PAGE_WORD
  return { one: lowerForm(settings.own.one), many: lowerForm(settings.own.many) }
}

/** THE helper: a label written with "page" gets the vault's word, in the form of its place. */
export type UnitText = (text: string) => string

/** The default vault's helper: the identity, one object for the app's life, so a memo sees no change. */
export const SAME_WORD: UnitText = (text) => text

/** A page that is not the unit: a folder's page, the Start page, the New tab page. Its word never changes. */
const OTHER_PAGE = String.raw`(?<!\b(?:[Ff]older|[Ss]tart|[Tt]ab|[Hh]ome|[Ff]ront|PDF|[Ww]eb|[Ss]ettings) )`
const WORD = new RegExp(`${OTHER_PAGE}\\b(page|pages|Page|Pages)\\b(?! tab)`, 'g')
const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/** The helper for one word. `PAGE_WORD` (and any word that spells it) gives `SAME_WORD`. */
export function unitTextOf(word: UnitWord): UnitText {
  if (word.one === PAGE_WORD.one && word.many === PAGE_WORD.many) return SAME_WORD
  const forms: Record<string, string> = { page: word.one, pages: word.many, Page: capital(word.one), Pages: capital(word.many) }
  return (text) => text.replace(WORD, (found) => forms[found] ?? found)
}
