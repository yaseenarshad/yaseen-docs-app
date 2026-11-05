/**
 * Focus and Favorites of the window's vaults, held by App (YAZ-3264 D1): the sidebar unmounts when
 * it is hidden, and the tab menu toggles both lists then too. One hook for the window, read once
 * per vault when it joins and dropped when it leaves (the sidebar's `useVaultTree` did this
 * before); the sidebar and the tab menu reach the SAME lists, through the one writer (6C).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_FOCUS, rootOfPath, type FocusFolder, type ListScope, type WorkspaceLists } from '@shared/types'
import { api } from '../api'
import type { NoticeKind, NoticeType } from '../lib/notice'
import { storage } from '../lib/storage'
import { favoriteOrder } from '../lib/treeState'
import { itemOf, mergeFolders, resolveItem, sameItem, upsert, type FolderItem } from './focusFolders'

export const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The two lists a vault keeps IN the vault, each with one namespace on the bridge that has the same
 * three calls (`get`, `set`, `onChanged`): Favorites (`.yaseendocs/favorites.json`, YAZ-1766 D11)
 * and focus (`.yaseendocs/focus.<mac id>.json`, YAZ-2702 Decisions 1 and 2). Each in two scopes since
 * YAZ-4450 (D1): the vault's own, and its list in a workspace (`favorites-workspace.json`, `focus-workspace.<mac id>.json`).
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
 *
 * `scope` (YAZ-4450 D2) is WHICH list of each vault the window shows: its own, or its workspace list.
 * A new scope drops every held list at once — so no toggle writes one list into the other's file —
 * and reads each vault of the window again; an answer or a change of the other scope is dropped.
 */
function useVaultLists(kind: ListKind, scope: ListScope, live: { readonly current: { roots: readonly string[] } }, onNotice: (message: string, kind?: NoticeKind, type?: NoticeType) => void): [ListsByRoot, VaultLists] {
  const [byRoot, setByRoot] = useState<ListsByRoot>({})
  const held = useRef(byRoot)
  held.current = byRoot
  const notice = useRef(onNotice)
  notice.current = onNotice
  const scopeNow = useRef(scope)
  scopeNow.current = scope
  const lists = useMemo<VaultLists>(
    () => ({
      kind,
      held,
      load(vault) {
        void api[kind].get(vault, scope).then((next) => {
          if (scopeNow.current === scope && live.current.roots.includes(vault)) setByRoot((prev) => (prev[vault] !== undefined && sameList(prev[vault], next) ? prev : { ...prev, [vault]: next }))
        })
      },
      drop: (vault) => setByRoot(({ [vault]: _left, ...rest }) => rest),
      save(vault, next) {
        const prev = held.current[vault] ?? []
        setByRoot((all) => ({ ...all, [vault]: next }))
        api[kind].set(vault, next, scope).catch((err: unknown) => {
          // Only for a vault still in the window: one that left must not come back with a list this window did not read (YAZ-2702 S6).
          if (scopeNow.current === scope && live.current.roots.includes(vault)) setByRoot((all) => ({ ...all, [vault]: prev }))
          notice.current(`Can't save ${kind}: ${err instanceof Error ? err.message : String(err)}`, 'error')
        })
      },
    }),
    [kind, scope, live],
  )
  const shown = useRef(scope)
  // Before paint, so the other scope's rows never show for a frame.
  useLayoutEffect(() => {
    if (shown.current === scope) return
    shown.current = scope
    held.current = {}
    setByRoot({})
    for (const vault of live.current.roots) lists.load(vault)
  }, [scope, live, lists])
  useEffect(
    () =>
      api[kind].onChanged((c) => {
        if (c.scope === scope && live.current.roots.includes(c.root)) lists.load(c.root)
      }),
    [kind, scope, live, lists],
  )
  return [byRoot, lists]
}

/**
 * Each vault's copy of the focus folders (YAZ-4460 F1, F2), by `useVaultLists`' rule: read once when the vault joins,
 * again on `focusFolders:changed` of the scope the window shows, dropped when it leaves; a new scope reads again. `save`
 * writes one folder into EVERY vault of the window (F2), optimistic, and puts a vault's copy back when main refuses.
 */
