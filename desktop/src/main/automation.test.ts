import { expect, it } from 'vitest'
import { defaultAppState, type WindowEntry } from '@shared/types'
import { AUTOMATION_COMMANDS } from '@shared/automationCommands'
import { RequestQueue } from '../automation/requests'
import { lockKeys, prepareAutomation, routeFor, type AutomationContext } from './automation'
import type { AutomationServices } from './automation/services'
import type { NavigationHost } from './automation/navigation'

const window = { id: 'w1', roots: ['/v', '/w'] } as WindowEntry
const state = () => ({ ...defaultAppState(), vaultSets: [{ id: 'set', name: 'Both', roots: ['/v', '/w'], lastUsed: 0 }] })
const context: AutomationContext = { profile: '/p', version: 'test', state, navigation: { windows: () => [window] } as unknown as NavigationHost }
const keys = (command: string, args: Record<string, unknown> = {}) => lockKeys(context, command, args)

it('routes every registry command to an adapter and declares its locks', () => {
  for (const { name } of AUTOMATION_COMMANDS) {
    if (name === 'request.status') continue // The server answers receipts itself, outside the queue.
    expect(typeof routeFor(name).run, name).toBe('function')
    expect(keys(name, { root: '/v', window: 'w1' }).every(key => typeof key === 'string' && key.length > 0), name).toBe(true)
  }
  expect(() => routeFor('folder.unknown')).not.toThrow() // a resource route: its adapter refuses the action
  expect(() => routeFor('file.unknown')).toThrow(expect.objectContaining({ code: 'UNKNOWN_COMMAND' }))
})

it('takes no lock for a read or a remote read, and only its own service lock for remote work', () => {
  for (const { name, effect } of AUTOMATION_COMMANDS) if (effect === 'read') expect(keys(name, { root: '/v', window: 'w1' }), name).toEqual([])
  for (const name of ['media.search', 'media.preview', 'media.drawingIndex', 'media.packList', 'media.drawing', 'media.stopPacks', 'share.accounts', 'languageHelper.cancel']) expect(keys(name), name).toEqual([])
  expect(keys('media.downloadPacks')).toEqual(['icon-packs'])
  expect(keys('share.publish', { root: '/v' })).toEqual(['share'])
  expect(keys('sync.now', { root: '/v/' })).toEqual(['sync:/v'])
})

it('locks the documents of each named vault only for commands that write vault files', () => {
  expect(keys('file.write', { root: '/v' })).toEqual(['documents:/v'])
  expect(keys('file.write', { roots: ['/v', '/w'] })).toEqual(['documents:/v', 'documents:/w'])
  expect(keys('note.create', { workspace: 'both' })).toEqual(['documents:/v', 'documents:/w'])
  // A scope it cannot name locks every vault's documents; the adapter then refuses the input.
  expect(keys('file.write', { workspace: 'missing' })).toEqual(['documents'])
  expect(keys('drawing.export', { root: '/v' })).toEqual([])
  expect(keys('share.publish', { root: '/v' })).not.toContain('documents:/v')
  expect(keys('editor.zoomIn', { window: 'w1' })).toEqual(['window:w1'])
  expect(keys('editor.select', { window: 'w1' })).toEqual(['window:w1'])
  expect(keys('editor.replace', { window: 'w1' })).toEqual(['window:w1', 'documents:/v', 'documents:/w'])
  expect(keys('file.move', { window: 'w1' })).toEqual(['navigation', 'window:w1', 'documents:/v', 'documents:/w'])
})

it('answers media packStatus while media downloadPacks runs', async () => {
  const status = { state: 'downloading', folder: '/packs', version: null, packs: 1, total: 9, bytes: 1, totalBytes: 9, checkedAt: null, message: null, failed: false }
  let finish!: () => void
  const download = new Promise<void>(resolve => { finish = resolve })
  const packs = { status: async () => status, download: async () => { await download; return { ...status, state: 'complete' } } }
  const services = { studio: { packs } } as unknown as AutomationServices
  const queue = new RequestQueue(), submit = (id: string, command: string) =>
    queue.submit({ version: 1, session: 's', token: 't', id, issuedAt: Date.now(), command, args: {} }, Buffer.alloc(0), () => prepareAutomation({ ...context, services }, { version: 1, session: 's', token: 't', id, issuedAt: Date.now(), command, args: {} }, Buffer.alloc(0)))
  const downloading = submit('download', 'media.downloadPacks')
  expect(await submit('status', 'media.packStatus')).toEqual({ ok: true, value: status })
  finish()
  expect(await downloading).toMatchObject({ ok: true, value: { state: 'complete' } })
})
