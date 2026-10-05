import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'

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
 * content. Only `in` is rewritten (`setFrontmatterProperty`, which refuses frontmatter that will
 * not parse); clearing a field the block does not hold returns the same string.
 */
export function setFolderValue(content: string, folderId: string, key: string, value: unknown): string {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (error === undefined && value === undefined && !Object.prototype.hasOwnProperty.call(folderValues(properties, folderId), key)) return content
  return setFrontmatterProperty(content, FOLDER_VALUES_KEY, withFolderValues(properties, folderId, { [key]: value })[FOLDER_VALUES_KEY])
}
