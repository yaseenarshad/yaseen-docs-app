/**
 * The Linked mentions column (YAZ-4738 L1, L3; YAZ-4739 L2): for each row, the pages and folders that link to its page,
 * read off the snapshot's one reverse map (`mentionsMap`, L5) and never written into a page. A row's value is the links
 * a link column would hold, one per mentioning page (`pageLinkOf`), so it reads, sorts, filters and opens as one.
 */
import { folderBlocks } from '@shared/folderValues'
import { exactLinkTarget } from '@shared/linkRewrite'
import type { IndexRecord, MentionsFrom } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { mentionsMap } from '../links/backlinks'
import { rowPage } from '../links/shortcuts'
import type { RunOptions } from './engine'
import type { ColumnDecl } from './folderSettings'
import { pageLinkOf } from './view/fills'

/** Whether `key` (bare, or `note.`-prefixed) is a Linked mentions column of `columns`. */
export function isMentionsColumn(columns: Readonly<Record<string, ColumnDecl>>, key: string): boolean {
  const bare = key.startsWith('note.') ? key.slice(5) : key
  return Object.hasOwn(columns, bare) && columns[bare].kind === 'mentions'
}

/** Whether a field's value holds a link to `target`: a whole-value `[[…]]`, alone or in a list, as the index reads a field's links. */
function holdsLinkTo(value: unknown, target: string, resolve: ResolveLink): boolean {
  const values = Array.isArray(value) ? value : [value]
  return values.some((v) => {
    const link = typeof v === 'string' ? exactLinkTarget(v, (page) => resolve(page) !== null) : null
    return link !== null && resolve(link) === target
  })
}

/** Whether `record` mentions `target` in its field `column`: its own field, or a page's value of it (`in`, C3). */
function inColumn(record: IndexRecord, column: string, target: string, resolve: ResolveLink): boolean {
  if (holdsLinkTo(record.properties[column], target, resolve)) return true
  return folderBlocks(record.properties).some(([, values]) => holdsLinkTo(values[column], target, resolve))
}

/** A column's `from` (L2), its folder resolved once per column: `dir` null = a folder the vault does not have, so no mention counts. */
interface Narrowing {
  dir?: string | null
  column?: string
}

const narrowingOf = (from: MentionsFrom | undefined, resolve: ResolveLink): Narrowing => ({
  ...(from?.folder !== undefined && { dir: resolve(exactLinkTarget(from.folder, (page) => resolve(page) !== null) ?? from.folder) }),
  ...(from?.column !== undefined && { column: from.column }),
})

/** The mentions a narrowing lets count: under its folder, then in its column. With neither, all of them. */
function narrowed(list: readonly IndexRecord[], { dir, column }: Narrowing, target: string, resolve: ResolveLink): readonly IndexRecord[] {
  let out = list
  if (dir !== undefined) out = dir === null ? [] : out.filter((m) => m.path.startsWith(`${dir}/`))
  if (column !== undefined) out = out.filter((m) => inColumn(m, column, target, resolve))
  return out
}

/**
 * The engine's `mentions` for a page with `columns` (its own and its parent folders', C2), or undefined when none is a
 * Linked mentions column. `records` and `folders` are the vault's snapshot and `resolve` its resolver: the reverse map
 * is built once for them and shared. A row's target is its page: a page's path, a subfolder row's directory.
 */
export function mentionsColumns(columns: Readonly<Record<string, ColumnDecl>>, records: readonly IndexRecord[], folders: readonly IndexRecord[], resolve: ResolveLink): RunOptions['mentions'] {
  const keys = Object.keys(columns).filter((key) => columns[key].kind === 'mentions')
  if (keys.length === 0) return undefined
  const map = mentionsMap(records, folders, resolve)
  const narrowings = new Map(keys.map((key) => [key, narrowingOf(columns[key].from, resolve)]))
  return {
    keys,
    of: (record, key) => {
      const target = rowPage(record.path)
      return narrowed(map.get(target) ?? [], narrowings.get(key) ?? {}, target, resolve).map((m) => pageLinkOf(m, resolve))
    },
  }
}
