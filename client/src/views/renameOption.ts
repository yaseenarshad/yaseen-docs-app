/**
 * Renaming a Select or Multi-select option rewrites the notes that hold it (YAZ-4591 S24). The
 * declaration lands first (`FolderHost.setColumn`); then each indexed note holding the old label is
 * ONE guarded `transformFile` against its fresh bytes: the value is read again there, so a note
 * edited since the index saw it is renamed as it is now, and a note that no longer holds the label is
 * not written. Where the vault uses IDs the value is this folder's block (D19, `shared/folderValues.ts`);
 * where it does not, the note's own top-level key. Nothing else in a note moves. A read-only note
 * is never written (YAZ-3076 D6): it is counted as kept.
 */
import { folderValues, setFolderValue } from '@shared/folderValues'
import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import type { IndexRecord } from '@shared/types'
import { transformFile } from './writeProperty'

/**
 * The value with `from` renamed to `to`, or undefined when it does not hold `from`. A scalar is
 * replaced; in a list only the elements equal to `from` change, and a `to` already there is not doubled.
 */
export function renamedValue(value: unknown, from: string, to: string): unknown {
  if (value === from) return to
  if (!holds(value, from)) return undefined
  const out: unknown[] = []
  for (const item of value) {
    const next = item === from ? to : item
    if (next === to && out.includes(to)) continue
    out.push(next)
  }
  return out
}

const holds = (value: unknown, label: string): value is unknown[] => Array.isArray(value) && value.includes(label)

/** Where a folder keeps a note's values: its block of `in`, by the folder's id, or (null) the note's top level. */
export type ValueHome = { block: string } | null

const valuesOf = (properties: Record<string, unknown>, home: ValueHome): Record<string, unknown> => (home === null ? properties : folderValues(properties, home.block))

/** One note's bytes with the rename applied to `key`, or the same bytes when the note does not hold `from`. */
export function renameInContent(content: string, home: ValueHome, key: string, from: string, to: string): string {
  const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (parsed.error) throw new FrontmatterWriteError(parsed.error)
  const next = renamedValue(valuesOf(parsed.properties, home)[key], from, to)
  if (next === undefined) return content
  return home === null ? setFrontmatterProperty(content, key, next) : setFolderValue(content, home.block, key, next)
}

export interface RenameResult {
  /** The notes rewritten: Undo renames back in these alone. */
  changed: string[]
  /** Notes holding the label that were not rewritten: read only, or the write failed. */
  kept: number
}

/** The indexed notes holding `from` under `key`, as `home` keeps them. */
export const notesWithOption = (records: readonly IndexRecord[], home: ValueHome, key: string, from: string): IndexRecord[] =>
  records.filter((record) => {
    const value = valuesOf(record.properties, home)[key]
    return value === from || holds(value, from)
  })

/** Rename `from` to `to` under `key` in every note of `records` holding it: one guarded write per note, all at once. */
export async function renameOptionInNotes(records: readonly IndexRecord[], home: ValueHome, key: string, from: string, to: string, locked: ReadonlySet<string>): Promise<RenameResult> {
  const holders = notesWithOption(records, home, key, from)
  const writable = holders.filter((record) => !locked.has(record.path)).map((record) => record.path)
  const { changed, failed } = await renameInPaths(writable, home, key, from, to)
  return { changed, kept: holders.length - writable.length + failed }
}

/** The writes themselves, over the given notes: Undo's door too, which renames back in the notes the rename changed. */
export async function renameInPaths(paths: readonly string[], home: ValueHome, key: string, from: string, to: string): Promise<{ changed: string[]; failed: number }> {
  const wrote = new Set<string>()
  const results = await Promise.allSettled(
    paths.map((path) =>
      transformFile(path, (content) => {
        // A conflict retry runs this again on fresher bytes: the last run says whether the note changed.
        const next = renameInContent(content, home, key, from, to)
        if (next !== content) wrote.add(path)
        else wrote.delete(path)
        return next
      }),
    ),
  )
  return { changed: paths.filter((path, i) => results[i].status === 'fulfilled' && wrote.has(path)), failed: results.filter((r) => r.status === 'rejected').length }
}

/** The toast's words: what was renamed, in how many notes, and how many kept the old label. */
export function renameNotice(from: string, to: string, { changed, kept }: RenameResult): string {
  const notes = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`
  return `Renamed “${from}” to “${to}” in ${notes(changed.length)}${kept > 0 ? ` · ${notes(kept)} not changed` : ''}`
}
