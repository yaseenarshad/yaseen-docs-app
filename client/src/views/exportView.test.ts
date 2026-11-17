/**
 * "Export as CSV…" and "Copy as table" (YAZ-4594 S30): the text of a view — Name first, the shown columns, each cell as
 * the view draws it — and the two formats, CSV by RFC 4180 and tab-separated.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { resolverFor, runView } from './engine'
import { type CellTextContext, cellText, csvName, shownRows, toCsv, toTsv, viewTable } from './exportView'
import { parseViews } from './viewSchema'
import { TEST_RECORDS } from './testRecords'

const rec = (title: string, folder: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${folder === '' ? '' : `${folder}/`}${title}.md`,
  name: `${title}.md`,
  basename: title,
  title,
  folder,
  properties,
})

const RECORDS = [
  rec('Alpha', 'Tasks', { price: 1234.5, due: '2026-11-07', owner: '[[Bravo]]', tags: ['a', 'b'], done: true }),
  rec('Bravo', 'Tasks/Sub', { price: 2, page: 'says "hi", then\nleaves', see: 'ask [[Alpha]] and ![[pic.png]]' }),
]
const resolve = resolverFor(RECORDS, '/vault')
const ctx: CellTextContext = {
  resolve,
  decls: { price: { kind: 'number', format: { style: 'grouped', decimals: 2 } }, due: { kind: 'date', format: { style: 'medium' } } },
  pageFolder: 'Tasks',
  folderTitle: (dir) => `Title of ${dir}`,
}
const run = (yaml: string) => {
  const { def } = parseViews(yaml)
  return { def, result: runView(def, def.views[0], RECORDS, { resolve }) }
}

describe('the text of a view (S30)', () => {
  it('Name leads, then the shown columns in order, with their labels; each cell reads as the view shows it', () => {
    const { def, result } = run(`views:
  - type: table
    name: T
    order: [note.price, file.name, note.due, note.owner, note.tags, note.done, file.folder]
    sort: [{ property: file.name, direction: ASC }]
properties:
  note.price:
    displayName: Cost
`)
    expect(viewTable(def, def.views[0].order!, result.rows, ctx)).toEqual([
      ['Name', 'Cost', 'Due', 'Owner', 'Tags', 'Done', 'Folder'],
      // A number in its format (11B), a date in its format, a link by its page's title, a list joined, the folder by its title.
      ['Alpha', '1,234.50', 'Nov 7, 2026', 'Bravo', 'a, b', 'true', ''],
      ['Bravo', '2.00', '', '', '', '', 'Title of Tasks/Sub'],
    ])
  })

  it('a text with inline [[links]] reads them by the titles their pills show; an embed stays as written (4G)', () => {
    const { result } = run('views:\n  - type: table\n    name: T\n    order: [note.see]\n')
    const bravo = result.rows.find((r) => r.record.title === 'Bravo')!
    expect(cellText(bravo, 'note.see', ctx)).toBe('ask Alpha and ![[pic.png]]')
  })

  it('a view that hides Name still leads with it', () => {
    const { def, result } = run('views:\n  - type: table\n    name: T\n    order: [note.price]\n')
    expect(viewTable(def, ['note.price'], result.rows, ctx)[0]).toEqual(['Name', 'Price'])
  })

  it('a grouped view: group by group, and a page shown under two groups is one line', () => {
    const { result } = run(`views:
  - type: table
    name: T
    groupBy: { property: note.tags, direction: DESC }
`)
    expect(result.groups).not.toBeNull()
    expect(shownRows(result.rows, result.groups).map((r) => r.record.title)).toEqual(['Alpha', 'Bravo'])
    expect(cellText(result.rows[0], 'file.name', ctx)).toBe(result.rows[0].record.title)
  })
})

describe('the two formats (S30)', () => {
  const table = [
    ['Name', 'Page'],
    ['Bravo', 'says "hi", then\nleaves'],
    ['Tab', 'a\tb'],
  ]
  it('CSV quotes a field with a quote, a comma or a line break, doubles its quotes, and ends lines in CRLF (RFC 4180)', () => {
    expect(toCsv(table)).toBe('Name,Page\r\nBravo,"says ""hi"", then\nleaves"\r\nTab,a\tb\r\n')
  })
  it('tab-separated text puts a space for a tab or a line break inside a cell', () => {
    expect(toTsv(table)).toBe('Name\tPage\nBravo\tsays "hi", then leaves\nTab\ta b')
  })
  it('the file name is the folder and the view, with no path separator', () => {
    expect(csvName('Tasks', 'Board: a/b')).toBe('Tasks - Board- a-b.csv')
  })
})
