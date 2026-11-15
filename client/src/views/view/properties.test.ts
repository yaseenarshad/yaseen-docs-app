import { describe, expect, it } from 'vitest'
import { parseViews } from '../viewSchema'
import { TEST_RECORDS } from '../testRecords'
import { allPropertyKeys } from './properties'

const { def } = parseViews('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n')
const view = def.views[0]

describe('allPropertyKeys', () => {
  it('offers a DECLARED column no member carries a value for (YAZ-895)', () => {
    expect(allPropertyKeys(def, view, TEST_RECORDS)).not.toContain('note.owner')
    expect(allPropertyKeys(def, view, TEST_RECORDS, { owner: { kind: 'link' } })).toContain('note.owner')
  })

  it('no longer offers `note.id`, or any reserved top-level key: the folder host takes the app’s keys out of the rows (YAZ-4713 C1)', () => {
    // Rows as a folder's views get them: `properties` are the note's own fields less the app's keys.
    const rows = TEST_RECORDS.map((r, i) => ({ ...r, id: `k3m9x2pq7ab${i}`, properties: { status: 'open' } }))
    const keys = allPropertyKeys(def, view, rows)
    expect(keys).toContain('note.status')
    for (const reserved of ['id', 'also_in', 'in', 'comments', 'reviews']) expect(keys).not.toContain(`note.${reserved}`)
  })

  it('offers every other field the rows hold, after the columns, sorted: Columns ⚙ › "Other properties in these notes" (YAZ-4713 C4)', () => {
    const { def: open } = parseViews('views:\n  - type: table\n    name: T\n')
    const rows = [{ ...TEST_RECORDS[0], properties: { domain: 'Billing', tags: 'x', aliases: ['y'] } }]
    expect(allPropertyKeys(open, open.views[0], rows, { domain: { kind: 'text' } }).slice(0, 4)).toEqual(['file.name', 'note.domain', 'note.aliases', 'note.tags'])
  })

  it('a declared column already seen in the values is listed once, not twice', () => {
    const keys = allPropertyKeys(def, view, TEST_RECORDS, { status: { kind: 'text' } })
    expect(keys.filter((k) => k === 'note.status')).toEqual(['note.status'])
  })
})
