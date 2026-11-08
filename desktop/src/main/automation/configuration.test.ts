import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../store'
import { configurationCommand } from './configuration'
import { _resetMint, _actAs } from '../vaultIndex/mint'
import { checked } from './contract'
import { prepareAutomation } from '../automation'

let base: string, root: string, other: string, store: ReturnType<typeof createStore>
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'docs-cli-config-')); root = join(base, 'Notes'); other = join(base, 'Skills')
  await mkdir(root); await mkdir(other)
  await writeFile(join(root, 'A.md'), 'A'); await writeFile(join(root, 'B.md'), 'B')
  store = createStore(join(base, 'profile/state.json'))
  _actAs(root, join(base, 'profile')); _actAs(other, join(base, 'profile'))
})
afterEach(async () => { await store.flush(); _resetMint(); await rm(base, { recursive: true, force: true }) })
const run = (command: string, args: Record<string, unknown>) => checked(command, configurationCommand(store, command, args))

describe('configuration commands', () => {
  it('patches vault names and unique number keys and persists picture-folder changes', async () => {
    expect(await run('vault.patch', { root, changes: { name: 'Notes', key: 3 } })).toEqual({ root, name: 'Notes', key: 3, diskSaved: true })
    // The number moves, as in the vault switcher, and the result names the vault that lost it.
    expect(await run('vault.patch', { root: other, changes: { key: 3 } })).toEqual({ root: other, name: null, key: 3, keyFrom: root, diskSaved: true })
    expect(store.get().folders[root]).toMatchObject({ name: 'Notes', key: null })
    expect(store.get().folders[other].key).toBe(3)
    await run('pictureFolder.allow', { folder: join(base, 'Pictures') })
    expect(JSON.parse(await readFile(join(base, 'profile/state.json'), 'utf8')).approvedPictureFolders).toEqual([join(base, 'Pictures')])
    await expect(run('pictureFolder.allow', { folder: '/System' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await run('pictureFolder.remove', { folder: join(base, 'Pictures') })
    expect(await run('pictureFolder.list', {})).toEqual({ folders: [] })
  })
  it('patches current settings, preserves unrelated changes, and flushes before success', async () => {
    store.setSettings({ ...store.get().settings, dailyNoteFolder: 'Journal' })
    await run('settings.patch', { changes: { dailyNotes: true } })
    expect(store.get().settings).toMatchObject({ dailyNotes: true, dailyNoteFolder: 'Journal' })
    expect(JSON.parse(await readFile(join(base, 'profile/state.json'), 'utf8')).settings.dailyNotes).toBe(true)
    await expect(run('settings.patch', { changes: { madeUp: true } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(run('settings.patch', { changes: { dailyNotes: 'yes' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    // An icon rule names an icon the app ships, as the rules control picks it (YAZ-4518).
    const rule = { match: '*.py', kind: 'file', icon: 'zzz-not-an-icon' }
    await expect(run('settings.patch', { changes: { sidebarIconRules: [rule] } })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('zzz-not-an-icon') })
    expect(store.get().settings.sidebarIconRules).toEqual([])
    await run('settings.patch', { changes: { sidebarIconRules: [{ ...rule, icon: 'python' }] } })
    expect(store.get().settings.sidebarIconRules).toEqual([{ ...rule, icon: 'python' }])
  })
  it('keeps workspace identity through updates and refuses an accidental same-name replacement', async () => {
    const first = await run('workspace.create', { name: 'Skills', roots: [root, other] }) as { workspace: { id: string } }
    await expect(run('workspace.create', { name: 'skills', roots: [root, other] })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
    await run('workspace.rename', { id: first.workspace.id, name: 'Writing' })
    await run('workspace.update', { id: first.workspace.id, roots: [other, root] })
    expect(store.get().vaultSets).toMatchObject([{ id: first.workspace.id, name: 'Writing' }])
    await run('workspace.remove', { id: first.workspace.id })
    expect(store.get().vaultSets).toEqual([])
    expect(await readFile(join(root, 'A.md'), 'utf8')).toBe('A')
  })
  it.each(['favorites', 'focus'])('serializes concurrent %s additions and preserves list scope and order', async kind => {
    const common = { root, kind, scope: 'workspace' }, a = join(root, 'A.md'), b = join(root, 'B.md')
    await Promise.all([run('collection.add', { ...common, paths: [a] }), run('collection.add', { ...common, paths: [b] })])
    expect(await run('collection.list', common)).toMatchObject({ items: [a, b], total: 2 })
    expect(await run('collection.list', { ...common, scope: 'vault' })).toMatchObject({ items: [] })
    await expect(run('collection.reorder', { ...common, paths: [a] })).rejects.toMatchObject({ code: 'CONFLICT' })
    await run('collection.reorder', { ...common, paths: [b, a] })
    expect(await run('collection.list', common)).toMatchObject({ items: [b, a] })
    await run('collection.remove', { ...common, paths: [a] })
    expect(await run('collection.list', common)).toMatchObject({ items: [b] })
  })
  it('saves explicit session tabs and labels them as saved restoration state', async () => {
    const tab = { path: join(root, 'A.md'), name: 'Planning', active: true }
    const result = await run('session.save', { name: 'Morning', roots: [root], tabs: [tab] }) as { session: { id: string } }
    expect(await run('session.list', {})).toMatchObject({ source: 'saved', items: [{ id: result.session.id, tabs: [tab] }] })
    await expect(run('session.save', { name: 'Invalid', roots: [other], tabs: [tab] })).rejects.toMatchObject({ code: 'OUTSIDE_SCOPE' })
    // The session list asks before a delete (YAZ-4567): without confirm the dispatcher refuses and the session stays.
    const request = (args: Record<string, unknown>) => prepareAutomation({ profile: '/p', version: 'test', store }, { version: 1, session: 's', token: 't', id: 'r', issuedAt: Date.now(), command: 'session.remove', args }, Buffer.alloc(0))
    expect(() => request({ id: result.session.id })).toThrow(/missing confirm/)
    expect(store.get().sessions).toHaveLength(1)
    await request({ id: result.session.id, confirm: true }).run()
    expect(store.get().sessions).toEqual([])
  })
})
