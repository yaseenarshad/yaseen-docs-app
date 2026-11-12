/**
 * "Show IDs" (YAZ-4940), three choices per vault with IDs, in one file:
 * - in search: a note's ID shows on every search row (Always, the default), or only when the search matches the ID
 *   (today's sidebar). It covers the sidebar's search and the explore stack's results; each keeps its own look.
 * - in the title (On, the default): the note's ID after its title, small and muted, drawn and never part of the
 *   title text; a click copies it. The explore stack's note head shows it by the same choice.
 * - in the files list (Off, the default): the ID at the right end of a note's row in the sidebar's files list.
 * `.yaseendocs/show-ids.json` through the vault-config door, as the review settings and "Clicking a link" are:
 * re-read when the file changes, the default with no file, nothing written until `save`. An old file with `search`
 * alone reads as title On, files list Off. Reading a choice costs a search nothing: each row already carries its
 * `id`; a title or a files-list row reads the index's cached path map, never the file.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api } from '../api'
import { pathInfo } from '../editor/wikilink/linkPillLook'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'

export const SHOW_IDS_FILE = 'show-ids.json'
export type IdsInSearch = 'always' | 'match'
export interface ShowIdsSettings {
  search: IdsInSearch
  /** The ID after the note's title (On, the default). */
  title: boolean
  /** The ID at the right end of a note's row in the sidebar's files list (Off, the default). */
  files: boolean
}
export const DEFAULT_SHOW_IDS: ShowIdsSettings = { search: 'always', title: true, files: false }

/** What the file holds, or the default for anything else: an old file (`search` alone) reads as title On, files list Off. */
export function sanitizeShowIds(raw: unknown): ShowIdsSettings {
  const held = typeof raw === 'object' && raw !== null ? (raw as { search?: unknown; title?: unknown; files?: unknown }) : {}
  return { search: held.search === 'match' ? 'match' : 'always', title: held.title !== false, files: held.files === true }
}

export interface ShowIdsState {
  settings: ShowIdsSettings
  save: (next: ShowIdsSettings) => void
  /** Read at each render of a result list (one identity for the vault's life). */
  inSearch: () => IdsInSearch
  /** "In the title", read where a note's head draws (one identity for the vault's life): the explore stack's note layer. */
  inTitle: () => boolean
}

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the default. */
export function useShowIds(root: string | null): ShowIdsState {
  const [settings, setSettings] = useState(DEFAULT_SHOW_IDS)
  const now = useRef(settings)
  now.current = settings
  const inSearch = useCallback(() => now.current.search, [])
  const inTitle = useCallback(() => now.current.title, [])
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
  return { settings, save, inSearch, inTitle }
}

/** The ID a row shows, by the vault's choice: always, or only on a row the search found by its ID (`searchRows` put `ID — ` in front of its label). */
export function shownId(row: { id?: string; label: string }, rule: IdsInSearch): string | null {
  if (row.id === undefined) return null
  return rule === 'always' || row.label.startsWith(`${row.id} — `) ? row.id : null
}

/**
 * The ID of the note at `path` in the title's place (YAZ-4940 "In the title"), live off the vault's index: a string,
 * so a snapshot that changed it alone re-renders. `source` absent (the choice Off, or no vault): nothing is read
 * or subscribed to. A vault without IDs holds no `id` on its records, so it shows none.
 */
export function useNoteId(source: WikilinkResolveSource | undefined, path: string): string | undefined {
  const subscribe = useCallback((poke: () => void) => (source === undefined ? () => undefined : source.subscribe(poke)), [source])
  return useSyncExternalStore(subscribe, () => (source === undefined ? undefined : pathInfo(source.records, source.folders).get(path)?.id))
}

/** Every note's ID by its absolute path (YAZ-4940 "In the files list"), over the vaults that chose it. */
export type PathIds = ReadonlyMap<string, string>

const NO_IDS: PathIds = new Map()
/** The map last handed out, kept while no ID of its vaults changed (as `pathTitles` keeps its Map): the tree is memo. */
function sameIds(prev: PathIds, next: Map<string, string>): boolean {
  if (prev.size !== next.size) return false
  for (const [path, id] of next) if (prev.get(path) !== id) return false
  return true
}

/**
 * One `PathIds` over the index of each vault in `sources`, live: the sidebar's files list draws each note's ID from
 * it. Empty `sources` (no vault chose the files list): `undefined`, and no index is read or subscribed to. Built once
 * per snapshot, off `pathInfo`'s cached map; a snapshot that changed no ID keeps the Map it had.
 */
export function useAllPathIds(sources: readonly WikilinkResolveSource[]): PathIds | undefined {
  const subscribe = useCallback(
    (poke: () => void) => {
      const offs = sources.map((source) => source.subscribe(poke))
      return () => offs.forEach((off) => off())
    },
    [sources],
  )
  const held = useRef<{ infos: readonly unknown[]; ids: PathIds }>({ infos: [], ids: NO_IDS })
  const ids = useSyncExternalStore(subscribe, () => {
    const infos = sources.map((source) => pathInfo(source.records, source.folders))
    const last = held.current
    if (infos.length === last.infos.length && infos.every((info, i) => info === last.infos[i])) return last.ids
    const built = new Map<string, string>()
    for (const info of infos) for (const [path, { id }] of info) if (id !== undefined) built.set(path, id)
    held.current = { infos, ids: sameIds(last.ids, built) ? last.ids : built }
    return held.current.ids
  })
  return sources.length === 0 ? undefined : ids
}
