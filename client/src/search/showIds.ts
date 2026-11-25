/**
 * "Show IDs" (YAZ-4940), three choices per vault with IDs, in one file:
 * - in search: a page's ID shows on every search row (Always, the default), or only when the search matches the ID
 *   (today's sidebar). It covers the sidebar's search and the explore stack's results; each keeps its own look.
 * - in the title (On, the default): the page's ID after its title, small and muted, drawn and never part of the
 *   title text; a click copies it. The explore stack's page head shows it by the same choice.
 * - in the files list (Off, the default): the ID at the right end of a page's row in the sidebar's files list, as its
 *   number ("#12", the letters are the same on every row of a vault) or in full ("EMB-12").
 * `.yaseendocs/show-ids.json` through the vault-config door, as the review settings and "Clicking a link" are:
 * re-read when the file changes, the default with no file, nothing written until `save`. An old file with `search`
 * alone reads as title On, files list Off; round 2's `files: true` reads as Number. Reading a choice costs a search nothing: each row already carries its
 * `id`; a title or a files-list row reads the index's cached path map, never the file.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { DEFAULT_SHOW_IDS, SHOW_IDS_FILE, SHOW_IDS_KEYS, idInFiles, sanitizeShowIds, type IdsInFiles, type IdsInSearch, type ShowIdsSettings } from '@shared/showIds'
import { api } from '../api'
import { pathInfo } from '../editor/wikilink/linkPillLook'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { dirname } from '../lib/paths'
import type { IndexRecord } from '@shared/types'

export { DEFAULT_SHOW_IDS, IDS_IN_SEARCH, IDS_IN_TABS, SHOW_IDS_FILE, TAB_ID_LAYOUTS, idInFiles, sanitizeShowIds, type IdsInFiles, type IdsInSearch, type IdsInTabs, type ShowIdsSettings, type TabIdLayout } from '@shared/showIds'

export interface ShowIdsState {
  settings: ShowIdsSettings
  save: (next: ShowIdsSettings) => void
  /** Read at each render of a result list (one identity for the vault's life). */
  inSearch: () => IdsInSearch
  /** "In the title", read where a page's head draws (one identity for the vault's life): the explore stack's page layer. */
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
      api.vaultConfig.write(root, SHOW_IDS_FILE, clean, SHOW_IDS_KEYS).catch(() => api.vaultConfig.read(root, SHOW_IDS_FILE).then((raw) => setSettings(sanitizeShowIds(raw)), () => undefined))
    },
    [root],
  )
  return { settings, save, inSearch, inTitle }
}

/**
 * The ID a search row shows, by the vault's choice (YAZ-4940, YAZ-6502): Number ("#2921"), Full ID ("WIKI-2921"),
 * or only when the search found the row by its ID (`searchRows` put `ID — ` in front of its label). Under `match`
 * or `off`, an ID-matched row still shows its number ("#2921") so the matched digits highlight cleanly.
 */
export function shownId(row: { id?: string; label: string }, rule: IdsInSearch): string | null {
  if (row.id === undefined) return null
  if (rule === 'full') return row.id
  if (rule === 'number') return idInFiles(row.id, 'number')
  return row.label.startsWith(`${row.id} — `) ? idInFiles(row.id, 'number') : null
}

/**
 * The ID of the page at `path` in the title's place (YAZ-4940 "In the title"), live off the vault's index: a string,
 * so a snapshot that changed it alone re-renders. `source` absent (the choice Off, or no vault): nothing is read
 * or subscribed to. A vault without IDs holds no `id` on its records, so it shows none. A card file shows its card's
 * ID (YAZ-5546, `cardFileIds`), as a string like a page's, so a click copies it the same way.
 */
export function usePageId(source: WikilinkResolveSource | undefined, path: string): string | undefined {
  const subscribe = useCallback((poke: () => void) => (source === undefined ? () => undefined : source.subscribe(poke)), [source])
  return useSyncExternalStore(subscribe, () => (source === undefined ? undefined : (pathInfo(source.records, source.folders).get(path)?.id ?? cardFileIds(source.records).get(path))))
}

