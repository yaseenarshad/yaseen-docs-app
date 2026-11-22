import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importSharedCards } from './importCards'

let vaultRoot: string

beforeEach(async () => {
  vaultRoot = await mkdtemp(path.join(tmpdir(), 'yd-import-cards-'))
})

afterEach(async () => {
  await rm(vaultRoot, { recursive: true, force: true })
})

describe('importSharedCards (YAZ-6219)', () => {
  it('creates card files with freshly minted vault IDs, shared_from attribution, and optional upNext', async () => {
    const res = await importSharedCards(
      {
        root: vaultRoot,
        dir: 'Shared Cards',
        cards: [
          { id: 'orig-1', title: 'Capital of France', markdown: 'What is the capital of France?\n---\nParis', senderLogin: 'ali', upNext: true },
          { id: 'orig-2', title: 'ATP Synthase', markdown: 'Where is ATP made?\n---\nMitochondria', senderLogin: 'sara' },
        ],
      },
      {
        mintIds: async (_root, count) => Array.from({ length: count }, (_, i) => `YAZ-${100 + i}`),
        now: () => Date.parse('2026-11-21T15:00:00.000Z'),
      },
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.paths).toHaveLength(2)
    expect(path.basename(res.paths[0])).toBe('capital-of-france-yaz-100.md')
    expect(path.basename(res.paths[1])).toBe('atp-synthase-yaz-101.md')

    const c1 = await readFile(res.paths[0], 'utf8')
    expect(c1).toContain('shared_from: "@ali"')
    expect(c1).toContain('YAZ-100')
    expect(c1).toContain('next')
    expect(c1).toContain('Paris')

    const c2 = await readFile(res.paths[1], 'utf8')
    expect(c2).toContain('shared_from: "@sara"')
    expect(c2).toContain('YAZ-101')
    expect(c2).not.toContain(', next')
  })

  it('creates a subfolder when createFolder is specified and falls back to generated IDs when vault has IDs off', async () => {
    const res = await importSharedCards(
      {
        root: vaultRoot,
        dir: '',
        createFolder: 'Biology Deck',
        cards: [{ id: 'c1', title: 'Cell Wall', markdown: 'Plants only', senderLogin: 'ali' }],
      },
      {
        mintIds: async () => null,
        randomHex: () => 'a1b2c3d4',
      },
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.paths[0]).toBe(path.join(vaultRoot, 'Biology Deck', 'cell-wall-sh-a1b2c3d4.md'))
  })

  it('never overwrites an existing file on filename collision', async () => {
    const existing = path.join(vaultRoot, 'test-card-yaz-1.md')
    await writeFile(existing, 'EXISTING CONTENT', 'utf8')

    const res = await importSharedCards(
      {
        root: vaultRoot,
        dir: vaultRoot,
        cards: [{ id: 'c1', title: 'Test Card', markdown: 'New body', senderLogin: 'ali' }],
      },
      { mintIds: async () => ['YAZ-1'] },
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(path.basename(res.paths[0])).toBe('test-card-yaz-1-2.md')
    expect(await readFile(existing, 'utf8')).toBe('EXISTING CONTENT')
    expect(await readFile(res.paths[0], 'utf8')).toContain('New body')
  })

  it('rejects target folders outside the vault root', async () => {
    const res = await importSharedCards({
      root: vaultRoot,
      dir: '../outside',
      cards: [{ id: 'c1', title: 'Escape', markdown: 'nope', senderLogin: 'ali' }],
    })
    expect(res).toEqual({ ok: false, error: 'Target folder is outside the vault' })
  })
})
