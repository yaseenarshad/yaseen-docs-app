/**
 * Focus and Favorites of the window's vaults, held by App (YAZ-3264 D1): the sidebar unmounts when
 * it is hidden, and the tab menu toggles both lists then too. One hook for the window, read once
 * per vault when it joins and dropped when it leaves (the sidebar's `useVaultTree` did this
 * before); the sidebar and the tab menu reach the SAME lists, through the one writer (6C).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_FOCUS, rootOfPath } from '@shared/types'
import { api } from '../api'
import type { NoticeKind, NoticeType } from '../lib/notice'
import { storage } from '../lib/storage'
import { favoriteOrder } from '../lib/treeState'

export const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The two lists a vault keeps IN the vault, each with one namespace on the bridge that has the same
 * three calls (`get`, `set`, `onChanged`): Favorites (`.yaseendocs/favorites.json`, YAZ-1766 D11)
 * and focus (`.yaseendocs/focus.<mac id>.json`, YAZ-2702 Decisions 1 and 2).
 */
type ListKind = 'favorites' | 'focus'
type ListsByRoot = Readonly<Record<string, readonly string[]>>
/** Each kind's order ACROSS the vaults of a window, in the store (YAZ-2631 D1; focus: YAZ-2702 Decision 3). */
const ORDER: Record<ListKind, { get: () => string[]; set: (roots: readonly string[], paths: readonly string[]) => void }> = {
  favorites: { get: () => storage.getFavoritesOrder(), set: (roots, paths) => storage.setFavoritesOrder(roots, paths) },
  focus: { get: () => storage.getFocusOrder(), set: (roots, paths) => storage.setFocusOrder(roots, paths) },
}

/** One kind's lists as the callbacks reach them: the same object for the life of the window. */
interface VaultLists {
  kind: ListKind
  /** The lists as the last render had them. A vault has an entry once this window has READ its list, an empty one too (YAZ-2631 R25). */
  held: { readonly current: ListsByRoot }
  /** Read one vault's list; the answer for a vault that left the window meanwhile is dropped. */
  load(vault: string): void
  /** The vault left the window: its list leaves this window. Nothing is written — the list is the vault's (YAZ-2702 S9). */
  drop(vault: string): void
  /**
   * The ONE writer (6C), of one vault's list: optimistic, then main writes that vault's file; a
   * refusal (a malformed favorites.json → INVALID_CONFIG, D12; a focus file that cannot be written,
   * YAZ-2702 S14) puts the list back and toasts. Main drops dead entries on the way (D14; focus: R7).
   */
  save(vault: string, next: readonly string[]): void
}

/**
 * One kind of vault list for the vaults of the window (YAZ-1766 6A/6C; focus by the same rule since
 * YAZ-2702): each vault's paths in the user's order, read from ITS file through main (absolute
 * paths) and kept by its root. `useVaultListsHere` reads each vault once, when it joins; every
 * `<kind>:changed` for a vault of the window reads it again (YAZ-2602 S27; focus: S7, S12) — an own
 * write's echo, another window's, or a file that a sync brought. So two windows on one vault, and
 * two Macs, show one list.
 */
