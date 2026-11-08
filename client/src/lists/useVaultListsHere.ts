/**
 * Focus and Favorites of the window's vaults, held by App (YAZ-3264 D1): the sidebar unmounts when
 * it is hidden, and the tab menu toggles both lists then too. One hook for the window, read once
 * per vault when it joins and dropped when it leaves (the sidebar's `useVaultTree` did this
 * before); the sidebar and the tab menu reach the SAME lists, through the one writer (6C).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_FAVORITES, MAX_FOCUS, MAX_FOLDER_ITEMS, rootOfPath, shownListScope, type FocusFolder, type ListScope, type WorkspaceLists } from '@shared/types'
import { api } from '../api'
import type { NoticeKind, NoticeType } from '../lib/notice'
import { storage } from '../lib/storage'
import { favoriteOrder } from '../lib/treeState'
import { folderDeletion, folderScopeChange, itemOf, mergeFolders, onTopLevel, sameItem, upsert, type FolderItem } from './focusFolders'

export const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The two lists a vault keeps IN the vault, each with one namespace on the bridge that has the same
 * three calls (`get`, `set`, `onChanged`): Favorites (`.yaseendocs/favorites.json`, YAZ-1766 D11)
 * and focus (`.yaseendocs/focus.<mac id>.json`, YAZ-2702 Decisions 1 and 2). Each in two scopes since
 * YAZ-4450 (D1): the vault's own, and its list in a workspace (`favorites-workspace.json`, `focus-workspace.<mac id>.json`).
 */
type ListKind = 'favorites' | 'focus'
type ListsByRoot = Readonly<Record<string, readonly string[]>>
/** The window's toast, with its optional button: "Undo" on each change of a list (YAZ-4460 demo). */
type Notice = (message: string, kind?: NoticeKind, type?: NoticeType, action?: NoticeAction) => void
type NoticeAction = { label: string; run: () => void; fades?: true }
/** The "Undo" of a toast (YAZ-4460 demo): it fades with the toast, as a move's Undo does. */
const undoAction = (run: () => void): NoticeAction => ({ label: 'Undo', run, fades: true })
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
function useVaultLists(kind: ListKind, scope: ListScope, live: { readonly current: { roots: readonly string[] } }, onNotice: Notice): [ListsByRoot, VaultLists] {
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
function useFolderCopies(kind: ListKind, scope: ListScope, live: { readonly current: { roots: readonly string[] } }, onNotice: Notice) {
  const door = kind === 'focus' ? api.focusFolders : api.favoriteFolders
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
        void door.get(vault, scope).then((next) => {
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
          door.set(vault, scope, next[vault]).catch((err: unknown) => {
            if (scopeNow.current === scope && live.current.roots.includes(vault)) setByRoot((all) => ({ ...all, [vault]: before[vault] ?? [] }))
            notice.current(`Can't save the focus folder: ${err instanceof Error ? err.message : String(err)}`, 'error')
          })
        return true
      },
    }),
    [door, scope, live],
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
      door.onChanged((c) => {
        if (c.scope === scope && live.current.roots.includes(c.root)) copies.load(c.root)
      }),
    [door, scope, live, copies],
  )
  return [byRoot, copies] as const
}


type ToggleIn = (lists: VaultLists, paths: string[], isOn: boolean, max?: number) => boolean | null

/**
 * The folders of one tab (YAZ-4460, the Focus tab's; the Favorites tab's by the same rules since the demo): each
 * vault's copy (`useFolderCopies`), the window's folders out of them, and every change. An item is in ONE place of
 * the tab: the top level (`lists`, `list`) or one folder. Every function reads through refs, so each keeps its identity.
 */
