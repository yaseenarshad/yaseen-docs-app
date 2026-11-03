/**
 * EXCALIDRAW'S PUBLIC LIBRARIES (YAZ-4157 demo 6K): about 3,100 named hand-drawn items in the 160 libraries that name them (of about 230), at
 * libraries.excalidraw.com, with no key. They go on the board as editable elements, in the board's own style.
 *
 * The index (`libraries.json`, about 200 KB) names every item of a version-2 library (`itemNames`, in the order of
 * its `libraryItems`). It is fetched once a day and handed to the Add tab whole, which ranks it as you type with the
 * app's one matcher: no request per key. A library FILE is fetched only for an item the tab draws or adds, and one
 * file serves all its items. A library with no `itemNames` (version 1) has no names to search, so it is left out.
 */
import type { StudioItem } from '@shared/types'

export const LIBRARIES_ORIGIN = 'https://libraries.excalidraw.com'
export const LIBRARIES_INDEX_URL = `${LIBRARIES_ORIGIN}/libraries.json`

/** `<author>/<name>.excalidrawlib`: the only shape of `source` the index uses, and the only one fetched. */
const SOURCE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.excalidrawlib$/

/** The most elements bytes one item may bring: the size rule of a saved component (`MAX_COMPONENT_ELEMENTS_BYTES`, `client/src/components-library/componentData.ts`). */
export const MAX_DRAWING_ELEMENTS_BYTES = 750_000

/** The most bytes read for the index (about 200 KB today) and for one library file (most are under 1 MB). */
export const MAX_INDEX_BYTES = 4 * 1024 * 1024
export const MAX_LIBRARY_FILE_BYTES = 16 * 1024 * 1024
/** How many library files main keeps parsed in memory; the disk cache holds the rest for 24 h. */
export const MAX_LIBRARY_FILES_IN_MEMORY = 8

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `<source>#<index>` → its parts, or null when it is not one this file made. */
export function parseDrawingId(id: string): { source: string; index: number } | null {
  const at = id.lastIndexOf('#')
  const source = id.slice(0, at)
  const index = Number(id.slice(at + 1))
  return at > 0 && SOURCE.test(source) && Number.isSafeInteger(index) && index >= 0 ? { source, index } : null
}

/** The index as Add tab items: one per named item of a library with a usable `source`. */
export function indexItems(index: unknown): StudioItem[] {
  if (!Array.isArray(index)) return []
  const items: StudioItem[] = []
  for (const library of index) {
    if (!isRecord(library) || typeof library.source !== 'string' || !SOURCE.test(library.source) || !Array.isArray(library.itemNames)) continue
    const author = Array.isArray(library.authors) && isRecord(library.authors[0]) ? library.authors[0] : undefined
    library.itemNames.forEach((name, i) => {
      if (typeof name !== 'string' || name.trim() === '') return
      const providerId = `${library.source as string}#${i}`
      const item: StudioItem = {
        itemKey: `excalidraw:${providerId}`,
        provider: 'excalidraw',
        providerId,
        kind: 'drawing',
        title: name.trim(),
        sourceUrl: `https://github.com/excalidraw/excalidraw-libraries/blob/main/libraries/${library.source as string}`,
      }
      if (typeof library.name === 'string') item.collectionName = library.name
      if (typeof author?.name === 'string') item.creator = author.name
      if (typeof author?.url === 'string' && author.url.startsWith('https://')) item.creatorUrl = author.url
      items.push(item)
    })
  }
  return items
}

/**
 * The elements of item `index` of a library file. Version 2 is `libraryItems[i].elements`; the name the index gave
 * must match, or the item is found by that name (a library updated since the index was read). Version 1 is
 * `library[i]`. Null when there is no such item.
 */
export function libraryItemElements(file: unknown, index: number, name: string | null): unknown[] | null {
  if (!isRecord(file)) return null
  if (Array.isArray(file.libraryItems)) {
    const items = file.libraryItems.filter(isRecord)
    const at = items[index]
    const item = name === null || at?.name === name ? at : items.find((candidate) => candidate.name === name)
    return Array.isArray(item?.elements) ? item.elements : null
  }
  if (Array.isArray(file.library)) {
    const elements = file.library[index]
    return Array.isArray(elements) ? elements : null
  }
  return null
}
