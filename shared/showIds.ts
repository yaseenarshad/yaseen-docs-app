import { idNumber } from './pageId'

/**
 * "Show IDs" (YAZ-4940), the vault's `.yaseendocs/show-ids.json`: what the file holds, and how a files-list row shows
 * an ID. Shared by the Mac (`client/src/search/showIds.ts`, which reads and writes it) and the phone (YAZ-5454, which
 * only reads it: Search's tree follows "In the files list" as the Mac's sidebar does).
 */
export const SHOW_IDS_FILE = 'show-ids.json'
/** "In search" (YAZ-4940, YAZ-6502): Off, the ID's number ("#12"), the full ID ("EMB-12"), or only on an ID match. */
export const IDS_IN_SEARCH = ['off', 'number', 'full', 'match'] as const
export type IdsInSearch = (typeof IDS_IN_SEARCH)[number]
/** "In the files list": Off, the ID's number ("#12"), or the full ID ("EMB-12"). */
export type IdsInFiles = 'off' | 'number' | 'full'
/** "In tabs" (YAZ-6464): Off, the ID's number ("#12"), or the full ID ("EMB-12"). */
export const IDS_IN_TABS = ['off', 'number', 'full'] as const
export type IdsInTabs = (typeof IDS_IN_TABS)[number]
/** "Tab ID layout" (YAZ-6464): inline before the title, or stacked above it on two lines. */
export const TAB_ID_LAYOUTS = ['inline', 'stacked'] as const
export type TabIdLayout = (typeof TAB_ID_LAYOUTS)[number]
export interface ShowIdsSettings {
  search: IdsInSearch
  /** The ID after the page's title (On, the default). */
  title: boolean
  /** The ID at the right end of a page's row in the sidebar's files list (Off, the default). */
  files: IdsInFiles
  /** The ID at the right end of a page's row in the sidebar's Recents list (YAZ-6537; Off, the default). */
  recents: IdsInFiles
  /** The ID shown on open tabs in the tab strip (Off, the default). */
  tabs: IdsInTabs
  /** How a tab's ID sits with its title: inline before it (the default) or stacked above it. */
  tabsLayout: TabIdLayout
}
export const DEFAULT_SHOW_IDS: ShowIdsSettings = { search: 'number', title: true, files: 'off', recents: 'off', tabs: 'off', tabsLayout: 'inline' }
/** The keys this build's writer owns (YAZ-5483): every other key of the file is kept on a save. */
export const SHOW_IDS_KEYS: readonly string[] = Object.keys(DEFAULT_SHOW_IDS)

/**
 * What the file holds, or the default for anything else: an old file (`search` alone) reads as title On, files list
 * Off, recents Off, tabs Off, tabsLayout Inline; legacy `search: 'always'` migrates to `'number'` (YAZ-6502); round 2's boolean
 * files list reads `true` as Number, `false` as Off.
 */
export function sanitizeShowIds(raw: unknown): ShowIdsSettings {
  const held = typeof raw === 'object' && raw !== null ? (raw as { search?: unknown; title?: unknown; files?: unknown; recents?: unknown; tabs?: unknown; tabsLayout?: unknown }) : {}
  return {
    search: held.search === 'off' || held.search === 'number' || held.search === 'full' || held.search === 'match' ? held.search : 'number',
    title: held.title !== false,
    files: held.files === true || held.files === 'number' ? 'number' : held.files === 'full' ? 'full' : 'off',
    recents: held.recents === 'number' ? 'number' : held.recents === 'full' ? 'full' : 'off',
    tabs: held.tabs === 'number' ? 'number' : held.tabs === 'full' ? 'full' : 'off',
    tabsLayout: held.tabsLayout === 'stacked' ? 'stacked' : 'inline',
  }
}


/** A page row's ID as "In the files list" shows it (YAZ-4940): Number, "#" and its number ("EMB-12" → "#12", an ID with no number in full); Full, the ID. */
export function idInFiles(id: string, form: Exclude<IdsInFiles, 'off'>): string {
  const number = form === 'number' ? idNumber(id) : undefined
  return number === undefined ? id : `#${number}`
}
