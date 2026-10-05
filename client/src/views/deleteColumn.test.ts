/**
 * Delete column (YAZ-1513): the declaration goes, every view reference goes, the label goes — ONE
 * settings write through the host's door — and the field is stripped from THIS folder's block
 * (D19) in every indexed note that holds it there; nothing else in a note is touched. Notes without
 * it are never written; a note whose frontmatter will not parse is reported, never rewritten;
 * built-in keys are refused before anything is touched. `transformFile` is stubbed over an
 * in-memory disk so the strips are real `setFolderValue` rewrites.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { FilterNode, ViewDef, ViewSet } from './viewSchema'

/** The in-memory vault the strips rewrite: path → content. */
const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }))
vi.mock('./writeProperty', () => ({
  transformFile: vi.fn(async (path: string, transform: (content: string) => string) => {
    const before = disk.get(path)
    if (before === undefined) throw new Error(`ENOENT: ${path}`)
    const after = transform(before)
    if (after !== before) disk.set(path, after)
    return { mtime: 1, content: after }
  }),
}))
import { transformFile } from './writeProperty'
import { deleteColumn, filterMentions, notesHolding, pruneColumnFromViews, pruneColumnLabel, pruneFilter, undeletableReason, type DeleteColumnHost } from './deleteColumn'

const rec = (path: string, properties: Record<string, unknown>): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice('/vault/'.length, Math.max('/vault/'.length, path.lastIndexOf('/')))
  return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder, ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases: [], tags: [], links: [], embeds: [] }
}

/** The folder deleting, and another that shows the same notes. */
const FOLDER_ID = 'k3m9x2pq7abc'
const OTHER_ID = 'z8y7x6w5v4t3'
/** A note's properties holding `values` for the folder deleting, beside its `own` fields. */
const held = (values: Record<string, unknown>, own: Record<string, unknown> = {}): Record<string, unknown> => ({ ...own, in: { [FOLDER_ID]: values } })

const A = '/vault/a.md'
const B = '/vault/b.md'
const C = '/vault/c.md'
const BROKEN = '/vault/broken.md'

const TABLE: ViewDef = {
  type: 'table',
  name: 'T',
  order: ['file.name', 'note.status', 'note.owner'],
  frozenColumns: 3,
  sort: [{ property: 'note.status', direction: 'ASC' }, { property: 'file.name', direction: 'DESC' }],
  groupBy: { property: 'status' },
  summaries: { 'note.status': 'Count', 'note.owner': 'Count' },
  columnSize: { 'note.status': 120 },
}
const BOARD: ViewDef = { type: 'board', name: 'B', order: ['file.name', 'status'], groupBy: [{ property: 'note.status' }, { property: 'note.owner' }], cardStyle: { 'note.status': { bold: true } } }
const OUTLINE: ViewDef = { type: 'outline', name: 'O', order: ['[[a]]', '[[b]]'] }

beforeEach(() => {
  disk.clear()
  disk.set(A, `---\n# a comment\ntitle: A\nin:\n  ${FOLDER_ID}:\n    status: 2-Todo\n    owner: "[[Sam]]"\n---\n\nbody a\n`)
  disk.set(B, `---\ntitle: B\nin:\n  ${FOLDER_ID}:\n    owner: "[[Kim]]"\n---\n`)
  disk.set(C, `---\nin:\n  ${FOLDER_ID}:\n    status: 1-Backlog\n---\nbody c\n`)
  disk.set(BROKEN, '---\nstatus: [unclosed\n---\n')
  vi.mocked(transformFile).mockClear()
})

const host = (over: Partial<DeleteColumnHost> = {}): DeleteColumnHost => ({
  columns: { status: { kind: 'select', options: ['1-Backlog', '2-Todo'] }, owner: { kind: 'link' } },
  def: { views: [TABLE, BOARD, OUTLINE], properties: { status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } } } as ViewSet,
  records: [rec(A, held({ status: '2-Todo', owner: '[[Sam]]' }, { title: 'A' })), rec(B, held({ owner: '[[Kim]]' }, { title: 'B' })), rec(C, held({ status: '1-Backlog' }))],
  folderId: FOLDER_ID,
  writeSettings: vi.fn(async () => {}),
  ...over,
})

