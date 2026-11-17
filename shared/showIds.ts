import { idNumber } from './pageId'

/**
 * "Show IDs" (YAZ-4940), the vault's `.yaseendocs/show-ids.json`: what the file holds, and how a files-list row shows
 * an ID. Shared by the Mac (`client/src/search/showIds.ts`, which reads and writes it) and the phone (YAZ-5454, which
 * only reads it: Search's tree follows "In the files list" as the Mac's sidebar does).
 */
export const SHOW_IDS_FILE = 'show-ids.json'
export type IdsInSearch = 'always' | 'match'
/** "In the files list": Off, the ID's number ("#12"), or the full ID ("EMB-12"). */
export type IdsInFiles = 'off' | 'number' | 'full'
export interface ShowIdsSettings {
  search: IdsInSearch
  /** The ID after the page's title (On, the default). */
  title: boolean
  /** The ID at the right end of a page's row in the sidebar's files list (Off, the default). */
  files: IdsInFiles
}
export const DEFAULT_SHOW_IDS: ShowIdsSettings = { search: 'always', title: true, files: 'off' }
/** The keys this build's writer owns (YAZ-5483): every other key of the file is kept on a save. */
export const SHOW_IDS_KEYS: readonly string[] = Object.keys(DEFAULT_SHOW_IDS)

/**
 * What the file holds, or the default for anything else: an old file (`search` alone) reads as title On, files list
 * Off; round 2's boolean files list reads `true` as Number, `false` as Off.
 */
export function sanitizeShowIds(raw: unknown): ShowIdsSettings {
  const held = typeof raw === 'object' && raw !== null ? (raw as { search?: unknown; title?: unknown; files?: unknown }) : {}
  return { search: held.search === 'match' ? 'match' : 'always', title: held.title !== false, files: held.files === true || held.files === 'number' ? 'number' : held.files === 'full' ? 'full' : 'off' }
}


/** A page row's ID as "In the files list" shows it (YAZ-4940): Number, "#" and its number ("EMB-12" → "#12", an ID with no number in full); Full, the ID. */
export function idInFiles(id: string, form: Exclude<IdsInFiles, 'off'>): string {
  const number = form === 'number' ? idNumber(id) : undefined
  return number === undefined ? id : `#${number}`
}
