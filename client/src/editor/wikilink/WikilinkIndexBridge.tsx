/**
 * Feeds the vault index into the wikilink resolve source (Links A, GRO-2190) and the `[[`
 * picker's candidate source (Links B, GRO-2191). App renders it ONCE per window inside the
 * workspace (so `root` is always a real folder) — cheaper than a per-editor `useIndex` now
 * that every visited tab keeps its editor mounted. Each ready index snapshot swaps a memoized
 * resolver (`resolverFor`: same records array identity → same resolver) into the resolve
 * source and the snapshot's `linkCandidates` (shortest unambiguous names) into the candidate
 * source; both pokes make every subscribed editor recompute (decorations / picker rows). The
 * editors never remount on index changes: the source OBJECTS stay stable, only their contents
 * are replaced.
 */
import { useEffect } from 'react'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../../bases/engine'
import { useIndex } from '../../bases/useIndex'
import type { WatchSource } from '../../hooks/useWatch'
import { linkCandidates } from '../../links/completion'
import type { MutableWikilinkCandidateSource } from './wikilinkPicker'
import type { MutableWikilinkResolveSource } from './wikilinkPlugin'

export interface WikilinkIndexBridgeProps {
  root: string
  watch: WatchSource
  source: MutableWikilinkResolveSource
  /** The `[[` picker's candidate names (GRO-2191), fed from the same ready snapshots. */
  candidates?: MutableWikilinkCandidateSource
  /**
   * Every READY snapshot, verbatim (Links E1c, GRO-2242): the external-rename detector diffs
   * consecutive snapshots — this component already sees them all, so no second `useIndex`
   * (which would double every fetch). Keep the identity stable (App's hook does).
   */
  onSnapshot?: (records: IndexRecord[]) => void
}

export function WikilinkIndexBridge({ root, watch, source, candidates, onSnapshot }: WikilinkIndexBridgeProps): null {
  const { status, records } = useIndex(root, watch)
  useEffect(() => {
    // Only a READY snapshot feeds the sources: while the first fetch is pending (or a refetch
    // failed) links keep rendering with the previous resolver — or, before any index has ever
    // loaded, as resolved (source.resolve null) — never flashing everything unresolved.
    if (status !== 'ready') return
    const resolve = resolverFor(records, root)
    source.update((target) => resolve(target)?.record.path ?? null)
    candidates?.update(linkCandidates(records))
    onSnapshot?.(records)
  }, [status, records, root, source, candidates, onSnapshot])
  return null
}
