/**
 * Owns the window's two deliberately separate wikilink feeds. Ready index snapshots replace the
 * stable semantic source's resolver/records and contribute Markdown picker rows. A Files-tree
 * catalog independently replaces the stable navigation-only source and contributes text/PDF rows;
 * it never enters the semantic source. The tree's FOLDERS do (YAZ-2290 D10): a link no notecard
 * answers resolves to the folder of that name, and the picker offers it. A root switch
 * synchronously retires the old catalog and the composed picker rows before either new feed can
 * resolve, preventing cross-vault composition while every subscribed editor keeps the same
 * source-object identities.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { IndexRecord } from '@shared/types'
import { useIndex } from '../../views/useIndex'
import type { WatchSource } from '../../hooks/useWatch'
import { useViewOnlyCatalog } from '../../hooks/useViewOnlyCatalog'
import { onTree } from '../../lib/treeFeed'
import { linkCandidates, mergeLinkCandidates, type LinkCandidate } from '../../links/completion'
import { folderLinkCandidates, linkResolver, vaultDirs } from '../../links/folderLinks'
import type { MutableWikilinkCandidateSource } from './wikilinkPicker'
import type { MutableWikilinkResolveSource } from './wikilinkPlugin'
import type { MutableViewOnlyLinkSource } from './viewOnlyLinkSource'

const NO_ROWS: readonly LinkCandidate[] = []

export interface WikilinkIndexBridgeProps {
  root: string
  watch: WatchSource
  source: MutableWikilinkResolveSource
  /** The `[[` picker's composed Markdown + view-only candidates (GRO-2191/YAZ-1310). */
  candidates?: MutableWikilinkCandidateSource
  /** Separate navigation-only catalog. Omitted mounts retain the semantic-only behavior. */
  viewOnly?: MutableViewOnlyLinkSource
  /**
   * Every READY snapshot, verbatim (Links E1c, GRO-2242): the external-rename detector diffs
   * consecutive snapshots — this component already sees them all, so no second `useIndex`
   * (which would double every fetch). Keep the identity stable (App's hook does).
   */
  onSnapshot?: (records: IndexRecord[], folders: IndexRecord[]) => void
}

export function WikilinkIndexBridge({ root, watch, source, candidates, viewOnly, onSnapshot }: WikilinkIndexBridgeProps) {
  const { status, records, folders } = useIndex(root, watch)
  // The folders a link can name (YAZ-2290 D10) come off the window's one tree feed. Read as ONE
  // string, so a tree that moved no folder wakes no editor (YAZ-2196).
  const dirList = useSyncExternalStore(
    useCallback((poke: () => void) => onTree(root, poke), [root]),
    () => vaultDirs(root).join('\n'),
  )
  const renderedRoot = useRef(root)
  const rootChanged = renderedRoot.current !== root
  useLayoutEffect(() => {
    renderedRoot.current = root
    if (viewOnly === undefined) return
    // Root identity changes synchronously retire the old vault's navigation catalog and every
    // merged row. New semantic/catalog snapshots may then arrive in either order without ever
    // composing across vaults; the stable source objects themselves are deliberately retained.
    viewOnly.reset()
    candidates?.update([])
  }, [root, candidates, viewOnly])
  // Only a READY snapshot feeds the sources: while the first fetch is pending (or a refetch
  // failed) links keep rendering with the previous resolver — or, before any index has ever
  // loaded, as resolved (source.resolve null) — never flashing everything unresolved.
  const ready = !rootChanged && status === 'ready'
  // ONE resolver per snapshot and folder list, and the semantic picker rows it names: the
  // notecards, then the folders — after them, so a notecard wins an equal match (D10).
  const semantic = useMemo(() => {
    if (!ready) return null
    const dirs = dirList === '' ? [] : dirList.split('\n')
    const resolve = linkResolver(records, root, dirs, folders)
    return { resolve, rows: [...linkCandidates(records), ...folderLinkCandidates(root, dirs, resolve)] }
  }, [ready, records, folders, root, dirList])
  useEffect(() => {
    if (semantic === null) return
    // The snapshot rides ALONG with the resolver (Links D, GRO-2193): the backlinks section
    // reads both off the same source, so N and the resolution behind it always agree.
    source.update(semantic.resolve, records, folders)
    candidates?.update(mergeLinkCandidates(semantic.rows, viewOnly?.catalog?.candidates ?? []))
  }, [semantic, records, folders, source, candidates, viewOnly])
  // Its own effect: a folder list that moved re-feeds the sources above, and is no index snapshot.
  useEffect(() => {
    if (ready) onSnapshot?.(records, folders)
  }, [ready, records, folders, onSnapshot])
  return viewOnly === undefined ? null : (
    <ViewOnlyCatalogBridge
      root={root}
      watch={watch}
      semantic={semantic?.rows ?? NO_ROWS}
      candidates={candidates}
      viewOnly={viewOnly}
    />
  )
}

function ViewOnlyCatalogBridge({ root, watch, semantic, candidates, viewOnly }: {
  root: string
  watch: WatchSource
  semantic: readonly LinkCandidate[]
  candidates?: MutableWikilinkCandidateSource
  viewOnly: MutableViewOnlyLinkSource
}): null {
  const state = useViewOnlyCatalog(root, watch)
  useEffect(() => {
    if (state.status !== 'ready' || state.catalog.root !== root) return
    viewOnly.update(state.catalog)
  }, [state.status, state.catalog, root, viewOnly])
  // The picker rows follow BOTH feeds; the catalog wake-up above follows only the catalog. Tied to
  // the semantic rows too, it re-decorated every open editor a second time per save (YAZ-2196).
  useEffect(() => {
    if (state.status !== 'ready' || state.catalog.root !== root) return
    candidates?.update(mergeLinkCandidates(semantic, state.catalog.candidates))
  }, [state.status, state.catalog, root, semantic, candidates])
  return null
}
