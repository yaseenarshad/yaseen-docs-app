/**
 * A search layer of the explore stack (YAZ-2571): the input, its ranked rows (`exploreRows`) and a footer of keys.
 * With no text it lists two sections (YAZ-4945, `recentSections.ts`): the files you Opened and the files you Edited. The layer owns its query, highlight and
 * list scroll, so it reads the same when a child closes over it; the rows come from the stack's ONE candidate feed.
 * Each row: its file icon, its title with the matched part marked, its folder, and a text row's snippet. A card inside a
 * page (YAZ-5164): the card icon, its title, and its page where the folder stands.
 */
import { useVaultUnit } from '../vault/unitWord'
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { basename, rootOfPath } from '@shared/types'
import { readNeedle } from '../links/completion'
import { relTo, dirname } from '../lib/paths'
import { idNeedle, marked } from '../search/marked'
import type { SearchCandidate } from '../search/searchCandidates'
import { FileIcon, NameEnding } from '../sidebar/FileIcon'
import { useResultKeys } from '../sidebar/hooks/useSidebarSearch'
import { FolderIcon } from '../views/view/icons'
import { exploreRows } from './exploreRows'
import { shownId, type IdsInSearch } from '../search/showIds'
import { movedOpens, onExploreMove } from './exploreRecents'
import { ago, type RecentSections } from './recentSections'

/**
 * The stack's side of a search layer (round 3): the layer writes its rows here at each render, so the page layer
 * over it steps through them (‹ ›) without a render of the search. One object per search layer, held by the stack.
 */
export interface SearchLink {
  rows: readonly SearchCandidate[]
  /** The rows changed while a page from this search is open (YAZ-2571 bug): the stack draws that page's ‹ n/m › again. */
  changed?: () => void
}

interface ExploreSearchProps {
  candidates: readonly SearchCandidate[]
  link: SearchLink
  /** The page over this layer that came from it (round 3): its path and its place in the rows. The row is marked and scrolled into view, so Esc returns to it. */
  markedRow: { path: string; at: number } | null
  /**
   * The pages opened most recently, newest first: the list with no text. The layer keeps the list it showed when it
   * opened (YAZ-2571 bug: an open and a step put their page first, so the list moved under ‹ ›); a rename or a delete
   * still changes its row, and clearing the text reads the list again.
   */
  recent: RecentSections
  /** A file's own search row (its title and ID), when the index has it: a recent row reads as a result row does. */
  rowOf?: (path: string) => SearchCandidate | undefined
  /** The window's vault roots: a recent row's folder is read against its vault. */
  roots: readonly string[]
  nameOf: (path: string) => string
  /** Enter or a click on a row: a page opens over this layer, with the row's place for ‹ ›; a folder or another file opens in a tab. */
  onOpen: (row: SearchCandidate, at: number) => void
  /** ⌘↵ on the highlighted row (YAZ-4984): that row in a tab, and the stack closes. */
  onOpenInTab: (row: SearchCandidate) => void
  /** A right-click on a row (round 1, item 6): the page menu for it, at the pointer. */
  onRowMenu: (row: SearchCandidate, x: number, y: number) => void
  /** The vault's "Show IDs in search" for a row's path (YAZ-4940): Always, or only on a row found by its ID. */
  idsInSearch: (path: string) => IdsInSearch
  /** This layer is the top one: the input takes the caret. */
  active: boolean
}

/** A row's identity: its file, and its name (a text row of the same file is its own row). */
const rowKey = (row: SearchCandidate): string => `${row.path}␟${row.name}`

