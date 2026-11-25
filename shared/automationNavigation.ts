import { AutomationFailure } from './automation'
import type { ListScope, SidebarTab, WindowBounds, WorkspaceLists } from './types'

/** The sidebar lists `navigation open` can show. */
export type NavigationSidebar = 'files' | 'favorites' | 'focus'

/** How `navigation.open` places a target file into a window's tabs (YAZ-6539). */
export const TAB_MODES = ['reuse', 'new', 'activate-or-new'] as const
export type TabMode = (typeof TAB_MODES)[number]

/** OS-level window tiling presets computed against the target display's `workArea` (YAZ-6539). */
export const TILE_PRESETS = [
  'left',
  'right',
  'top',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'left-third',
  'center-third',
  'right-third',
  'left-two-thirds',
  'right-two-thirds',
  'center',
  'maximize',
] as const
export type TilePreset = (typeof TILE_PRESETS)[number]

/** Display selector for `window.move` and `navigation.open --tile` (YAZ-6539). */
export type DisplaySelector = 'primary' | 'cursor' | 'next' | number

/** Maximum number of paths accepted in one `navigation.open` batch call (YAZ-6539). */
export const MAX_BATCH_PATHS = 50

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  workArea: WindowBounds
  bounds: WindowBounds
}

export interface TabSummary {
  tab: string
  path: string | null
  title: string
  active: boolean
  dirty: boolean
}

export interface WindowInspectResult {
  path: string | null
  tab: string | null
  sidebar: SidebarTab
  sidebarCollapsed: boolean
  activeTab: string | null
  tabs: TabSummary[]
}

export interface NavigationInput {
  workspace?: string
  root?: string
  roots?: string[]
  path?: string
  paths?: string[]
  activePath?: string
  tabMode?: TabMode
  window?: string
  mode?: 'reuse' | 'new'
  focus?: boolean
  tile?: TilePreset
  display?: DisplaySelector
  sidebar?: NavigationSidebar
  scope?: ListScope
  group?: string
  view?: string
  reveal?: boolean
  allowPartial?: boolean
  readOnly?: boolean
  line?: number
}

/** Resolved in main before opening or raising a window. No unresolved name can select an arbitrary item. */
export interface NavigationTarget {
  path?: string
  paths?: string[]
  activePath?: string
  tabMode?: TabMode
  line?: number
  sidebar?: NavigationSidebar
  group?: string
  view?: string
  reveal?: boolean
}

export type RendererCommand =
  | { id: string; action: 'navigate'; target: NavigationTarget }
  | { id: string; action: 'inspect' }
  | { id: string; action: 'tab.activate'; tab?: string; path?: string }
  | { id: string; action: 'tab.close'; tab?: string; path?: string; tabs?: string[]; others?: boolean; force?: boolean }
  | { id: string; action: 'tab.move'; tab?: string; path?: string; to?: string; newWindow?: boolean; focus?: boolean }

export type RendererCommandBody = RendererCommand extends infer C ? (C extends { id: string } ? Omit<C, 'id'> : never) : never

export type RendererReply = { id: string; ok: true; value: unknown } | { id: string; ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }

/**
 * The Favorites or Focus list a window shows (YAZ-4450 D2, D4): the workspace list only with two or more vaults and that
 * tab's switch on; a vault alone always shows its own. The same rule as `useVaultListsHere`.
 */
export const shownListScope = (roots: readonly string[], separate: WorkspaceLists, kind: keyof WorkspaceLists): ListScope => (roots.length > 1 && separate[kind] ? 'workspace' : 'vault')

/** A folder view by name: the exact name first, else the one match without case. Main and the live page both pick by it. */
export function viewIndex(views: readonly { name: string }[], name: string): number {
  const exact = views.findIndex((view) => view.name === name)
  if (exact !== -1) return exact
  const loose = views.flatMap((view, i) => (view.name.toLowerCase() === name.toLowerCase() ? [i] : []))
  if (loose.length !== 1) throw new AutomationFailure(loose.length ? 'AMBIGUOUS_TARGET' : 'NOT_FOUND', 'Choose a unique folder view name.', { views: views.map((view) => view.name) })
  return loose[0]!
}
