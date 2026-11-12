/**
 * "Show IDs in search" (YAZ-4940), a choice per vault with IDs: a note's ID shows on every search row (Always, the
 * default), or only when the search matches the ID (today's sidebar). It covers the sidebar's search and the explore
 * stack's results; each keeps its own look. `.yaseendocs/show-ids.json` through the vault-config door, as the review
 * settings and "Clicking a link" are: re-read when the file changes, the default with no file, nothing written until
 * `save`. Reading the choice costs a search nothing: each row already carries its `id`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

export const SHOW_IDS_FILE = 'show-ids.json'
export type IdsInSearch = 'always' | 'match'
export interface ShowIdsSettings {
  search: IdsInSearch
}
export const DEFAULT_SHOW_IDS: ShowIdsSettings = { search: 'always' }

/** What the file holds, or the default for anything else. */
export function sanitizeShowIds(raw: unknown): ShowIdsSettings {
  const search = typeof raw === 'object' && raw !== null ? (raw as { search?: unknown }).search : undefined
  return { search: search === 'match' ? 'match' : 'always' }
}

export interface ShowIdsState {
  settings: ShowIdsSettings
  save: (next: ShowIdsSettings) => void
  /** Read at each render of a result list (one identity for the vault's life). */
  inSearch: () => IdsInSearch
}

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the default. */
export function useShowIds(root: string | null): ShowIdsState {
  const [settings, setSettings] = useState(DEFAULT_SHOW_IDS)
  const now = useRef(settings)
  now.current = settings
  const inSearch = useCallback(() => now.current.search, [])
  useEffect(() => {
    setSettings(DEFAULT_SHOW_IDS)
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, SHOW_IDS_FILE).then(
        (raw) => live && setSettings(sanitizeShowIds(raw)),
        () => undefined,
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === SHOW_IDS_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root])
  const save = useCallback(
    (next: ShowIdsSettings) => {
      if (root === null) return
      const clean = sanitizeShowIds(next)
      setSettings(clean)
      api.vaultConfig.write(root, SHOW_IDS_FILE, clean).catch(() => api.vaultConfig.read(root, SHOW_IDS_FILE).then((raw) => setSettings(sanitizeShowIds(raw)), () => undefined))
    },
    [root],
  )
  return { settings, save, inSearch }
}

/** The ID a row shows, by the vault's choice: always, or only on a row the search found by its ID (`searchRows` put `ID — ` in front of its label). */
export function shownId(row: { id?: string; label: string }, rule: IdsInSearch): string | null {
  if (row.id === undefined) return null
  return rule === 'always' || row.label.startsWith(`${row.id} — `) ? row.id : null
}
