/**
 * Two-way relations for link columns (YAZ-4781). A link is stored in ONE note: the link column's field of the linking
 * note. "Both ways" (R1) adds the other side's column on the folder the Relation names: a Linked mentions column tied to
 * the link column (`pair: true`, `from: { column, folder }`), worked out from the snapshot's one mentions map. Its cells
 * edit from that side (R2): a row's new list becomes writes of the link column's field in the notes added to the list
 * or taken out of it. The row's own note is never written, and a toggle never changes a note value.
 */
import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { isRecord } from '@shared/guards'
import { exactLinkTarget } from '@shared/linkRewrite'
import { isReadOnlyProperties } from '@shared/readOnly'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { rowPage } from '../links/shortcuts'
import { CHANGE_CANCELLED } from './confirmChanges'
import { pruneStored } from './deleteColumn'
import { type ColumnDecl, insertFolderColumn, rebaseSettings, removeFolderColumn, rewriteFolderViews, writeFolderColumn } from './folderSettings'
import { readOnlyTip } from './readOnlyRows'
import type { UnitText } from '../vault/unitWord'
import { transformFile } from './writeProperty'

/** R1: the tied column of link column `key` among `columns` — its `from` names `key` and a folder `owns` says is the link column's — or undefined. */
export function tiedKeyOf(columns: Readonly<Record<string, ColumnDecl>>, key: string, owns: (folderLink: string | undefined) => boolean): string | undefined {
  return Object.keys(columns).find((k) => {
    const decl = columns[k]
    return decl.kind === 'mentions' && decl.pair === true && decl.from?.column === key && owns(decl.from.folder)
  })
}

/** R1: the tied column's first key, "Recipes · Pairs with", made free among `taken` by a number ("Recipes · Pairs with 2"). */
export function tiedKeyFor(name: string, taken: Readonly<Record<string, unknown>>): string {
  if (!Object.hasOwn(taken, name)) return name
  for (let n = 2; ; n++) if (!Object.hasOwn(taken, `${name} ${n}`)) return `${name} ${n}`
}

/** R1 Both ways: the tied column on the `.folder.md` at `path`, shown last in each of its table views that list their columns. ONE write. */
export function addTiedColumn(path: string, key: string, decl: ColumnDecl, ids: boolean): Promise<{ mtime: number }> {
  const column = `note.${key}`
  const shown = (views: unknown): unknown =>
    Array.isArray(views) ? views.map((v) => (isRecord(v) && v.type === 'table' && Array.isArray(v.order) && !v.order.includes(column) ? { ...v, order: [...v.order, column] } : v)) : views
  return writeFolderColumn(path, key, decl, undefined, ids, shown)
}

/**
 * R1 One way: the tied column goes from the `.folder.md` at `path` — the views' references and its label, then the
 * declaration. No note changes. Resolves with the Undo: the declaration back before `before` (the column after it), and
 * the references laid back onto the views as they are then.
 */
export async function removeTiedColumn(path: string, key: string, decl: ColumnDecl, before: string | null): Promise<() => Promise<void>> {
  const prune = pruneStored(`note.${key}`)
  const was = await rewriteFolderViews(path, prune)
  await removeFolderColumn(path, key, null)
  const left = prune(was.views, was.properties)
  return async () => {
    await insertFolderColumn(path, key, decl, before)
    await rewriteFolderViews(path, (views, labels) => ({ views: rebaseSettings(left.views, was.views, views), properties: rebaseSettings(left.properties, was.properties, labels) }))
  }
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value])

/** The page a stored link names (a `[[…]]` or bare text), or null. */
const pageOf = (v: unknown, resolve: ResolveLink): string | null => (typeof v === 'string' && v.trim() !== '' ? resolve(exactLinkTarget(v, (page) => resolve(page) !== null) ?? v.trim()) : null)

/** R2: what a tied cell's write changes — the pages `next` holds and `before` does not (`add`), and the other way (`remove`). A link in `next` that names no page refuses the write. */
export function pairPlan(before: unknown, next: unknown, resolve: ResolveLink): { add: string[]; remove: string[] } {
  const was = new Set(listOf(before).map((v) => pageOf(v, resolve)).filter((p): p is string => p !== null))
  const now = new Set<string>()
  for (const v of listOf(next)) {
    const page = pageOf(v, resolve)
    if (page === null) throw new Error(`Can't find ${String(v)}`)
    now.add(page)
  }
  return { add: [...now].filter((p) => !was.has(p)), remove: [...was].filter((p) => !now.has(p)) }
}

/**
 * R2: a linking note's link-column value with the link to `page` added (`link`, in the app's form for that column) or
 * taken out. `multi` (Multi-link): add appends, remove filters it out. A one-value Link: add sets it, remove clears the
 * field. The same value back when nothing changes.
 */
