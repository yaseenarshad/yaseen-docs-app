import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { search, resolveTarget, scopeRoots, readSaved } from './resources'
import { _evictAll, getIndex, getReadOnlyTree } from '../vaultIndex/live'
import { subscribe } from '../fs/watchers'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docs-readonly-cli-'))
  await mkdir(join(root, '.yaseendocs'))
  await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: true, letters: 'TST' }))
  await mkdir(join(root, 'Mochi'))
  await writeFile(join(root, 'Mochi/.folder.md'), '---\nid: TST-1\ntitle: Mochi\n---\n')
  await writeFile(join(root, 'Mochi/cards.md'), '---\nid: TST-2\ntitle: Study cards\naliases: [Recall]\n---\nCards body\n')
  await writeFile(join(root, 'no-id.md'), '# Leave this alone\n')
})
afterEach(async () => { _evictAll(); await rm(root, { recursive: true, force: true }) })
const waitReady = () => new Promise<void>(done => {
  let ready = false, off = () => {}
  off = subscribe(root, event => { if (event.type === 'ready') { ready = true; off(); done() } })
  if (ready) off()
})
const mutate = async (path: string, type: string, run: () => Promise<void>) => {
  let off = () => {}
  const event = new Promise<void>(done => { off = subscribe(root, event => { if (event.type === type && 'path' in event && event.path === path) done() }) })
  try { await run(); await event } finally { off() }
}

describe('read-only resource queries', () => {
  it('shares search matching, scopes results, resolves existing identities, and never assigns IDs', async () => {
    const state = defaultAppState()
    expect((await search(state, { root, query: 'Recall' })).items[0].path).toBe(join(root, 'Mochi/cards.md'))
    expect((await search(state, { root, query: 'TST2' })).items[0].id).toBe('TST-2')
    expect(await resolveTarget([root], { name: 'Mochi' })).toBe(join(root, 'Mochi'))
    expect(await resolveTarget([root], { id: 'TST-1' })).toBe(join(root, 'Mochi'))
    expect((await search(state, { root, folder: join(root, 'Mochi'), query: 'no-id' })).items).toEqual([])
    expect(await readFile(join(root, 'no-id.md'), 'utf8')).toBe('# Leave this alone\n')
    expect(await readdir(join(root, '.yaseendocs'))).toEqual(['ids.json'])
    expect((await readdir(root)).includes('.folder.md')).toBe(false)
  })

  it('keeps a tree snapshot across queries and content changes, then sees structural changes', async () => {
    await getIndex(root, { readOnly: true }); await waitReady()
    const first = await getReadOnlyTree(root)
    expect(await getReadOnlyTree(root)).toBe(first)
    await mutate(join(root, 'no-id.md'), 'change', () => writeFile(join(root, 'no-id.md'), 'Updated without ID\n'))
    expect(await getReadOnlyTree(root)).toBe(first)
    expect((await getIndex(root, { readOnly: true })).records.find(row => row.path === join(root, 'no-id.md'))?.id).toBeUndefined()
    await mutate(join(root, 'new.md'), 'add', () => writeFile(join(root, 'new.md'), 'Another note\n'))
    expect((await getReadOnlyTree(root)).tree.some(row => row.name === 'new.md')).toBe(true)
    expect(await readFile(join(root, 'new.md'), 'utf8')).toBe('Another note\n')
  })

  it('pages distinct matches and includes only Favorites when requested', async () => {
    await writeFile(join(root, '.yaseendocs/favorites.json'), JSON.stringify({ version: 1, favorites: ['Mochi'] }))
    const state = defaultAppState()
    const all = await search(state, { root, query: '', limit: 1 })
    expect(all.items).toHaveLength(1)
    expect(all.nextOffset).toBe(1)
    const favorites = await search(state, { root, query: '', collection: 'favorites', scope: 'vault' })
    expect(favorites.items.map(row => row.path)).toEqual([join(root, 'Mochi'), join(root, 'Mochi/cards.md')])
  })

  it('refuses ambiguous names, absent roots, and paths outside the scope', async () => {
    await writeFile(join(root, 'other.md'), '---\nid: TST-3\ntitle: Study cards\n---\n')
    await expect(resolveTarget([root], { name: 'Study cards' })).rejects.toMatchObject({ code: 'AMBIGUOUS_TARGET' })
    await expect(resolveTarget([root], { path: '/outside.md' })).rejects.toMatchObject({ code: 'OUTSIDE_SCOPE' })
    await expect(scopeRoots(defaultAppState(), { roots: [root, join(root, 'missing')] })).rejects.toMatchObject({ code: 'MISSING_VAULT' })
    expect(await scopeRoots(defaultAppState(), { roots: [root, join(root, 'missing')] }, true)).toEqual({ roots: [root], missing: [join(root, 'missing')] })
  })

  it('reads saved bytes with a revision that changes when the file changes', async () => {
    const path = join(root, 'no-id.md')
    const first = await readSaved(path)
    expect(first).toMatchObject({ content: '# Leave this alone\n', source: 'disk' })
    await writeFile(path, 'changed')
    expect((await readSaved(path)).revision).not.toBe(first.revision)
  })
})
