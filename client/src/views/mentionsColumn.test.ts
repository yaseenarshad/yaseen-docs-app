/**
 * The Linked mentions column (YAZ-4738 L1, L3, L5; YAZ-4739 L2): the snapshot's one reverse map, each row's value off it,
 * and the engine reading it as a field no note holds — cells, "is empty", sort by count.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { linkResolver } from '../links/folderLinks'
import { mentionsMap } from '../links/backlinks'
import { columnTyping } from './editorType'
import { type ColumnDecl, folderSettings } from './folderSettings'
import { mentionsColumns } from './mentionsColumn'
import { resolverFor, runView } from './engine'
import { linkText, type LinkValue } from './expr'
import { writableKey } from './readOnlyRows'
import type { ViewSet } from './viewSchema'

const rec = (path: string, init: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  const basename = name.replace(/\.md$/, '')
  return { path, name, basename, title: basename, folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...init }
}

const DIRS = ['/vault/API', '/vault/Schema', '/vault/Web']
const TOTAL = rec('/vault/Schema/total.md')
const UNUSED = rec('/vault/Schema/unused.md')
const ROUTE = rec('/vault/API/POST orders.md', { links: ['total', 'Web'], properties: { reads_writes: ['[[total]]'] } })
/** Links `total` in its body only: the field it holds names another note. */
const HOOK = rec('/vault/Web/useOrders.md', { links: ['total', 'POST orders'], properties: { calls: '[[POST orders]]' } })
const NOTES = [ROUTE, TOTAL, UNUSED, HOOK]
const WEB = rec('/vault/Web/.folder.md', { title: 'Web' })
const FOLDERS = [WEB]

const resolverOf = (records = NOTES, folders = FOLDERS): ResolveLink => linkResolver(records, '/vault', DIRS, folders)
const column = (decl: Partial<ColumnDecl> = {}): Record<string, ColumnDecl> => ({ used_by: { kind: 'mentions', ...decl } })
const titlesOf = (resolve: ResolveLink, columns: Record<string, ColumnDecl>, record: IndexRecord): string[] =>
  [...mentionsColumns(columns, NOTES, FOLDERS, resolve)!.of(record, 'used_by')].map((link) => link.slice(2, -2))

describe('the Linked mentions column (YAZ-4738)', () => {
  it('a row lists the pages that link to it, by the link a link column would hold; a folder row lists the links to its folder', () => {
    const resolve = resolverOf()
    expect(titlesOf(resolve, column(), TOTAL)).toEqual(['POST orders', 'useOrders'])
    expect(titlesOf(resolve, column(), UNUSED)).toEqual([])
    // A subfolder row's page is its folder: the route links [[Web]].
    expect(titlesOf(resolve, column(), WEB)).toEqual(['POST orders'])
  })

  it('no Linked mentions column: no work, and nothing for the engine', () => {
    expect(mentionsColumns({ owner: { kind: 'link' } }, NOTES, FOLDERS, resolverOf())).toBeUndefined()
  })

  it('a table of 4,000 rows builds the map in ONE pass: one resolver call per link, none per row', () => {
    const notes = Array.from({ length: 4000 }, (_, i) => rec(`/vault/n${i}.md`, { id: `YAZ-${i + 1}`, links: [`YAZ-${((i + 1) % 4000) + 1}`, `YAZ-${((i + 7) % 4000) + 1}`] }))
    const base = linkResolver(notes, '/vault', [], [])
    let calls = 0
    const resolve: ResolveLink = (target) => {
      calls++
      return base(target)
    }
    const mentions = mentionsColumns(column(), notes, [], resolve)!
    expect(calls).toBe(8000) // the map: every link once
    // Every row's value, and every section under a note, read the same map: no further call (an ID vault's link is the id).
    for (const r of notes) expect(mentions.of(r, 'used_by')).toHaveLength(2)
    expect(mentionsMap(notes, [], resolve).get(notes[1].path)).toEqual([notes[0], notes[3994]])
    expect(calls).toBe(8000)
  })

  it('reads as a field no note holds: read only, never written; "is empty" finds the note nobody links to; a sort sorts by count', () => {
    const columns = column()
    const settings = { ...folderSettings(undefined, true), columns }
    expect(columnTyping('note.used_by', NOTES, null, settings)).toBeNull()
    expect(writableKey('note.used_by', columns)).toBeNull()
    expect(writableKey('note.used_by', {})).toBe('used_by')
    const resolve = resolverOf()
    const mentions = mentionsColumns(columns, NOTES, FOLDERS, resolve)
    const rows = [TOTAL, UNUSED, ROUTE]
    const def: ViewSet = { views: [{ type: 'table', name: 'T', order: ['file.name', 'note.used_by'], sort: [{ property: 'note.used_by', direction: 'DESC' }] }] }
    const result = runView(def, def.views[0], rows, { declared: ['used_by'], mentions })
    expect(result.rows.map((r) => r.record.title)).toEqual(['total', 'POST orders', 'unused']) // 2, 1, 0
    expect((result.rows[0].values['note.used_by'] as LinkValue[]).map((v) => linkText(v))).toEqual(['POST orders', 'useOrders'])
    expect(result.rows[0].record).toBe(TOTAL) // the record is the note's: no field was added to it
    const empty: ViewSet = { views: [{ type: 'table', name: 'T', filters: 'note.used_by.isEmpty()' }] }
    expect(runView(empty, empty.views[0], rows, { declared: ['used_by'], mentions }).rows.map((r) => r.record.title)).toEqual(['unused'])
    // "contains" names a linking note by its title, as a Multi-link filter does: the hook links both.
    const contains: ViewSet = { views: [{ type: 'table', name: 'T', filters: 'note.used_by.contains("useOrders")' }] }
    expect(runView(contains, contains.views[0], rows, { declared: ['used_by'], mentions, resolve: resolverFor(NOTES) }).rows.map((r) => r.record.title)).toEqual(['total', 'POST orders'])
  })
})

