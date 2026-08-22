import { useCallback, useRef, useState } from 'react'
import { storage } from '../lib/storage'
import { hashFilePath } from '../lib/urlHash'

/**
 * The renderer-owned tab model (Tabs I2, GRO-2234). A window's open files are
 * `WindowEntry.tabs` with `file` doubling as the ACTIVE tab (GRO-2232); the boot identity
 * snapshot seeds this state, and from then on the renderer owns it, mirroring every change
 * down as ONE explicit `setIdentity({ tabs, file })` (via `storage.setTabs`) — never a
 * `{ file }`-only patch, whose main-side normalization would prepend files into `tabs`
 * on its own (the legacy pre-tabs path).
 *
 * Invariants (enforced here, matching main's `WindowEntry`): `active ∈ tabs` whenever
 * non-null; `tabs: []` ⇔ `active: null`; `tabs` de-duplicated by path. `mounted` is
 * renderer-only: `mounted ⊆ tabs`, `active ∈ mounted` whenever non-null.
 */
export interface TabsState {
  /** Open tabs, absolute paths, left→right (`WindowEntry.tabs`). */
  tabs: string[]
  /** The active tab; doubles as the window's `file` (title, URL hash, sidebar highlight). */
  active: string | null
  /**
   * Tabs visited since boot, in first-activation order: exactly the editors kept mounted.
   * A background tab's editor lazy-mounts on first activation — which is also why opening
   * one never steals focus (`focusEditor` only fires when an editor mounts).
   */
  mounted: string[]
}

export type TabsAction =
  | { type: 'open-current'; path: string } // sidebar click & friends: replace the active tab (activate instead when already open)
  | { type: 'open-new'; path: string } // append at the end + activate (activate instead when already open)
  | { type: 'open-background'; path: string } // append at the end, do NOT activate (no-op when already open)
  | { type: 'activate'; path: string } // tab-strip click
  | { type: 'close'; path: string } // ✕ / ⌘W: the active tab closes to its right neighbour, else left
  | { type: 'cycle'; dir: 1 | -1 } // ⌃Tab / ⌃⇧Tab: wraparound, plain left→right order
  | { type: 'reset'; tabs: string[]; active: string | null } // boot + root switch: replace wholesale, normalizing

const EMPTY: TabsState = { tabs: [], active: null, mounted: [] }

function withActive(s: TabsState, active: string): TabsState {
  return { tabs: s.tabs, active, mounted: s.mounted.includes(active) ? s.mounted : [...s.mounted, active] }
}

/** Pure; returns the SAME state object for a no-op so callers can skip the identity mirror. */
export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'open-current': {
      if (a.path === s.active) return s
      if (s.tabs.includes(a.path)) return withActive(s, a.path) // dedupe by path: activate, never duplicate
      if (s.active === null) return { tabs: [a.path], active: a.path, mounted: [a.path] }
      // Replace the active tab in its slot; the old file's editor unmounts (→ autosave flush).
      return {
        tabs: s.tabs.map((t) => (t === s.active ? a.path : t)),
        active: a.path,
        mounted: [...s.mounted.filter((t) => t !== s.active), a.path],
      }
    }
    case 'open-new': {
      if (a.path === s.active) return s
      if (s.tabs.includes(a.path)) return withActive(s, a.path)
      return { tabs: [...s.tabs, a.path], active: a.path, mounted: [...s.mounted, a.path] }
    }
    case 'open-background': {
      if (s.tabs.includes(a.path)) return s // already open: stay where we are, steal nothing
      // The first tab of an empty window must activate: non-empty `tabs` requires a non-null `file`.
      if (s.active === null) return { tabs: [a.path], active: a.path, mounted: [a.path] }
      return { ...s, tabs: [...s.tabs, a.path] } // not mounted: the editor lazy-mounts on first activation
    }
    case 'activate':
      return a.path === s.active || !s.tabs.includes(a.path) ? s : withActive(s, a.path)
    case 'close': {
      const i = s.tabs.indexOf(a.path)
      if (i === -1) return s
      const rest: TabsState = {
        tabs: s.tabs.filter((t) => t !== a.path),
        active: s.active,
        mounted: s.mounted.filter((t) => t !== a.path),
      }
      if (a.path !== s.active) return rest
      // ⌘W ladder (rule 7): the right neighbour takes over, else the left; closing the last
      // tab leaves the empty state — the window stays alive (App escalates to closeSelf only
      // on a ⌘W with zero tabs).
      const heir = s.tabs[i + 1] ?? s.tabs[i - 1] ?? null
      return heir === null ? { ...rest, active: null } : withActive({ ...rest, active: null }, heir)
    }
    case 'cycle': {
      if (s.active === null || s.tabs.length < 2) return s
      const i = s.tabs.indexOf(s.active)
      return withActive(s, s.tabs[(i + a.dir + s.tabs.length) % s.tabs.length])
    }
    case 'reset': {
      if (a.active === null) return s.tabs.length === 0 && s.active === null && s.mounted.length === 0 ? s : EMPTY
      const tabs = [...new Set(a.tabs)]
      // An active file missing from the list is PREPENDED — main's own normalization order.
      return { tabs: tabs.includes(a.active) ? tabs : [a.active, ...tabs], active: a.active, mounted: [a.active] }
    }
  }
}

