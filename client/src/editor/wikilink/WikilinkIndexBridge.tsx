/**
 * Feeds the vault index into the wikilink resolve source (Links A, GRO-2190). App renders it
 * ONCE per window inside the workspace (so `root` is always a real folder) — cheaper than a
 * per-editor `useIndex` now that every visited tab keeps its editor mounted. Each ready index
 * snapshot swaps a memoized resolver (`resolverFor`: same records array identity → same
 * resolver) into the source, which pokes every subscribed editor to recompute its decorations.
 * The editors never remount on index changes: the source OBJECT stays stable, only its
 * `resolve` function is replaced.
 */
import { useEffect } from 'react'
import { resolverFor } from '../../bases/engine'
import { useIndex } from '../../bases/useIndex'
import type { WatchSource } from '../../hooks/useWatch'
import type { MutableWikilinkResolveSource } from './wikilinkPlugin'

export interface WikilinkIndexBridgeProps {
  root: string
  watch: WatchSource
  source: MutableWikilinkResolveSource
}

export function WikilinkIndexBridge({ root, watch, source }: WikilinkIndexBridgeProps): null {
  const { status, records } = useIndex(root, watch)
  useEffect(() => {
    // Only a READY snapshot feeds the source: while the first fetch is pending (or a refetch
    // failed) links keep rendering with the previous resolver — or, before any index has ever
    // loaded, as resolved (source.resolve null) — never flashing everything unresolved.
    if (status !== 'ready') return
    const resolve = resolverFor(records, root)
    source.update((target) => resolve(target)?.record.path ?? null)
  }, [status, records, root, source])
  return null
}