function useTabFolders(kind: ListKind, scope: ListScope, lists: VaultLists, otherLists: VaultLists, list: readonly string[], max: number, live: { readonly current: { roots: readonly string[] } }, onNotice: Notice, toggleIn: ToggleIn) {
  const [copies, store] = useFolderCopies(kind, scope, live, onNotice)
  const folders = useMemo(() => mergeFolders(copies), [copies])
  const now = useRef(folders)
  now.current = folders
  // The OTHER scope's folders (YAZ-4460 demo, "Show it in"): a folder can show in both. It stays ONE folder: each change
  // here goes to its copy there too, while that copy lives.
  const [otherCopies, other] = useFolderCopies(kind, otherScope(scope), live, onNotice)
  const otherNow = useRef<readonly FocusFolder[]>([])
  otherNow.current = useMemo(() => mergeFolders(otherCopies), [otherCopies])
  const top = useRef(list)
  top.current = list
  const notice = useRef(onNotice)
  notice.current = onNotice
  return useMemo(() => {
    /** One folder's change, in this scope and — while it shows there too — in the other. */
    const save = (folder: FocusFolder): boolean => {
      const done = store.save(folder)
      if (done && inOther(folder.id)) other.save(folder)
      return done
    }
    /** A copy there, live or not yet merged: by each vault's raw copy too, so a copy written a moment ago (another window's) still counts. */
    const inOther = (id: string): boolean => otherNow.current.some((f) => f.id === id) || Object.values(other.held.current).some((list) => list.some((f) => f.id === id && !f.deleted))
    const loading = () => notice.current(kind === 'focus' ? 'Focus is still loading. Try again.' : 'Favorites are still loading. Try again.', 'error')
    const limitReached = `${kind === 'focus' ? 'Focus' : 'Favorites'} limit reached:`
    const itemsOf = (paths: readonly string[]) => paths.map((p) => itemOf(p, live.current.roots)).filter((i): i is FolderItem => i !== null)
    /** The folder that holds `path`, an absolute path of the window. */
    const folderOf = (path: string): FocusFolder | undefined => {
      const item = itemOf(path, live.current.roots)
      return item === null ? undefined : now.current.find((f) => f.items.some((i) => sameItem(i, item)))
    }
    /** The folder of the OTHER scope that holds `path` (YAZ-4476): an item there is in that list, as one at its top level. */
    const otherFolderOf = (path: string): FocusFolder | undefined => {
      const item = itemOf(path, live.current.roots)
      return item === null ? undefined : otherNow.current.find((f) => f.items.some((i) => sameItem(i, item)))
    }
    /** `paths` out of every folder of the other scope; answers each folder as it was, for an Undo. */
    const stripOther = (paths: readonly string[]): FocusFolder[] => {
      const items = itemsOf(paths)
      const was = otherNow.current.filter((f) => f.items.some((i) => items.some((x) => sameItem(i, x))))
      for (const f of was) other.save({ ...f, items: f.items.filter((i) => !items.some((x) => sameItem(i, x))), at: Date.now() })
      return was
    }
    /** `paths` out of every folder but `keep`: one write for each folder that held one. */
    const strip = (paths: readonly string[], keep: string | null = null): void => {
      const items = itemsOf(paths)
      for (const f of now.current) {
        if (f.id === keep || !f.items.some((i) => items.some((x) => sameItem(i, x)))) continue
        save({ ...f, items: f.items.filter((i) => !items.some((x) => sameItem(i, x))), at: Date.now() })
      }
    }
    /** Into folder `id`, or with null a new one; the paths leave the top level and every other folder. Null while loading. */
    const addTo = (paths: string[], id: string | null, quiet = false): string | null => {
      const roots = live.current.roots
      const target = id === null ? undefined : now.current.find((f) => f.id === id)
      if (roots.some((vault) => store.held.current[vault] === undefined || lists.held.current[vault] === undefined) || (id !== null && target === undefined)) {
        loading()
        return null
      }
      const at = Date.now()
      const base: FocusFolder = target ?? { id: crypto.randomUUID(), name: kind === 'focus' ? 'New focus folder' : 'New favorite folder', created: at, at, items: [] }
      // A folder holds MAX_FOLDER_ITEMS at most (YAZ-4479): the paths that fit are cut FIRST (YAZ-4480), so a path that does
      // not fit stays where it was — at the top level, in its folder, or out of the list — and only the others move.
      const room = Math.max(0, MAX_FOLDER_ITEMS - base.items.length)
      let left = room
      const going = paths.filter((p) => {
        const item = itemOf(p, live.current.roots)
        if (item === null) return false
        if (base.items.some((i) => sameItem(i, item))) return true
        return left-- > 0
      })
      const stay = paths.length - going.length
      const limit = stay === 0 ? '' : `A folder holds ${MAX_FOLDER_ITEMS} items at most: ${stay === 1 ? 'one item stays' : `${stay} items stay`} where ${stay === 1 ? 'it was' : 'they were'}.`
      // Nothing fits: nothing moves. (No paths at all is "+ Folder": an empty new folder.)
      if (going.length === 0 && paths.length > 0) {
        notice.current(limit, 'error')
        return target?.id ?? null
      }
      // Where each path was, for the toast's Undo: a folder, the top level, or not in the list.
      const before = going.map((p) => ({ p, folder: folderOf(p)?.id ?? null, top: top.current.includes(p) }))
      const atTop = going.filter((p) => top.current.includes(p))
      if (atTop.length > 0) toggleIn(lists, atTop, true)
      strip(going, id)
      const items = itemsOf(going)
      const next = { ...base, items: [...base.items, ...items.filter((x) => !base.items.some((i) => sameItem(i, x)))], at }
      save(next)
      if (items.length > 0 && (!quiet || stay > 0))
        notice.current(
          // A new folder has no name yet when the toast shows: its name field is still open. One toast: the count is what
          // went in, and the limit, when it held some back, rides on it, as an error that always shows (YAZ-4480).
          `Added ${items.length > 1 ? `${items.length} ` : ''}to ${target === undefined ? `a new ${kind === 'focus' ? 'focus' : 'favorite'} folder` : `${next.name} (${kind === 'focus' ? 'focus' : 'favorite'} folder)`}${stay > 0 ? `. ${limit}` : ''}`,
          stay > 0 ? 'error' : kind === 'focus' ? 'focus' : 'favorite',
          stay > 0 ? undefined : 'lists',
          undoAction(() => {
            // Each path back where it was; a folder this add made goes again.
            for (const b of before) {
              if (b.folder !== null && b.folder !== next.id) addTo([b.p], b.folder, true)
              else if (b.top) moveOut(b.p)
              else if (b.folder === null) strip([b.p])
            }
            if (target === undefined) {
              const made = now.current.find((f) => f.id === next.id)
              if (made !== undefined) save({ ...made, deleted: true, items: [], at: Date.now() })
            }
          }),
        )
      return next.id
    }
    const rename = (id: string, name: string): void => {
      const f = now.current.find((x) => x.id === id)
      const clean = name.trim()
      if (f !== undefined && clean !== '' && clean !== f.name) save({ ...f, name: clean, at: Date.now() })
    }
    /**
     * F3: the folder goes (a tombstone, so no older copy brings it back). `keep` (YAZ-4460 demo, the Delete box's choice):
     * its items that this window shows go back to the top level — of each place it showed; else they leave the list with it.
     */
    const remove = (id: string, keep = true): void => {
      const f = now.current.find((x) => x.id === id)
      if (f === undefined) return
      const there = inOther(id)
      const theirs = otherNow.current.find((x) => x.id === id)
      const inOtherList = (p: string) => (otherLists.held.current[rootOfPath(live.current.roots, p) ?? ''] ?? []).includes(p)
      // The plan is shared with the CLI's group.remove (D7, YAZ-4568).
      const { gone, here: fresh, there: freshThere } = folderDeletion(f, live.current.roots, keep, Date.now(), (p) => top.current.includes(p), there ? inOtherList : null)
      if (!store.save(gone)) return loading()
      // A delete is the folder's, in both places: the other scope gets the tombstone too, whether or not this window has seen a copy there.
      other.save(gone)
      const putHere = fresh.length > 0 ? toggleIn(lists, fresh, false, max) : false
      const putThere = freshThere.length > 0 ? toggleIn(otherLists, freshThere, false, max) : false
      if (putHere === null || putThere === null) return notice.current(`Couldn't put every item of ${f.name} back: a vault is still loading. Add them again.`, 'error')
      // A full top level keeps its first `max` items (YAZ-4479): the rest leave the list, and the toast says so.
      const full = putHere === true || putThere === true
      // Undo (YAZ-4470, 7): the folder again where it showed, with its items; the items it put at the top level leave it.
      notice.current(
        full ? `Deleted ${f.name}. ${limitReached} ${max} items, so some of its items left ${kind}.` : `Deleted ${f.name} (${kind === 'focus' ? 'focus' : 'favorite'} folder)`,
        full ? 'error' : kind === 'focus' ? 'focus' : 'favorite',
        full ? undefined : 'lists', // an error always shows (YAZ-3303 D2)
        undoAction(() => {
          if (fresh.length > 0) toggleIn(lists, fresh, true)
          if (freshThere.length > 0) toggleIn(otherLists, freshThere, true)
          const at = Date.now()
          store.save({ ...f, at })
          if (there && theirs !== undefined) other.save({ ...theirs, at })
        }),
      )
    }
    /** F5: out of its folder to the top level, last. A full top level keeps it in its folder and says so (YAZ-4479). */
    const moveOut = (path: string): void => {
      const root = rootOfPath(live.current.roots, path)
      if (!top.current.includes(path) && root !== null && (lists.held.current[root] ?? []).length >= max) return notice.current(`${limitReached} ${max} items. It stays in its folder.`, 'error')
      strip([path])
      if (!top.current.includes(path)) toggleIn(lists, [path], false, max)
    }
    /** The menus' one door: into a folder, a new one (null), or out of any folder to the top level ('top'). */
    const moveIn = (paths: string[], to: string | null | 'top'): string | null => {
      if (to !== 'top') return addTo(paths, to)
      for (const path of paths) moveOut(path)
      return 'top'
    }
    /** F5: a drag inside a folder: its items in the new order; ghosts keep their places at the end. */
    const reorder = (id: string, paths: readonly string[]): void => {
      const f = now.current.find((x) => x.id === id)
      if (f === undefined) return
      const shown = itemsOf(paths).filter((i) => f.items.some((x) => sameItem(i, x)))
      save({ ...f, items: [...shown, ...f.items.filter((i) => !shown.some((x) => sameItem(i, x)))], at: Date.now() })
    }
    /** A drag of the folders (YAZ-4470, 13): `ids` is the new order; each folder whose place changed is written with it. */
    const reorderFolders = (ids: readonly string[]): void => {
      ids.forEach((id, pos) => {
        const f = now.current.find((x) => x.id === id)
        if (f !== undefined && f.pos !== pos) save({ ...f, pos, at: Date.now() })
      })
    }
    /** Where a folder shows (YAZ-4460 demo): here — it is a folder of this tab — and in the other scope while its copy lives there. */
    const scopesOfFolder = (id: string): ScopeState => ({ [scope]: now.current.some((f) => f.id === id), [otherScope(scope)]: otherNow.current.some((f) => f.id === id) }) as ScopeState
    /**
     * "Show it in ▸ Workspace / Vault" on a folder (YAZ-4460 demo): on copies the folder into that scope's file of each vault
     * of the window; off leaves a tombstone there. The last place it shows stays: a folder goes away by "Delete".
     */
    const setFolderScope = (id: string, to: ListScope, on: boolean): void => {
      const f = now.current.find((x) => x.id === id) ?? otherNow.current.find((x) => x.id === id)
      if (f === undefined) return
      const next = folderScopeChange(f, on, Date.now(), scopesOfFolder(id)[otherScope(to)])
      if (next === null) return notice.current('A folder shows in one place at least. To remove it, use Delete.', 'error')
      const target = to === scope ? store : other
      const alive = (({ deleted: _d, ...rest }: FocusFolder): FocusFolder => rest)
      if (!target.save(next)) return loading()
      // Off, with Undo (YAZ-4470, 8): the shown list's off moves the folder to the other; the other's off just leaves it.
      if (!on)
        notice.current(
          to === scope ? `${f.name} moved to the ${otherScope(scope)} list` : `${f.name} left the ${to} list`,
          kind === 'focus' ? 'focus' : 'favorite',
          'lists',
          undoAction(() => void target.save(alive({ ...f, at: Date.now() }))),
        )
    }
    return { store, other, folders, folderOf, otherFolderOf, stripOther, strip, addTo, rename, remove, moveOut, moveIn, reorder, reorderFolders, scopesOfFolder, setFolderScope }
  }, [kind, scope, max, lists, otherLists, store, other, folders, live, toggleIn])
}

