/**
 * The vault's unit word (YAZ-4938): what the app calls a note in THIS vault. Note (the default), Card, Doc, Page, or
 * the user's own word with its plural. `.yaseendocs/unit-word.json` through the vault-config door, as "Clicking a
 * link" is (`explore/linkClick.ts`): re-read when the file changes, the default with no file, nothing written until
 * `save`. A window with two vaults keeps one word per vault.
 *
 * ONE helper gives every label its word: `unit('New note')` → "New card", `unit('12 notes')` → "12 cards",
 * `unit("This note's folder")` → "This card's folder". A label is written with the plain word, and the helper swaps
 * `note` / `notes` / `Note` / `Notes` for the vault's forms, the capital kept. Feature names that hold the word
 * ("Cell note", "Daily notes") do not go through it, and the guard test (`unitWord.guard.test.ts`) lists them.
 *
 * Speed: the file is read once per vault change. The default vault's helper is the identity, so a label costs
 * nothing there; another word's helper is one small regex per label, at the label's render, never on a keystroke.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { api } from '../api'

export const UNIT_WORD_FILE = 'unit-word.json'

export type UnitChoice = 'note' | 'card' | 'doc' | 'page' | 'own'

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

export const NOTE_WORD: UnitWord = Object.freeze({ one: 'note', many: 'notes' })
export const DEFAULT_UNIT_WORD: UnitWordSettings = Object.freeze({ unit: 'note', own: Object.freeze({ one: '', many: '' }) })

/** The four built-in words, in the order the Settings row shows them. */
export const UNIT_WORDS: Readonly<Record<Exclude<UnitChoice, 'own'>, UnitWord>> = Object.freeze({
  note: NOTE_WORD,
  card: Object.freeze({ one: 'card', many: 'cards' }),
  doc: Object.freeze({ one: 'doc', many: 'docs' }),
  page: Object.freeze({ one: 'page', many: 'pages' }),
})

/** An own word is one word of letters and digits (a hyphen inside is fine), at most this long. */
export const OWN_WORD_MAX = 24
const OWN_WORD = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u

/** The own word as the user may type it, or '' for anything that is not one word. */
export function cleanOwnWord(raw: unknown): string {
  const word = typeof raw === 'string' ? raw.trim() : ''
  return word.length <= OWN_WORD_MAX && OWN_WORD.test(word) ? word : ''
}

/** What the file holds, or the default for anything else. An own choice keeps, even with no usable word yet: the word then reads as "note". */
export function sanitizeUnitWord(raw: unknown): UnitWordSettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as { unit?: unknown; own?: unknown }) : {}
  const ownRaw = typeof o.own === 'object' && o.own !== null ? (o.own as { one?: unknown; many?: unknown }) : {}
  const one = cleanOwnWord(ownRaw.one)
  const many = cleanOwnWord(ownRaw.many)
  const own = { one, many: many === '' ? (one === '' ? '' : `${one}s`) : many }
  const unit = o.unit === 'own' || o.unit === 'card' || o.unit === 'doc' || o.unit === 'page' ? o.unit : 'note'
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
  if (settings.own.one === '') return NOTE_WORD
  return { one: lowerForm(settings.own.one), many: lowerForm(settings.own.many) }
}

/** THE helper: a label written with "note" gets the vault's word, in the form of its place. */
export type UnitText = (text: string) => string

/** The default vault's helper: the identity, one object for the app's life, so a memo sees no change. */
export const SAME_WORD: UnitText = (text) => text

const WORD = /\b(note|notes|Note|Notes)\b/g
const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/** The helper for one word. `NOTE_WORD` (and any word that spells it) gives `SAME_WORD`. */
export function unitTextOf(word: UnitWord): UnitText {
  if (word.one === NOTE_WORD.one && word.many === NOTE_WORD.many) return SAME_WORD
  const forms: Record<string, string> = { note: word.one, notes: word.many, Note: capital(word.one), Notes: capital(word.many) }
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
        // The same word again (every vault that says "note") is no change: no render for it.
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
