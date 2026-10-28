/**
 * The Search tab's filters (YAZ-3511 D13 to D17): a type and a time range, picked in the Search sort menu. They are not
 * saved (D15): a new search starts with all types at any time. They run on the candidates BEFORE the ranking cuts at
 * `SEARCH_CAP` (D16), so "PDFs" finds the PDFs past the first 50 matches.
 */
import { IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS, PDF_EXTENSIONS } from '@shared/types'
import type { MenuSection } from '../sidebar/menuSections'
import type { SearchCandidate } from './searchCandidates'

export type SearchType = 'all' | 'notes' | 'folders' | 'images' | 'pdfs' | 'other'
export type SearchTime = 'any' | 'today' | 'week' | 'month' | 'year'
export interface SearchFilter {
  type: SearchType
  time: SearchTime
}

/** No filter: one object, so a search with none hands the ranking nothing new. */
export const NO_FILTER: SearchFilter = { type: 'all', time: 'any' }

export const filterOn = (filter: SearchFilter): boolean => filter.type !== 'all' || filter.time !== 'any'

const TYPES: ReadonlyArray<[SearchType, string]> = [
  ['all', 'All types'],
  ['notes', 'Notes'],
  ['folders', 'Folders'],
  ['images', 'Images'],
  ['pdfs', 'PDFs'],
  ['other', 'Other'],
]
const TIMES: ReadonlyArray<[SearchTime, string]> = [
  ['any', 'Any time'],
  ['today', 'Today'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['year', 'This year'],
]

const IMAGES = new Set<string>(IMAGE_EXTENSIONS.map((ext) => `.${ext}`))
const NOTES = new Set<string>(MARKDOWN_EXTENSIONS)
const PDFS = new Set<string>(PDF_EXTENSIONS)

/** A row's type (D13): a folder, else its file's extension, case-blind. */
export function typeOf(row: Pick<SearchCandidate, 'kind' | 'path'>): Exclude<SearchType, 'all'> {
  if (row.kind === 'dir') return 'folders'
  const name = row.path.slice(row.path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const ext = dot <= 0 ? '' : name.slice(dot).toLowerCase()
  return NOTES.has(ext) ? 'notes' : IMAGES.has(ext) ? 'images' : PDFS.has(ext) ? 'pdfs' : 'other'
}

/** Where a range starts (D14), on the local calendar of `now`: 00:00 today, Monday 00:00, the 1st, January 1. */
export function timeStart(time: Exclude<SearchTime, 'any'>, now: number): number {
  const at = new Date(now)
  at.setHours(0, 0, 0, 0)
  if (time === 'week') at.setDate(at.getDate() - ((at.getDay() + 6) % 7))
  else if (time === 'month') at.setDate(1)
  else if (time === 'year') at.setMonth(0, 1)
  return at.getTime()
}

/**
 * The test a candidate must pass, or `undefined` with no filter. `timeOf` is a row's time by its path — a file's mtime,
 * a folder's newest file anywhere inside (D14) — and is read only while a time range is on. An empty folder (0) never passes.
 */
export function filterTest(filter: SearchFilter, timeOf: (path: string) => number, now: number): ((row: SearchCandidate) => boolean) | undefined {
  if (!filterOn(filter)) return undefined
  const from = filter.time === 'any' ? undefined : timeStart(filter.time, now)
  return (row) => (filter.type === 'all' || typeOf(row) === filter.type) && (from === undefined || (timeOf(row.path) >= from && timeOf(row.path) > 0))
}

/** The Search menu's Type and Time rows (D13, D14): each a flyout with its "all" choice apart, ✓ on the pick, the pick as the row's hint. */
export function filterSection(filter: SearchFilter, set: (next: SearchFilter) => void): MenuSection {
  const flyout = <K extends keyof SearchFilter>(key: K, choices: ReadonlyArray<[SearchFilter[K], string]>, id: string, label: string) => {
    const leaf = ([value, text]: [SearchFilter[K], string]) => ({
      id: `${id}-${value}`,
      label: text,
      hint: filter[key] === value ? '✓' : undefined,
      onSelect: () => {
        if (filter[key] !== value) set({ ...filter, [key]: value })
      },
    })
    return { id, label, hint: choices.find(([value]) => value === filter[key])?.[1], children: [[leaf(choices[0])], choices.slice(1).map(leaf)] }
  }
  return [flyout('type', TYPES, 'filter-type', 'Type'), flyout('time', TIMES, 'filter-time', 'Time')]
}