export function ExploreSearch({ candidates, link, markedRow, recent, rowOf, roots, nameOf, onOpen, onOpenInTab, onRowMenu, idsInSearch, active }: ExploreSearchProps) {
  const unit = useVaultUnit(roots[0] ?? null)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const typed = query.trim() !== ''
  const recentNow = useRef(recent)
  recentNow.current = recent
  const [shownRecent, setShownRecent] = useState(recent)
  useEffect(
    () =>
      onExploreMove((from, to) =>
        setShownRecent((prev) => {
          const opened = movedOpens(prev.opened, from, to)
          const edited = movedOpens(prev.edited, from, to)
          return opened === prev.opened && edited === prev.edited ? prev : { opened, edited }
        }),
      ),
    [],
  )
  /** Both sections as one list (↑ ↓ go through both), the Opened rows first; each row's time beside it. */
  const recentList = useMemo(() => [...shownRecent.opened, ...shownRecent.edited], [shownRecent])
  const recentRows = useMemo(
    () =>
      recentList.map(({ path }): SearchCandidate => {
        const own = rowOf?.(path)
        if (own !== undefined) return own
        const name = nameOf(path)
        const root = rootOfPath(roots, path)
        return { kind: 'file', name, lower: name.toLowerCase(), label: name, path, folder: root === null ? '' : relTo(root, dirname(path)) }
      }),
    [recentList, rowOf, roots, nameOf],
  )
  const now = Date.now()
  const rows = useMemo(() => (typed ? exploreRows(candidates, query) : recentRows), [candidates, query, typed, recentRows])
  const needle = useMemo(() => (typed ? readNeedle(query) : undefined), [query, typed])
  link.rows = rows
  // The stack read these rows in its render, before this one wrote them: a page over this search counts again (YAZ-2571 bug).
  const pageOver = useRef(false)
  pageOver.current = markedRow !== null
  const firstRows = useRef(true)
  useEffect(() => {
    if (firstRows.current) {
      firstRows.current = false
      return
    }
    if (pageOver.current) link.changed?.()
  }, [rows, link])
  // The highlight follows its row's page (YAZ-4990): a page added or deleted above it does not move it to another page.
  const { sel, setSelected, onKeys } = useResultKeys(rows, (row) => onOpen(row, rows.indexOf(row)), rowKey)
  const selectedRow = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: 'nearest' })
  }, [sel])
  // The page over this layer stepped (round 3): its row is the selected one, so Esc comes back to it.
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
    // ⌘↵ (YAZ-4984): the highlighted row in a tab, as the footer says (the same as ↵, then ⌘↵). With no row it goes up:
    // the stack opens the page under this search.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      const row = rows[sel]
      if (row === undefined || e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      onOpenInTab(row)
      return
    }
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
          // Back to no text: the pages opened most recently, as they are now.
          if (e.target.value.trim() === '' && typed) setShownRecent(recentNow.current)
          setQuery(e.target.value)
          setSelected(0)
        }}
        onKeyDown={onKeyDown}
      />
      <div className="explore__results">
        {rows.length === 0 ? (
          <p className="explore__empty">{typed ? 'No matches found' : unit('Type to search the vault. The pages you open show here.')}</p>
        ) : (
          <ul className="search-results" role="listbox" aria-label="Explore results">
            {rows.map((r, i) => {
              /** With no text: the section heading before its first row (Opened, Edited) and the row's time. */
              const opened = shownRecent.opened.length
              const heading = typed ? null : i === 0 && opened > 0 ? 'Opened' : i === opened ? 'Edited' : null
              const at = typed ? undefined : recentList[i]?.at
              // The ID as a chip after the title (round 1, item 1), by the vault's rule (YAZ-4940); a row found by its ID loses the `ID — ` of its label, so the ID shows once.
              const id = shownId(r, idsInSearch(r.path))
              const label = id !== null && r.label.startsWith(`${id} — `) ? r.label.slice(id.length + 3) : r.label
              return (
              <Fragment key={`${r.path}␟${r.name}`}>
              {heading !== null && (
                <li role="presentation" className="explore__group">
                  {heading}
                </li>
              )}
              <li
                ref={i === sel ? selectedRow : null}
                role="option"
                aria-selected={i === sel}
                aria-label={`Explore result ${r.label}${r.kind === 'dir' ? ', folder' : ''}`}
                className={`search-results__row${i === sel ? ' search-results__row--active' : ''}${r.kind === 'dir' ? ' search-results__row--dir' : ''}${at !== undefined ? ' explore__row--timed' : ''}`}
                title={r.page ?? r.path}
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
                  {/* The name is cut with "…" on its own, so a long one never hides the ID after it (round 5). */}
                  <span className="explore__name">
                    <FileIcon path={r.path} folder={r.kind === 'dir'} card={r.card === true} />
                    {r.kind === 'dir' && <FolderIcon size={12} className="search-results__glyph" />}
                    {marked(label, needle)}
                    {r.kind === 'file' && r.page === undefined && <NameEnding path={r.path} />}
                  </span>
                  {/* The page's or folder's id, in an ID vault (YAZ-2571 round 1): small and muted after the title; a vault without IDs has none. Found by its ID, the matched digits are marked (round 5). */}
                  {id !== null && <span className="explore__id">{marked(id, idNeedle(r, query))}</span>}
                </span>
                {r.snippet !== undefined && <span className="explore__snippet">{marked(r.snippet, needle)}</span>}
                {/* A card inside a page (YAZ-5164): its page, quietly, where a page's folder stands. */}
                {r.page !== undefined && <span className="search-results__folder">{rowOf?.(r.page)?.label ?? nameOf(r.page)}</span>}
                {r.page === undefined && r.folder !== '' && <span className="search-results__folder">{r.folder}</span>}
                {r.page === undefined && r.folder === '' && r.kind === 'file' && <span className="search-results__folder">{basename(r.path) === r.label ? '' : 'Vault root'}</span>}
                {at !== undefined && <span className="explore__time">{ago(at, now)}</span>}
              </li>
              </Fragment>
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
