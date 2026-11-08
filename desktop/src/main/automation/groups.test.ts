import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MAX_FOCUS, defaultAppState, type FocusFolder } from '@shared/types'
import { groupCommand } from './groups'
import { getFocusFolders, setFocusFolders } from '../focusFolders'
import { _actAs, _resetMint } from '../vaultIndex/mint'
import { checked } from './contract'
import { getFavorites, updateFavorites } from '../favorites'
import { getFocus, updateFocus } from '../focus'

let base: string, roots: string[]
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'docs-cli-groups-')); roots = [join(base, 'Notes'), join(base, 'Skills')]
  for (const root of roots) { await mkdir(root); await writeFile(join(root, 'Mochi.md'), 'Mochi'); _actAs(root, join(base, 'profile')) }
})
afterEach(async () => { _resetMint(); await rm(base, { recursive: true, force: true }) })
const run = (command: string, extra: Record<string, unknown> = {}) => checked(command, groupCommand(defaultAppState(), command, { roots, kind: 'favorites', scope: 'workspace', ...extra }))
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
    const reversed = [...(listed.items[0] as unknown as FocusFolder).items].reverse()
    expect(await run('group.reorderItems', { group: group.id, items: reversed })).toMatchObject({ group: { items: reversed } })
    await run('group.remove', { group: group.id, keepItems: false })
    expect(await run('group.list')).toMatchObject({ items: [] })
    for (const root of roots) expect((await getFocusFolders(root, 'workspace', 'favorites'))[0].deleted).toBe(true)
  })
  it('deletes a group as the sidebar’s Delete does: Keep items puts them back at the top of each list it showed in, and both lists get the tombstone (YAZ-4568)', async () => {
    const group = await create(), [notes, skills] = roots.map(root => join(root, 'Mochi.md'))
    await run('group.addItems', { group: group.id, paths: [notes, skills] })
    // One item is in no open vault: it leaves either way. The group shows in the vault list of Notes too.
    const shown = (await getFocusFolders(roots[0], 'workspace', 'favorites'))[0]
    await setFocusFolders(roots[0], 'workspace', [{ ...shown, items: [...shown.items, { vault: 'Missing', path: 'Old.md' }], at: shown.at + 1 }], 'favorites')
    await setFocusFolders(roots[0], 'vault', [shown], 'favorites')
    await updateFavorites(roots[1], 'workspace', () => [skills]) // already at the top: it is not added twice
    expect(await run('group.remove', { group: group.id, keepItems: true })).toMatchObject({ group: { id: group.id, deleted: true, items: [] }, topLevel: { workspace: [notes], vault: [notes, skills] }, limitReached: false })
    expect(await getFavorites(roots[0], 'workspace')).toEqual([notes])
    expect(await getFavorites(roots[1], 'workspace')).toEqual([skills])
    expect(await getFavorites(roots[0], 'vault')).toEqual([notes])
    expect(await getFavorites(roots[1], 'vault')).toEqual([skills])
    for (const root of roots) for (const scope of ['workspace', 'vault'] as const) expect(await getFocusFolders(root, scope, 'favorites'), `${root} ${scope}`).toMatchObject([{ id: group.id, deleted: true, items: [] }])
  })
  it('removes the items with the group when the caller does not keep them, and keeps a full Focus list at its limit', async () => {
    const group = await create(), path = join(roots[0], 'Mochi.md')
    await run('group.addItems', { group: group.id, paths: [path] })
    expect(await run('group.remove', { group: group.id, keepItems: false })).toMatchObject({ topLevel: { workspace: [], vault: [] }, limitReached: false })
    expect(await getFavorites(roots[0], 'workspace')).toEqual([])
    const focus = (extra: Record<string, unknown>) => run(extra.command as string, { kind: 'focus', ...extra })
    const made = (await focus({ command: 'group.create', name: 'Today' }) as { group: FocusFolder }).group
    await focus({ command: 'group.addItems', group: made.id, paths: [path] })
    const others = Array.from({ length: MAX_FOCUS }, (_, i) => join(roots[0], `F${i}.md`))
    await Promise.all(others.map(other => writeFile(other, ''))) // a focus list keeps only items that exist
    await updateFocus(roots[0], 'workspace', () => others)
    expect(await focus({ command: 'group.remove', group: made.id, keepItems: true })).toMatchObject({ limitReached: true })
    expect(await getFocus(roots[0], 'workspace')).toEqual(others)
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
