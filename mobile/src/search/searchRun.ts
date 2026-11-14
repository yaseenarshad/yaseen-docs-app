import { matchTier, readNeedle } from '@client/links/completion'
import { SEARCH_CAP, idQuery, searchCandidates, searchRows, type SearchCandidate } from '@client/search/searchCandidates'
import { filterTest, typeOf } from '@client/search/searchType'
import { holdsId } from '@shared/pageId'
import { FOLDER_SETTINGS_FILE, type IndexRecord } from '@shared/types'

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
 *  - The Type filter (round 15, item 2) runs in the same pass, BEFORE the ranking, as the Mac's (`filterTest`, D16).
 *
 * No folder rows: the phone opens no folder. The search box has no pinned items (the Mac's `first`).
 */

/** The Type filter of the phone (round 15, item 2): All types, Pages, Cards. Cards only while Review is on. */
export type PhoneType = 'all' | 'pages' | 'cards'

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

/** The rows `type` keeps: the Mac's own test (`filterTest`), with no time range. */
export function typeTest(type: PhoneType): ((row: SearchCandidate) => boolean) | undefined {
  return filterTest({ type, time: 'any' }, () => 0, undefined)
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

/** The rows of the empty box: `type` Cards lists the cards; All types and Pages list the pages (round 15, item 2). */
export function emptyBoxRows(rows: readonly SearchCandidate[], type: PhoneType): SearchCandidate[] {
  // The first row of each record is its title row (`searchCandidates`); a card in a page is a card row of its own.
  const seen = new Set<string>()
  const out: SearchCandidate[] = []
  for (const row of rows) {
    const cardInPage = row.page !== undefined
    if (!cardInPage && seen.has(row.path)) continue
    if (!cardInPage) seen.add(row.path)
    const kind = typeOf(row)
    if ((type === 'cards' && kind === 'cards') || (type !== 'cards' && kind === 'pages' && !cardInPage)) out.push(row)
  }
  // By name, letter case aside. A plain compare of lowered names: `localeCompare` on 20,000 rows is a long task.
  return out.map((row) => ({ row, key: row.lower })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((held) => held.row)
}
