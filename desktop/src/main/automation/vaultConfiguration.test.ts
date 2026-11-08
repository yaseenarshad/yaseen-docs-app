import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { vaultConfiguration } from './vaultConfiguration'
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-vault-config-')); await mkdir(join(root, '.yaseendocs')) })
afterEach(() => rm(root, { recursive: true, force: true }))
const run = (command: string, args: Record<string, unknown> = {}) => vaultConfiguration(defaultAppState(), command, { root, ...args })
describe('public vault configuration adapters', () => {
  it('patches one New note shortcut against current slots and refuses files or malformed config', async () => {
    const a = join(root, 'A'), b = join(root, 'B'); await mkdir(a); await mkdir(b)
    await Promise.all([run('newPlace.set', { slot: 0, folder: a }), run('newPlace.set', { slot: 2, folder: b })])
    expect(await run('newPlace.list')).toEqual({ root, places: [a, null, b] })
    await run('newPlace.set', { slot: 0, folder: null })
    expect(await run('newPlace.list')).toEqual({ root, places: [null, null, b] })
    const note = join(root, 'Not a folder.md'); await writeFile(note, '')
    await expect(run('newPlace.set', { slot: 1, folder: note })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await writeFile(join(root, '.yaseendocs/new-places.json'), '{broken')
    await expect(run('newPlace.set', { slot: 1, folder: a })).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })
  it('patches declaration fields without discarding unknown stored extensions', async () => {
    await writeFile(join(root, '.yaseendocs/properties.json'), JSON.stringify({ version: 1, future: 7, properties: { status: { kind: 'select', options: ['Todo'], future: { keep: true } } } }))
    await run('declaration.patch', { name: 'status', changes: { required: true } })
    const stored = JSON.parse(await readFile(join(root, '.yaseendocs/properties.json'), 'utf8'))
    expect(stored).toMatchObject({ future: 7, properties: { status: { kind: 'select', options: ['Todo'], required: true, future: { keep: true } } } })
    await run('declaration.patch', { name: 'status', changes: { required: null } })
    expect(JSON.parse(await readFile(join(root, '.yaseendocs/properties.json'), 'utf8')).properties.status.required).toBeUndefined()
  })
  it('preserves concurrent icon picks and rejects invalid paths and identifiers', async () => {
    const a = join(root, 'A.md'), b = join(root, 'B.md'); await writeFile(a, 'A'); await writeFile(b, 'B')
    await Promise.all([run('icon.set', { path: a, icon: 'markdown' }), run('icon.set', { path: b, icon: 'python' })])
    expect(await run('icon.list')).toMatchObject({ total: 2 })
    await expect(run('icon.set', { path: a, icon: 'not an icon' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(run('icon.remove', { path: '/outside' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await run('icon.remove', { path: a })
    expect(await run('icon.list')).toMatchObject({ items: [{ path: b, icon: 'python' }] })
  })
  it('patches latest public config, retains unrelated fields, and refuses corruption or unknown fields', async () => {
    const name = 'review.json', file = join(root, '.yaseendocs', name)
    await writeFile(file, JSON.stringify({ enabled: false, future: 'keep' }))
    await Promise.all([run('vaultConfig.patch', { name, changes: { enabled: true } }), run('vaultConfig.patch', { name, changes: { baseDays: 10 } })])
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ enabled: true, baseDays: 10, future: 'keep' })
    await expect(run('vaultConfig.patch', { name, changes: { token: 'not-allowed' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(run('vaultConfig.patch', { name, changes: { baseDays: -1 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await writeFile(file, '{broken')
    await expect(run('vaultConfig.patch', { name, changes: { enabled: false } })).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(await readFile(file, 'utf8')).toBe('{broken')
  })
  it('patches a formatting field and resets only a named value', async () => {
    const name = 'text-formatting.json'
    await run('vaultConfig.patch', { name, changes: { h2: { size: 22, bold: true } } })
    await run('vaultConfig.patch', { name, changes: { h2: { size: null } } })
    expect(await run('vaultConfig.read', { name })).toMatchObject({ value: { version: 1, h2: { bold: true } } })
    await expect(run('vaultConfig.patch', { name, changes: { h2: { size: 999 } } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
