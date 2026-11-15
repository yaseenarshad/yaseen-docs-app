import { matchTier, readNeedle } from '@client/links/completion'
import { SEARCH_CAP, idQuery, searchCandidates, searchRows, type SearchCandidate } from '@client/search/searchCandidates'
import { holdsId } from '@shared/pageId'
import { FOLDER_SETTINGS_FILE, type IndexRecord } from '@shared/types'
import { boardKindOf } from '../drawing/boardFiles'

/**
 * THE PHONE'S SEARCH (YAZ-5079, 4C): the Mac's own search over the index records, with no bridge. The rows are the Mac's
 * (`searchCandidates`: titles, aliases, a file name given by hand, IDs; a card file is one card row while Review is on,
 * and each card in a page with an ID is one more row), and the ranking is the Mac's (`searchRows`). So one query gives
 * the same rows in the same order on both.
 *
 * What is the phone's own: the work runs in small slices (`Slice`, 3B's `uiSlicer`), so 5,000 pages and 20,000 cards
 * never hold the thread for a long task (50 ms):
 *  - `buildRows` builds the rows for some records at a time.
 *  - `findRows` reads the rows ONE time in slices and keeps only the rows that can show: each row whose ID the text holds,
 *    each row of `#<digits>`, and in each rank tier of the title match only its first `SEARCH_CAP` rows (the cap cuts
 *    after the tiers, so no later row can show). Then `searchRows` ranks that short list as the Mac ranks the whole one.
 *  - The Type filter (round 15, item 2; YAZ-5534) runs in the same pass, BEFORE the ranking, as the Mac's (D16).
 *
 * No folder rows: the phone opens no folder. The search box has no pinned items (the Mac's `first`).
 */

/**
 * The Type filter of the phone (YAZ-5534): the Mac's types and words (`searchFilter.ts`, YAZ-5047: Pages, Cards, Drawings,
 * Diagrams, in that order), the ones the phone opens. Cards only while Review is on.
 */
export type PhoneKind = 'pages' | 'cards' | 'drawings' | 'diagrams'
/** The types on, any mix (YAZ-5534: multi-select), in the menu's order; none on is All types. */
export type PhoneType = readonly PhoneKind[]
/** All types: no type on. */
export const ALL_TYPES: PhoneType = []
/** Each type in the menu's order, with the word the Mac's menu and chip show (`searchFilter.ts` `TYPES`). */
export const PHONE_KINDS: readonly (readonly [PhoneKind, string])[] = [
  ['pages', 'Pages'],
  ['cards', 'Cards'],
  ['drawings', 'Drawings'],
  ['diagrams', 'Diagrams'],
]

/** Called after each small piece of work: it gives the thread back when the slice has run long enough (`uiSlicer`). */
export type Slice = () => Promise<void>

/** What the search reads, from the open vault's index. */
export interface SearchSource {
  /** The index records, folder settings left out (`searchRecords`). */
  records: readonly IndexRecord[]
  /** The vault's ID letters, the current ones first (`idLettersOf`). */
  letters: readonly string[]
  /** The vault's Review is on (`.yaseendocs/review.json`, `enabled`; on when the file is absent, as on the Mac). */
  cards: boolean
}

/** The records search reads: the pages and card files, by path, with no folder settings record (`.folder.md`). */
export function searchRecords(records: Readonly<Record<string, IndexRecord>>): IndexRecord[] {
  const out: IndexRecord[] = []
  for (const path of Object.keys(records).sort()) if (records[path].name !== FOLDER_SETTINGS_FILE) out.push(records[path])
  return out
}

/** Records for each step of `buildRows`: one step is far under a millisecond. */
const RECORDS_A_STEP = 200
/** Rows for each step of `findRows`. */
const ROWS_A_STEP = 1000

const noSlice: Slice = () => Promise.resolve()

/** Every row of the source, in the Mac's order, built a few records at a time. Null when `live()` turns false. */
export async function buildRows(source: SearchSource, slice: Slice = noSlice, live: () => boolean = () => true): Promise<SearchCandidate[] | null> {
  const rows: SearchCandidate[] = []
  for (let i = 0; i < source.records.length; i += RECORDS_A_STEP) {
    // `searchCandidates` reads each record on its own, so a part of the list gives the part of the rows.
    for (const row of searchCandidates(source.records.slice(i, i + RECORDS_A_STEP), source.letters, source.cards)) rows.push(row)
    await slice()
    if (!live()) return null
  }
  return rows
}

/**
 * A row's type: a card (a card file's while Review is on, or a card in a page), a drawing (`.excalidraw`) or a diagram
 * (`.drawio`, `.drawio.svg`, `.drawio.png`) by YAZ-5473's kinds (`boardKindOf`), else a page; a folder has none. The Mac's
 * `typeOf` reads `.drawio.svg` as an image, a type the phone has not: here it is the diagram its tree row shows.
 */
export function phoneKindOf(row: Pick<SearchCandidate, 'kind' | 'path' | 'card'>): PhoneKind | null {
  if (row.kind === 'dir') return null
  if (row.card === true) return 'cards'
  const board = boardKindOf(row.path)
  return board === 'drawing' ? 'drawings' : board === 'diagram' ? 'diagrams' : 'pages'
}

/** The rows `type` keeps: a row of any type on; undefined for All types (a folder too). */
export function typeTest(type: PhoneType): ((row: SearchCandidate) => boolean) | undefined {
  if (type.length === 0) return undefined
  return (row) => {
    const kind = phoneKindOf(row)
    return kind !== null && type.includes(kind)
  }
}

/**
 * The rows the search box shows for `query` (not empty): `searchRows` of the Mac on the rows `type` keeps. The same rows
 * in the same order as `searchRows(rows.filter(keep), query)`, read in slices. Null when `live()` turns false.
 */
export async function findRows(rows: readonly SearchCandidate[], query: string, type: PhoneType, slice: Slice = noSlice, live: () => boolean = () => true): Promise<SearchCandidate[] | null> {
  const keep = typeTest(type)
  const needle = readNeedle(query)
  const holds = holdsId(query)
  const digits = idQuery(query)
  const inTier = [0, 0, 0, 0, 0]
  let numbered = false
  const short: SearchCandidate[] = []
  for (let i = 0; i < rows.length; i += ROWS_A_STEP) {
    const end = Math.min(rows.length, i + ROWS_A_STEP)
    for (let j = i; j < end; j++) {
      const row = rows[j]
      if (keep !== undefined && !keep(row)) continue
      const id = row.id
      const dash = id === undefined ? -1 : id.indexOf('-')
      let wanted = false
      // `#5` (`numberRows`): every row whose ID number starts with the digits, and one row with a number ID, so the short
      // list says "some row has a number ID" exactly when the whole list does.
      if (digits !== null && dash !== -1 && (id!.startsWith(digits, dash + 1) || !numbered)) {
        numbered = true
        wanted = true
      }
      // An ID the text holds (`holdsId`): each such row leads the answer, so each one stays.
      if (holds !== null && id !== undefined && holds(id, row.was)) wanted = true
      const tier = matchTier(row, needle)
      if (tier !== -1 && inTier[tier] < SEARCH_CAP) {
        inTier[tier]++
        wanted = true
      }
      if (wanted) short.push(row)
    }
    await slice()
    if (!live()) return null
  }
  return searchRows(short, query)
}
