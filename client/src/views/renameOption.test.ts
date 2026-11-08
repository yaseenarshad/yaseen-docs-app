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
import { renameInContent, renameInPaths, renameNotice, renameOptionInNotes, renamedValue } from './renameOption'

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
  it('ID vault: only this folder’s block changes — not the note’s own key, not another folder’s', () => {
    const before = `---\ntitle: A\nstage: Todo\nin:\n  ${OTHER}:\n    stage: Todo\n  ${ID}:\n    stage: Todo\n    tags: [x]\n---\nbody\n`
    expect(renameInContent(before, { block: ID }, 'stage', 'Todo', 'Next')).toBe(`---\ntitle: A\nstage: Todo\nin:\n  ${OTHER}:\n    stage: Todo\n  ${ID}:\n    stage: Next\n    tags: [x]\n---\nbody\n`)
  })

  it('no IDs: the note’s own key; a multi-select list keeps its other elements', () => {
    const before = '---\n# kept comment\nlabels:\n  - red\n  - Todo\n  - blue\nother: 1\n---\n'
    const after = renameInContent(before, null, 'labels', 'Todo', 'Next')
    expect(after).toContain('# kept comment')
    expect(after).toMatch(/labels:\n {2}- red\n {2}- Next\n {2}- blue\nother: 1/)
  })

  it('bytes that no longer hold the label come back the same', () => {
    const before = '---\nstage: Done\n---\n'
    expect(renameInContent(before, null, 'stage', 'Todo', 'Next')).toBe(before)
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
    expect(result).toEqual({ changed: ['/a.md', '/b.md'], kept: 1 })
    expect(disk.get('/a.md')).toContain('stage: Next')
    expect(disk.get('/b.md')).toMatch(/Next[\s\S]*Done/)
    expect(disk.get('/b.md')).not.toContain('Todo')
    expect(disk.get('/locked.md')).toContain('stage: Todo')
    expect(renameNotice('Todo', 'Next', result)).toBe('Renamed “Todo” to “Next” in 2 notes · 1 note not changed')
  })

  it('a failed write is counted as kept; the rest still land', async () => {
    disk.set('/a.md', '---\nstage: Todo\n---\n')
    const result = await renameOptionInNotes([rec('/a.md', { stage: 'Todo' }), rec('/gone.md', { stage: 'Todo' })], null, 'stage', 'Todo', 'Next', new Set())
    expect(result).toEqual({ changed: ['/a.md'], kept: 1 })
  })

  it('Undo renames back in the changed notes alone', async () => {
    disk.set('/a.md', '---\nstage: Next\n---\n')
    disk.set('/b.md', '---\nstage: Next\n---\n')
    expect(await renameInPaths(['/a.md'], null, 'stage', 'Next', 'Todo')).toEqual({ changed: ['/a.md'], failed: 0 })
    expect(disk.get('/a.md')).toBe('---\nstage: Todo\n---\n')
    expect(disk.get('/b.md')).toBe('---\nstage: Next\n---\n')
  })
})
