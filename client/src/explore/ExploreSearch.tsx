/**
 * A search layer of the explore stack (YAZ-2571): the input, its ranked rows (`exploreRows`) and a footer of keys.
 * With no text it lists the notes opened most recently (`exploreRecents`). The layer owns its query, highlight and
 * list scroll, so it reads the same when a child closes over it; the rows come from the stack's ONE candidate feed.
 * Each row: its file icon, its title with the matched part marked, its folder, and a text row's snippet.
 */
import { useVaultUnit } from '../vault/unitWord'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { basename, rootOfPath } from '@shared/types'
import { readNeedle } from '../links/completion'
import { relTo, dirname } from '../lib/paths'
import { marked } from '../search/marked'
import type { SearchCandidate } from '../search/searchCandidates'
import { FileIcon, NameEnding } from '../sidebar/FileIcon'
import { useResultKeys } from '../sidebar/hooks/useSidebarSearch'
import { FolderIcon } from '../views/view/icons'
import { exploreRows } from './exploreRows'
import { shownId, type IdsInSearch } from '../search/showIds'

/**
 * The stack's side of a search layer (round 3): the layer writes its rows here at each render, so the note layer
 * over it steps through them (‹ ›) without a render of the search. One object per search layer, held by the stack.
 */
export interface SearchLink {
  rows: readonly SearchCandidate[]
}

interface ExploreSearchProps {
  candidates: readonly SearchCandidate[]
  link: SearchLink
  /** The note over this layer that came from it (round 3): its path and its place in the rows. The row is marked and scrolled into view, so Esc returns to it. */
  markedRow: { path: string; at: number } | null
  /** The notes opened most recently, newest first: the list with no text. */
  recent: readonly string[]
  /** The window's vault roots: a recent row's folder is read against its vault. */
  roots: readonly string[]
  nameOf: (path: string) => string
  /** Enter or a click on a row: a note opens over this layer, with the row's place for ‹ ›; a folder or another file opens in a tab. */
  onOpen: (row: SearchCandidate, at: number) => void
  /** A right-click on a row (round 1, item 6): the note menu for it, at the pointer. */
  onRowMenu: (row: SearchCandidate, x: number, y: number) => void
  /** The vault's "Show IDs in search" for a row's path (YAZ-4940): Always, or only on a row found by its ID. */
  idsInSearch: (path: string) => IdsInSearch
  /** This layer is the top one: the input takes the caret. */
  active: boolean
}

export function ExploreSearch({ candidates, link, markedRow, recent, roots, nameOf, onOpen, onRowMenu, idsInSearch, active }: ExploreSearchProps) {
  const unit = useVaultUnit(roots[0] ?? null)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const typed = query.trim() !== ''
  const recentRows = useMemo(
    () =>
      recent.map((path): SearchCandidate => {
        const name = nameOf(path)
        const root = rootOfPath(roots, path)
        return { kind: 'file', name, lower: name.toLowerCase(), label: name, path, folder: root === null ? '' : relTo(root, dirname(path)) }
      }),
    [recent, roots, nameOf],
  )
  const rows = useMemo(() => (typed ? exploreRows(candidates, query) : recentRows), [candidates, query, typed, recentRows])
  const needle = useMemo(() => (typed ? readNeedle(query) : undefined), [query, typed])
  link.rows = rows
  const { sel, setSelected, onKeys } = useResultKeys(rows, (row) => onOpen(row, rows.indexOf(row)))
  const selectedRow = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: 'nearest' })
  }, [sel])
  // The note over this layer stepped (round 3): its row is the selected one, so Esc comes back to it.
  const markedPath = markedRow?.path ?? null
  const markedAt = markedRow?.at ?? -1
  useEffect(() => {
    if (markedPath === null) return
    const at = rows[markedAt]?.path === markedPath ? markedAt : rows.findIndex((r) => r.path === markedPath)
    if (at !== -1) setSelected(at)
  }, [markedPath, markedAt, rows, setSelected])
  // The caret, on show and again when a child closes: the Escape that closed it left the focus nowhere.
  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // ⌘↵ is the stack's (open in a tab): it goes up.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return
    onKeys(e)
  }

  return (
    <>
      <input
        ref={inputRef}
        className="explore__input"
        type="text"
        placeholder="Search the vault…"
        aria-label="Explore the vault"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setSelected(0)
        }}
        onKeyDown={onKeyDown}
      />
      <div className="explore__results">
        {!typed && rows.length > 0 && <div className="explore__group">Recent</div>}
        {rows.length === 0 ? (
          <p className="explore__empty">{typed ? 'No matches found' : unit('Type to search the vault. The notes you open show here.')}</p>
        ) : (
          <ul className="search-results" role="listbox" aria-label="Explore results">
            {rows.map((r, i) => {
              // The ID as a chip after the title (round 1, item 1), by the vault's rule (YAZ-4940); a row found by its ID loses the `ID — ` of its label, so the ID shows once.
              const id = shownId(r, idsInSearch(r.path))
              const label = id !== null && r.label.startsWith(`${id} — `) ? r.label.slice(id.length + 3) : r.label
              return (
              <li
                key={`${r.path}␟${r.name}`}
                ref={i === sel ? selectedRow : null}
                role="option"
                aria-selected={i === sel}
                aria-label={`Explore result ${r.label}${r.kind === 'dir' ? ', folder' : ''}`}
                className={`search-results__row${i === sel ? ' search-results__row--active' : ''}${r.kind === 'dir' ? ' search-results__row--dir' : ''}`}
                title={r.path}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSelected(i)
                  onOpen(r, i)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setSelected(i)
                  onRowMenu(r, e.clientX, e.clientY)
                }}
              >
                <span className="search-results__label">
                  <FileIcon path={r.path} folder={r.kind === 'dir'} />
                  {r.kind === 'dir' && <FolderIcon size={12} className="search-results__glyph" />}
                  {marked(label, needle)}
                  {r.kind === 'file' && <NameEnding path={r.path} />}
                  {/* The note's or folder's id, in an ID vault (YAZ-2571 round 1): small and muted after the title; a vault without IDs has none. */}
                  {id !== null && <span className="explore__id">{id}</span>}
                </span>
                {r.snippet !== undefined && <span className="explore__snippet">{marked(r.snippet, needle)}</span>}
                {r.folder !== '' && <span className="search-results__folder">{r.folder}</span>}
                {r.folder === '' && r.kind === 'file' && <span className="search-results__folder">{basename(r.path) === r.label ? '' : 'Vault root'}</span>}
              </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="explore__foot">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> select
        </span>
        <span>
          <kbd>↵</kbd> open
        </span>
        <span>
          <kbd>⌘↵</kbd> open in a tab
        </span>
        <span>
          <kbd>esc</kbd> back
        </span>
      </div>
    </>
  )
}