describe('only from a column, only from a folder (YAZ-4739 L2)', () => {
  it('"Only from the column": a body link does not count; a link held in that field does, its own or a page\'s value (`in`)', () => {
    const resolve = resolverOf()
    expect(titlesOf(resolve, column({ from: { column: 'reads_writes' } }), TOTAL)).toEqual(['POST orders'])
    // The hook links `total` in its body, and holds `[[POST orders]]` in `calls`.
    expect(titlesOf(resolve, column({ from: { column: 'calls' } }), TOTAL)).toEqual([])
    expect(titlesOf(resolve, column({ from: { column: 'calls' } }), ROUTE)).toEqual(['useOrders'])
    const separate = { ...HOOK, properties: { in: { 'YAZ-9': { reads_writes: '[[total]]' } } } }
    const notes = [ROUTE, TOTAL, UNUSED, separate]
    const resolveSeparate = resolverOf(notes)
    expect([...mentionsColumns(column({ from: { column: 'reads_writes' } }), notes, FOLDERS, resolveSeparate)!.of(TOTAL, 'used_by')]).toEqual(['[[POST orders]]', '[[useOrders]]'])
  })

  it('"Only from the folder": a note outside it does not count; both narrowings at once', () => {
    const resolve = resolverOf()
    expect(titlesOf(resolve, column({ from: { folder: '[[API]]' } }), TOTAL)).toEqual(['POST orders'])
    expect(titlesOf(resolve, column({ from: { folder: '[[Web]]' } }), TOTAL)).toEqual(['useOrders'])
    expect(titlesOf(resolve, column({ from: { folder: '[[Web]]', column: 'reads_writes' } }), TOTAL)).toEqual([])
    expect(titlesOf(resolve, column({ from: { folder: '[[Nowhere]]' } }), TOTAL)).toEqual([])
  })

  it('`from` is read from the column, and only its text parts', () => {
    const settings = folderSettings(rec('/vault/Schema/.folder.md', { properties: { folder_settings: { columns: { used_by: { kind: 'mentions', from: { column: 'reads_writes', folder: 7 } } } } } }), true)
    expect(settings.columns.used_by).toEqual({ kind: 'mentions', from: { column: 'reads_writes' } })
    expect(settings.problems).toEqual(['folder_settings.columns.used_by.from.folder must be text — ignoring it'])
  })
})

describe('words that only LOOK like an ID in a field (YAZ-4954 part 2): the column picks as the editor does', () => {
  const COVID = rec('/vault/Covid notes.md')
  const ID_NOTE = rec('/vault/COVID-19.md')
  const WORDS = rec('/vault/Web/A.md', { links: ['Covid notes|COVID-19'], properties: { about: '[[Covid notes|COVID-19]]' } })
  const ID_FIRST = rec('/vault/Web/B.md', { links: ['COVID-19'], properties: { about: '[[COVID-19|Covid notes]]' } })
  const notes = [COVID, ID_NOTE, WORDS, ID_FIRST]
  const titles = (row: IndexRecord) =>
    [...mentionsColumns(column({ from: { column: 'about' } }), notes, FOLDERS, linkResolver(notes, '/vault', DIRS, FOLDERS))!.of(row, 'used_by')].map((link) => link.slice(2, -2))

  it('"Covid notes" lists the words-first field; COVID-19 lists the ID-first one', () => {
    expect(titles(COVID)).toEqual(['A'])
    expect(titles(ID_NOTE)).toEqual(['B'])
  })
})
