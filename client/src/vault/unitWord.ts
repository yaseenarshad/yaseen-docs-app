/**
 * The vault's unit word (YAZ-4938): what the app calls a page in THIS vault. Page (the default), Doc, Note, or the
 * user's own word with its plural. `.yaseendocs/unit-word.json` through the vault-config door, as "Clicking a link" is
 * (`explore/linkClick.ts`): re-read when the file changes, the default with no file, nothing written until `save`. A
 * window with two vaults keeps one word per vault.
 *
 * ONE helper gives every label its word: `unit('New page')` → "New doc", `unit('12 pages')` → "12 docs",
 * `unit("This page's folder")` → "This doc's folder". A label is written with the plain word, and the helper swaps
 * `page` / `pages` / `Page` / `Pages` for the vault's forms, the capital kept. A page that is not the unit keeps its
 * word: "folder page", "Start page", "New tab page" (`OTHER_PAGE`). Feature names that hold the word ("Daily page")
 * do not go through it, and the guard test (`unitWord.guard.test.ts`) lists them.
 *
 * YAZ-5036: "page" is the base word (it was "note"). "Card" is no choice any more: a card is its own thing (YAZ-5037),
 * so a vault never shows two "New card" rows. A file that still says `card` reads as the default, "page". "Note" stays
 * a choice, for a vault that wants it.
 *
 * Speed: the file is read once per vault change. The default vault's helper is the identity, so a label costs
 * nothing there; another word's helper is one small regex per label, at the label's render, never on a keystroke.
 *
 * rename-note-to-page: skip-file (the word "note" here is the vault's choice "Note", not a page).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { api } from '../api'

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

/** `next` when it differs from `prev`, else `prev` itself, so a read that changes nothing renders nothing. */
const sameSettings = (prev: UnitWordSettings, next: UnitWordSettings): UnitWordSettings => (prev.unit === next.unit && prev.own.one === next.own.one && prev.own.many === next.own.many ? prev : next)

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

// ---- The store: one helper per vault root, for code that knows the root but is no component (a menu built at the
// right-click, a toast). `useVaultUnitWord` fills it; a slot that loses its vault empties its entry, so it never
// holds more than the window's vaults. ----

const helpers = new Map<string, UnitText>()
const listeners = new Set<() => void>()
let version = 0

function setVaultUnit(root: string, helper: UnitText | null): void {
  if (helper === null) helpers.delete(root)
  else helpers.set(root, helper)
  version++
  for (const listener of listeners) listener()
}

/** The helper of the vault at `root`, read now: the identity for no vault, an unknown vault, or the default word. */
export function vaultUnit(root: string | null | undefined): UnitText {
  return (root == null ? undefined : helpers.get(root)) ?? SAME_WORD
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = (): number => version

/** The helper of the vault at `root`, live: the component renders again when the vault's word changes. */
export function useVaultUnit(root: string | null | undefined): UnitText {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return vaultUnit(root)
}

// ---- React: the helper of the vault whose page is on screen. `App` provides it at each page layer; a component
// under one reads it with `useUnit()`. With no provider, the default word. ----

export const UnitContext = createContext<UnitText>(SAME_WORD)

/** The helper of the vault around this component. */
export const useUnit = (): UnitText => useContext(UnitContext)

export interface UnitWordState {
  settings: UnitWordSettings
  word: UnitWord
  /** The helper for this vault's word (one identity per word). */
  unit: UnitText
  save: (next: UnitWordSettings) => void
}

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the default. */
export function useVaultUnitWord(root: string | null): UnitWordState {
  const [settings, setSettings] = useState(DEFAULT_UNIT_WORD)
  const word = useMemo(() => unitWordOf(settings), [settings])
  const unit = useMemo(() => unitTextOf(word), [word])
  useEffect(() => {
    setSettings(DEFAULT_UNIT_WORD)
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, UNIT_WORD_FILE).then(
        // The same word again (every vault that says "page") is no change: no render for it.
        (raw) => live && setSettings((prev) => sameSettings(prev, sanitizeUnitWord(raw))),
        () => undefined,
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === UNIT_WORD_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root])
  useEffect(() => {
    if (root === null) return
    setVaultUnit(root, unit)
    return () => setVaultUnit(root, null)
  }, [root, unit])
  const save = useCallback(
    (next: UnitWordSettings) => {
      if (root === null) return
      const clean = sanitizeUnitWord(next)
      setSettings(clean)
      api.vaultConfig.write(root, UNIT_WORD_FILE, clean).catch(() => api.vaultConfig.read(root, UNIT_WORD_FILE).then((raw) => setSettings(sanitizeUnitWord(raw)), () => undefined))
    },
    [root],
  )
  return { settings, word, unit, save }
}
