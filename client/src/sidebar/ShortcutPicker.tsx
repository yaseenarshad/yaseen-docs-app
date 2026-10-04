/**
 * "Add note shortcut" (YAZ-2290 D2): pick ONE note to also appear in a folder. Not a second
 * search — the search bar's own candidates, matcher and result list (`searchCandidates`,
 * `searchTitles`, `SearchResults`) inside the confirm sheet's shell, so it ranks like the bar and
 * closes like a sheet. Notes only (the index holds nothing else), and none the folder already
 * shows: one living there or already a shortcut there has nothing to add.
 *
 * The input keeps focus, as the bar's does: type to filter, ↑/↓ move the highlight (clamped, never
 * wrapping), ⏎ picks it, Esc or a click away closes. An empty query lists the first `SEARCH_CAP`.
 */
import { useMemo, useState, type KeyboardEvent } from 'react'
import { useIndexFeed } from '../editor/wikilink/useIndexFeed'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { folderRows } from '../links/shortcuts'
import { SearchResults } from '../search/SearchResults'
import { searchCandidates, searchTitles } from '../search/searchCandidates'
import { SearchIcon } from '../views/view/icons'
import { useResultKeys } from './hooks/useSidebarSearch'

interface ShortcutPickerProps {
  /** The folder the shortcut is for, as the index names it: root-relative. */
  folder: string
  /** The window's index source — the Sidebar's own, no second feed; the list follows it while the picker is open. */
  source: WikilinkResolveSource
  /** The chosen note's path; the caller writes the shortcut and closes the picker. */
  onPick: (path: string) => void
  onClose: () => void
}

export function ShortcutPicker({ folder, source, onPick, onClose }: ShortcutPickerProps) {
  const { records, folders } = useIndexFeed(source)
  const [query, setQuery] = useState('')
  const candidates = useMemo(() => {
    const shown = new Set(folderRows(records, folders, folder))
    return searchCandidates(records.filter((record) => !shown.has(record)))
  }, [records, folders, folder])
  const results = useMemo(() => searchTitles(candidates, query), [candidates, query])
  const { sel, setSelected, onKeys } = useResultKeys(results, (hit) => onPick(hit.path))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else onKeys(e)
  }

  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div className="confirm shortcut-picker" role="dialog" aria-modal="true" aria-label="Add note shortcut" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sidebar__search">
          <SearchIcon />
          <input
            className="sidebar__search-input"
            type="text"
            autoFocus
            placeholder="Add note shortcut"
            aria-label="Find a note"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0) // a new query is a new ranking: the top row is the selection again
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {results.length > 0 ? (
          <SearchResults results={results} selected={sel} onSelect={setSelected} onActivate={(hit) => onPick(hit.path)} onRowContextMenu={(_hit, e) => e.preventDefault()} />
        ) : (
          <p className="sidebar__msg">No matches</p>
        )}
      </div>
    </div>
  )
}
