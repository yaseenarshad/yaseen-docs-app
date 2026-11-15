/**
 * S24 (YAZ-4591): renaming a Select or Multi-select option rewrites every note that holds it — this
 * folder's block where the vault uses IDs, the top level where it does not — in ONE guarded write
 * per note, replacing only the renamed element of a list. `transformFile` is stubbed over an
 * in-memory disk, so each rewrite is the real transform.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'

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
import { renameInContent, renameInPaths, renameNotice, renameOptionInFilters, renameOptionInNotes, renamedValue, restoreInPaths } from './renameOption'

const ID = 'k3m9x2pq7abc'
const OTHER = 'z8y7x6w5v4t3'
const rec = (path: string, properties: Record<string, unknown>): IndexRecord =>
  ({ path, name: path, basename: path, title: path, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases: [], tags: [], links: [], embeds: [] }) as IndexRecord

beforeEach(() => {
  disk.clear()
  vi.mocked(transformFile).mockClear()
})

describe('renamedValue', () => {
  it('a scalar is replaced; another value is not touched', () => {
    expect(renamedValue('Todo', 'Todo', 'Next')).toBe('Next')
    expect(renamedValue('Done', 'Todo', 'Next')).toBeUndefined()
    expect(renamedValue(undefined, 'Todo', 'Next')).toBeUndefined()
  })

  it('in a list only the renamed element changes, in its place', () => {
    expect(renamedValue(['a', 'Todo', 'b'], 'Todo', 'Next')).toEqual(['a', 'Next', 'b'])
    expect(renamedValue(['a', 'b'], 'Todo', 'Next')).toBeUndefined()
  })

  it('a list already holding the new label does not get it twice', () => {
    expect(renamedValue(['Next', 'Todo'], 'Todo', 'Next')).toEqual(['Next'])
  })
})

describe('renameInContent', () => {
  it('a "Separate value for <folder>" column (YAZ-4713 C3): only that page’s block changes — not the note’s own key, not another page’s', () => {
    const before = `---\ntitle: A\nstage: Todo\nin:\n  ${OTHER}:\n    stage: Todo\n  ${ID}:\n    stage: Todo\n    tags: [x]\n---\nbody\n`
    expect(renameInContent(before, { block: ID }, 'stage', 'Todo', 'Next')).toEqual({ content: `---\ntitle: A\nstage: Todo\nin:\n  ${OTHER}:\n    stage: Todo\n  ${ID}:\n    stage: Next\n    tags: [x]\n---\nbody\n`, before: 'Todo' })
  })

  it('a shared column (YAZ-4713 C1), in vaults with IDs and without: the note’s own key; a multi-select list keeps its other elements', () => {
    const before = '---\n# kept comment\nlabels:\n  - red\n  - Todo\n  - blue\nother: 1\n---\n'
    const { content: after } = renameInContent(before, null, 'labels', 'Todo', 'Next')
    expect(after).toContain('# kept comment')
    expect(after).toMatch(/labels:\n {2}- red\n {2}- Next\n {2}- blue\nother: 1/)
  })

  it('bytes that no longer hold the label come back the same', () => {
    const before = '---\nstage: Done\n---\n'
    expect(renameInContent(before, null, 'stage', 'Todo', 'Next')).toEqual({ content: before })
  })
})

describe('renameOptionInNotes', () => {
  it('one write per note holding the label; non-holders and read-only notes are never written', async () => {
    disk.set('/a.md', `---\nin:\n  ${ID}:\n    stage: Todo\n---\n`)
    disk.set('/b.md', `---\nin:\n  ${ID}:\n    stage: [Todo, Done]\n---\n`)
    disk.set('/c.md', `---\nin:\n  ${ID}:\n    stage: Done\n---\n`)
    disk.set('/locked.md', `---\nreadonly: true\nin:\n  ${ID}:\n    stage: Todo\n---\n`)
    const records = [
      rec('/a.md', { in: { [ID]: { stage: 'Todo' } } }),
      rec('/b.md', { in: { [ID]: { stage: ['Todo', 'Done'] } } }),
      rec('/c.md', { in: { [ID]: { stage: 'Done' } } }),
      rec('/locked.md', { readonly: true, in: { [ID]: { stage: 'Todo' } } }),
      rec('/own.md', { stage: 'Todo' }), // the note's own key, not this folder's value
    ]
    const result = await renameOptionInNotes(records, { block: ID }, 'stage', 'Todo', 'Next', new Set(['/locked.md']))
    expect(vi.mocked(transformFile).mock.calls.map(([path]) => path)).toEqual(['/a.md', '/b.md'])
    expect(result).toEqual({ changed: [{ path: '/a.md', before: 'Todo' }, { path: '/b.md', before: ['Todo', 'Done'] }], kept: 1 })
    expect(disk.get('/a.md')).toContain('stage: Next')
    expect(disk.get('/b.md')).toMatch(/Next[\s\S]*Done/)
    expect(disk.get('/b.md')).not.toContain('Todo')
    expect(disk.get('/locked.md')).toContain('stage: Todo')
    expect(renameNotice('Todo', 'Next', result)).toBe('Renamed “Todo” to “Next” in 2 notes · 1 note not changed')
  })

  it('a failed write is counted as kept; the rest still land', async () => {
    disk.set('/a.md', '---\nstage: Todo\n---\n')
    const result = await renameOptionInNotes([rec('/a.md', { stage: 'Todo' }), rec('/gone.md', { stage: 'Todo' })], null, 'stage', 'Todo', 'Next', new Set())
    expect(result).toEqual({ changed: [{ path: '/a.md', before: 'Todo' }], kept: 1 })
  })

  it('a note that is read only on disk is never written, wherever it is (YAZ-4637 M6), and counts as not changed', async () => {
    disk.set('/a.md', '---\nstage: Todo\n---\n')
    disk.set('/outside.md', '---\nreadonly: true\nstage: Todo\n---\n')
    const result = await renameOptionInNotes([rec('/a.md', { stage: 'Todo' }), rec('/outside.md', { readonly: true, stage: 'Todo' })], null, 'stage', 'Todo', 'Next', new Set())
    expect(result).toEqual({ changed: [{ path: '/a.md', before: 'Todo' }], kept: 1 })
    expect(disk.get('/outside.md')).toBe('---\nreadonly: true\nstage: Todo\n---\n')
  })

  it('Undo puts each changed note\'s exact previous value back (YAZ-4637 M5): a list that held both labels is whole again', async () => {
    disk.set('/a.md', '---\nlabels:\n  - Todo\n  - Next\n---\n')
    disk.set('/b.md', '---\nlabels: Next\n---\n')
    const { changed } = await renameInPaths(['/a.md'], null, 'labels', 'Todo', 'Next')
    expect(changed).toEqual([{ path: '/a.md', before: ['Todo', 'Next'] }])
    expect(disk.get('/a.md')).toBe('---\nlabels:\n  - Next\n---\n')
    await restoreInPaths(changed, null, 'labels')
    expect(disk.get('/a.md')).toBe('---\nlabels:\n  - Todo\n  - Next\n---\n')
    expect(disk.get('/b.md')).toBe('---\nlabels: Next\n---\n') // not among the changed
  })
})

describe('renameOptionInFilters (YAZ-4637 M5): a filter on the column that compares to the old label follows it', () => {
  const views = [
    { type: 'table', name: 'T', filters: { and: ['note.stage == "Todo"', '["Todo", "Done"].contains(note.stage)', 'note.other == "Todo"'] } },
    { type: 'board', name: 'B', filters: 'stage.containsAny("Todo")' },
    { type: 'list', name: 'L' },
  ]
  it('rewrites each literal equal to the old label in a leaf naming the column; another column\'s leaf and a view with no filter stay', () => {
    const out = renameOptionInFilters(views, 'stage', 'Todo', 'Next') as typeof views
    expect(out[0].filters).toEqual({ and: ['note.stage == "Next"', '["Next", "Done"].contains(note.stage)', 'note.other == "Todo"'] })
    expect(out[1].filters).toBe('stage.containsAny("Next")')
    expect(out[2]).toBe(views[2])
    expect(views[0].filters).toEqual({ and: ['note.stage == "Todo"', '["Todo", "Done"].contains(note.stage)', 'note.other == "Todo"'] }) // input untouched
  })

  it('YAZ-4834 P2: a calendar\'s "Cross out when" tree follows the rename too, beside its filters', () => {
    const calendar = [{ type: 'calendar', name: 'C', filters: 'note.stage == "Todo"', crossOut: { and: ['note.stage == "Todo"', 'note.done == true'] } }, { type: 'calendar', name: 'D', crossOut: 'note.stage == "Todo"' }]
    const out = renameOptionInFilters(calendar, 'stage', 'Todo', 'Next') as typeof calendar
    expect(out[0]).toEqual({ type: 'calendar', name: 'C', filters: 'note.stage == "Next"', crossOut: { and: ['note.stage == "Next"', 'note.done == true'] } })
    expect(out[1]).toEqual({ type: 'calendar', name: 'D', crossOut: 'note.stage == "Next"' })
    expect(renameOptionInFilters(calendar, 'other', 'Todo', 'Next')).toBe(calendar)
  })

  it('comes back as the same list when nothing names the label, and quotes the new label as the builder does', () => {
    expect(renameOptionInFilters(views, 'stage', 'Later', 'Soon')).toBe(views)
    expect(renameOptionInFilters([{ type: 'table', name: 'T', filters: 'note.stage == "Todo"' }], 'stage', 'Todo', 'Say "hi"')).toEqual([{ type: 'table', name: 'T', filters: 'note.stage == "Say \\"hi\\""' }])
    expect(renameOptionInFilters('not a list', 'stage', 'Todo', 'Next')).toBe('not a list')
  })
})
