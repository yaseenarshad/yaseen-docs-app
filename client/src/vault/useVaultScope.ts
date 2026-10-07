import { useCallback, useEffect, useState } from 'react'
import { IDS_FILE } from '@shared/noteId'
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

type IdsAsk = NonNullable<IndexResponse['ask']>

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
  /** The vault's answer on IDs as its last snapshot said it (YAZ-2523 🔒 V5), and the switch; undefined until its index has loaded. */
  ids: { enabled: boolean | undefined; held: boolean; ask: IndexResponse['ask']; set: (enabled: boolean) => void } | undefined
  /** What a yes would write, while the box that asks is to show (🔒 V2); null once answered or closed. */
  idsAsk: IdsAsk | null
  saveIds: (enabled: boolean) => void
  closeIdsAsk: () => void
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
  // did not give. `enabled` is undefined while the vault has not answered, and `ask` is then what a
  // yes would write: the box that asks (🔒 V2). `held` says a note holds an ID, which is true only
  // while the vault uses IDs (a plain vault's records carry none). An answer, or Esc, closes the box
  // for that root: later snapshots still carry `ask` and must not reopen it. Leaving the vault forgets that.
  const [idsSnapshot, setIdsSnapshot] = useState<{ root: string | null; enabled: boolean | undefined; held: boolean; ask: IndexResponse['ask'] } | null>(null)
  const [idsAskClosed, setIdsAskClosed] = useState<string | null>(null)
  if (idsAskClosed !== null && idsAskClosed !== root) setIdsAskClosed(null)
  const vaultIds = idsSnapshot?.root === root ? idsSnapshot : null
  const onSnapshot = useCallback(
    (records: IndexRecord[], folders: IndexRecord[], ids: boolean, ask: IndexResponse['ask']) => {
      onIndexSnapshot(records, folders, ids)
      setIdsSnapshot({ root, enabled: ask === undefined ? ids : undefined, held: records.some((record) => record.id !== undefined), ask })
    },
    [root, onIndexSnapshot],
  )
  /** Save the vault's answer in its `ids.json` (🔒 V1), from the box or from Settings; the index refetches off the write. */
  const saveIds = (enabled: boolean): void => {
    if (root === null) return
    api.vaultConfig.write(root, IDS_FILE, { enabled }).then(() => setIdsAskClosed(root), (err: unknown) => notify(`Couldn't save this vault's answer: ${err instanceof Error ? err.message : String(err)}`, 'error'))
  }
  const closeIdsAsk = (): void => setIdsAskClosed(root)

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
    ids: vaultIds === null ? undefined : { ...vaultIds, set: saveIds },
    idsAsk: vaultIds?.ask !== undefined && idsAskClosed !== root ? vaultIds.ask : null,
    saveIds,
    closeIdsAsk,
    onSnapshot,
  }
}
