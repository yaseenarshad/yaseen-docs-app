/**
 * Delete column (YAZ-1513): the declaration goes, every view reference goes, the label goes — ONE
 * settings write through the host's door — and the key is stripped from every direct member that
 * carries it, byte-preserving everything else. Members without the key are never written; a note
 * whose frontmatter will not parse is reported, never rewritten; built-in keys are refused before
 * anything is touched. `transformFile` is stubbed over an in-memory disk so the strips are real
 * `setFrontmatterProperty` rewrites.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ViewDef, ViewSet } from './viewSchema'

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
import { deleteColumn, membersCarrying, pruneColumnFromViews, pruneColumnLabel, undeletableReason, type DeleteColumnHost } from './deleteColumn'

const rec = (path: string, properties: Record<string, unknown>): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases: [], tags: [], links: [], embeds: [] }
}

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
  disk.set(A, '---\n# a comment\ntitle: A\nstatus: 2-Todo\nowner: "[[Sam]]"\n---\n\nbody a\n')
  disk.set(B, '---\ntitle: B\nowner: "[[Kim]]"\n---\n')
  disk.set(C, '---\nstatus: 1-Backlog\n---\nbody c\n')
  disk.set(BROKEN, '---\nstatus: [unclosed\n---\n')
  vi.mocked(transformFile).mockClear()
})

const host = (over: Partial<DeleteColumnHost> = {}): DeleteColumnHost => ({
  columns: { status: { kind: 'select', options: ['1-Backlog', '2-Todo'] }, owner: { kind: 'link' } },
  def: { views: [TABLE, BOARD, OUTLINE], properties: { status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } } } as ViewSet,
  members: [rec(A, { title: 'A', status: '2-Todo', owner: '[[Sam]]' }), rec(B, { title: 'B', owner: '[[Kim]]' }), rec(C, { status: '1-Backlog' })],
  writeSettings: vi.fn(),
  ...over,
})

describe('undeletableReason: built-in keys are hidden, never deleted', () => {
  it('refuses file.*, formula.* and the reserved keys with the one tooltip; a plain note key may go', () => {
    for (const key of ['file.name', 'file.mtime', 'formula.score', 'note.folder_page', 'folder_pages', 'note.folder_page_settings', 'comments']) {
      expect(undeletableReason(key)).toBe('Built-in column — hide it instead')
    }
    expect(undeletableReason('note.status')).toBeNull()
    expect(undeletableReason('status')).toBeNull()
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

  it('pruneColumnLabel drops the entry under any spelling and deletes an emptied map', () => {
    expect(pruneColumnLabel({ status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } }, 'note.status')).toEqual({ 'note.owner': { displayName: 'Who' } })
    expect(pruneColumnLabel({ 'note.status': { displayName: 'Stage' } }, 'status')).toBeUndefined()
    expect(pruneColumnLabel(undefined, 'status')).toBeUndefined()
  })

  it('membersCarrying counts the direct members whose card holds the exact key', () => {
    expect(membersCarrying(host().members, 'note.status').map((m) => m.basename)).toEqual(['a', 'c'])
    expect(membersCarrying(host().members, 'owner').map((m) => m.basename)).toEqual(['a', 'b'])
  })
})

describe('deleteColumn', () => {
  it('writes the settings ONCE — declaration gone, references pruned, label gone — then strips the key from the carrying members, byte-preserving every other key', async () => {
    const h = host()
    await deleteColumn('note.status', h)
    expect(h.writeSettings).toHaveBeenCalledExactlyOnceWith(
      { owner: { kind: 'link' } },
      pruneColumnFromViews([TABLE, BOARD, OUTLINE], 'status'),
      { 'note.owner': { displayName: 'Who' } },
    )
    expect(disk.get(A)).toBe('---\n# a comment\ntitle: A\nowner: "[[Sam]]"\n---\n\nbody a\n')
    expect(disk.get(C)).toBe('---\n---\nbody c\n')
    // a member without the key is never even read
    expect(disk.get(B)).toBe('---\ntitle: B\nowner: "[[Kim]]"\n---\n')
    expect(vi.mocked(transformFile).mock.calls.map(([path]) => path)).toEqual([A, C])
  })

  it('settings land BEFORE the first strip — the source of truth first, so the presence invariant cannot re-add the key meanwhile', async () => {
    const order: string[] = []
    const h = host({ writeSettings: vi.fn(() => order.push('settings')) })
    vi.mocked(transformFile).mockImplementationOnce(async (path, transform) => {
      order.push('strip')
      disk.set(path, transform(disk.get(path)!))
      return { mtime: 1, content: disk.get(path)! }
    })
    await deleteColumn('status', h)
    expect(order[0]).toBe('settings')
    expect(order).toContain('strip')
  })

  it('a note whose frontmatter will not parse is reported, not written; the others still commit (no rollback)', async () => {
    const h = host({ members: [...host().members, rec(BROKEN, { status: 'x' })] })
    await expect(deleteColumn('status', h)).rejects.toThrow(/Could not remove "status" from 1 note: broken \(frontmatter is not valid YAML/)
    expect(disk.get(BROKEN)).toBe('---\nstatus: [unclosed\n---\n')
    expect(disk.get(A)).not.toContain('status:')
    expect(disk.get(C)).not.toContain('status:')
    expect(h.writeSettings).toHaveBeenCalledTimes(1)
  })

  it('a record that claims the key but whose disk no longer has it is read and left alone', async () => {
    disk.set(C, '---\ntitle: C\n---\n')
    const h = host()
    await deleteColumn('status', h)
    expect(disk.get(C)).toBe('---\ntitle: C\n---\n')
  })

  it('refuses a built-in key before touching anything', async () => {
    const h = host()
    await expect(deleteColumn('file.name', h)).rejects.toThrow("Can't delete file.name: built-in column — hide it instead")
    await expect(deleteColumn('folder_pages', h)).rejects.toThrow(/built-in column/)
    expect(h.writeSettings).not.toHaveBeenCalled()
    expect(transformFile).not.toHaveBeenCalled()
  })

  it('a key with no declaration and no references still strips the members and writes the settings unchanged in shape', async () => {
    const h = host({ columns: {}, def: { views: [{ type: 'table', name: 'T' }] } })
    await deleteColumn('owner', h)
    expect(h.writeSettings).toHaveBeenCalledExactlyOnceWith({}, [{ type: 'table', name: 'T' }], undefined)
    expect(disk.get(A)).toBe('---\n# a comment\ntitle: A\nstatus: 2-Todo\n---\n\nbody a\n')
    expect(disk.get(B)).toBe('---\ntitle: B\n---\n')
  })
})
