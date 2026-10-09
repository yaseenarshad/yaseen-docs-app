import { useCallback, useEffect, useState } from 'react'
import { IDS_FILE, idsLetters } from '@shared/noteId'
import type { IndexRecord, IndexResponse, PropertiesResponse } from '@shared/types'
import { api } from '../api'
import { createViewOnlyLinkSource, type MutableViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import { createWikilinkCandidateSource, type MutableWikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { useGithubSync, type GithubSyncState } from '../hooks/useGithubSync'
import { useWatch, type WatchSource } from '../hooks/useWatch'
import type { NoticeKind } from '../lib/notice'
import { attentionCopy, type AttentionCopy } from '../lib/syncAttention'
import { useVaultName } from '../lib/useVaultName'
import { useExternalRenames, type ExternalRenames } from '../links/useExternalRenames'
import { useReview, type ReviewApi } from '../review/useReview'
import { useReviewSettings, type ReviewSettingsState } from '../review/useReviewSettings'
import { useProperties } from '../views/useProperties'

/**
 * Everything the window holds ONCE PER VAULT (YAZ-2602 D1): a note's links, properties, sync,
 * review and IDs come from the vault that holds it, whichever tab is in front. `App` owns one per
 * slot (`vault/slots.ts`) and every one stays loaded, so a tab switch between two vaults costs
 * what a switch inside one vault costs.
 */
export interface VaultScope {
  /** The vault of this slot; null for a slot that holds none, and everything below is then idle. */
  root: string | null
  watch: WatchSource
  /** The stable source every editor of this vault subscribes to; its `WikilinkIndexBridge` keeps it fed. */
  wikilinks: MutableWikilinkResolveSource
  wikilinkCandidates: MutableWikilinkCandidateSource
  viewOnlyLinks: MutableViewOnlyLinkSource
  /** The vault's property DECLARATIONS (YAZ-835). */
  properties: PropertiesResponse | null
  sync: GithubSyncState
  /** The words of the sync attention banner; null with nothing to say, and once this problem was dismissed. */
  syncBanner: AttentionCopy | null
  dismissSync: () => void
  /** What the app calls the vault (YAZ-1974 D4); null for a slot with none. */
  name: string | null
  reviewSettings: ReviewSettingsState
  review: ReviewApi
  renames: ExternalRenames
  /**
   * The vault's IDs as its last snapshot said them (YAZ-2523 🔒 V5), its ID letters as its `ids.json`
   * holds them now, and the switch (YAZ-2677 🔒 D2); undefined until its index has loaded.
   */
  ids: { enabled: boolean; held: boolean; ask: IndexResponse['ask']; letters: () => Promise<string | undefined>; set: (enabled: boolean, letters?: string) => void } | undefined
  /** Every READY index snapshot of this vault, from its `WikilinkIndexBridge`. */
  onSnapshot: (records: IndexRecord[], folders: IndexRecord[], ids: boolean, ask: IndexResponse['ask']) => void
}

/** `root` is nullable because `App` calls this for every slot: with no vault there is no bridge call. */
export function useVaultScope(root: string | null, notify: (text: string, icon?: NoticeKind) => void): VaultScope {
  const watch = useWatch(root)
  // Wikilinks (Links A, GRO-2190): ONE resolve source per vault — a stable object every editor's
  // wikilink plugin subscribes to; the vault's WikilinkIndexBridge keeps it fed from the vault
  // index, so index changes restyle links live without any editor remounting. The stable
  // navigation-only source beside it is tree-derived; only the picker's rows compose both feeds.
  const [wikilinks] = useState(createWikilinkResolveSource)
  const [wikilinkCandidates] = useState(createWikilinkCandidateSource)
  const [viewOnlyLinks] = useState(createViewOnlyLinkSource)
  // A vault that left the window unloads: its index and its file catalog leave the slot's sources
  // with it. A vault that takes the slot is cleared by its own WikilinkIndexBridge.
  useEffect(() => {
    if (root !== null) return
    wikilinks.update(null)
    viewOnlyLinks.reset()
    wikilinkCandidates.update([])
  }, [root, wikilinks, viewOnlyLinks, wikilinkCandidates])
  // The vault's property DECLARATIONS (YAZ-835), owned here for the same reason `wikilinks` is:
  // ONE per vault, threaded down rather than re-fetched per surface. It is the editor ladder's
  // rung 2 inside a folder's views (YAZ-846) — Editor → FolderView.
  const { properties } = useProperties(root)
  // GitHub sync (YAZ-1081 3A/3B), owned here for the same reason: ONE per vault. Two surfaces
  // read it — the editor's chip (every mounted tab) and the settings cog's section — and they
  // must never disagree, which two hooks watching the same root eventually would.
  const sync = useGithubSync(root)
  // The attention banner (3B): passive, exactly like the external-rename one — `role="status"`,
  // explicit buttons, never a modal. Sync failing is not worth stealing focus over; the vault
  // still works, and the note in front of the user is untouched.
  //
  // Dismissal is per-PROBLEM, not per-session: it resets on ANY transition of state or reason,
  // so a retry that fails again — or a different failure — says so rather than staying silent
  // because the user waved off an earlier one.
  const [syncDismissed, setSyncDismissed] = useState(false)
  const syncState = sync.status?.state ?? null
  const syncReason = sync.status?.attention ?? null
  useEffect(() => {
    setSyncDismissed(false)
  }, [syncState, syncReason])
  const syncCopy = sync.status === null ? null : attentionCopy(sync.status)
  const dismissSync = useCallback(() => setSyncDismissed(true), [])
  const name = useVaultName(root)
  const reviewSettings = useReviewSettings(root, notify)
  // Upkeep review (YAZ-2322): the Inbox count and the vault's review session, read off the SAME
  // index source the wikilinks use. The window shows one session at a time; `App` sees to that.
  const review = useReview(root, wikilinks, reviewSettings.settings, notify)

  // External rename/move resilience (Links E1c, GRO-2242 — locked: confirm-first, NEVER
  // automatic, never a dialog): ONE detector per vault, fed by the cold-start reconcile diff and
  // by consecutive index snapshots (`onSnapshot` below).
  const renames = useExternalRenames(root, notify)
  const onIndexSnapshot = renames.onSnapshot

  // The vault's answer on IDs as the last snapshot said it (YAZ-2523 🔒 V5), with the root it is of:
  // one of another vault says nothing here, so the Settings switch never shows an answer this vault
  // did not give. `enabled` is the snapshot's `ids`: no answer reads as no, and nothing asks when a
  // vault opens (YAZ-2677 🔒 D1). `ask` is what a yes would write, while the answer is not yes: the
  // counts of the box in Settings (🔒 D2). `held` says a note holds an ID, which is true only while
  // the vault uses IDs (a plain vault's records carry none).
  const [idsSnapshot, setIdsSnapshot] = useState<{ root: string | null; enabled: boolean; held: boolean; ask: IndexResponse['ask'] } | null>(null)
  const vaultIds = idsSnapshot?.root === root ? idsSnapshot : null
  const onSnapshot = useCallback(
    (records: IndexRecord[], folders: IndexRecord[], ids: boolean, ask: IndexResponse['ask']) => {
      onIndexSnapshot(records, folders, ids)
      setIdsSnapshot({ root, enabled: ids, held: records.some((record) => record.id !== undefined), ask })
    },
    [root, onIndexSnapshot],
  )
  const said = (err: unknown): string => (err instanceof Error ? err.message : String(err))
  /** The keys of the vault's `ids.json` as they are on disk now; a missing file has none. Rejects on a file that is not valid JSON. */
  const readIds = (vault: string): Promise<Record<string, unknown>> => api.vaultConfig.read(vault, IDS_FILE).then((config) => (typeof config === 'object' && config !== null && !Array.isArray(config) ? (config as Record<string, unknown>) : {}))
  /**
   * Save the vault's answer in its `ids.json` (🔒 V1), from Settings, and with a yes its ID letters
   * (YAZ-2677 🔒 D2); the index refetches off the write. Each key that the save does not change
   * stays (R10, R12): `letters` and `was` are read off the disk first. A file that cannot be read
   * is not written over.
   */
  const saveIds = (enabled: boolean, letters?: string): void => {
    if (root === null) return
    readIds(root)
      .then((config) => api.vaultConfig.write(root, IDS_FILE, { ...config, enabled, ...(letters !== undefined && { letters }) }))
      .catch((err: unknown) => notify(`Couldn't save this vault's answer: ${said(err)}`, 'error'))
  }
  /** The vault's ID letters, read when Settings asks (S9). A file that cannot be read is said in the notice, and the caller opens no box. */
  const readLetters = (): Promise<string | undefined> =>
    root === null
      ? Promise.resolve(undefined)
      : readIds(root).then(idsLetters, (err: unknown) => {
          notify(`Couldn't read this vault's ID settings: ${said(err)}`, 'error')
          throw err
        })

  return {
    root,
    watch,
    wikilinks,
    wikilinkCandidates,
    viewOnlyLinks,
    properties,
    sync,
    syncBanner: syncDismissed ? null : syncCopy,
    dismissSync,
    name,
    reviewSettings,
    review,
    renames,
    ids: vaultIds === null ? undefined : { enabled: vaultIds.enabled, held: vaultIds.held, ask: vaultIds.ask, letters: readLetters, set: saveIds },
    onSnapshot,
  }
}