describe('undeletableReason: built-in keys are hidden, never deleted', () => {
  it('refuses file.*, formula.* and the reserved keys with the one tooltip; a plain note key may go', () => {
    for (const key of ['file.name', 'file.mtime', 'formula.score', 'note.also_in', 'comments', 'in', 'note.in']) {
      expect(undeletableReason(key)).toBe('Built-in column — hide it instead')
    }
    expect(undeletableReason('note.status')).toBeNull()
    expect(undeletableReason('status')).toBeNull()
  })

  it('refuses `id` (YAZ-2293): the note id is the app\'s value — a column that can be hidden, never deleted', () => {
    expect(undeletableReason('id')).toBe('Built-in column — hide it instead')
    expect(undeletableReason('note.id')).toBe('Built-in column — hide it instead')
  })

  it('refuses `also_in` (YAZ-2290 D2): a note\'s shortcuts are the app\'s list — stripping it would take every shortcut down', async () => {
    expect(undeletableReason('also_in')).toBe('Built-in column — hide it instead')
    expect(undeletableReason('note.also_in')).toBe('Built-in column — hide it instead')
    const h = host()
    await expect(deleteColumn('also_in', h)).rejects.toThrow(/built-in column/)
    expect(h.writeSettings).not.toHaveBeenCalled()
  })
})

describe('the pure pruners', () => {
  it('pruneColumnFromViews drops the key from order / sort / groupBy / summaries / columnSize / cardStyle, clamps frozenColumns, and leaves untouched views as the same object', () => {
    const [table, board, outline] = pruneColumnFromViews([TABLE, BOARD, OUTLINE], 'status')
    expect(table).toEqual({
      type: 'table',
      name: 'T',
      order: ['file.name', 'note.owner'],
      frozenColumns: 2,
      sort: [{ property: 'file.name', direction: 'DESC' }],
      summaries: { 'note.owner': 'Count' },
    })
    expect(board).toEqual({ type: 'board', name: 'B', order: ['file.name'], groupBy: [{ property: 'note.owner' }] })
    expect(outline).toBe(OUTLINE) // an outline's order is wikilinks: nothing there names a column
    // the inputs are never mutated
    expect(TABLE.order).toEqual(['file.name', 'note.status', 'note.owner'])
  })

  it('a single-object groupBy on the key deletes the key; an array groupBy keeps its array form', () => {
    expect(pruneColumnFromViews([{ type: 'table', name: 'T', groupBy: { property: 'note.x' } }], 'x')[0].groupBy).toBeUndefined()
    expect(pruneColumnFromViews([{ type: 'table', name: 'T', groupBy: [{ property: 'note.x' }, { property: 'note.y' }] }], 'x')[0].groupBy).toEqual([{ property: 'note.y' }])
  })

  it('prunes a cards `image` that names the key, and leaves one that names another', () => {
    expect(pruneColumnFromViews([{ type: 'cards', name: 'C', image: 'note.status' }], 'status')[0]).toEqual({ type: 'cards', name: 'C' })
    const other: ViewDef = { type: 'cards', name: 'C', image: 'note.cover' }
    expect(pruneColumnFromViews([other], 'status')[0]).toBe(other)
  })

  it('filterMentions: the identifier `note.<key>` or the bare key as a whole token, outside string literals', () => {
    expect(filterMentions('note.status == "idea"', 'status')).toBe(true)
    expect(filterMentions('status == "idea"', 'note.status')).toBe(true)
    expect(filterMentions('note.status_2 == 1', 'status')).toBe(false) // a longer identifier
    expect(filterMentions('note.substatus == 1', 'status')).toBe(false)
    expect(filterMentions('file.status == 1', 'status')).toBe(false) // another namespace
    expect(filterMentions('note.title == "status"', 'status')).toBe(false) // inside a string literal
    expect(filterMentions("note.title == 'note.status'", 'status')).toBe(false)
    expect(filterMentions('note.title == "a \\" status" && note.status', 'status')).toBe(true) // an escaped quote does not end the literal
  })

  it('pruneFilter: a leaf goes, a nested node loses only that leaf, an emptied node goes with it, other keys stay, the same node returns when untouched', () => {
    expect(pruneFilter('note.status == "x"', 'status')).toBeUndefined()
    const nested: FilterNode = { and: ['note.owner == "[[Sam]]"', { or: ['note.status == "a"', 'note.status == "b"'] }, { not: ['note.status == "c"'] }] }
    expect(pruneFilter(nested, 'status')).toEqual({ and: ['note.owner == "[[Sam]]"'] })
    const untouched: FilterNode = { and: ['note.owner == "[[Sam]]"', 'note.title == "status"'] }
    expect(pruneFilter(untouched, 'status')).toBe(untouched)
    // through the views: a fully pruned filter loses the key
    const [pruned] = pruneColumnFromViews([{ type: 'table', name: 'T', filters: { or: ['status == 1', 'note.status == 2'] } }], 'status')
    expect(pruned).toEqual({ type: 'table', name: 'T' })
    const [kept] = pruneColumnFromViews([{ type: 'table', name: 'T', filters: nested }], 'status')
    expect(kept.filters).toEqual({ and: ['note.owner == "[[Sam]]"'] })
  })

  it('pruneColumnLabel drops the entry under any spelling and deletes an emptied map', () => {
    expect(pruneColumnLabel({ status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } }, 'note.status')).toEqual({ 'note.owner': { displayName: 'Who' } })
    expect(pruneColumnLabel({ 'note.status': { displayName: 'Stage' } }, 'status')).toBeUndefined()
    expect(pruneColumnLabel(undefined, 'status')).toBeUndefined()
  })

  it('notesHolding lists the notes whose block for THIS folder holds the exact field — never a top-level field, never another folder’s', () => {
    const records = [...host().records, rec('/vault/own.md', { status: 'mine' }), rec('/vault/theirs.md', { in: { [OTHER_ID]: { status: 'x' } } })]
    expect(notesHolding(records, FOLDER_ID, 'note.status').map((m) => m.basename)).toEqual(['a', 'c'])
    expect(notesHolding(records, FOLDER_ID, 'owner').map((m) => m.basename)).toEqual(['a', 'b'])
    expect(notesHolding(records, FOLDER_ID, 'Status')).toEqual([]) // names compare exactly
    expect(notesHolding(records, undefined, 'status')).toEqual([]) // a folder with no id holds no values
  })
})

