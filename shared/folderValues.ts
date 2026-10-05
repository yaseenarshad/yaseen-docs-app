import { FrontmatterWriteError, parseFrontmatter, setFrontmatterIn, setFrontmatterProperty, splitFrontmatter } from './frontmatter'

/**
 * A folder's values for a note (D19): `in`, one block per FOLDER ID, each holding that folder's
 * columns for the note. The note's own fields stay at the top level; a folder's views and the
 * properties panel read and write only that folder's block. The app's own key, never a column.
 */
export const FOLDER_VALUES_KEY = 'in'

const isMap = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** ONE folder's values as the note holds them. A folder with no id, an `in` that is no map and a block that is no map all read as none. */
export function folderValues(properties: Record<string, unknown>, folderId: string | undefined): Record<string, unknown> {
  const blocks = properties[FOLDER_VALUES_KEY]
  const block = folderId !== undefined && isMap(blocks) ? blocks[folderId] : undefined
  return isMap(block) ? block : {}
}

/** EVERY folder's block, by folder id, as written: what the index and the rename read a note's folder values through. Tolerant as `folderValues` is. */
export function folderBlocks(properties: Record<string, unknown>): [string, Record<string, unknown>][] {
  const blocks = properties[FOLDER_VALUES_KEY]
  return isMap(blocks) ? Object.entries(blocks).filter((entry): entry is [string, Record<string, unknown>] => isMap(entry[1])) : []
}

/** A map to write into, or a refusal: an `in` or a block that is no map is someone else's value, never overwritten. */
function writable(value: unknown, what: string): Record<string, unknown> {
  if (value == null) return {}
  if (!isMap(value)) throw new FrontmatterWriteError(`${what} is not a map of values`)
  return { ...value }
}

/**
 * `properties` with `values` set in ONE folder's block (`undefined` clears a field), beside what
 * the block already holds. An emptied block goes, and `in` with its last block.
 */
export function withFolderValues(properties: Record<string, unknown>, folderId: string, values: Record<string, unknown>): Record<string, unknown> {
  const blocks = writable(properties[FOLDER_VALUES_KEY], `"${FOLDER_VALUES_KEY}"`)
  const block = writable(blocks[folderId], `"${FOLDER_VALUES_KEY}.${folderId}"`)
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete block[key]
    else block[key] = value
  }
  if (Object.keys(block).length === 0) delete blocks[folderId]
  else blocks[folderId] = block
  const { [FOLDER_VALUES_KEY]: _, ...own } = properties
  return Object.keys(blocks).length === 0 ? own : { ...own, [FOLDER_VALUES_KEY]: blocks }
}

/**
 * Set (or clear, when `value === undefined`) ONE field of ONE folder's block in a whole file's
 * content. Only that field's own line is written (`setFrontmatterIn`, which refuses frontmatter
 * that will not parse): the rest of `in` keeps its quoting and layout, so two devices changing
 * different values of one note merge. Clearing a field the block does not hold returns the same
 * string; the block goes with its last field, and `in` with its last block.
 */
export function setFolderValue(content: string, folderId: string, key: string, value: unknown): string {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (error === undefined && value === undefined && !Object.hasOwn(folderValues(properties, folderId), key)) return content
  // What the change leaves says how much goes: the field, its emptied block, or an emptied `in`.
  const blocks = withFolderValues(properties, folderId, { [key]: value })[FOLDER_VALUES_KEY]
  const path = !isMap(blocks) ? [FOLDER_VALUES_KEY] : !Object.hasOwn(blocks, folderId) ? [FOLDER_VALUES_KEY, folderId] : [FOLDER_VALUES_KEY, folderId, key]
  return setFrontmatterIn(content, path, value)
}

/**
 * A whole file's content with the block of the folder `from` named `to` instead, where it stood: a
 * copied folder's values, under the copy's id. The same string when the note holds no block for
 * `from`, already holds one for `to` (never overwritten), or its frontmatter will not parse.
 */
export function moveFolderValues(content: string, from: string, to: string): string {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  const blocks = properties[FOLDER_VALUES_KEY]
  if (error !== undefined || !isMap(blocks) || !Object.hasOwn(blocks, from) || Object.hasOwn(blocks, to)) return content
  return setFrontmatterProperty(content, FOLDER_VALUES_KEY, Object.fromEntries(Object.entries(blocks).map(([id, block]) => [id === from ? to : id, block])))
}

/**
 * A folder's values leave the note when the note leaves the folder (D20): `properties` without the
 * blocks of the folders that are `known` — some settings record has that id — and not among the
 * ones `showing` the note. A block for an id the app does not know (a folder deleted, or not synced
 * yet) is kept. The same object when nothing goes; `in` goes with its last block.
 */
export function withoutStaleFolderValues(properties: Record<string, unknown>, showing: ReadonlySet<string>, known: ReadonlySet<string>): Record<string, unknown> {
  const blocks = properties[FOLDER_VALUES_KEY]
  if (!isMap(blocks)) return properties
  const kept = Object.entries(blocks).filter(([id]) => showing.has(id) || !known.has(id))
  if (kept.length === Object.keys(blocks).length) return properties
  const { [FOLDER_VALUES_KEY]: _, ...own } = properties
  return kept.length === 0 ? own : { ...own, [FOLDER_VALUES_KEY]: Object.fromEntries(kept) }
}
