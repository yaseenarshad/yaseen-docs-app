import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandDefinition, validateInput } from '@shared/automationCommands'
import { createComponentStore } from '../library/componentStore'
import { createMediaStore } from '../library/mediaStore'
import { mediaCommand } from './media'
import type { AutomationServices } from './services'

let root: string, services: AutomationServices
const item = { itemKey: 'pixabay:1', provider: 'pixabay', providerId: '1', kind: 'photo', title: 'Tree' }
const fragmentJson = JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'box', type: 'rectangle' }], appState: {}, files: {} })
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docs-cli-media-'))
  services = {
    components: createComponentStore(root, { trash: async path => { await rm(path) } }),
    media: createMediaStore(root, { macId: async () => 'aaaaaaaaaaaa' }),
    copies: { remove: vi.fn(async () => {}) },
    studio: { providers: {
      search: vi.fn(async () => ({ items: [item], cursor: null })),
      import: vi.fn(async () => ({ item, mimeType: 'image/png', dataURL: 'data:image/png;base64,AP+A' })),
    }, packs: { stop: vi.fn(async () => ({ state: 'stopped' })) } },
  } as unknown as AutomationServices
})
afterEach(async () => { await services.components.close(); await services.media.close(); await rm(root, { recursive: true, force: true }) })
const run = (command: string, args: Record<string, unknown> = {}, body = '') => {
  validateInput(commandDefinition(command).input, args)
  return mediaCommand(services, command, args, Buffer.from(body))
}
it('saves, renames, exports and removes a component through the app store', async () => {
  expect(await run('component.save', { name: 'Mochi card' }, JSON.stringify({ fragmentJson, previewPng: 'data:image/png;base64,iVBORw0KGgo=' }))).toMatchObject({ component: { slug: 'mochi-card' }, diskSaved: true })
  await run('component.rename', { slug: 'mochi-card', name: 'Renamed' })
  expect(await run('component.list', { limit: 1 })).toMatchObject({ items: [{ name: 'Renamed', slug: 'mochi-card' }], nextOffset: null })
  const outputFile = join(root, 'export.excalidraw')
  await run('component.export', { slug: 'mochi-card', outputFile })
  expect(JSON.parse(await readFile(outputFile, 'utf8'))).toEqual(JSON.parse(fragmentJson))
  await expect(run('component.export', { slug: 'mochi-card', outputFile })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
  await run('component.remove', { slug: 'mochi-card' })
  expect(await run('component.list')).toMatchObject({ items: [], total: 0 })
})
it('keeps library favorites, use words and removal in the same durable store', async () => {
  await run('media.favorite', { item })
  await run('media.recordUse', { item, query: 'oak' })
  await run('media.addWord', { item, word: 'green' })
  await run('media.removeWord', { itemKey: item.itemKey, word: 'oak' })
  expect(await run('media.library', { kind: 'used' })).toMatchObject({ items: [{ itemKey: item.itemKey, words: ['green'] }] })
  await run('media.unfavorite', { itemKey: item.itemKey })
  expect(services.copies.remove).toHaveBeenCalledExactlyOnceWith(item.itemKey)
  expect(await run('media.library', { kind: 'favorites' })).toMatchObject({ items: [] })
  expect(JSON.parse(await readFile(join(root, 'media-aaaaaaaaaaaa.json'), 'utf8')).used[0].words).toEqual(['green'])
})
it('uses provider bytes verbatim and refuses an existing output file', async () => {
  const outputFile = join(root, 'photo.png')
  await run('media.import', { provider: 'pixabay', id: '1', outputFile, zoomWidth: 340 })
  expect(await readFile(outputFile)).toEqual(Buffer.from([0, 255, 128]))
  await expect(run('media.import', { provider: 'pixabay', id: '1', outputFile })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
  expect(await readFile(outputFile)).toEqual(Buffer.from([0, 255, 128]))
})
it('rejects unknown nested filters and malformed components before changing app data', async () => {
  expect(() => run('media.search', { source: 'all', query: 'tree', filters: { surprise: true } })).toThrow()
  expect(services.studio.providers.search).not.toHaveBeenCalled()
  await expect(run('component.save', { name: 'bad' }, '{')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await expect(run('component.save', { name: 'bad' }, JSON.stringify({ fragmentJson, previewPng: 'https://example.test/image.png' }))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  expect(await run('component.list')).toMatchObject({ total: 0 })
})
