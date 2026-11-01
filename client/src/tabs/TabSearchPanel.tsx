/**
 * "Open tabs here…" (YAZ-3343 D22): the app's own search — `useSearchResults`, the search bar's
 * ranking over each vault's index and tree, drawn as the flat result list (`SearchResults`, the shortcut picker's) —
 * floating over the tab board beside one window's frame. It searches THAT window's vaults: a vault this window does
 * not show has its index read by the search itself (`api.index`), and its tree by the tree feed, only while the panel
 * is open; both go with it. A pick adds the file as a background tab of that window and keeps the panel open for more;
 * Esc closes it. Folders are not offered: a pick is a tab.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { WatchSource } from '../hooks/useWatch'
import { useLatestTrees } from '../lib/pageLabel'
import { fetchTree } from '../lib/treeFeed'
import { otherFiles } from '../lib/treeState'
import { SearchResults } from '../search/SearchResults'
import type { SearchCandidate } from '../search/searchCandidates'
import { useSearchResults, type SearchVault } from '../search/useSearchResults'
import { useResultKeys } from '../sidebar/hooks/useSidebarSearch'
import { SearchIcon } from '../views/view/icons'

/** A vault this window does not watch: its rows are read once on open and not followed. */
const NO_WATCH: WatchSource = { subscribe: () => () => undefined }
const NO_PINS: ReadonlySet<string> = new Set()

export interface TabSearchPanelProps {
  /** The target window's vaults. */
  roots: readonly string[]
  /** The frame's label: the panel says which window its picks go to. */
  label: string
  /** Where the panel stands, in the board's px (beside the frame), kept inside the board. */
  at: { left: number; top: number }
  /** This window's watch feed for a vault it shows; undefined for any other. */
  watchOf: (root: string) => WatchSource | undefined
  onPick: (path: string) => void
  onClose: () => void
}

export function TabSearchPanel({ roots, label, at, watchOf, onPick, onClose }: TabSearchPanelProps) {
  const [query, setQuery] = useState('')
  // The trees of the target's vaults: the other files (drawings, PDFs) are the tree's, as in the search bar.
  const trees = useLatestTrees(roots)
  useEffect(() => {
    for (const root of roots) fetchTree(root).catch(() => undefined)
  }, [roots])
  const vaults: SearchVault[] = useMemo(() => roots.map((root, i) => ({ root, watch: watchOf(root) ?? NO_WATCH, dirs: [], files: trees[i] === null || trees[i] === undefined ? [] : otherFiles(trees[i].tree) })), [roots, trees, watchOf])
  const all = useSearchResults(vaults, query, NO_PINS)
  const results = useMemo(() => all.filter((row) => row.kind === 'file'), [all])
  const pick = (hit: SearchCandidate): void => onPick(hit.path)
  const { sel, setSelected, onKeys } = useResultKeys(results, pick)
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else onKeys(e)
  }
  return (
    // The board reads every key and keeps every press: the panel keeps its own.
    <div className="taboverview__search" role="dialog" aria-label={`Open tabs in ${label}`} style={at} onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="taboverview__search-head">
        Open tabs in <b>{label}</b>
        <button type="button" className="taboverview__search-close" aria-label="Close search" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="sidebar__search">
        <SearchIcon />
        <input
          className="sidebar__search-input"
          type="text"
          autoFocus
          placeholder="Search to open a tab"
          aria-label="Search to open a tab"
          spellCheck={false} // names, not prose (YAZ-3748 B2)
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {query.trim() === '' ? null : results.length > 0 ? <SearchResults results={results} query={query} selected={sel} onSelect={setSelected} onActivate={pick} onRowContextMenu={(_hit, e) => e.preventDefault()} /> : <p className="sidebar__msg">No matches</p>}
    </div>
  )
}
