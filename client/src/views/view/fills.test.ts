/**
 * Cell and row fills in the folder table (YAZ-4536, D3 / D12): the index the table paints from, the
 * CSS each fill becomes, the link a fill names its note by, and the one write that sets or clears a
 * fill and drops the fills whose note is gone.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { linkResolver, vaultDirs } from '../../links/folderLinks'
import { TEST_RECORDS } from '../testRecords'
import type { ViewSet } from '../viewSchema'
import { cellFillOf, fillIndex, fillPaint, noteLinkOf, setViewFill } from './fills'

const resolveLink = linkResolver(TEST_RECORDS, '/vault', vaultDirs('/vault'))
const [AGENCY, LEVELS] = TEST_RECORDS

describe('fillIndex and cellFillOf', () => {
  it('reads each fill by its note path, a row fill under "*", a cell fill under its canonical column', () => {
    const index = fillIndex(
      [
        { note: '[[Agentic Agency]]', fill: 'red' },
        { note: '[[Agentic Agency]]', column: 'priority', fill: 'blue' },
        { note: '[[The Levels of an Agency]]', column: 'note.status', fill: '#00FF00' },
      ],
      resolveLink,
    )
    expect(cellFillOf(index, AGENCY.path, 'note.priority')).toBe('blue') // a cell fill wins over the row fill
    expect(cellFillOf(index, AGENCY.path, 'priority')).toBe('blue') // either spelling of the key
    expect(cellFillOf(index, AGENCY.path, 'file.name')).toBe('red') // the row fill everywhere else
    expect(cellFillOf(index, LEVELS.path, 'status')).toBe('#00ff00') // a custom hex, lowercase
    expect(cellFillOf(index, LEVELS.path, 'file.name')).toBeUndefined()
  })

  it('skips what it cannot use: no list, a bad colour, a link that resolves to nothing, a stray shape', () => {
    expect(fillIndex(undefined, resolveLink).size).toBe(0)
    expect(fillIndex('red', resolveLink).size).toBe(0)
    const index = fillIndex([{ note: '[[Agentic Agency]]', fill: 'magenta' }, { note: '[[Nobody]]', fill: 'red' }, 7, { fill: 'red' }, { note: '[[Agentic Agency]]', column: 3, fill: 'red' }], resolveLink)
    expect(index.size).toBe(0)
  })
})

describe('fillPaint', () => {
  it('a palette name paints the table block’s own wash; a hex paints at the custom wash', () => {
    expect(fillPaint('teal')).toBe('var(--table-fill-teal)')
    expect(fillPaint('#12ab34')).toBe('color-mix(in srgb, #12ab34 var(--table-fill-wash), transparent)')
  })
})

describe('noteLinkOf', () => {
  it('names a note by its id when it has one, else by the title that resolves to it, else by its path', () => {
    expect(noteLinkOf({ ...AGENCY, id: 'YAZ-12' }, resolveLink)).toBe('[[YAZ-12]]')
    expect(noteLinkOf(AGENCY, resolveLink)).toBe('[[Agentic Agency]]')
    // A second note of the same title, deeper: its title resolves to the first one, so it goes by its path.
    const twin: IndexRecord = { ...AGENCY, path: '/vault/Deep/Inner/More/Agentic Agency.md', folder: 'Deep/Inner/More' }
    const twins = linkResolver([...TEST_RECORDS, twin], '/vault', vaultDirs('/vault'))
    expect(noteLinkOf(twin, twins)).toBe('[[Deep/Inner/More/Agentic Agency]]')
  })
})

describe('setViewFill', () => {
  const def = (fills?: unknown): ViewSet => ({ views: [{ type: 'table', name: 'T', ...(fills === undefined ? {} : { fills }) }] })

  it('adds a cell fill, then a row fill, then replaces the cell fill in place', () => {
    const d = def()
    setViewFill(d, 0, AGENCY, 'note.priority', 'yellow', TEST_RECORDS, resolveLink)
    setViewFill(d, 0, AGENCY, undefined, 'green', TEST_RECORDS, resolveLink)
    setViewFill(d, 0, AGENCY, 'note.priority', '#ABCDEF', TEST_RECORDS, resolveLink)
    expect(d.views[0].fills).toEqual([
      { note: '[[Agentic Agency]]', column: 'note.priority', fill: '#abcdef' },
      { note: '[[Agentic Agency]]', fill: 'green' },
    ])
  })

  it('"No fill" removes the one entry, and the key goes when the list is empty', () => {
    const d = def([
      { note: '[[Agentic Agency]]', fill: 'red' },
      { note: '[[Agentic Agency]]', column: 'priority', fill: 'blue' },
    ])
    setViewFill(d, 0, AGENCY, 'note.priority', null, TEST_RECORDS, resolveLink) // the other spelling of the same column
    expect(d.views[0].fills).toEqual([{ note: '[[Agentic Agency]]', fill: 'red' }])
    setViewFill(d, 0, AGENCY, undefined, null, TEST_RECORDS, resolveLink)
    expect('fills' in d.views[0]).toBe(false)
  })

  it('each write drops the fills whose note is no longer in the folder', () => {
    const d = def([
      { note: '[[The Levels of an Agency]]', fill: 'red' },
      { note: '[[Gone Note]]', fill: 'blue' },
      { note: '[[Agentic Agency]]', column: 'status', fill: 'pink' },
    ])
    // The Levels note left the folder: it is still in the vault, but not among the folder's records.
    const folder = TEST_RECORDS.filter((r) => r !== LEVELS)
    setViewFill(d, 0, AGENCY, undefined, 'grey', folder, resolveLink)
    expect(d.views[0].fills).toEqual([
      { note: '[[Agentic Agency]]', column: 'status', fill: 'pink' },
      { note: '[[Agentic Agency]]', fill: 'grey' },
    ])
  })
})
