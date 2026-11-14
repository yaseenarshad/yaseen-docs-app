/**
 * Turning "Separate value for <folder>" OFF (YAZ-4713 C3, 1B, locked 2026-11-08). The page's own values for a column
 * live in each page's `in: {<page id>}` block; off, the page reads the page's own field again. The ask counts the pages
 * first (`separateCounts`); then ONE guarded write per page moves the page value into the page's field and drops it
 * from the block (`mergeSeparateValues`), and Undo puts both back exactly (`restoreSeparateValues`). A read-only page is
 * never written: it keeps its block, which nothing reads while the column is shared.
 */
import { folderValues, setFolderValue } from '@shared/folderValues'
import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { foldedValue, heldKey, setFolderValueOneSpelling, setOneSpelling } from '@shared/propertyKeys'
import { isReadOnlyProperties } from '@shared/readOnly'
import type { IndexRecord } from '@shared/types'
import { reservedKeys } from '../links/reservedKeys'
import { transformFile } from './writeProperty'

/** How the page's values meet the pages' own: `total` pages hold a page value; `differ` of them hold another value in the page field. */
export interface SeparateCounts {
  total: number
  /** Page values that fill an empty page field, or match it. */
  fill: number
  differ: number
}

/** "Keep the pages' values" (a differing page value is dropped) or "Use the <folder> values" (it overwrites the field). */
export type SeparateKeep = 'pages' | 'page'

const empty = (value: unknown): boolean => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The pages holding a page value for `key` in the block of the page `pageId`. */
export const separateHolders = (records: readonly IndexRecord[], pageId: string | undefined, key: string): IndexRecord[] =>
  records.filter((record) => heldKey(folderValues(record.properties, pageId), key) !== undefined)

/** The ask's numbers, off the index. YAZ-4769: the field and the page value in any capitals. */
export function separateCounts(records: readonly IndexRecord[], pageId: string | undefined, key: string): SeparateCounts {
  const holders = separateHolders(records, pageId, key)
  const differ = holders.filter((record) => {
    const field = foldedValue(record.properties, key)
    return !empty(field) && !same(field, foldedValue(folderValues(record.properties, pageId), key))
  }).length
  return { total: holders.length, fill: holders.length - differ, differ }
}

/** One page changed by the merge, with what Undo puts back: the page field (absent = `field` undefined) and the block value. */
export interface MergedPage {
  path: string
  field: unknown
  block: unknown
}

/** One page's bytes with the page value moved into its field (or dropped, per `keep`), and what stood before. */
function mergeInContent(content: string, pageId: string, key: string, keep: SeparateKeep): { content: string; before?: Omit<MergedPage, 'path'> } {
  const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (parsed.error) throw new FrontmatterWriteError(parsed.error)
  if (isReadOnlyProperties(parsed.properties)) return { content }
  const block = folderValues(parsed.properties, pageId)
  // YAZ-4769: the page value and the page field in any capitals; the field is written in the column's, its other spellings out.
  const held = heldKey(block, key)
  if (held === undefined) return { content }
  const value = block[held]
  const field = foldedValue(parsed.properties, key)
  const cleared = setFolderValueOneSpelling(content, pageId, key, undefined)
  const take = keep === 'page' || empty(field)
  return { content: take && !same(field, value) ? setOneSpelling(cleared, key, value, reservedKeys(true)) : cleared, before: { field, block: value } }
}

/** The merge over the given pages, one guarded write each, all at once. Resolves with the pages it changed and how many writes failed. */
export async function mergeSeparateValues(paths: readonly string[], pageId: string, key: string, keep: SeparateKeep): Promise<{ changed: MergedPage[]; failed: number }> {
  const wrote = new Map<string, Omit<MergedPage, 'path'>>()
  const results = await Promise.allSettled(
    paths.map((path) =>
      transformFile(path, (content) => {
        // A conflict retry runs this again on fresher bytes: the last run says what the page held.
        const next = mergeInContent(content, pageId, key, keep)
        if (next.before === undefined) wrote.delete(path)
        else wrote.set(path, next.before)
        return next.content
      }),
    ),
  )
  return {
    changed: paths.filter((path, i) => results[i].status === 'fulfilled' && wrote.has(path)).map((path) => ({ path, ...wrote.get(path)! })),
    failed: results.filter((r) => r.status === 'rejected').length,
  }
}

/** Undo's door: each changed page gets its field and its page value back, exactly. A page that went read only since is not written. */
export async function restoreSeparateValues(changed: readonly MergedPage[], pageId: string, key: string): Promise<void> {
  await Promise.allSettled(
    changed.map(({ path, field, block }) =>
      transformFile(path, (content) => {
        const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
        if (parsed.error) throw new FrontmatterWriteError(parsed.error)
        if (isReadOnlyProperties(parsed.properties)) return content
        return setFolderValue(setFrontmatterProperty(content, key, field), pageId, key, block)
      }),
    ),
  )
}