/**
 * The boot state (rule 15): `storage`'s identity is valid AT BOOT only (`storage.init()`
 * resolves before the first render). Active-file precedence (GRO-2069/2160): a pasted
 * `#/abs/path` hash wins, then this window's restored file, then the folder's remembered
 * lastFile; a hash file missing from the stored tabs is added (rule 12). Only the active
 * tab's editor mounts.
 */
export function bootTabs(root: string | null): TabsState {
  if (root === null) return EMPTY
  const active = hashFilePath(location.hash) ?? storage.getFile() ?? storage.getLastFile(root)
  return tabsReducer(EMPTY, { type: 'reset', tabs: storage.getTabs(), active })
}

export interface UseTabs extends TabsState {
  /** Rule 11: sidebar single-click, inline-create, Bases row links, base embeds, deep links. */
  openCurrent: (path: string) => void
  /** Rule 5 (call sites arrive with I3's ⌘-click swap): append at the end + activate. */
  openNew: (path: string) => void
  /** Rule 5: append at the end without activating (and so without stealing focus). */
  openBackground: (path: string) => void
  activate: (path: string) => void
  close: (path: string) => void
  /** ⌘W: closes the active tab; false when there is none (App escalates to `closeSelf`). */
  closeActive: () => boolean
  next: () => void
  prev: () => void
  /** The root switched to `nextRoot` (rule 13): replace the list with the restored file, or nothing. */
  reset: (nextRoot: string | null, file: string | null) => void
}

export function useTabs(root: string | null): UseTabs {
  const [state, setState] = useState<TabsState>(() => bootTabs(root))
  // Dispatch reads/writes the ref so consecutive dispatches in one event see each other; the
  // mirror side effect stays OUT of the setState updater (StrictMode double-invokes updaters).
  const stateRef = useRef(state)
  const rootRef = useRef(root)
  rootRef.current = root

  const dispatch = useCallback((action: TabsAction, opts?: { root?: string | null; mirror?: boolean }): void => {
    const prevState = stateRef.current
    const nextState = tabsReducer(prevState, action)
    if (nextState === prevState) return
    stateRef.current = nextState
    setState(nextState)
    // ONE explicit write per change carries BOTH halves — tabs AND the active file.
    if (opts?.mirror !== false) storage.setTabs(opts?.root !== undefined ? opts.root : rootRef.current, nextState.tabs, nextState.active)
  }, [])

  const openCurrent = useCallback((path: string) => dispatch({ type: 'open-current', path }), [dispatch])
  const openNew = useCallback((path: string) => dispatch({ type: 'open-new', path }), [dispatch])
  const openBackground = useCallback((path: string) => dispatch({ type: 'open-background', path }), [dispatch])
  const activate = useCallback((path: string) => dispatch({ type: 'activate', path }), [dispatch])
  const close = useCallback((path: string) => dispatch({ type: 'close', path }), [dispatch])
  const closeActive = useCallback((): boolean => {
    const active = stateRef.current.active
    if (active === null) return false
    dispatch({ type: 'close', path: active })
    return true
  }, [dispatch])
  const next = useCallback(() => dispatch({ type: 'cycle', dir: 1 }), [dispatch])
  const prev = useCallback(() => dispatch({ type: 'cycle', dir: -1 }), [dispatch])
  const reset = useCallback(
    (nextRoot: string | null, file: string | null) =>
      // An empty reset mirrors nothing: `storage.setRoot` already wrote {root, file: null,
      // tabs: []} in ONE identity patch (rule 13). A restored file is one {tabs, file} write
      // against the NEW root (App's root state has not re-rendered yet, hence explicit).
      dispatch({ type: 'reset', tabs: [], active: file }, { root: nextRoot, mirror: file !== null }),
    [dispatch],
  )

  return { ...state, openCurrent, openNew, openBackground, activate, close, closeActive, next, prev, reset }
}
