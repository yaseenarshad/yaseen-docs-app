import type { IndexRecord } from '@shared/types'
import type { VaultData } from '../search/vaultData'

/**
 * DRAWINGS FIRST CLASS (YAZ-5473): the vault's drawings are files of their own, as pages and cards are. The index holds
 * Markdown only, so the phone makes a small record for each drawing file the vault holds (`VaultData.files`, the
 * checkpoint's list), and Search's tree, its typed search, Favorites, Focus and Recent take them beside the pages:
 *  - an Excalidraw drawing (`.excalidraw`): the Mac's drawing icon; the phone draws it (YAZ-5440's code);
 *  - a draw.io diagram (`.drawio.svg`, `.drawio.png`): the Mac's diagram icon; a picture already, shown as one;
 *  - a plain draw.io file (`.drawio`): the diagram icon; draw.io's own viewer draws it, as on the Mac (YAZ-5533).
 * The name is the Mac's (`pathTitles.ts` `fileLabel`): the file name without its board extension. Nothing is written.
 */

export type BoardKind = 'drawing' | 'diagram'

/** The board kind of a vault path, or null for any other file. */
export function boardKindOf(path: string): BoardKind | null {
  if (/\.excalidraw$/i.test(path)) return 'drawing'
  if (/\.drawio(\.(svg|png))?$/i.test(path)) return 'diagram'
  return null
}

/**
 * The Mac's row name of a file (`fileLabel`, with `boardBaseName`): its name less its last extension (`.excalidraw`,
 * `.drawio`; `flow.drawio.svg` is `flow.drawio`). Written out here: `@shared/fileKind` would add its lists to the first load.
 */
export function boardLabel(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

const hidden = (path: string) => path.split('/').some((part) => part.startsWith('.'))

/** A record for a board file: what the tree, the search and the lists read of a file. No text, no links. */
export function boardRecord(path: string): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const label = boardLabel(name)
  return {
    path,
    name,
    basename: label,
    title: label,
    folder: path.slice(0, Math.max(0, path.lastIndexOf('/'))),
    ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
    size: 0,
    ctime: 0,
    mtime: 0,
    properties: {},
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const held = new WeakMap<VaultData, { boards: Map<string, IndexRecord>; all: IndexRecord[] }>()

function boardsOf(data: VaultData) {
  let out = held.get(data)
  if (out === undefined) {
    const boards = new Map<string, IndexRecord>()
    for (const path of data.files) if (boardKindOf(path) !== null && !hidden(path) && data.byPath[path] === undefined) boards.set(path, boardRecord(path))
    out = { boards, all: boards.size === 0 ? (data.records as IndexRecord[]) : [...data.records, ...boards.values()] }
    held.set(data, out)
  }
  return out
}

/** The pages and card files of the vault, and its board files: what Search's tree and search read. Built once a version. */
export const recordsWithBoards = (data: VaultData): readonly IndexRecord[] => boardsOf(data).all

/** The record of `path`: a page's or a card file's from the index, else a board file's; undefined when the vault has none. */
export const fileRecord = (data: VaultData, path: string): IndexRecord | undefined => data.byPath[path] ?? boardsOf(data).boards.get(path)
