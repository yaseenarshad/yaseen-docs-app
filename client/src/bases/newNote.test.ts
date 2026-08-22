/**
 * "New" note derivation (5D, GRO-2144), pure over the view's filter AST: equality filters and
 * `file.hasTag` become seed frontmatter (YAML types preserved), a single `file.inFolder`
 * names the target folder, `Untitled` names de-duplicate, and `createNewNote` creates in one
 * atomic content-at-create call (Bible B, GRO-2202; `api` mocked, same as writeProperty.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseDefinition, BaseView, FilterNode } from './baseFile'
import { createNewNote, deriveSeed, seedContent, targetFolder, untitledName } from './newNote'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { createFile: vi.fn(), writeFile: vi.fn() },
}))

import { api } from '../api'

const createFile = vi.mocked(api.createFile)
const writeFile = vi.mocked(api.writeFile)

beforeEach(() => {
  createFile.mockReset()
  writeFile.mockReset()
})

/** A minimal def + view around the two filter slots. */
const seed = (viewFilters?: FilterNode, defFilters?: FilterNode) =>
  deriveSeed({ views: [], filters: defFilters } as unknown as BaseDefinition, { type: 'table', name: 'T', filters: viewFilters } as BaseView)

describe('deriveSeed', () => {
  it('seeds equality filters with their YAML types preserved', () => {
    const s = seed({ and: ['note.status == "idea"', 'note.priority == 2', 'note.published == false'] })
    expect(s.properties).toEqual({ status: 'idea', priority: 2, published: false })
  })

  it('handles bare identifiers, quoted property names and negative numbers', () => {
    const s = seed({ and: ['status == "idea"', 'note["my prop"] == "v"', 'note.score == -3'] })
    expect(s.properties).toEqual({ status: 'idea', 'my prop': 'v', score: -3 })
  })

  it('a bare string filter node seeds like a one-item and', () => {
    expect(seed('status == "idea"').properties).toEqual({ status: 'idea' })
  })

  it('def filters and view filters both contribute', () => {
    const s = seed({ and: ['status == "idea"'] }, { and: ['pillar == "Agentic"'] })
    expect(s.properties).toEqual({ pillar: 'Agentic', status: 'idea' })
  })

  it('file.hasTag seeds a tags list, merged across rules', () => {
    const s = seed({ and: ['file.hasTag("agentic")', 'file.hasTag("pillar")'] })
    expect(s.properties).toEqual({ tags: ['agentic', 'pillar'] })
  })

  it('ignores non-equality filters', () => {
    const s = seed({ and: ['note.views > 100', 'note.status != "done"', 'note.title.contains("x")', 'note.status.isEmpty()', 'file.name == "x"'] })
    expect(s.properties).toEqual({})
  })

  it('ignores rules inside or / not branches (seeding them would not satisfy the view)', () => {
    const s = seed({ and: ['status == "idea"', { or: ['pillar == "A"', 'pillar == "B"'] }, { not: ['note.archived == true'] }] })
    expect(s.properties).toEqual({ status: 'idea' })
  })

  it('a single file.inFolder names the folder, slashes trimmed', () => {
    expect(seed({ and: ['file.inFolder("/Content Pillars/1. Agentic Agency/")'] }).folder).toBe('Content Pillars/1. Agentic Agency')
  })

  it('zero or several inFolder rules leave the folder null (base-folder rule)', () => {
    expect(seed({ and: ['status == "idea"'] }).folder).toBeNull()
    expect(seed({ and: ['file.inFolder("A")', 'file.inFolder("B")'] }).folder).toBeNull()
  })
})

describe('untitledName', () => {
  it('Untitled when free, then Untitled 2, Untitled 3…', () => {
    expect(untitledName(new Set())).toBe('Untitled')
    expect(untitledName(new Set(['Untitled']))).toBe('Untitled 2')
    expect(untitledName(new Set(['Untitled', 'Untitled 2']))).toBe('Untitled 3')
  })

  it('fills gaps left by renames', () => {
    expect(untitledName(new Set(['Untitled', 'Untitled 3']))).toBe('Untitled 2')
  })
})

describe('targetFolder', () => {
  it('resolves an inFolder seed against the root', () => {
    expect(targetFolder('Content Pillars', '/vault', '/vault/Bases/x.base')).toBe('/vault/Content Pillars')
    expect(targetFolder('', '/vault', null)).toBe('/vault')
  })

  it('falls back to the base file folder, then the root', () => {
    expect(targetFolder(null, '/vault', '/vault/Bases/x.base')).toBe('/vault/Bases')
    expect(targetFolder('A', null, '/vault/Bases/x.base')).toBe('/vault/Bases')
    expect(targetFolder(null, '/vault', null)).toBe('/vault')
    expect(targetFolder(null, null, null)).toBeNull()
  })
})

describe('seedContent', () => {
  it('empty seed → empty file', () => {
    expect(seedContent({})).toBe('')
  })

  it('writes one frontmatter block with native YAML types; null prints `key:`', () => {
    expect(seedContent({ status: 'idea', priority: 2 })).toBe('---\nstatus: idea\npriority: 2\n---\n')
    expect(seedContent({ tags: ['agentic'] })).toBe('---\ntags:\n  - agentic\n---\n')
    expect(seedContent({ unit: null })).toBe('---\nunit:\n---\n')
  })
})

describe('createNewNote', () => {
  it('creates the note in ONE atomic content-at-create call (GRO-2202), never a follow-up write', async () => {
    createFile.mockResolvedValue({ path: '/v/Untitled.md', mtime: 5, size: 20 })

    await createNewNote('/v/Untitled.md', { status: 'idea' })

    expect(createFile).toHaveBeenCalledWith({ path: '/v/Untitled.md', content: '---\nstatus: idea\n---\n' })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('an empty seed creates an empty file', async () => {
    createFile.mockResolvedValue({ path: '/v/Untitled.md', mtime: 5, size: 0 })

    await createNewNote('/v/Untitled.md', {})

    expect(createFile).toHaveBeenCalledWith({ path: '/v/Untitled.md', content: '' })
  })

  it('a body lands after the frontmatter block (template bodies, R3)', async () => {
    createFile.mockResolvedValue({ path: '/v/Untitled.md', mtime: 5, size: 40 })

    await createNewNote('/v/Untitled.md', { page_type: 'kpi' }, '# Notes\n')

    expect(createFile).toHaveBeenCalledWith({ path: '/v/Untitled.md', content: '---\npage_type: kpi\n---\n# Notes\n' })
  })

  it('propagates a create failure', async () => {
    createFile.mockRejectedValue(new Error('parent folder does not exist'))

    await expect(createNewNote('/v/Untitled.md', { status: 'idea' })).rejects.toThrow('parent folder does not exist')
  })
})
