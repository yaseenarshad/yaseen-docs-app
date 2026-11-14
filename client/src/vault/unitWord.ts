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
import { DEFAULT_UNIT_WORD, SAME_WORD, sanitizeUnitWord, UNIT_WORD_FILE, unitTextOf, unitWordOf, type UnitText, type UnitWord, type UnitWordSettings } from './unitWordText'

// The pure half lives in `unitWordText.ts` (the phone imports it with no bridge); every name stays importable from here.
export * from './unitWordText'

/** `next` when it differs from `prev`, else `prev` itself, so a read that changes nothing renders nothing. */
const sameSettings = (prev: UnitWordSettings, next: UnitWordSettings): UnitWordSettings => (prev.unit === next.unit && prev.own.one === next.own.one && prev.own.many === next.own.many ? prev : next)

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

/** The helper of the vault that holds `path` (the longest known root it is under): the identity when none does. */
export function pathUnit(path: string): UnitText {
  let best: string | null = null
  for (const root of helpers.keys()) if ((path === root || path.startsWith(`${root.replace(/\/+$/, '')}/`)) && (best === null || root.length > best.length)) best = root
  return best === null ? SAME_WORD : helpers.get(best)!
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
