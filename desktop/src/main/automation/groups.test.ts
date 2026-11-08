import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultAppState, type FocusFolder } from '@shared/types'
import { groupCommand } from './groups'
import { getFocusFolders, setFocusFolders } from '../focusFolders'
import { _actAs, _resetMint } from '../vaultIndex/mint'

let base: string, roots: string[]
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'docs-cli-groups-')); roots = [join(base, 'Notes'), join(base, 'Skills')]
  for (const root of roots) { await mkdir(root); await writeFile(join(root, 'Mochi.md'), 'Mochi'); _actAs(root, join(base, 'profile')) }
})
afterEach(async () => { _resetMint(); await rm(base, { recursive: true, force: true }) })
const run = (command: string, extra: Record<string, unknown> = {}) => groupCommand(defaultAppState(), command, { roots, kind: 'favorites', scope: 'workspace', ...extra })
const create = async () => (await run('group.create', { name: 'Mochi' }) as { group: FocusFolder }).group

describe('collection group commands', () => {
  it('keeps concurrent membership edits across workspace copies, then tombstones deletion', async () => {
    const group = await create()
    await Promise.all(roots.map(root => run('group.addItems', { group: group.id, paths: [join(root, 'Mochi.md')] })))
    for (const root of roots) expect((await getFocusFolders(root, 'workspace', 'favorites'))[0].items).toHaveLength(2)
    await run('group.rename', { group: group.id, name: 'Flashcards' })
    await run('group.position', { group: group.id, position: 2 })
    // The two adds raced, so either may be first. Both must be kept.
    const listed = await run('group.list') as { items: { resolvedItems: { path: string }[] }[] }
    expect(listed).toMatchObject({ items: [{ id: group.id, name: 'Flashcards', pos: 2 }] })
    expect(listed.items[0].resolvedItems.map(item => item.path).sort()).toEqual(roots.map(root => join(root, 'Mochi.md')).sort())
    await run('group.remove', { group: group.id })
    expect(await run('group.list')).toMatchObject({ items: [] })
    for (const root of roots) expect((await getFocusFolders(root, 'workspace', 'favorites'))[0].deleted).toBe(true)
  })
  it('can remove a missing-vault item by its stored reference and rejects duplicate membership input', async () => {
    const group = await create(), ghost = { vault: 'Missing', path: 'Old.md' }
    for (const root of roots) await setFocusFolders(root, 'workspace', [{ ...group, items: [ghost], at: group.at + 1 }], 'favorites')
    await run('group.removeItems', { group: group.id, items: [ghost] })
    expect(await run('group.list')).toMatchObject({ items: [{ items: [] }] })
    const path = join(roots[0], 'Mochi.md')
    await expect(run('group.addItems', { group: group.id, paths: [path, path] })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
  it('reports the vaults saved before a partial disk failure', async () => {
    await writeFile(join(roots[1], '.yaseendocs'), 'not a configuration directory')
    await expect(create()).rejects.toMatchObject({ code: 'PARTIAL_FAILURE', details: { appliedRoots: [roots[0]], failedRoots: [roots[1]] } })
    expect(await getFocusFolders(roots[0], 'workspace', 'favorites')).toHaveLength(1)
  })

})
