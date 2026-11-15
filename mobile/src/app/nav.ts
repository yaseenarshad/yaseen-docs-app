/**
 * The shell's navigation (decision 21): the tabs at the bottom, Friends · Review · Search, and screens that open over
 * them (Settings from the gear, and the screens Settings opens). Pure, so it is tested without React.
 *
 * YAZ-5476: the tabs follow the OPEN vault's own settings (`vaultTabs.ts`). Search is always there. Review and Friends
 * only while the vault's Review is on (Friends compares review numbers). The Today button (YAZ-5470) only while its
 * Daily pages are on. A plain vault has Search alone, and then there is no tab bar at all (`showsTabBar`).
 */

export type Tab = 'friends' | 'review' | 'search'

/** In the order of the tab bar. There is no Pages tab: Search lists the pages when its box is empty (4C). */
export const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'friends', label: 'Friends' },
  { id: 'review', label: 'Review' },
  { id: 'search', label: 'Search' },
]

/** What the open vault turns on (`vaultTabs.ts`): its Review (cards), its Daily pages. */
export interface VaultTabs {
  review: boolean
  daily: boolean
}

/** A vault with neither: Search alone. Also the answer while nothing is known yet. */
export const PLAIN_VAULT: VaultTabs = Object.freeze({ review: false, daily: false })

/** The tab may show in this vault: Search always; Review and Friends with Review on. */
export const hasTab = (tab: Tab, vault: VaultTabs): boolean => tab === 'search' || vault.review

/** The tabs of the bar for this vault, in order. */
export const tabsOf = (vault: VaultTabs): readonly { id: Tab; label: string }[] => TABS.filter((t) => hasTab(t.id, vault))

/** More than one thing in the bar (a tab or Today): with Search alone, the bar is not drawn. */
export const showsTabBar = (vault: VaultTabs): boolean => tabsOf(vault).length + (vault.daily ? 1 : 0) > 1

/** The tab to show: `tab`, or Search when this vault has no such tab (it went away, or the vault changed). */
export const tabIn = (tab: Tab, vault: VaultTabs): Tab => (hasTab(tab, vault) ? tab : 'search')

/** Decision 21: the app opens on Friends. With no friend yet, it opens on Review. A vault with Review off: Search. */
export function openingTab(hasFriends: boolean, vault: VaultTabs): Tab {
  return tabIn(hasFriends ? 'friends' : 'review', vault)
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
  /**
   * 4C (YAZ-5079): a page, read only. `at`: the ID of a card on it to show first ("Open page" of a card). `heading`: the
   * `#part` a link named (YAZ-5455): the page opens at that heading.
   */
  | { kind: 'page'; path: string; at?: string; heading?: string }
  /** 4C (round 12, item 10): a card alone, read only: the card, its review history, "Open page" for a card in a page. */
  | { kind: 'card'; path: string; id: string }
  /** YAZ-5473: a drawing file on its own (`.excalidraw`, `.drawio.svg`; a `.drawio` says "Open it on the Mac"), read only. */
  | { kind: 'drawing'; path: string }
  /** 4E4 (decision 23): "You vs <friend>". `theirs`: the friend's pointer; or `group` and `pointer`: a member of a group. */
  | { kind: 'friend'; theirs: string; group?: undefined; pointer?: undefined }
  | { kind: 'friend'; group: string; pointer: string; theirs?: undefined }

export interface NavState {
  tab: Tab
  stack: Route[]
}

/** `swap`: `route` IN PLACE of the top screen (the page arrows): Back still goes to the screen under. */
export type NavAction = { type: 'tab'; tab: Tab } | { type: 'open'; route: Route } | { type: 'swap'; route: Route } | { type: 'back' } | { type: 'home' }

export function navigate(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'tab':
      return { tab: action.tab, stack: [] }
    case 'open':
      return { ...state, stack: [...state.stack, action.route] }
    case 'swap':
      return { ...state, stack: [...state.stack.slice(0, -1), action.route] }
    case 'back':
      return { ...state, stack: state.stack.slice(0, -1) }
    case 'home':
      return { ...state, stack: [] }
  }
}

export const topRoute = (state: NavState): Route | null => state.stack.at(-1) ?? null