export type TabFolders = ReturnType<typeof useTabFolders>
export type ScopeState = Record<ListScope, boolean>
const otherScope = (scope: ListScope): ListScope => (scope === 'vault' ? 'workspace' : 'vault')

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
  /** The same three for the Favorites tab's folders (YAZ-4460 demo). */
  favoriteFolders?: readonly { id: string; name: string }[]
  favoriteFolderId?: string | null
  intoFavoriteFolder?: (paths: string[], id: string | null | 'top') => void
  /** Each tab's list in each scope, for the "Workspace" / "Vault" checks, and their door (YAZ-4460 demo). */
  scopes?: Record<ListKind, ScopeState>
  setScope?: (kind: ListKind, paths: string[], scope: ListScope, on: boolean) => void
}

export type VaultListsHere = ReturnType<typeof useVaultListsHere>

/**
 * The window's Focus and Favorites (YAZ-3264 D1), for the window's vaults `roots` in the window's
 * order. App calls it once and hands it to the sidebar (`useVaultTree`) and to the tab menu
 * (`stateOf`, `toggleFocus`, `toggleFavorite`).
 */
export function useVaultListsHere(roots: readonly string[], onNotice: Notice, separate: WorkspaceLists) {
  // What the callbacks below ask at call time, so each keeps its identity.
  const live = useRef({ roots })
  live.current = { roots }
  // YAZ-4450 D2, D4: a window with two or more vaults is a workspace. With a tab's switch on (the default), each vault
  // shows its ONE workspace list there, the same in every workspace; a vault alone always shows its own list.
  const favoritesScope = shownListScope(roots, separate, 'favorites')
  const focusScope = shownListScope(roots, separate, 'focus')
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
  // Each list's OTHER scope (YAZ-4460 demo): the menus' "Workspace" / "Vault" checks read and write it.
  const [, focusOther] = useVaultLists('focus', otherScope(focusScope), live, onNotice)
  const [, favoritesOther] = useVaultLists('favorites', otherScope(favoritesScope), live, onNotice)

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
        const { list: kept, full: over } = isOn ? onTopLevel(prev.filter((p) => !own.includes(p)), [], max) : onTopLevel(prev, own, max)
        if (over) full = true
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
  // The folders of each tab (YAZ-4460; Favorites since the demo), in the scope that tab shows.
  const focusTab = useTabFolders('focus', focusScope, focus, focusOther, focusList, MAX_FOCUS, live, onNotice, toggleIn)
  const favoritesTab = useTabFolders('favorites', favoritesScope, favorites, favoritesOther, favoritePaths, MAX_FAVORITES, live, onNotice, toggleIn)

  // Each vault's first read of both lists, for as long as the vault is in the window (YAZ-2631 D1;
  // focus: YAZ-2702): a vault that joins is read, one that leaves is dropped, and a vault that stays
  // is never read again here (its `<kind>:changed` reads it).
  const read = useRef(new Set<string>())
  useEffect(() => {
    const held = read.current
    for (const vault of held) {
      if (roots.includes(vault)) continue
      held.delete(vault)
      for (const lists of [favorites, focus, focusOther, favoritesOther]) lists.drop(vault)
      for (const tab of [focusTab, favoritesTab]) {
        tab.store.drop(vault)
        tab.other.drop(vault)
      }
    }
    for (const vault of roots) {
      if (held.has(vault)) continue
      held.add(vault)
      for (const lists of [favorites, focus, focusOther, favoritesOther]) lists.load(vault)
      for (const tab of [focusTab, favoritesTab]) {
        tab.store.load(vault)
        tab.other.load(vault)
      }
    }
  }, [roots, favorites, focus, focusOther, favoritesOther, focusTab.store, favoritesTab.store, focusTab.other, favoritesTab.other])


  const toggleFocus = useCallback(
    (paths: string[], isOn: boolean, quiet = false): boolean => {
      // Where each path was, for the toast's Undo (YAZ-4460 demo): its focus folder, the top level, or not in focus.
      const before = paths.map((p) => ({ p, folder: focusTab.folderOf(p)?.id ?? null, top: focusList.includes(p) }))
      const full = toggleIn(focus, paths, isOn, MAX_FOCUS)
      if (full === null) {
        onNotice('Focus is still loading. Try again.', 'error')
        return false
      }
      // "Remove from focus" takes an item out of its focus folder too (YAZ-4460 F5).
      if (isOn) focusTab.strip(paths)
      const n = paths.length > 1 ? `${paths.length} ` : ''
      const undoRemove = undoAction(() => {
        for (const b of before) {
          if (b.folder !== null) focusTab.addTo([b.p], b.folder, true)
          else if (b.top) toggleFocusRef.current([b.p], false, true)
        }
      })
      const added = before.filter((b) => !b.top && b.folder === null).map((b) => b.p)
      if (quiet) return true
      if (isOn) onNotice(`Removed ${n}from focus`, 'focus', 'lists', undoRemove)
      else if (full) onNotice(`Focus limit reached: ${MAX_FOCUS} items`, 'error')
      else {
        // With two or more vaults the new items go LAST on the tab, "the order added" (YAZ-2619 D1), as
        // before the lists were the vaults': the order across vaults takes them. Favorites writes no order
        // on an add (YAZ-2631 R13), so there a new favorite stands with its vault.
        if (live.current.roots.length > 1) storage.setFocusOrder(live.current.roots.filter((vault) => focus.held.current[vault] !== undefined), [...focusList, ...paths.filter((p) => !focusList.includes(p))])
        onNotice(`Added ${n}to focus`, 'focus', 'lists', undoAction(() => toggleFocusRef.current(added, true, true)))
      }
      return true
    },
    [focus, focusList, toggleIn, onNotice, focusTab],
  )
  // The Undo of a toast calls the toggle again, quietly, through this ref: the toast outlives the render that made it.
  const toggleFocusRef = useRef(toggleFocus)
  toggleFocusRef.current = toggleFocus
  /**
   * "Clear" (YAZ-2619; YAZ-2702 S4): the list of each vault of the window that has items becomes
   * empty — one write for each such vault, so the change goes to each window and each Mac — and
   * those vaults lose their places in the store's order across vaults.
   */
  const clearFocus = useCallback(() => {
    const cleared = live.current.roots.filter((vault) => (focus.held.current[vault] ?? []).length > 0)
    const before = cleared.map((vault) => [vault, focus.held.current[vault] ?? []] as const)
    const order = storage.getFocusOrder()
    for (const vault of cleared) focus.save(vault, [])
    if (order.some((p) => rootOfPath(cleared, p) !== null)) storage.setFocusOrder(cleared, [])
    // Undo (YAZ-4470, 7): each vault's top level back, in its order.
    onNotice(
      'Cleared the top level of Focus',
      'focus',
      'lists',
      undoAction(() => {
        for (const [vault, list] of before) focus.save(vault, [...list])
        if (order.length > 0) storage.setFocusOrder(live.current.roots, order)
      }),
    )
  }, [focus, onNotice])

  /**
   * The favorite toggle (YAZ-1766 D3/D6; `toggleIn`). `isOn` arrives with the paths. The toast
   * confirms with its own glyph and counts every row; `favorites.save` persists.
   */
  const toggleFavorite = useCallback(
    (paths: string[], isOn: boolean, quiet = false) => {
      const before = paths.map((p) => ({ p, folder: favoritesTab.folderOf(p)?.id ?? null, top: favoritePaths.includes(p) }))
      if (toggleIn(favorites, paths, isOn) === null) return onNotice('Favorites are still loading. Try again.', 'error')
      if (isOn) favoritesTab.strip(paths) // out of its favorite folder too (YAZ-4460 demo)
      if (quiet) return
      const n = paths.length > 1 ? `${paths.length} ` : ''
      // The toast's Undo (YAZ-4460 demo): a remove puts each favorite back in its folder or at the top; an add takes the new ones out.
      const undo = isOn
        ? undoAction(() => {
            for (const b of before) {
              if (b.folder !== null) favoritesTab.addTo([b.p], b.folder, true)
              else if (b.top) toggleFavoriteRef.current([b.p], false, true)
            }
          })
        : undoAction(() => toggleFavoriteRef.current(before.filter((b) => !b.top && b.folder === null).map((b) => b.p), true, true))
      onNotice(isOn ? `Removed ${n}from favorites` : `Added ${n}to favorites`, 'favorite', 'lists', undo)
    },
    [favorites, favoritePaths, toggleIn, onNotice, favoritesTab],
  )
  const toggleFavoriteRef = useRef(toggleFavorite)
  toggleFavoriteRef.current = toggleFavorite

  /**
   * Where `path` stands in the two lists (YAZ-3264 D2), read when a tab's menu opens (S14). Null
   * hides the menu's two items: a path in no vault of the window (S8), or one whose vault's lists
   * this window has not read yet (S7). A copy of a tab reads its page's path (S9).
   */
  /**
   * Where `paths` stand in each scope of a tab's list (YAZ-4460 demo), for the menus' "Workspace" / "Vault" checks: a
   * scope is on when EVERY path is in it — the shown scope's top level or one of its folders; the other scope's top level.
   */
  const scopesOf = useCallback(
    (kind: ListKind, paths: readonly string[]): ScopeState => {
      const [shown, other, tab, scope] = kind === 'focus' ? [focus, focusOther, focusTab, focusScope] : [favorites, favoritesOther, favoritesTab, favoritesScope]
      const inShown = (p: string) => (shown.held.current[rootOf(p)] ?? []).includes(p) || tab.folderOf(p) !== undefined
      // The other list holds it at its top level or in one of its folders (YAZ-4476).
      const inOther = (p: string) => (other.held.current[rootOf(p)] ?? []).includes(p) || tab.otherFolderOf(p) !== undefined
      const on = (test: (p: string) => boolean) => paths.length > 0 && paths.every(test)
      return { [scope]: on(inShown), [otherScope(scope)]: on(inOther) } as ScopeState
    },
    [rootOf, focus, focusOther, focusTab, focusScope, favorites, favoritesOther, favoritesTab, favoritesScope],
  )
  /** A "Workspace" / "Vault" check (YAZ-4460 demo): `paths` into or out of that scope's top level. The shown scope goes by the tab's own toggle. */
  const setScope = useCallback(
    (kind: ListKind, paths: string[], scope: ListScope, on: boolean): void => {
      const shownScope = kind === 'focus' ? focusScope : favoritesScope
      if (scope === shownScope) return void (kind === 'focus' ? toggleFocus(paths, !on) : toggleFavorite(paths, !on))
      const other = kind === 'focus' ? focusOther : favoritesOther
      const tab = kind === 'focus' ? focusTab : favoritesTab
      // An item in a folder of that list is in it already (YAZ-4476): an add puts it in no second place.
      const moving = on ? paths.filter((p) => tab.otherFolderOf(p) === undefined) : paths
      if (moving.length === 0) return
      const atTop = moving.filter((p) => (other.held.current[rootOf(p)] ?? []).includes(p))
      const done = toggleIn(other, moving, !on, kind === 'focus' ? MAX_FOCUS : Infinity)
      if (done === null) return onNotice(kind === 'focus' ? 'Focus is still loading. Try again.' : 'Favorites are still loading. Try again.', 'error')
      // Off takes it out of that list's folders too; the Undo puts each folder back as it was.
      const folders = on ? [] : tab.stripOther(moving)
      const where = scope === 'workspace' ? 'workspace' : 'vault'
      onNotice(
        `${on ? 'Added to' : 'Removed from'} the ${where} ${kind === 'focus' ? 'focus' : 'favorites'}`,
        kind === 'focus' ? 'focus' : 'favorite',
        'lists',
        undoAction(() => {
          // An add goes out again; a remove comes back where it was: the top level, or its folder.
          if (on) toggleIn(other, moving, true)
          else if (atTop.length > 0) toggleIn(other, atTop, false, kind === 'focus' ? MAX_FOCUS : Infinity)
          for (const f of folders) tab.other.save({ ...f, at: Date.now() })
        }),
      )
    },
    [rootOf, focusScope, favoritesScope, focusOther, favoritesOther, focusTab, favoritesTab, toggleFocus, toggleFavorite, toggleIn, onNotice],
  )

  /**
   * Where `path` stands in the two lists (YAZ-3264 D2), read when a tab's menu opens (S14). Null
   * hides the menu's two items: a path in no vault of the window (S8), or one whose vault's lists
   * this window has not read yet (S7). A copy of a tab reads its page's path (S9). Since YAZ-4460 it
   * also carries each tab's folders and the doors of the menus' flyouts.
   */
  const stateOf = useCallback(
    (path: string): ListState | null => {
      const vault = rootOfPath(live.current.roots, path)
      if (vault === null) return null
      const [inFocus, inFavorites] = [focus.held.current[vault], favorites.held.current[vault]]
      if (inFocus === undefined || inFavorites === undefined) return null
      return {
        focus: inFocus.includes(path) || focusTab.folderOf(path) !== undefined,
        favorite: inFavorites.includes(path) || favoritesTab.folderOf(path) !== undefined,
        folders: focusTab.folders,
        folderId: focusTab.folderOf(path)?.id ?? null,
        intoFolder: (paths, id) => void focusTab.moveIn(paths, id),
        favoriteFolders: favoritesTab.folders,
        favoriteFolderId: favoritesTab.folderOf(path)?.id ?? null,
        intoFavoriteFolder: (paths, id) => void favoritesTab.moveIn(paths, id),
        scopes: { focus: scopesOf('focus', [path]), favorites: scopesOf('favorites', [path]) },
        setScope: (kind, paths, scope, on) => setScope(kind, paths, scope, on),
      }
    },
    [focus, favorites, focusTab, favoritesTab, scopesOf, setScope],
  )

  return useMemo(
    () => ({ favoritesByRoot, focusList, favoritePaths, toggleFocus, toggleFavorite, clearFocus, reorderFocus, saveFavoriteOrder, stateOf, focusScope, favoritesScope, focusTab, favoritesTab, scopesOf, setScope }),
    [favoritesByRoot, focusList, favoritePaths, toggleFocus, toggleFavorite, clearFocus, reorderFocus, saveFavoriteOrder, stateOf, focusScope, favoritesScope, focusTab, favoritesTab, scopesOf, setScope],
  )
}
