import { AutomationFailure } from './automation'
import type { ListScope, WorkspaceLists } from './types'

/** The sidebar lists `navigation open` can show. */
export type NavigationSidebar = 'files' | 'favorites' | 'focus'

export interface NavigationInput {
  workspace?: string
  root?: string
  roots?: string[]
  path?: string
  window?: string
  mode?: 'reuse' | 'new'
  sidebar?: NavigationSidebar
  scope?: ListScope
  group?: string
  view?: string
  reveal?: boolean
  allowPartial?: boolean
}

/** Resolved in main before opening or raising a window. No unresolved name can select an arbitrary item. */
export interface NavigationTarget {
  path?: string
  sidebar?: NavigationSidebar
  group?: string
  view?: string
  reveal?: boolean
}
export type RendererCommand = { id: string; action: 'navigate'; target: NavigationTarget }
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
