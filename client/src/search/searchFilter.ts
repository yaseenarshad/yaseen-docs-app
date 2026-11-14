/**
 * The Search tab's filters (YAZ-3511 D13 to D17): a type and a time range, picked in the Search sort menu. They are not
 * saved (D15): a new search starts with all types at any time. They run on the candidates BEFORE the ranking cuts at
 * `SEARCH_CAP` (D16), so "PDFs" finds the PDFs past the first 50 matches. The types are the words people use (YAZ-5047):
 * Pages, Cards, Drawings, Diagrams — Cards only while a vault of the window has Review on (YAZ-5037).
 */
import { createElement, type ReactNode } from 'react'
import { fileKind } from '@shared/fileKind'
import { IMAGE_EXTENSIONS, type TreeNode } from '@shared/types'
import { FileIcon } from '../sidebar/FileIcon'
import { CardIcon } from './CardIcon'
import type { MenuSection } from '../sidebar/menuSections'
import { timeOf } from '../sidebar/treeSort'
import type { SearchCandidate } from './searchCandidates'

export type SearchType = 'all' | 'pages' | 'cards' | 'drawings' | 'diagrams' | 'folders' | 'images' | 'pdfs' | 'other'
export type SearchTime = 'any' | 'today' | 'week' | 'month' | 'year'
export interface SearchFilter {
  type: SearchType
  time: SearchTime
}

/** No filter: what a new search starts with (D15). */
export const NO_FILTER: SearchFilter = { type: 'all', time: 'any' }

export const filterOn = (filter: SearchFilter): boolean => filter.type !== 'all' || filter.time !== 'any'

/**
 * Each type with a name of its kind, whose icon the menu row shows: the icon a tree row of that kind shows (`FileIcon`);
 * `card` is the card icon (`CardIcon`).
 */
const TYPES: ReadonlyArray<[SearchType, string, string?]> = [
  ['all', 'All types'],
  ['pages', 'Pages', 'page.md'],
  ['cards', 'Cards', 'card'],
  ['drawings', 'Drawings', 'drawing.excalidraw'],
  ['diagrams', 'Diagrams', 'diagram.drawio'],
  ['folders', 'Folders', 'folder'],
  ['images', 'Images', 'image.png'],
  ['pdfs', 'PDFs', 'file.pdf'],
  ['other', 'Other', 'file'],
]
const TIMES: ReadonlyArray<[SearchTime, string]> = [
  ['any', 'Any time'],
  ['today', 'Today'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['year', 'This year'],
]

/** The type of each file kind (D13): the app's own kinds, so a type holds what its icon shows in the tree. Text files are Other. */
const OF_KIND = { markdown: 'pages', drawing: 'drawings', diagram: 'diagrams', image: 'images', pdf: 'pdfs', text: 'other' } as const
/** An image the app does not view as one, as `.svg` (a text file to the app), is still an Image to the eye. */
const IMAGES = new Set<string>(IMAGE_EXTENSIONS)

/**
 * A row's type (D13): a folder, a card (YAZ-5047: the index's `kind`, which the row carries as `card` only while its
 * vault's Review is on — else a card file is a page), else its file's kind (`fileKind`, by the extension, case-blind).
 */
export function typeOf(row: Pick<SearchCandidate, 'kind' | 'path' | 'card'>): Exclude<SearchType, 'all'> {
  if (row.kind === 'dir') return 'folders'
  if (row.card === true) return 'cards'
  const kind = fileKind(row.path)
  if (kind !== null && kind !== 'text') return OF_KIND[kind]
  return IMAGES.has(row.path.slice(row.path.lastIndexOf('.') + 1).toLowerCase()) ? 'images' : 'other'
}

/** Where a range starts (D14), on the local calendar of `now`: 00:00 today, Monday 00:00, the 1st, January 1; none for Any time. */
export function timeStart(time: SearchTime, now: number): number | undefined {
  if (time === 'any') return undefined
  const at = new Date(now)
  at.setHours(0, 0, 0, 0)
  if (time === 'week') at.setDate(at.getDate() - ((at.getDay() + 6) % 7))
  else if (time === 'month') at.setDate(1)
  else if (time === 'year') at.setMonth(0, 1)
  return at.getTime()
}

/**
 * The test a candidate must pass, or `undefined` with no filter. `from` is where the time range starts (`timeStart`), and
 * `timeOf` a row's time by its path — a file's mtime, a folder's newest file anywhere inside (D14). An empty folder (0) never passes.
 */
export function filterTest(filter: SearchFilter, timeOf: (path: string) => number, from: number | undefined): ((row: SearchCandidate) => boolean) | undefined {
  if (!filterOn(filter)) return undefined
  // A card in a page (YAZ-5037) has its page's time.
  return (row) => (filter.type === 'all' || typeOf(row) === filter.type) && (from === undefined || timeOf(row.page ?? row.path) >= from)
}

/** No times: a search with no time range reads none. */
export const NO_TIMES: ReadonlyMap<string, number> = new Map()

/** Each row's time by its path (D14), over the whole tree: a file's mtime, a folder's newest file anywhere inside (`timeOf`). */
export function timesByPath(trees: readonly TreeNode[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>()
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      out.set(node.path, timeOf(node))
      if (node.type === 'dir') walk(node.children)
    }
  }
  walk(trees)
  return out
}

