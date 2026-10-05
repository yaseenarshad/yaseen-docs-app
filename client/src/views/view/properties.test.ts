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

  it('no longer offers `note.id`, or any reserved top-level key: a folder’s table shows only that folder’s values, so such a column could never hold anything', () => {
    // Rows as a folder's views get them (D19): `properties` are the folder's block; the note's own keys are not in it.
    const rows = TEST_RECORDS.map((r, i) => ({ ...r, id: `k3m9x2pq7ab${i}`, properties: { status: 'open' } }))
    const keys = allPropertyKeys(def, view, rows)
    expect(keys).toContain('note.status')
    for (const reserved of ['id', 'also_in', 'in', 'comments', 'reviews']) expect(keys).not.toContain(`note.${reserved}`)
  })

  it('a declared column already seen in the values is listed once, not twice', () => {
    const keys = allPropertyKeys(def, view, TEST_RECORDS, { status: { kind: 'text' } })
    expect(keys.filter((k) => k === 'note.status')).toEqual(['note.status'])
  })
})