function useFolderCopies(scope: ListScope, live: { readonly current: { roots: readonly string[] } }, onNotice: (message: string, kind?: NoticeKind, type?: NoticeType) => void) {
  const [byRoot, setByRoot] = useState<Readonly<Record<string, readonly FocusFolder[]>>>({})
  const held = useRef(byRoot)
  held.current = byRoot
  const notice = useRef(onNotice)
  notice.current = onNotice
  const scopeNow = useRef(scope)
  scopeNow.current = scope
  const copies = useMemo(
    () => ({
      held,
      load(vault: string) {
        void api.focusFolders.get(vault, scope).then((next) => {
          if (scopeNow.current === scope && live.current.roots.includes(vault)) setByRoot((prev) => ({ ...prev, [vault]: next }))
        })
      },
      drop: (vault: string) => setByRoot(({ [vault]: _left, ...rest }) => rest),
      /** False, with nothing written, while a vault of the window has no copy read yet: a write would replace it. */
      save(folder: FocusFolder): boolean {
        const vaults = live.current.roots
        if (vaults.some((vault) => held.current[vault] === undefined)) return false
        const before = held.current
        const next = Object.fromEntries(vaults.map((vault) => [vault, upsert(before[vault] ?? [], folder)]))
        held.current = { ...before, ...next }
        setByRoot(held.current)
        for (const vault of vaults)
          api.focusFolders.set(vault, scope, next[vault]).catch((err: unknown) => {
            if (scopeNow.current === scope && live.current.roots.includes(vault)) setByRoot((all) => ({ ...all, [vault]: before[vault] ?? [] }))
            notice.current(`Can't save the focus folder: ${err instanceof Error ? err.message : String(err)}`, 'error')
          })
        return true
      },
    }),
    [scope, live],
  )
  const shown = useRef(scope)
  useLayoutEffect(() => {
    if (shown.current === scope) return
    shown.current = scope
    held.current = {}
    setByRoot({})
    for (const vault of live.current.roots) copies.load(vault)
  }, [scope, live, copies])
  useEffect(
    () =>
      api.focusFolders.onChanged((c) => {
        if (c.scope === scope && live.current.roots.includes(c.root)) copies.load(c.root)
      }),
    [scope, live, copies],
  )
  return [byRoot, copies] as const
}

/** A path's place in the two lists, as a menu reads it when it opens (YAZ-3264 D2). */
export interface ListState {
  focus: boolean
  favorite: boolean
  /** The focus folders, and the door into one (YAZ-4460 F4): the tab menu's "Add to focus ▸" reads them here. */
  folders?: readonly { id: string; name: string }[]
  /** The focus folder that holds the path, null at the top level (YAZ-4460 demo). */
  folderId?: string | null
  /** Into a folder, a new one (null), or back to the top level ('top'). */
  intoFolder?: (paths: string[], id: string | null | 'top') => void
}

export type VaultListsHere = ReturnType<typeof useVaultListsHere>

/**
 * The window's Focus and Favorites (YAZ-3264 D1), for the window's vaults `roots` in the window's
 * order. App calls it once and hands it to the sidebar (`useVaultTree`) and to the tab menu
 * (`stateOf`, `toggleFocus`, `toggleFavorite`).
 */
