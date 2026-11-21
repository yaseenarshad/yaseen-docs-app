/**
 * The Search tab's type and its test, with no bridge and no icons (YAZ-5079): the phone's search (4C) filters its rows
 * with the Mac's own rule. `searchFilter.ts` gives out the same names, with the menu and its icons.
 */
import { fileKind } from '@shared/fileKind'
import { IMAGE_EXTENSIONS } from '@shared/types'
import type { SearchCandidate } from './searchCandidates'

export type SearchType = 'all' | 'pages' | 'cards' | 'drawings' | 'diagrams' | 'folders' | 'images' | 'pdfs' | 'other'
export type SearchTime = 'any' | 'today' | 'week' | 'month' | 'year'
export interface SearchFilter {
  type: SearchType
  time: SearchTime
  /** Include inline drawings and cards inside pages (YAZ-6143). Undefined/true = include; false = files only. */
  includeInline?: boolean
}

/** No filter: what a new search starts with (D15). */
export const NO_FILTER: SearchFilter = { type: 'all', time: 'any' }

export const filterOn = (filter: SearchFilter): boolean => filter.type !== 'all' || filter.time !== 'any' || filter.includeInline === false

/** The type of each file kind (D13): the app's own kinds, so a type holds what its icon shows in the tree. Text files are Other. */
const OF_KIND = { markdown: 'pages', drawing: 'drawings', diagram: 'diagrams', image: 'images', pdf: 'pdfs', text: 'other' } as const
/** An image the app does not view as one, as `.svg` (a text file to the app), is still an Image to the eye. */
const IMAGES = new Set<string>(IMAGE_EXTENSIONS)

/**
 * A row's type (D13): a folder, a card (YAZ-5047: the index's `kind`, which the row carries as `card` only while its
 * vault's Review is on — else a card file is a page), an inline drawing (YAZ-6143), else its file's kind (`fileKind`, by the extension, case-blind).
 */
export function typeOf(row: Pick<SearchCandidate, 'kind' | 'path' | 'card' | 'inlineDrawing'>): Exclude<SearchType, 'all'> {
  if (row.kind === 'dir') return 'folders'
  if (row.card === true) return 'cards'
  if (row.inlineDrawing === true) return 'drawings'
  const kind = fileKind(row.path)
  if (kind !== null && kind !== 'text') return OF_KIND[kind]
  return IMAGES.has(row.path.slice(row.path.lastIndexOf('.') + 1).toLowerCase()) ? 'images' : 'other'
}

/**
 * The test a candidate must pass, or `undefined` with no filter. `from` is where the time range starts (`timeStart`), and
 * `timeOf` a row's time by its path — a file's mtime, a folder's newest file anywhere inside (D14). An empty folder (0) never passes.
 */
export function filterTest(filter: SearchFilter, timeOf: (path: string) => number, from: number | undefined): ((row: SearchCandidate) => boolean) | undefined {
  if (!filterOn(filter)) return undefined
  // A card or inline drawing in a page (YAZ-5037, YAZ-6143) has its page's time.
  return (row) =>
    (filter.includeInline !== false || row.page === undefined) &&
    (filter.type === 'all' || typeOf(row) === filter.type) &&
    (from === undefined || timeOf(row.page ?? row.path) >= from)
}
