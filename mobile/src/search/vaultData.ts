import { useEffect, useState } from 'react'
import { IDS_FILE, idLettersOf, idsAnswer } from '@shared/pageId'
import { REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import { useApp } from '../app/AppState'
import type { VaultStore } from '../store'
import type { PhoneIndex } from '../sync/phoneIndex'

/**
 * WHAT SEARCH AND THE READER KNOW OF THE OPEN VAULT (YAZ-5079), from the phone's storage only, so both work with no
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

async function readJson(store: VaultStore, vault: string, path: string): Promise<unknown> {
  const file = await store.read(vault, path)
  if (file === null) return undefined
  try {
    return JSON.parse(typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content))
  } catch {
    return undefined
  }
}

let versions = 0

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
  return {
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
}

/** The open vault's data, kept current with each `changed` event of that vault; null while it loads or with no vault. */
export function useVaultData(): VaultData | null {
  const { services, vaultKey, vault } = useApp()
  const { store, sync } = services
  const [data, setData] = useState<VaultData | null>(null)
  const repoName = vault?.repo.split('/')[1] ?? ''
  useEffect(() => {
    setData(null)
    if (vaultKey === null) return
    let live = true
    let generation = 0
    const load = (index?: PhoneIndex) => {
      const mine = ++generation
      void loadVaultData(store, vaultKey, repoName, index).then((next) => {
        if (live && mine === generation) setData(next)
      })
    }
    load()
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
