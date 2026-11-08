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
import { cellFillOf, fillIndex, fillPaint, noteLinkOf, setViewFill, setViewFills } from './fills'

const resolveLink = linkResolver(TEST_RECORDS, '/vault', vaultDirs('/vault'))
const [AGENCY, LEVELS] = TEST_RECORDS
/** The Orders folder's `.folder.md` as the index holds it (no id), and as the Orders ROW of a Schema page (`subfolderRows`: `folder` is the parent). */
const ORDERS_FILE: IndexRecord = { ...AGENCY, id: undefined, path: '/vault/Schema/Orders/.folder.md', name: '.folder.md', basename: '.folder', title: 'Orders', folder: 'Schema/Orders' }
const ORDERS: IndexRecord = { ...ORDERS_FILE, folder: 'Schema' }
const DIRS = ['/vault/Schema', '/vault/Schema/Orders', '/vault/Schema/Users']
/** A resolver that knows the folders, as the app's does (`vaultDirs` is empty in a test). */
const folderAware = linkResolver(TEST_RECORDS, '/vault', DIRS, [ORDERS_FILE])

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

  it('a folder row (YAZ-4644 E1) goes by its id, else by the title that resolves to its folder, else by the folder\'s path', () => {
    expect(noteLinkOf({ ...ORDERS, id: 'YAZ-7' }, folderAware)).toBe('[[YAZ-7]]')
    expect(noteLinkOf(ORDERS, folderAware)).toBe('[[Orders]]')
    // A note titled Orders takes the title: the folder row goes by its folder's path, never by `.folder`.
    const note: IndexRecord = { ...AGENCY, path: '/vault/Orders.md', name: 'Orders.md', basename: 'Orders', title: 'Orders', folder: '' }
    expect(noteLinkOf(ORDERS, linkResolver([...TEST_RECORDS, note], '/vault', DIRS, [ORDERS_FILE]))).toBe('[[Schema/Orders]]')
  })
})

describe('a folder row\'s fill (YAZ-4644 E1): its link names the folder, and the row is found by its folder too', () => {
  it('fillIndex and cellFillOf meet on the folder: a fill written by Fill row on the Orders row paints the Orders row', () => {
    const index = fillIndex([{ note: '[[Orders]]', fill: 'pink' }, { note: '[[Schema/Orders]]', column: 'note.domain', fill: 'blue' }], folderAware)
    expect(cellFillOf(index, ORDERS.path, 'file.name')).toBe('pink')
    expect(cellFillOf(index, ORDERS.path, 'domain')).toBe('blue')
    expect(cellFillOf(index, '/vault/Schema/Users/.folder.md', 'file.name')).toBeUndefined()
  })

  it('setViewFill on a folder row writes one entry, replaces it in place, and clears it', () => {
    const d: ViewSet = { views: [{ type: 'table', name: 'T' }] }
    setViewFill(d, 0, ORDERS, undefined, 'pink', folderAware)
    setViewFill(d, 0, ORDERS, undefined, 'yellow', folderAware)
    expect(d.views[0].fills).toEqual([{ note: '[[Orders]]', fill: 'yellow' }])
    setViewFill(d, 0, ORDERS, 'note.domain', 'blue', folderAware)
    expect(d.views[0].fills).toEqual([{ note: '[[Orders]]', fill: 'yellow' }, { note: '[[Orders]]', column: 'note.domain', fill: 'blue' }])
    setViewFill(d, 0, ORDERS, undefined, null, folderAware, true)
    expect(d.views[0].fills).toEqual([{ note: '[[Orders]]', column: 'note.domain', fill: 'blue' }])
  })
})

describe('setViewFill', () => {
  const def = (fills?: unknown): ViewSet => ({ views: [{ type: 'table', name: 'T', ...(fills === undefined ? {} : { fills }) }] })

  it('adds a cell fill, then a row fill, then replaces the cell fill in place', () => {
    const d = def()
    setViewFill(d, 0, AGENCY, 'note.priority', 'yellow', resolveLink)
    setViewFill(d, 0, AGENCY, undefined, 'green', resolveLink)
    setViewFill(d, 0, AGENCY, 'note.priority', '#ABCDEF', resolveLink)
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
    setViewFill(d, 0, AGENCY, 'note.priority', null, resolveLink) // the other spelling of the same column
    expect(d.views[0].fills).toEqual([{ note: '[[Agentic Agency]]', fill: 'red' }])
    setViewFill(d, 0, AGENCY, undefined, null, resolveLink)
    expect('fills' in d.views[0]).toBe(false)
  })

  // Until YAZ-4636 T9b a write dropped the fills of notes outside the folder's shown records and of links that did not
  // resolve: Subfolders: Hide narrows the shown records, so a fill of a hidden note went with the next write.
  it('with the vault index loaded (YAZ-4637, after T9b): a write drops the entries whose note is in no record, and keeps a hidden note\'s', () => {
    const d = def([
      { note: '[[The Levels of an Agency]]', fill: 'red' }, // a note outside the shown rows: kept
      { note: '[[Gone Note]]', fill: 'blue' }, // in no record of the vault: dropped
      { fill: 'pink' }, // not a fill of ours to judge: kept
    ])
    setViewFills(d, 0, [{ record: AGENCY }], 'grey', resolveLink, true)
    expect(d.views[0].fills).toEqual([{ note: '[[The Levels of an Agency]]', fill: 'red' }, { fill: 'pink' }, { note: '[[Agentic Agency]]', fill: 'grey' }])
  })

  it('a write changes only the cells it is for: a fill of a note the view does not show, or a link to nothing, stays (YAZ-4636 T9b)', () => {
    const d = def([
      { note: '[[The Levels of an Agency]]', fill: 'red' },
      { note: '[[Gone Note]]', fill: 'blue' },
      { note: '[[Agentic Agency]]', column: 'status', fill: 'pink' },
    ])
    setViewFill(d, 0, AGENCY, undefined, 'grey', resolveLink)
    expect(d.views[0].fills).toEqual([
      { note: '[[The Levels of an Agency]]', fill: 'red' },
      { note: '[[Gone Note]]', fill: 'blue' },
      { note: '[[Agentic Agency]]', column: 'status', fill: 'pink' },
      { note: '[[Agentic Agency]]', fill: 'grey' },
    ])
  })
})