export function pairedValue(value: unknown, link: string, page: string, add: boolean, multi: boolean, resolve: ResolveLink): unknown {
  const list = listOf(value)
  const holds = (v: unknown) => pageOf(v, resolve) === page
  if (add) return list.some(holds) ? value : multi ? [...list, link] : link
  if (!list.some(holds)) return value
  return multi || Array.isArray(value) ? list.filter((v) => !holds(v)) : null
}

/** R2: the link a one-value Link column holds that adding `page` would replace, or null when it is empty or holds `page`. */
export function replacedLink(value: unknown, page: string, resolve: ResolveLink): string | null {
  const other = listOf(value).find((v) => pageOf(v, resolve) !== page)
  return typeof other === 'string' && other.trim() !== '' ? other : null
}

/** R2: the ask before a replace (ConfirmSheet): "Chocolate cake pairs with Lemon tart. Replace it with Apple pie?" */
export const replaceAsk = (note: string, column: string, held: string, row: string): string => `${note} ${column.charAt(0).toLowerCase()}${column.slice(1)} ${held}. Replace it with ${row}?`

/** What a host's write of a tied cell resolves with (R2): the Undo of exactly the notes it wrote, each field back as it was. */
export interface PairWritten {
  undoPair: () => Promise<void>
}

export const isPairWritten = (result: unknown): result is PairWritten => isRecord(result) && typeof result.undoPair === 'function'

export interface TiedCellWrite {
  /** The row whose tied cell is written (a note, or a folder row): the page the links point to. */
  row: IndexRecord
  /** The link to the row's page, as the link column holds it (`noteLinkOf`: an ID link where the vault uses IDs, else a path link). */
  rowLink: string
  /** The link column's key, and the absolute directory of its folder with that folder's name. */
  column: string
  owner: string
  ownerName: string
  multi: boolean
  before: unknown
  next: unknown
  resolve: ResolveLink
  /** The snapshot's record of a page (a note, or a folder's settings record). */
  recordOf: (page: string) => IndexRecord | undefined
  /** The replace ask; false cancels the whole write. */
  ask: (text: string) => Promise<boolean>
  /** The record's title as the UI shows it. */
  titleOf: (link: string) => string
  /** The vault's word for a note (YAZ-4938), for the refusal of a read-only note. */
  unit?: UnitText
}

/**
 * R2: a tied cell's write, as writes of the link column in the linking notes — never in the row's note. Every note is
 * checked first (under the link column's folder, not read only), and a one-value Link that holds another link asks
 * before it is replaced; Cancel writes nothing. Resolves with the Undo: each written note's field back as it was.
 */
export async function writeTiedCell(w: TiedCellWrite): Promise<PairWritten> {
  const { add, remove } = pairPlan(w.before, w.next, w.resolve)
  const page = rowPage(w.row.path)
  const changes = [...add.map((p) => ({ page: p, add: true })), ...remove.map((p) => ({ page: p, add: false }))].map((change) => {
    const record = w.recordOf(change.page)
    if (change.page === page) throw new Error(`${w.row.title} can't link to itself here`)
    if (record === undefined) throw new Error(`Can't find ${change.page.slice(change.page.lastIndexOf('/') + 1)}`)
    if (change.add && !record.path.startsWith(`${w.owner}/`)) throw new Error(`${record.title} is not in ${w.ownerName}`)
    if (isReadOnlyProperties(record.properties)) throw new Error(`${record.title} is read only`)
    return { ...change, record }
  })
  if (!w.multi) {
    for (const { record } of changes.filter((c) => c.add)) {
      const held = replacedLink(record.properties[w.column], page, w.resolve)
      if (held !== null && !(await w.ask(replaceAsk(record.title, w.column, w.titleOf(held), w.row.title)))) throw CHANGE_CANCELLED
    }
  }
  const written: { path: string; was: unknown }[] = []
  const results = await Promise.allSettled(
    changes.map(async ({ record, add: on }) => {
      let was: unknown
      await transformFile(record.path, (content) => {
        const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
        if (parsed.error) throw new FrontmatterWriteError(parsed.error)
        if (isReadOnlyProperties(parsed.properties)) throw new Error(readOnlyTip(w.unit))
        was = parsed.properties[w.column]
        const value = pairedValue(was, w.rowLink, page, on, w.multi, w.resolve)
        return value === was ? content : setFrontmatterProperty(content, w.column, value)
      })
      written.push({ path: record.path, was })
    }),
  )
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed.length > 0) throw failed[0].reason instanceof Error ? failed[0].reason : new Error(String(failed[0].reason))
  return {
    undoPair: async () => {
      await Promise.all(written.map(({ path, was }) => transformFile(path, (content) => setFrontmatterProperty(content, w.column, was))))
    },
  }
}
