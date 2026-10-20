/**
 * For the tests of the tab model written before tabs had ids (YAZ-2940 D1): they read a state by
 * PATH. With no copies a path names exactly one tab, so these helpers give each tab the id of its
 * path, run the REAL reducer, and read the result back by path — a tab the reducer opened has a
 * new id, and reads as its path too. A no-op still returns the same object. The tests of copies
 * use the reducers directly, with ids.
 */
import type { StoredTab } from '@shared/types'
import { tabById, tabsReducer, workspaceReducer, type Tab, type TabHistory, type TabsAction, type TabsState, type WorkspaceAction, type WorkspaceState } from './useWorkspace'

/** A stored strip of plain tabs (YAZ-3057): one entry per path, no name, no mark — what `reset` gets from a window that stores no strip. */
export const plain = (...paths: string[]): StoredTab[] => paths.map((path) => ({ path }))

/** `TabsState` read by path. */
export interface PathTabs {
  tabs: string[]
  active: string | null
  mounted: string[]
  history: Record<string, TabHistory>
  preview: string | null
  blank: boolean
}

export type PathWorkspace = Omit<WorkspaceState, keyof TabsState> & PathTabs

/** The actions that name a tab, naming it by its path. */
type ByPath =
  | { type: 'activate' | 'close' | 'keep'; path: string }
  | { type: 'close-many'; paths: readonly string[] }
export type PathTabsAction = Exclude<TabsAction, { type: ByPath['type'] }> | ByPath
export type PathWorkspaceAction = Exclude<WorkspaceAction, { type: ByPath['type'] }> | ByPath

/** Each tab's id is its path. */
export function byId<S extends PathTabs>(s: S): Omit<S, 'tabs'> & { tabs: Tab[] } {
  return { ...s, tabs: s.tabs.map((path) => ({ id: path, path })) }
}

/** The state read by path. */
export function byPath<S extends TabsState>(s: S): Omit<S, keyof TabsState> & PathTabs {
  const p = (id: string): string => tabById(s, id)?.path ?? id
  return {
    ...s,
    tabs: s.tabs.map((t) => t.path),
    active: s.active === null ? null : p(s.active),
    mounted: s.mounted.map(p),
    history: Object.fromEntries(Object.entries(s.history).map(([id, r]) => [p(id), r])),
    preview: s.preview === null ? null : p(s.preview),
  }
}

function idAction<A extends PathTabsAction | PathWorkspaceAction>(a: A): TabsAction | WorkspaceAction {
  switch (a.type) {
    case 'activate':
    case 'close':
    case 'keep':
      return { type: a.type, id: a.path }
    case 'close-many':
      return { type: 'close-many', ids: a.paths }
    default:
      return a as TabsAction | WorkspaceAction
  }
}

/** `tabsReducer`, by path. */
export function pathTabsReducer(s: PathTabs, a: PathTabsAction): PathTabs {
  const before = byId(s)
  const after = tabsReducer(before, idAction(a) as TabsAction)
  return after === before ? s : byPath(after)
}

/** `workspaceReducer`, by path. */
export function pathWorkspaceReducer(s: PathWorkspace, a: PathWorkspaceAction): PathWorkspace {
  const before = byId(s)
  const after = workspaceReducer(before, idAction(a) as WorkspaceAction)
  return after === before ? s : byPath(after)
}
