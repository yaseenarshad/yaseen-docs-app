/** The persistent search bar (YAZ-739 A-, YAZ-801/803): its query, the ranked results, the keyboard's highlighted row and ⌘K's focus handshake. */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { WatchSource } from '../../hooks/useWatch'
import type { PathTitles } from '../../lib/pageLabel'
import type { SearchCandidate } from '../../search/searchCandidates'
import { useSearchResults } from '../../search/useSearchResults'

/**
 * A result list driven from its input (YAZ-803), shared by the search bar and the shortcut picker:
 * the highlighted row and the keys that move and activate it. Every reader clamps, since an index
 * refresh can shrink the list under the keyboard's index (YAZ-808); ↑/↓ stop at both ends, never
 * wrapping — the `[[` picker's rule.
 */
export function useResultKeys<T>(results: readonly T[], activate: (hit: T, e: KeyboardEvent) => void) {
  const [selected, setSelected] = useState(0)
  const sel = Math.max(0, Math.min(selected, results.length - 1))
  const onKeys = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (results.length === 0) return
    if (e.key === 'ArrowDown') setSelected(Math.min(sel + 1, results.length - 1))
    else if (e.key === 'ArrowUp') setSelected(Math.max(sel - 1, 0))
    else if (e.key === 'Enter') activate(results[sel], e)
    else return
    e.preventDefault()
  }
  return { sel, setSelected, onKeys }
}

export function useSidebarSearch(
  root: string,
  watch: WatchSource,
  dirs: string[],
  titles: PathTitles,
  pendingSearchFocus: boolean,
  onSearchFocusHandled: () => void,
  activate: (hit: SearchCandidate, background: boolean) => void,
) {
  // The persistent search bar's query (YAZ-801). It lives HERE rather than in the bar because
  // YAZ-803 swaps the BODY while it is non-empty; Sidebar is mounted `key={root}`, so it resets
  // on unmount and on a root switch without any clearing code.
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const results = useSearchResults(root, watch, query, dirs, titles)
  // The bar keeps focus while the list is driven from it (YAZ-803). Opening leaves the list up.
  const { sel, setSelected, onKeys } = useResultKeys(results, (hit, e) => activate(hit, e.metaKey))
  // 🔒 flat-list ruling on YAZ-739: while a query is typed the body shows a FLAT ranked list
  // instead of the tree. A conditional render, not a teardown — every bit of tree state (data,
  // expansion, pending create/rename, drag) lives in the Sidebar's other hooks (useVaultTree,
  // rowGestures) and is waiting untouched when it clears.
  const searching = query.trim() !== ''

  // ⌘K's focus handshake (YAZ-801). Firing on MOUNT is deliberate, not a side effect to guard
  // against: ⌘K with the sidebar collapsed un-collapses it, so the sidebar mounts with the flag
  // already true (0- re-scope on YAZ-800). A plain remount with the flag false focuses nothing.
  useEffect(() => {
    if (!pendingSearchFocus) return
    searchInput.current?.focus()
    onSearchFocusHandled()
  }, [pendingSearchFocus, onSearchFocusHandled])

  const changeQuery = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setSelected(0) // a new query is a new ranking: the top row is the selection again
  }

  const searchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      // Esc empties a typed query first and only gives up focus on the second press.
      if (query !== '') setQuery('')
      else e.currentTarget.blur()
    } else onKeys(e)
  }

  return { query, setQuery, searchInput, results, searching, sel, setSelected, changeQuery, searchKeyDown }
}
