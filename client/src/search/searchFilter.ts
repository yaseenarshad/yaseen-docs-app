/**
 * The Search tab's filters (YAZ-3511 D13 to D17): a type and a time range, picked in the Search sort menu. They are not
 * saved (D15): a new search starts with all types at any time. They run on the candidates BEFORE the ranking cuts at
 * `SEARCH_CAP` (D16), so "PDFs" finds the PDFs past the first 50 matches.
 */
import { createElement, type ReactNode } from 'react'
import { fileKind } from '@shared/fileKind'
import { IMAGE_EXTENSIONS, type TreeNode } from '@shared/types'
import { FileIcon } from '../sidebar/FileIcon'
import type { MenuSection } from '../sidebar/menuSections'
import { timeOf } from '../sidebar/treeSort'
import type { SearchCandidate } from './searchCandidates'

export type SearchType = 'all' | 'markdown' | 'excalidraw' | 'drawio' | 'folders' | 'images' | 'pdfs' | 'other'
export type SearchTime = 'any' | 'today' | 'week' | 'month' | 'year'
export interface SearchFilter {
  type: SearchType
  time: SearchTime
}

/** No filter: what a new search starts with (D15). */
export const NO_FILTER: SearchFilter = { type: 'all', time: 'any' }

export const filterOn = (filter: SearchFilter): boolean => filter.type !== 'all' || filter.time !== 'any'

/** Each type with a name of its kind, whose icon the menu row shows: the icon a tree row of that kind shows (`FileIcon`). */
const TYPES: ReadonlyArray<[SearchType, string, string?]> = [
  ['all', 'All types'],
  ['markdown', 'Markdown', 'note.md'],
  ['excalidraw', 'Excalidraw', 'drawing.excalidraw'],
  ['drawio', 'draw.io', 'diagram.drawio'],
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
const OF_KIND = { markdown: 'markdown', drawing: 'excalidraw', diagram: 'drawio', image: 'images', pdf: 'pdfs', text: 'other' } as const
/** An image the app does not view as one, as `.svg` (a text file to the app), is still an Image to the eye. */
const IMAGES = new Set<string>(IMAGE_EXTENSIONS)

/** A row's type (D13): a folder, else its file's kind (`fileKind`, by the extension, case-blind). */
export function typeOf(row: Pick<SearchCandidate, 'kind' | 'path'>): Exclude<SearchType, 'all'> {
  if (row.kind === 'dir') return 'folders'
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
  return (row) => (filter.type === 'all' || typeOf(row) === filter.type) && (from === undefined || timeOf(row.path) >= from)
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

/** A type's icon in the menu: a tree row's, for a name of that kind. */
const typeIcon = (name: string): ReactNode => createElement(FileIcon, { path: name, folder: name === 'folder' })

/** The filters that are on, as the bar under the search box names them (YAZ-3511 D24): the type with its icon, then the time. */
export function filterChips(filter: SearchFilter): { key: keyof SearchFilter; label: string; icon?: ReactNode }[] {
  const type = TYPES.find(([value]) => value === filter.type)
  const time = TIMES.find(([value]) => value === filter.time)
  return [
    ...(filter.type === 'all' || type === undefined ? [] : [{ key: 'type' as const, label: type[1], ...(type[2] !== undefined && { icon: typeIcon(type[2]) }) }]),
    ...(filter.time === 'any' || time === undefined ? [] : [{ key: 'time' as const, label: time[1] }]),
  ]
}

/** The Search menu's Type and Time rows (D13, D14): each a flyout with its "all" choice apart, ✓ on the pick, the pick as the row's hint. */
export function filterSection(filter: SearchFilter, set: (next: SearchFilter) => void): MenuSection {
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
  return [flyout('type', TYPES, 'filter-type', 'Type'), flyout('time', TIMES, 'filter-time', 'Time')]
}