/** A type's icon in the menu: a tree row's, for a name of that kind; the card icon for Cards. */
const typeIcon = (name: string): ReactNode => (name === 'card' ? createElement(CardIcon) : createElement(FileIcon, { path: name, folder: name === 'folder' }))
/** The types the menu offers: Cards only while Review is on (YAZ-5037). */
const typesFor = (cards: boolean) => (cards ? TYPES : TYPES.filter(([value]) => value !== 'cards'))

/** The filters that are on, as the bar under the search box names them (YAZ-3511 D24): the type with its icon, then the time. */
export function filterChips(filter: SearchFilter): { key: keyof SearchFilter; label: string; icon?: ReactNode }[] {
  const type = TYPES.find(([value]) => value === filter.type)
  const time = TIMES.find(([value]) => value === filter.time)
  return [
    ...(filter.type === 'all' || type === undefined ? [] : [{ key: 'type' as const, label: type[1], ...(type[2] !== undefined && { icon: typeIcon(type[2]) }) }]),
    ...(filter.time === 'any' || time === undefined ? [] : [{ key: 'time' as const, label: time[1] }]),
  ]
}

/** The Search menu's Type and Time rows (D13, D14): each a flyout with its "all" choice apart, ✓ on the pick, the pick as the row's hint. `cards`: a vault of the window has Review on. */
export function filterSection(filter: SearchFilter, set: (next: SearchFilter) => void, cards = false): MenuSection {
  const flyout = <K extends keyof SearchFilter>(key: K, choices: ReadonlyArray<[SearchFilter[K], string, string?]>, id: string, label: string) => {
    const leaf = ([value, text, iconOf]: [SearchFilter[K], string, string?]) => ({
      id: `${id}-${value}`,
      label: text,
      ...(iconOf !== undefined && { icon: typeIcon(iconOf) }),
      hint: filter[key] === value ? '✓' : undefined,
      onSelect: () => {
        if (filter[key] !== value) set({ ...filter, [key]: value })
      },
    })
    return { id, label, hint: choices.find(([value]) => value === filter[key])?.[1], children: [[leaf(choices[0])], choices.slice(1).map(leaf)] }
  }
  return [flyout('type', typesFor(cards), 'filter-type', 'Type'), flyout('time', TIMES, 'filter-time', 'Time')]
}

/** The Type flyout alone, as Search's (D13), for the Recents menu (YAZ-4450 demo): `omit` leaves out types its rows never have. Recents rows are the tree's: no Cards. */
export function typeFlyout(type: SearchType, set: (next: SearchType) => void, omit: readonly SearchType[] = []): MenuSection[number] {
  const choices = typesFor(false).filter(([value]) => !omit.includes(value))
  const leaf = ([value, text, iconOf]: (typeof TYPES)[number]) => ({
    id: `filter-type-${value}`,
    label: text,
    ...(iconOf !== undefined && { icon: typeIcon(iconOf) }),
    hint: type === value ? '✓' : undefined,
    onSelect: () => {
      if (type !== value) set(value)
    },
  })
  return { id: 'filter-type', label: 'Type', hint: choices.find(([value]) => value === type)?.[1], children: [[leaf(choices[0])], choices.slice(1).map(leaf)] }
}

/** A type's chip, as the search bar names it (D24): its name and its icon; null for All types. */
export function typeChip(type: SearchType): { label: string; icon?: ReactNode } | null {
  const found = TYPES.find(([value]) => value === type)
  if (type === 'all' || found === undefined) return null
  return { label: found[1], ...(found[2] !== undefined && { icon: typeIcon(found[2]) }) }
}
