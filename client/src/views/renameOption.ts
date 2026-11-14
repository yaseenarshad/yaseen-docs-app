/**
 * Renaming a Select or Multi-select option rewrites the pages that hold it (YAZ-4591 S24). The
 * declaration lands first (`FolderHost.setColumn`); then each indexed page holding the old label is
 * ONE guarded `transformFile` against its fresh bytes: the value is read again there, so a page
 * edited since the index saw it is renamed as it is now, and a page that no longer holds the label is
 * not written. Where the vault uses IDs the value is this folder's block (D19, `shared/folderValues.ts`);
 * where it does not, the page's own top-level key. Nothing else in a page moves. A read-only page
 * is never written (YAZ-3076 D6): it is counted as kept.
 */
import { folderValues } from '@shared/folderValues'
import { FrontmatterWriteError, parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { isRecord } from '@shared/guards'
import { foldedValue, setFolderValueOneSpelling, setOneSpelling } from '@shared/propertyKeys'
import { reservedKeys } from '../links/reservedKeys'
import { isReadOnlyProperties } from '@shared/readOnly'
import type { IndexRecord } from '@shared/types'
import { filterMentions } from './deleteColumn'
import type { FilterNode } from './viewSchema'
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

/** Where a folder keeps a page's values: its block of `in`, by the folder's id, or (null) the page's top level. */
export type ValueHome = { block: string } | null

const valuesOf = (properties: Record<string, unknown>, home: ValueHome): Record<string, unknown> => (home === null ? properties : folderValues(properties, home.block))

/** A page's value of `key` where `home` says, in any capitals (YAZ-4769). */
const valueOf = (properties: Record<string, unknown>, home: ValueHome, key: string): unknown => foldedValue(valuesOf(properties, home), key)

/**
 * `key`'s value put where `home` says, under `key`'s spelling: the page's other spellings of it go in the same write
 * (YAZ-4769), the app's keys never.
 */
const putValue = (content: string, home: ValueHome, key: string, value: unknown): string =>
  home === null ? setOneSpelling(content, key, value, reservedKeys(true)) : setFolderValueOneSpelling(content, home.block, key, value)

/**
 * One page's bytes with the rename applied to `key`, and the value it held, or the same bytes when the page does not
 * hold `from` — or is read only on disk (YAZ-4637 M6): a `readonly: true` page is never written, wherever it is.
 */
export function renameInContent(content: string, home: ValueHome, key: string, from: string, to: string): { content: string; before?: unknown } {
  const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (parsed.error) throw new FrontmatterWriteError(parsed.error)
  if (isReadOnlyProperties(parsed.properties)) return { content }
  const before = valueOf(parsed.properties, home, key)
  const next = renamedValue(before, from, to)
  if (next === undefined) return { content }
  return { content: putValue(content, home, key, next), before }
}

/** A page the rename changed, with the exact value it held before (YAZ-4637 M5): what Undo puts back. */
export interface ChangedPage {
  path: string
  before: unknown
}

export interface RenameResult {
  /** The pages rewritten: Undo restores these alone, each to its `before`. */
  changed: ChangedPage[]
  /** Pages holding the label that were not rewritten: read only, or the write failed. */
  kept: number
}

/** The indexed pages holding `from` under `key`, as `home` keeps them. */
export const pagesWithOption = (records: readonly IndexRecord[], home: ValueHome, key: string, from: string): IndexRecord[] =>
  records.filter((record) => {
    const value = valueOf(record.properties, home, key)
    return value === from || holds(value, from)
  })

/** Rename `from` to `to` under `key` in every page of `records` holding it: one guarded write per page, all at once. */
export async function renameOptionInPages(records: readonly IndexRecord[], home: ValueHome, key: string, from: string, to: string, locked: ReadonlySet<string>): Promise<RenameResult> {
  const holders = pagesWithOption(records, home, key, from)
  const writable = holders.filter((record) => !locked.has(record.path)).map((record) => record.path)
  const { changed } = await renameInPaths(writable, home, key, from, to)
  // Every holder not rewritten: locked, read only on disk (M6), or a failed write.
  return { changed, kept: holders.length - changed.length }
}

/** The writes themselves, over the given pages, each with the value it held before (M5). */
export async function renameInPaths(paths: readonly string[], home: ValueHome, key: string, from: string, to: string): Promise<{ changed: ChangedPage[]; failed: number }> {
  const wrote = new Map<string, unknown>()
  const results = await Promise.allSettled(
    paths.map((path) =>
      transformFile(path, (content) => {
        // A conflict retry runs this again on fresher bytes: the last run says whether the page changed, and what it held.
        const next = renameInContent(content, home, key, from, to)
        if (next.content !== content) wrote.set(path, next.before)
        else wrote.delete(path)
        return next.content
      }),
    ),
  )
  return {
    changed: paths.filter((path, i) => results[i].status === 'fulfilled' && wrote.has(path)).map((path) => ({ path, before: wrote.get(path) })),
    failed: results.filter((r) => r.status === 'rejected').length,
  }
}

/**
 * Undo's door (YAZ-4637 M5): each changed page gets back the exact value it held — not a reverse rename, which would
 * leave a list that held both labels one short. A page that went read only since is not written.
 */
export async function restoreInPaths(changed: readonly ChangedPage[], home: ValueHome, key: string): Promise<void> {
  await Promise.allSettled(
    changed.map(({ path, before }) =>
      transformFile(path, (content) => {
        const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
        if (parsed.error) throw new FrontmatterWriteError(parsed.error)
        if (isReadOnlyProperties(parsed.properties)) return content
        return putValue(content, home, key, before)
      }),
    ),
  )
}

/** A literal as the filter builder quotes it (`filterRows.ts`). */
const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`
const unescape = (s: string): string => s.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))

/** A filter leaf with every literal equal to `from` reading `to`, when the leaf names the column; else itself. */
function renameInLeaf(expr: string, key: string, from: string, to: string): string {
  if (!filterMentions(expr, key)) return expr
  return expr.replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (literal, dq: string | undefined, sq: string | undefined) => (unescape(dq ?? sq ?? '') === from ? quote(to) : literal))
}

function renameInFilter(node: FilterNode, key: string, from: string, to: string): FilterNode {
  if (typeof node === 'string') return renameInLeaf(node, key, from, to)
  const [op, children] = Object.entries(node)[0] as ['and' | 'or' | 'not', FilterNode[]]
  const next = children.map((child) => renameInFilter(child, key, from, to))
  return next.every((child, i) => child === children[i]) ? node : ({ [op]: next } as FilterNode)
}

/**
 * The views' filters that compare the column to the old label, renamed with it (YAZ-4637 M5): `status == "A"` reads
 * `"B"` once A is B, so the renamed pages stay in their filtered views; a calendar's "Cross out when" (`crossOut`,
 * YAZ-4864) is a filter tree too, so the renamed pages stay crossed out (YAZ-4834 P2). Runs over the raw `views` of the
 * settings block, in the declaration's own write; the same list comes back when nothing changed.
 */
export function renameOptionInFilters(views: unknown, key: string, from: string, to: string): unknown {
  if (!Array.isArray(views)) return views
  let changed = false
  const out = views.map((view: unknown) => {
    if (!isRecord(view)) return view
    let next = view
    for (const tree of ['filters', 'crossOut'] as const) {
      if (view[tree] === undefined) continue
      const renamed = renameInFilter(view[tree] as FilterNode, key, from, to)
      if (renamed === view[tree]) continue
      changed = true
      next = { ...next, [tree]: renamed }
    }
    return next
  })
  return changed ? out : views
}

/** The toast's words: what was renamed, in how many pages, and how many kept the old label. */
export function renameNotice(from: string, to: string, { changed, kept }: RenameResult): string {
  const pages = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`
  return `Renamed “${from}” to “${to}” in ${pages(changed.length)}${kept > 0 ? ` · ${pages(kept)} not changed` : ''}`
}