function useVaultLists(kind: ListKind, live: { readonly current: { roots: readonly string[] } }, onNotice: (message: string, kind?: NoticeKind, type?: NoticeType) => void): [ListsByRoot, VaultLists] {
  const [byRoot, setByRoot] = useState<ListsByRoot>({})
  const held = useRef(byRoot)
  held.current = byRoot
  const notice = useRef(onNotice)
  notice.current = onNotice
  const lists = useMemo<VaultLists>(
    () => ({
      kind,
      held,
      load(vault) {
        void api[kind].get(vault).then((next) => {
          if (live.current.roots.includes(vault)) setByRoot((prev) => (prev[vault] !== undefined && sameList(prev[vault], next) ? prev : { ...prev, [vault]: next }))
        })
      },
      drop: (vault) => setByRoot(({ [vault]: _left, ...rest }) => rest),
      save(vault, next) {
        const prev = held.current[vault] ?? []
        setByRoot((all) => ({ ...all, [vault]: next }))
        api[kind].set(vault, next).catch((err: unknown) => {
          // Only for a vault still in the window: one that left must not come back with a list this window did not read (YAZ-2702 S6).
          if (live.current.roots.includes(vault)) setByRoot((all) => ({ ...all, [vault]: prev }))
          notice.current(`Can't save ${kind}: ${err instanceof Error ? err.message : String(err)}`, 'error')
        })
      },
    }),
    [kind, live],
  )
  useEffect(
    () =>
      api[kind].onChanged((c) => {
        if (live.current.roots.includes(c.root)) lists.load(c.root)
      }),
    [kind, live, lists],
  )
  return [byRoot, lists]
}

/** A path's place in the two lists, as a menu reads it when it opens (YAZ-3264 D2). */
export interface ListState {
  focus: boolean
  favorite: boolean
}

export type VaultListsHere = ReturnType<typeof useVaultListsHere>

/**
 * The window's Focus and Favorites (YAZ-3264 D1), for the window's vaults `roots` in the window's
 * order. App calls it once and hands it to the sidebar (`useVaultTree`) and to the tab menu
 * (`stateOf`, `toggleFocus`, `toggleFavorite`).
 */