describe('deleteColumn', () => {
  it('Delete a column from a folder: it leaves the folder’s settings and every view that used it — ONE settings write, label gone — then that field is removed from THAT folder’s block in every indexed note that has it, byte-preserving everything else', async () => {
    const h = host()
    await deleteColumn('note.status', h)
    expect(h.writeSettings).toHaveBeenCalledExactlyOnceWith(
      { owner: { kind: 'link' } },
      pruneColumnFromViews([TABLE, BOARD, OUTLINE], 'status'),
      { 'note.owner': { displayName: 'Who' } },
    )
    expect(disk.get(A)).toBe(`---\n# a comment\ntitle: A\nin:\n  ${FOLDER_ID}:\n    owner: "[[Sam]]"\n---\n\nbody a\n`)
    expect(disk.get(C)).toBe('---\n---\nbody c\n') // the emptied block goes, and `in` with it
    // a note without the field is never even read
    expect(disk.get(B)).toBe(`---\ntitle: B\nin:\n  ${FOLDER_ID}:\n    owner: "[[Kim]]"\n---\n`)
    expect(vi.mocked(transformFile).mock.calls.map(([path]) => path)).toEqual([A, C])
  })

  it('settings land BEFORE the first strip — the source of truth first', async () => {
    const order: string[] = []
    const h = host({ writeSettings: vi.fn(async () => void order.push('settings')) })
    vi.mocked(transformFile).mockImplementationOnce(async (path, transform) => {
      order.push('strip')
      disk.set(path, transform(disk.get(path)!))
      return { mtime: 1, content: disk.get(path)! }
    })
    await deleteColumn('status', h)
    expect(order[0]).toBe('settings')
    expect(order).toContain('strip')
  })

  it('a note that cannot be written (invalid YAML) is reported, not written; the others are still stripped (no rollback)', async () => {
    const h = host({ records: [...host().records, rec(BROKEN, held({ status: 'x' }))] })
    await expect(deleteColumn('status', h)).rejects.toThrow(/Could not remove "status" from 1 note: broken \(frontmatter is not valid YAML/)
    expect(disk.get(BROKEN)).toBe('---\nstatus: [unclosed\n---\n')
    expect(disk.get(A)).not.toContain('status:')
    expect(disk.get(C)).not.toContain('status:')
    expect(h.writeSettings).toHaveBeenCalledTimes(1)
  })

  it('a record that claims the field but whose disk no longer has it is read and left alone', async () => {
    disk.set(C, '---\ntitle: C\n---\n')
    const h = host()
    await deleteColumn('status', h)
    expect(disk.get(C)).toBe('---\ntitle: C\n---\n')
  })

  it('refuses a built-in key before touching anything', async () => {
    const h = host()
    await expect(deleteColumn('file.name', h)).rejects.toThrow("Can't delete file.name: built-in column — hide it instead")
    await expect(deleteColumn('comments', h)).rejects.toThrow(/built-in column/)
    // The note id (YAZ-2293): stripping it from every note would orphan every link to them.
    await expect(deleteColumn('id', h)).rejects.toThrow(/built-in column/)
    expect(h.writeSettings).not.toHaveBeenCalled()
    expect(transformFile).not.toHaveBeenCalled()
  })

  it('the settings write is refused: the error surfaces and nothing is stripped (YAZ-1549)', async () => {
    const h = host({ writeSettings: vi.fn(async () => { throw new Error('disk full') }) })
    await expect(deleteColumn('status', h)).rejects.toThrow('disk full')
    expect(transformFile).not.toHaveBeenCalled()
    expect(disk.get(A)).toContain('status: 2-Todo')
  })

  it('a folder with no id holds no values: the settings are written and no note is read', async () => {
    const h = host({ folderId: undefined })
    await deleteColumn('status', h)
    expect(h.writeSettings).toHaveBeenCalledTimes(1)
    expect(transformFile).not.toHaveBeenCalled()
  })

  it('a key with no declaration and no references still strips the notes and writes the settings unchanged in shape', async () => {
    const h = host({ columns: {}, def: { views: [{ type: 'table', name: 'T' }] } })
    await deleteColumn('owner', h)
    expect(h.writeSettings).toHaveBeenCalledExactlyOnceWith({}, [{ type: 'table', name: 'T' }], undefined)
    expect(disk.get(A)).toBe(`---\n# a comment\ntitle: A\nin:\n  ${FOLDER_ID}:\n    status: 2-Todo\n---\n\nbody a\n`)
    expect(disk.get(B)).toBe('---\ntitle: B\n---\n')
  })
})

describe('Delete a column from a folder: nothing else is touched', () => {
  const NOTE = '/vault/Projects/note.md'
  const GONE = '/vault/Elsewhere/moved-out.md'
  /** The same field three times over: the note's own, another folder's, and the deleting folder's. */
  const three = `---\nowner: mine\nin:\n  ${OTHER_ID}:\n    owner: theirs\n  ${FOLDER_ID}:\n    owner: Sam\n    status: 2-Todo\n---\nbody\n`
  const properties = { owner: 'mine', in: { [OTHER_ID]: { owner: 'theirs' }, [FOLDER_ID]: { owner: 'Sam', status: '2-Todo' } } }

  it('the note’s own field of that name, and another folder’s value of that name, both stay — only THIS folder’s block loses it', async () => {
    disk.set(NOTE, three)
    await deleteColumn('owner', host({ records: [rec(NOTE, properties)] }))
    expect(disk.get(NOTE)).toBe(`---\nowner: mine\nin:\n  ${OTHER_ID}:\n    owner: theirs\n  ${FOLDER_ID}:\n    status: 2-Todo\n---\nbody\n`)
  })

  it('a note that only holds the field at its top level, or for another folder, is never read', async () => {
    disk.set(NOTE, '---\nowner: mine\n---\n')
    await deleteColumn('owner', host({ records: [rec(NOTE, { owner: 'mine', in: { [OTHER_ID]: { owner: 'theirs' } } })] }))
    expect(transformFile).not.toHaveBeenCalled()
  })

  it('every indexed note that has it: one the folder no longer shows still loses the value', async () => {
    disk.set(GONE, three)
    await deleteColumn('owner', host({ records: [rec(GONE, properties)] }))
    expect(disk.get(GONE)).not.toContain('owner: Sam')
    expect(disk.get(GONE)).toContain('owner: theirs')
  })
})
