import { useEffect, useState } from 'react'
import { IDS_FILE, idLettersOf, idsAnswer } from '@shared/pageId'
import { REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import { useApp } from '../app/AppState'
import type { VaultStore } from '../store'
import type { PhoneIndex } from '../sync/phoneIndex'

/**
 * WHAT SEARCH AND THE READER KNOW OF THE OPEN VAULT, from the phone's storage only, so both work with no
 * signal: the index records (3B keeps them as the vault's state `index`), the vault's files (the checkpoint's list, for
 * pictures and files a link names), its ID letters (`.yaseendocs/ids.json`) and its review settings
 * (`.yaseendocs/review.json`: Review on or off, the answer words).
 *
 * It follows 3B's `changed` event: the event's index when it carries one (3B's engine does), else the stored index again.
 * A `changed` with a `diff` that names the open page is R3 to R6 (the page view reads it). Pure reads; no network.
 */

export interface VaultData {
  vault: string
  /** The commit the records are of; null before the first download ends. */
  commit: string | null
  /** Pages and card files, by path (`folder/name.md`). */
  byPath: Readonly<Record<string, IndexRecord>>
  /** The pages and card files, in path order. */
  records: readonly IndexRecord[]
  /** The folder settings records (`.folder.md`). */
  folders: readonly IndexRecord[]
  /** Every file of the vault at `commit` (the checkpoint's list), stored or not. */
  files: readonly string[]
  /** The vault's ID letters, the current ones first. */
  letters: readonly string[]
  /** The vault gives IDs (`ids.json`; with no answer there, when some record has one). */
  ids: boolean
  review: ReviewSettings
  /** A new object each time any part changes. */
  version: number
}

/**
 * 3B's name of the stored index (`INDEX_STATE` in `sync/phoneIndex.ts`), written here: that file builds records with the
 * frontmatter parser (`yaml`, about 100 kB), which the first load must not carry. `vaultData.test.ts` checks the two agree.
 */
export const INDEX_STATE_NAME = 'index'

const CONFIG = `${VAULT_CONFIG_DIR}/`
const REVIEW_PATH = `${CONFIG}${REVIEW_SETTINGS_FILE}`
export const IDS_PATH = `${CONFIG}${IDS_FILE}`

/** A stored JSON file of the vault, parsed; undefined when it is not stored or not JSON. */
export async function readJson(store: VaultStore, vault: string, path: string): Promise<unknown> {
  const file = await store.read(vault, path)
  if (file === null) return undefined
  try {
    return JSON.parse(typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content))
  } catch {
    return undefined
  }
}

let versions = 0
/** YAZ-5596 (6): the index object each data was made from (the engine's, or a store read). */
const madeFrom = new WeakMap<VaultData, PhoneIndex>()

/** The vault's data as the phone holds it now. `index`: the index the caller already has (3B's event), else the stored one. */
export async function loadVaultData(store: VaultStore, vault: string, repoName: string, index?: PhoneIndex): Promise<VaultData> {
  const held = index ?? (await store.getState<PhoneIndex>(vault, INDEX_STATE_NAME)) ?? null
  const checkpoint = await store.checkpoint(vault)
  const byPath: Record<string, IndexRecord> = {}
  const folders: IndexRecord[] = []
  const all = held?.records ?? {}
  for (const path of Object.keys(all).sort()) {
    if (all[path].name === FOLDER_SETTINGS_FILE) folders.push(all[path])
    else byPath[path] = all[path]
  }
  const records = Object.values(byPath)
  const idsConfig = await readJson(store, vault, IDS_PATH)
  const data: VaultData = {
    vault,
    commit: held?.commit ?? null,
    byPath,
    records,
    folders,
    files: Object.keys(checkpoint?.shas ?? {}),
    letters: idLettersOf(idsConfig, repoName).letters,
    ids: idsAnswer(idsConfig) ?? records.some((r) => r.id !== undefined || r.cards?.some((c) => c.id !== null) === true),
    review: sanitizeReviewSettings(await readJson(store, vault, REVIEW_PATH)),
    version: ++versions,
  }
  if (held !== null) madeFrom.set(data, held)
  return data
}

/**
 * YAZ-5589: the data read last, for each phone's store (memory only). A screen that mounts starts from it, so a page
 * opened from a tab draws in the same frame as the tap; its own read follows, and keeps this same object when nothing
 * changed (no second draw).
 */
const held = new WeakMap<VaultStore, VaultData>()
export const heldVaultData = (store: VaultStore, vault: string): VaultData | null => {
  const data = held.get(store)
  return data !== undefined && data.vault === vault ? data : null
}
/**
 * The same vault's data (every part but `version`). YAZ-5596 (6): two data made from the SAME index object (the sync
 * engine's, which the screens share) have the same records: only the file list and the small settings are compared,
 * never the records serialised twice (about 2 x 1.9 MB in a big vault). Else every part is compared.
 */
export const sameVaultData = (a: VaultData, b: VaultData): boolean => {
  if (a.vault !== b.vault || a.commit !== b.commit || a.records.length !== b.records.length || a.files.length !== b.files.length) return false
  const index = madeFrom.get(a)
  if (index === undefined || index !== madeFrom.get(b)) return JSON.stringify([a.byPath, a.folders, a.files, a.letters, a.ids, a.review]) === JSON.stringify([b.byPath, b.folders, b.files, b.letters, b.ids, b.review])
  return a.files.every((f, i) => f === b.files[i]) && JSON.stringify([a.letters, a.ids, a.review]) === JSON.stringify([b.letters, b.ids, b.review])
}
/** `next`, or the held data when it is the same: the one object the screens share, and remembered. */
function hold(store: VaultStore, next: VaultData): VaultData {
  const last = heldVaultData(store, next.vault)
  const kept = last !== null && sameVaultData(last, next) ? last : next
  held.set(store, kept)
  return kept
}
/** The held data of `vault`, else read now (and held). */
export async function vaultDataFor(store: VaultStore, vault: string, repoName: string): Promise<VaultData> {
  return heldVaultData(store, vault) ?? hold(store, await loadVaultData(store, vault, repoName))
}

/** The open vault's data, kept current with each `changed` event of that vault; null while it loads or with no vault. */
export function useVaultData(): VaultData | null {
  const { services, vaultKey, vault } = useApp()
  const { store, sync } = services
  const [data, setData] = useState<VaultData | null>(() => (vaultKey === null ? null : heldVaultData(store, vaultKey)))
  const repoName = vault?.repo.split('/')[1] ?? ''
  useEffect(() => {
    setData((d) => (vaultKey !== null && d !== null && d.vault === vaultKey ? d : vaultKey === null ? null : heldVaultData(store, vaultKey)))
    if (vaultKey === null) return
    let live = true
    let generation = 0
    const load = (index?: PhoneIndex) => {
      const mine = ++generation
      void loadVaultData(store, vaultKey, repoName, index).then((next) => {
        const kept = hold(store, next)
        if (live && mine === generation) setData(kept)
      })
    }
    // YAZ-5596 (5): the index the sync engine holds, when it has it: no read of a copy of the stored index.
    load(sync.index?.(vaultKey) ?? undefined)
    const off = sync.subscribe((event) => {
      if (event.type === 'changed' && event.vault === vaultKey) load(event.index)
    })
    return () => {
      live = false
      off()
    }
  }, [store, sync, vaultKey, repoName])
  return data
}