export function useVaultListsHere(roots: readonly string[], onNotice: (message: string, kind?: NoticeKind, type?: NoticeType) => void, separate: WorkspaceLists) {
  // What the callbacks below ask at call time, so each keeps its identity.
  const live = useRef({ roots })
  live.current = { roots }
  // YAZ-4450 D2, D4: a window with two or more vaults is a workspace. With a tab's switch on (the default), each vault
  // shows its ONE workspace list there, the same in every workspace; a vault alone always shows its own list.
  const multi = roots.length > 1
  const favoritesScope: ListScope = multi && separate.favorites ? 'workspace' : 'vault'
  const focusScope: ListScope = multi && separate.focus ? 'workspace' : 'vault'
  /** The vault that holds `path`, the most specific one; a path in no vault of the window gets the first. */
  const rootOf = useCallback((path: string): string => rootOfPath(live.current.roots, path) ?? live.current.roots[0], [])
  // Favorites (YAZ-1766 D2, in the vault since 6A/D11): each vault's pinned files and folders in the
  // user's order, from ITS `.yaseendocs/favorites.json` — or, in a workspace, `favorites-workspace.json` — kept by its root (`useVaultLists`).
  const [favoritesByRoot, favorites] = useVaultLists('favorites', favoritesScope, live, onNotice)
  // Focus (YAZ-2619 D1): the files and folders the Focus tab shows. ONE list for each VAULT, kept in
  // the vault, since YAZ-2702 (Decision 1) — no longer one for each window (YAZ-1628): each window
  // on a vault shows the same list, as does each Mac that syncs the vault, and it stays after a
  // quit, a closed window, and a change to a different vault and back (S7, S8, S10, S12). This hook
  // holds what it read and writes nothing back on its own: a vault that leaves takes its rows off
  // the tab and keeps its file (S9).
  const [focusByRoot, focus] = useVaultLists('focus', focusScope, live, onNotice)
  // The focus folders (YAZ-4460), in the scope of the Focus tab: each vault's copy, and the window's folders out of them.
  const [folderCopies, folders] = useFolderCopies(focusScope, live, onNotice)
  const focusFolders = useMemo(() => mergeFolders(Object.values(folderCopies)), [folderCopies])
  const foldersNow = useRef(focusFolders)
  foldersNow.current = focusFolders

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
      folders.drop(vault)
    }
    for (const vault of roots) {
      if (held.has(vault)) continue
      held.add(vault)
      favorites.load(vault)
      focus.load(vault)
      folders.load(vault)
    }
  }, [roots, favorites, focus, folders])

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
  /** The focus folder that holds `path`, an absolute path of the window (YAZ-4460 F5: one place for each item). */
  const folderOf = useCallback((path: string): FocusFolder | undefined => {
    const item = itemOf(path, live.current.roots)
    return item === null ? undefined : foldersNow.current.find((f) => f.items.some((i) => sameItem(i, item)))
  }, [])
  /** `paths` out of every focus folder but `keep`: one write for each folder that held one. */
  const stripFolders = useCallback(
    (paths: readonly string[], keep: string | null = null): void => {
      const items = paths.map((p) => itemOf(p, live.current.roots)).filter((i): i is FolderItem => i !== null)
      for (const f of foldersNow.current) {
        if (f.id === keep || !f.items.some((i) => items.some((x) => sameItem(i, x)))) continue
        folders.save({ ...f, items: f.items.filter((i) => !items.some((x) => sameItem(i, x))), at: Date.now() })
      }
    },
    [folders],
  )

  const toggleFocus = useCallback(
    (paths: string[], isOn: boolean): boolean => {
      const full = toggleIn(focus, paths, isOn, MAX_FOCUS)
      if (full === null) {
        onNotice('Focus is still loading. Try again.', 'error')
        return false
      }
      // "Remove from focus" takes an item out of its focus folder too (YAZ-4460 F5).
      if (isOn) stripFolders(paths)
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
    [focus, focusList, toggleIn, onNotice, stripFolders],
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
      return inFocus === undefined || inFavorites === undefined
        ? null
        : { focus: inFocus.includes(path) || folderOf(path) !== undefined, favorite: inFavorites.includes(path), folders: foldersNow.current, folderId: folderOf(path)?.id ?? null, intoFolder: (paths, id) => void intoRef.current(paths, id) }
    },
    [focus, favorites, folderOf],
  )
  // `addToFocusFolder` comes below; the menu's door reads it at the click.
  const intoRef = useRef<(paths: string[], id: string | null | 'top') => unknown>(() => undefined)

  /**
   * Into a focus folder (YAZ-4460 F4, F5): `paths` leave the top level and every other folder, then go last in folder
   * `id` — or, with `id` null, in a new folder "New focus folder". Answers the folder's id, or null when a vault's
   * lists are still on their way (the toast says so and nothing is written).
   */
  const addToFocusFolder = useCallback(
    (paths: string[], id: string | null): string | null => {
      const roots = live.current.roots
      const items = paths.map((p) => itemOf(p, roots)).filter((i): i is FolderItem => i !== null)
      const target = id === null ? undefined : foldersNow.current.find((f) => f.id === id)
      if (roots.some((vault) => folders.held.current[vault] === undefined || focus.held.current[vault] === undefined) || (id !== null && target === undefined)) {
        onNotice('Focus is still loading. Try again.', 'error')
        return null
      }
      if (paths.some((p) => focusList.includes(p))) toggleIn(focus, paths.filter((p) => focusList.includes(p)), true)
      stripFolders(paths, id)
      const now = Date.now()
      const base: FocusFolder = target ?? { id: crypto.randomUUID(), name: 'New focus folder', created: now, at: now, items: [] }
      const next = { ...base, items: [...base.items, ...items.filter((x) => !base.items.some((i) => sameItem(i, x)))], at: now }
      folders.save(next)
      if (items.length > 0) onNotice(`Added ${items.length > 1 ? `${items.length} ` : ''}to ${next.name}`, 'info', 'lists')
      return next.id
    },
    [focus, focusList, folders, toggleIn, stripFolders, onNotice],
  )
  const renameFocusFolder = useCallback(
    (id: string, name: string): void => {
      const f = foldersNow.current.find((x) => x.id === id)
      const clean = name.trim()
      if (f !== undefined && clean !== '' && clean !== f.name) folders.save({ ...f, name: clean, at: Date.now() })
    },
    [folders],
  )
  /** F3: the folder goes (a tombstone, so no older copy brings it back); its items that this window shows go back to the top level. */
  const deleteFocusFolder = useCallback(
    (id: string): void => {
      const f = foldersNow.current.find((x) => x.id === id)
      if (f === undefined) return
      const back = f.items.map((i) => resolveItem(i, live.current.roots)).flatMap((r) => ('path' in r ? [r.path] : []))
      if (!folders.save({ ...f, deleted: true, items: [], at: Date.now() })) return onNotice('Focus is still loading. Try again.', 'error')
      if (back.length > 0) toggleIn(focus, back.filter((p) => !focusList.includes(p)), false, MAX_FOCUS)
    },
    [focus, focusList, folders, toggleIn, onNotice],
  )
  /** F5: a drag out of a folder to the top level: the item leaves its folder and goes last on the top level. */
  const moveOutOfFocusFolder = useCallback(
    (path: string): void => {
      stripFolders([path])
      if (!focusList.includes(path)) toggleIn(focus, [path], false, MAX_FOCUS)
    },
    [focus, focusList, stripFolders, toggleIn],
  )
  /** The menus' one door (YAZ-4460 F4, demo): into a folder, a new one (null), or out of any folder to the top level ('top'). */
  const moveInFocus = useCallback(
    (paths: string[], to: string | null | 'top'): string | null => {
      if (to !== 'top') return addToFocusFolder(paths, to)
      for (const path of paths) moveOutOfFocusFolder(path)
      return 'top'
    },
    [addToFocusFolder, moveOutOfFocusFolder],
  )
  intoRef.current = moveInFocus
  /** F5: a drag inside a folder: its items in the new order (absolute paths of the window; ghosts keep their places at the end). */
  const reorderFocusFolder = useCallback(
    (id: string, paths: readonly string[]): void => {
      const f = foldersNow.current.find((x) => x.id === id)
      if (f === undefined) return
      const shown = paths.map((p) => itemOf(p, live.current.roots)).filter((i): i is FolderItem => i !== null && f.items.some((x) => sameItem(i, x)))
      const rest = f.items.filter((i) => !shown.some((x) => sameItem(i, x)))
      folders.save({ ...f, items: [...shown, ...rest], at: Date.now() })
    },
    [folders],
  )

  return useMemo(
    () => ({ favoritesByRoot, focusList, favoritePaths, toggleFocus, toggleFavorite, clearFocus, reorderFocus, saveFavoriteOrder, stateOf, focusScope, favoritesScope, focusFolders, folderOf, addToFocusFolder, moveInFocus, renameFocusFolder, deleteFocusFolder, moveOutOfFocusFolder, reorderFocusFolder }),
    [favoritesByRoot, focusList, favoritePaths, toggleFocus, toggleFavorite, clearFocus, reorderFocus, saveFavoriteOrder, stateOf, focusScope, favoritesScope, focusFolders, folderOf, addToFocusFolder, moveInFocus, renameFocusFolder, deleteFocusFolder, moveOutOfFocusFolder, reorderFocusFolder],
  )
}