const cardIdsCache = new WeakMap<readonly IndexRecord[], ReadonlyMap<string, string>>()
/**
 * Each card file's ID by its path (YAZ-5546), for display only: a card file holds no `id:` property (decision D,
 * YAZ-5308), its ID is its card's, off its card line (`searchCandidates`' `cardFileId`, the phone's `rowId`). Kept
 * apart from `pathInfo` and the record: a record's `id` also resolves links, draws pills and names comments, where a
 * card file is not a page. A file with its own `id` is not here. Built once per snapshot's records.
 */
function cardFileIds(records: readonly IndexRecord[]): ReadonlyMap<string, string> {
  let ids = cardIdsCache.get(records)
  if (ids === undefined) {
    const built = new Map<string, string>()
    for (const record of records) {
      const cardId = record.kind === 'card' && record.id === undefined ? (record.cards?.[0]?.id ?? undefined) : undefined
      if (cardId !== undefined) built.set(record.path, cardId)
    }
    cardIdsCache.set(records, (ids = built))
  }
  return ids
}

/** Every page's ID by its absolute path (YAZ-4940 "In the files list"), as its vault chose to show it ("#12" or "EMB-12"). */
export type PathIds = ReadonlyMap<string, string>

/** A vault that chose the files list or tabs: its index, the form its rows show, and whether to include folder pages. */
export interface PathIdsSource {
  index: WikilinkResolveSource
  form: Exclude<IdsInFiles, 'off'>
  /** When true (used by open tabs), also include folder pages keyed by `dirname(folder.path)`. */
  includeFolders?: boolean
}

const NO_IDS: PathIds = new Map()
/** The map last handed out, kept while no ID of its vaults changed (as `pathTitles` keeps its Map): the tree is memo. */
function sameIds(prev: PathIds, next: Map<string, string>): boolean {
  if (prev.size !== next.size) return false
  for (const [path, id] of next) if (prev.get(path) !== id) return false
  return true
}

/**
 * One `PathIds` over the index of each vault in `sources`, live, each in its vault's form: the sidebar's files list
 * draws each page's ID from it, and the tab bar draws open tabs' IDs from it (with `includeFolders: true`). Empty
 * `sources` (no vault chose the option): `undefined`, and no index is read or subscribed to. Built once per snapshot
 * or change of form, off `pathInfo`'s cached map (and a card file's card ID, YAZ-5546, plus folder IDs when requested);
 * a build that changed no shown ID keeps the Map it had.
 */
export function useAllPathIds(sources: readonly PathIdsSource[]): PathIds | undefined {
  const subscribe = useCallback(
    (poke: () => void) => {
      const offs = sources.map((source) => source.index.subscribe(poke))
      return () => offs.forEach((off) => off())
    },
    [sources],
  )
  const held = useRef<{ infos: readonly unknown[]; forms: string; ids: PathIds }>({ infos: [], forms: '', ids: NO_IDS })
  const ids = useSyncExternalStore(subscribe, () => {
    const infos = sources.map((source) => pathInfo(source.index.records, source.index.folders))
    const forms = sources.map((source) => `${source.form}:${source.includeFolders === true ? '1' : '0'}`).join()
    const last = held.current
    if (forms === last.forms && infos.length === last.infos.length && infos.every((info, i) => info === last.infos[i])) return last.ids
    const built = new Map<string, string>()
    infos.forEach((info, i) => {
      const form = sources[i].form === 'number' ? 'number' : 'full'
      for (const [path, { id }] of info) if (id !== undefined) built.set(path, idInFiles(id, form))
      // A card file's ID, its card's (YAZ-5546): not on its record nor in `pathInfo` (see `cardFileIds`).
      for (const [path, id] of cardFileIds(sources[i].index.records)) built.set(path, idInFiles(id, form))
      // Folder page IDs (YAZ-6464): only when requested (open tabs); sidebar files list keeps folder rows without IDs.
      if (sources[i].includeFolders === true) {
        for (const folder of sources[i].index.folders) {
          if (folder.id !== undefined) built.set(dirname(folder.path), idInFiles(folder.id, form))
        }
      }
    })
    held.current = { infos, forms, ids: sameIds(last.ids, built) ? last.ids : built }
    return held.current.ids
  })
  return sources.length === 0 ? undefined : ids
}