export function useVaultListsHere(roots: readonly string[], onNotice: (message: string, kind?: NoticeKind, type?: NoticeType) => void) {
  // What the callbacks below ask at call time, so each keeps its identity.
  const live = useRef({ roots })
  live.current = { roots }
  /** The vault that holds `path`, the most specific one; a path in no vault of the window gets the first. */
  const rootOf = useCallback((path: string): string => rootOfPath(live.current.roots, path) ?? live.current.roots[0], [])
  // Favorites (YAZ-1766 D2, in the vault since 6A/D11): each vault's pinned files and folders in the
  // user's order, from ITS `.yaseendocs/favorites.json`, kept by its root (`useVaultLists`).
  const [favoritesByRoot, favorites] = useVaultLists('favorites', live, onNotice)
  // Focus (YAZ-2619 D1): the files and folders the Focus tab shows. ONE list for each VAULT, kept in
  // the vault, since YAZ-2702 (Decision 1) — no longer one for each window (YAZ-1628): each window
  // on a vault shows the same list, as does each Mac that syncs the vault, and it stays after a
  // quit, a closed window, and a change to a different vault and back (S7, S8, S10, S12). This hook
  // holds what it read and writes nothing back on its own: a vault that leaves takes its rows off
  // the tab and keeps its file (S9).
  const [focusByRoot, focus] = useVaultLists('focus', live, onNotice)

  // Each vault's first read of both lists, for as long as the vault is in the window (YAZ-2631 D1;
  // focus: YAZ-2702): a vault that joins is read, one that leaves is dropped, and a vault that stays
  // is never read again here (its `<kind>:changed` reads it).
  const read = useRef(new Set<string>())
  useEffect(() => {
    const held = read.current
    for (const vault of held) {
      if (roots.includes(vault)) continue
      held.delete(vault)
      favorites.drop(vault)
      focus.drop(vault)
    }
    for (const vault of roots) {
      if (held.has(vault)) continue
      held.add(vault)
      favorites.load(vault)
      focus.load(vault)
    }
  }, [roots, favorites, focus])

  // The Focus tab's items (YAZ-2619 D2): ONE flat list across the vaults of the window (YAZ-2602 A1, A4),
  // in ITS order, never the tree's. `focusList` is every focus item in the tab's order — the store's
  // order across vaults over each vault's own file (`favoriteOrder`; YAZ-2702 Decision 3) — and also
  // holds the items this Mac has no file for, which draw no row and STAY in the list (S13): the note
  // may simply not have synced yet.
  const focusOrder = useSyncExternalStore(storage.subscribe, storage.getFocusOrder)
  const focusList = useMemo(() => favoriteOrder(roots, focusByRoot, focusOrder), [roots, focusByRoot, focusOrder])
  // The Favorites tab's items (YAZ-1766 D4; YAZ-2631 D1): ONE flat list across the vaults of the window,
  // by the Focus rule above; nesting and redundancy are kept. `favoritePaths` is every favorite in
  // the tab's order — the store's order across vaults over each vault's own file (`favoriteOrder`) —
  // and also holds the ones this machine has no file for yet, which draw no row (D14).
  const storedOrder = useSyncExternalStore(storage.subscribe, storage.getFavoritesOrder)
  const favoritePaths = useMemo(() => favoriteOrder(roots, favoritesByRoot, storedOrder), [roots, favoritesByRoot, storedOrder])

  /**
   * A drag on the Favorites tab (YAZ-2631 D1) or of a top row of the Focus tab (D3; YAZ-2702 S11):
   * `next` is every item of that tab in the new order. Each vault's file gets its own part, and only
   * when that part changed (R3); the store gets the order across the vaults, where the window has
   * two or more (R4), for the vaults whose list this window has read: one whose list is still on its
   * way keeps its places (R25). Each write is whole alone.
   */
  const saveOrder = useCallback(
    (lists: VaultLists, next: string[]) => {
      for (const vault of live.current.roots) {
        const own = next.filter((p) => rootOf(p) === vault)
        if (!sameList(own, lists.held.current[vault] ?? [])) lists.save(vault, own)
      }
      if (live.current.roots.length > 1) ORDER[lists.kind].set(live.current.roots.filter((vault) => lists.held.current[vault] !== undefined), next)
    },
    [rootOf],
  )
  const saveFavoriteOrder = useCallback((next: string[]) => saveOrder(favorites, next), [saveOrder, favorites])
  const reorderFocus = useCallback((next: string[]) => saveOrder(focus, next), [saveOrder, focus])

  /**
   * The toggle of a vault list (Favorites: YAZ-1766 D3/D6; focus: YAZ-2619 D3, YAZ-2702 S1–S3):
   * remove every path, or append the ones not yet in the list — insertion order, no duplicates, `max`
   * at most for each vault. Each path goes to the list of the vault that holds it, so a selection
   * across two vaults writes one file per vault (YAZ-2602 S25; S2). A remove also takes its paths
   * out of the store's order across vaults, where that order holds one (YAZ-2631 R23; S3): the same
   * path, in the list again, then goes last (S6). An add writes no order (R13).
   * Answers null, with nothing written, when a vault that holds a path has no list here yet (R26;
   * YAZ-2702 S6): a write would replace the list on disk. Else whether a list went past `max`.
   */
  const toggleIn = useCallback(
    (lists: VaultLists, paths: string[], isOn: boolean, max = Infinity): boolean | null => {
      if (paths.some((p) => lists.held.current[rootOf(p)] === undefined)) return null
      let full = false
      for (const vault of live.current.roots) {
        const own = paths.filter((p) => rootOf(p) === vault)
        if (own.length === 0) continue
        const prev = lists.held.current[vault] ?? []
        const next = isOn ? prev.filter((p) => !own.includes(p)) : [...prev, ...own.filter((p) => !prev.includes(p))]
        if (next.length > max) full = true
        const kept = next.slice(0, max)
        // A list that did not change — an add to a full list — is not written.
        if (!sameList(kept, prev)) lists.save(vault, kept)
      }
      const order = ORDER[lists.kind].get()
      if (isOn && order.some((p) => paths.includes(p))) ORDER[lists.kind].set(live.current.roots, order.filter((p) => !paths.includes(p)))
      return full
    },
    [rootOf],
  )

  /**
   * The focus toggle (YAZ-2619 D3), into the vaults' own lists since YAZ-2702 (`toggleIn`):
   * `MAX_FOCUS` at most for EACH VAULT (R2; S5) — an add past it keeps the first `MAX_FOCUS` of that
   * vault and says so. `isOn` arrives with the paths. The items go last on the tab, and the toast
   * confirms, as the favorite toggle's does (R3). The sidebar opens a folder just added (R4) on its
   * own (`useVaultTree`); the tab menu jumps nowhere (YAZ-3264 D3). Answers false, after its toast,
   * while a vault's list is still on its way; else true.
   */
  const toggleFocus = useCallback(
    (paths: string[], isOn: boolean): boolean => {
      const full = toggleIn(focus, paths, isOn, MAX_FOCUS)
      if (full === null) {
        onNotice('Focus is still loading. Try again.', 'error')
        return false
      }
      const n = paths.length > 1 ? `${paths.length} ` : ''
      if (isOn) onNotice(`Removed ${n}from focus`, 'info', 'lists')
      else if (full) onNotice(`Focus limit reached: ${MAX_FOCUS} items`, 'error')
      else {
        // With two or more vaults the new items go LAST on the tab, "the order added" (YAZ-2619 D1), as
        // before the lists were the vaults': the order across vaults takes them. Favorites writes no order
        // on an add (YAZ-2631 R13), so there a new favorite stands with its vault.
        if (live.current.roots.length > 1) storage.setFocusOrder(live.current.roots.filter((vault) => focus.held.current[vault] !== undefined), [...focusList, ...paths.filter((p) => !focusList.includes(p))])
        onNotice(`Added ${n}to focus`, 'info', 'lists')
      }
      return true
    },
    [focus, focusList, toggleIn, onNotice],
  )
  /**
   * "Clear" (YAZ-2619; YAZ-2702 S4): the list of each vault of the window that has items becomes
   * empty — one write for each such vault, so the change goes to each window and each Mac — and
   * those vaults lose their places in the store's order across vaults.
   */
  const clearFocus = useCallback(() => {
    const cleared = live.current.roots.filter((vault) => (focus.held.current[vault] ?? []).length > 0)
    for (const vault of cleared) focus.save(vault, [])
    if (storage.getFocusOrder().some((p) => rootOfPath(cleared, p) !== null)) storage.setFocusOrder(cleared, [])
  }, [focus])

  /**
   * The favorite toggle (YAZ-1766 D3/D6; `toggleIn`). `isOn` arrives with the paths. The toast
   * confirms with its own glyph and counts every row; `favorites.save` persists.
   */
  const toggleFavorite = useCallback(
    (paths: string[], isOn: boolean) => {
      if (toggleIn(favorites, paths, isOn) === null) return onNotice('Favorites are still loading. Try again.', 'error')
      const n = paths.length > 1 ? `${paths.length} ` : ''
      onNotice(isOn ? `Removed ${n}from favorites` : `Added ${n}to favorites`, 'favorite', 'lists')
    },
    [favorites, toggleIn, onNotice],
  )

  /**
   * Where `path` stands in the two lists (YAZ-3264 D2), read when a tab's menu opens (S14). Null
   * hides the menu's two items: a path in no vault of the window (S8), or one whose vault's lists
   * this window has not read yet (S7). A copy of a tab reads its page's path (S9).
   */
  const stateOf = useCallback(
    (path: string): ListState | null => {
      const vault = rootOfPath(live.current.roots, path)
      if (vault === null) return null
      const [inFocus, inFavorites] = [focus.held.current[vault], favorites.held.current[vault]]
      return inFocus === undefined || inFavorites === undefined ? null : { focus: inFocus.includes(path), favorite: inFavorites.includes(path) }
    },
    [focus, favorites],
  )

  return useMemo(
    () => ({ favoritesByRoot, focusList, favoritePaths, toggleFocus, toggleFavorite, clearFocus, reorderFocus, saveFavoriteOrder, stateOf }),
    [favoritesByRoot, focusList, favoritePaths, toggleFocus, toggleFavorite, clearFocus, reorderFocus, saveFavoriteOrder, stateOf],
  )
}
