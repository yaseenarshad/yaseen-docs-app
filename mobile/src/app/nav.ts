/**
 * The shell's navigation (decision 21): three tabs at the bottom, Friends · Review · Search, and screens that open
 * over them (Settings from the gear, and the screens Settings opens). Pure, so it is tested without React.
 */

export type Tab = 'friends' | 'review' | 'search'

/** In the order of the tab bar. There is no Pages tab: Search lists the pages when its box is empty (4C). */
export const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'friends', label: 'Friends' },
  { id: 'review', label: 'Review' },
  { id: 'search', label: 'Search' },
]

/** Decision 21: the app opens on Friends. With no friend yet, it opens on Review. */
export function openingTab(hasFriends: boolean): Tab {
  return hasFriends ? 'friends' : 'review'
}

/** A screen over the tabs (or over the first sign-in). The last one in the stack shows; Back closes it. */
export type Route =
  | { kind: 'settings' }
  /** The sign-in form for one more vault (decision 13: the same form adds a second vault). */
  | { kind: 'add-vault' }
  /** "Set up your phone" (round 11, item 9), opened from "How to make a token". */
  | { kind: 'guide' }
  /** "Scan a code" (round 11, item 23). `vault` set: the code must be for that vault (a new token for it). */
  | { kind: 'scan'; vault?: string }
  /** A new token for a vault: "Replace token" in Settings, or "Sign in again" (row N6). */
  | { kind: 'replace-token'; vault: string }

export interface NavState {
  tab: Tab
  stack: Route[]
}

export type NavAction = { type: 'tab'; tab: Tab } | { type: 'open'; route: Route } | { type: 'back' } | { type: 'home' }

export function navigate(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'tab':
      return { tab: action.tab, stack: [] }
    case 'open':
      return { ...state, stack: [...state.stack, action.route] }
    case 'back':
      return { ...state, stack: state.stack.slice(0, -1) }
    case 'home':
      return { ...state, stack: [] }
  }
}

export const topRoute = (state: NavState): Route | null => state.stack.at(-1) ?? null
