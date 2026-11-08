// YAZ-4506: the commands no other adapter test reaches run here through the public dispatcher, which proves each
// result against its declared output. Service fakes use the services' own types, so they return real shapes.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type ShareEntry, type ShareStatus } from '@shared/types'
import { prepareAutomation } from '../automation'
import { createStore } from '../store'
import { _evictAll } from '../vaultIndex/live'
import { createComponentStore } from '../library/componentStore'
import type { AutomationApp } from './app'
import type { AutomationServices } from './services'

let base: string, root: string, store: ReturnType<typeof createStore>, components: ReturnType<typeof createComponentStore>
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'docs-cli-contract-')); root = join(base, 'Vault'); await mkdir(root)
  store = createStore(join(base, 'profile/state.json'))
  components = createComponentStore(join(base, 'library'), { trash: async path => { await rm(path) } })
})
afterEach(async () => { _evictAll(); await store.flush(); await components.close(); await rm(base, { recursive: true, force: true }) })

const off: ShareStatus = { state: 'off', url: null, workersDevUrl: null, customDomain: null, accountName: null, workerName: null, bucketName: null, readyAt: null, demo: false }
const share = (path: string): ShareEntry => ({ path, id: 'share', url: 'https://share.test/b/share', allowDownload: false, sharedAt: 1, updatedAt: 2, sync: { state: 'failed', message: 'Offline.', failedAt: 3 }, stale: false })
const item = { itemKey: 'iconify:mdi:home', provider: 'iconify' as const, providerId: 'mdi:home', kind: 'icon' as const, title: 'Home' }
const packs = { state: 'complete' as const, folder: '/packs', version: '2.2.553', packs: 2, total: 2, bytes: 10, totalBytes: 10, checkedAt: 1, message: null, failed: false }
const services = () => ({
  components,
  languageHelpers: { state: () => ({ ready: false, installing: false }), install: async () => ({ ok: false as const, error: 'offline' as const }), cancel: async () => {} },
  settingsFolder: { missing: () => false, hasOtherMacs: async () => false, settled: async () => {} },
  copies: { status: async () => ({ favorites: 2, saved: 1, saving: 0, waitingForKey: 1, waitingForPanel: 0, failed: 0, bytes: 512 }), readElements: async () => null, missingForPanel: async () => ['shape:a'], saveElements: async () => true },
  studio: {
    providers: {
      search: async () => ({ items: [item], nextCursor: 'next', pixabayAvailable: false, warnings: ['Pixabay is unreachable.'] }),
      preview: async () => ({ mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,PHN2Zy8+' }),
      drawingIndex: async () => ({ items: [{ ...item, kind: 'drawing' as const }] }), drawing: async () => ({ elements: [{ id: 'e', type: 'rectangle' }] }),
      packList: async () => [{ prefix: 'mdi', name: 'Material Design', total: 7000, license: { title: 'Apache 2.0', spdx: 'Apache-2.0' }, palette: false }],
    },
    packs: { status: async () => packs, download: async () => packs, stop: async () => packs, check: async () => packs, remove: async () => ({ ...packs, state: 'none' as const, version: null }) },
  },
  sync: { status: async (vault: string) => ({ root: vault, state: 'attention' as const, attention: 'too-large' as const, repo: { remoteUrl: null, branch: 'main' }, enabled: true, tooLarge: ['Big.mov'] }), syncNow: async (vault: string) => ({ root: vault, state: 'synced' as const, enabled: true, merged: [{ path: 'Board.drawio', author: 'Sara', clashes: 1, copy: 'Board (mine).drawio' }] }) },
  sharing: { status: async () => off, setup: async () => ({ ...off, state: 'ready' as const, readyAt: 1 }), accounts: async () => [{ id: 'a', name: 'Account' }], setDomain: async () => off, get: async (_root: string, path: string) => share(path), setPermission: async (_root: string, path: string) => share(path) },
}) satisfies Partial<{ [K in keyof AutomationServices]: unknown }>
const app = {
  updater: { state: () => ({ kind: 'downloading' as const, version: '2.15' }), notes: async () => ({ current: '2.14', checks: true, releases: [{ version: '2.15', title: 'v2.15', date: '2026-11-01T00:00:00Z', body: '- New' }] }), check: async () => ({ kind: 'idle' as const }), checks: true },
  diagnostics: async () => ({ platform: 'darwin', architecture: 'arm64', version: '2.14.0', packaged: true, memory: { windows: [{ id: 'w1', title: 'Notes', open: '1 note', bytes: 1, jsHeapBytes: null, grew: false, tabs: [{ path: '/v/A.md', title: null, state: null, lastSeen: null, sleepsAt: null, changed: 1 }] }], core: { bytes: 4, main: 1, gpu: 1, utility: 1, other: 1 }, helpers: null } }),
  restart: () => {},
} satisfies AutomationApp

const run = (command: string, args: Record<string, unknown> = {}, body?: string) => prepareAutomation({
  profile: base, version: 'test', state: () => store.get(), store, services: services() as unknown as AutomationServices, app,
  navigation: { windows: () => [{ id: 'w1', root, roots: [root], tabs: [], file: null, bounds: { x: 0, y: 0, width: 1, height: 1 } }], inspect: async () => ({ open: [] }) } as never,
}, { version: 1, session: 'contract', token: 'contract', id: command, issuedAt: Date.now(), command, args, hasContent: body !== undefined }, Buffer.from(body ?? '')).run()

it('declares the settings, saved lists, and live-window list results', async () => {
  expect(await run('settings.get')).toEqual({ settings: DEFAULT_SETTINGS })
  store.pushRecent(root)
  expect(await run('vault.list')).toMatchObject({ items: [{ path: root, key: null, open: false }] })
  expect(await run('vault.patch', { root, changes: { name: 'Notes', key: 2 } })).toEqual({ root, name: 'Notes', key: 2, diskSaved: true })
  await writeFile(join(root, 'A.md'), 'A')
  const { session } = await run('session.save', { name: 'Morning', roots: [root], tabs: [{ path: join(root, 'A.md') }] }) as { session: { id: string } }
  expect(await run('session.rename', { id: session.id, name: 'Evening' })).toMatchObject({ session: { name: 'Evening' } })
  expect(await run('workspace.list')).toMatchObject({ items: [], total: 0 })
  expect(await run('window.list')).toEqual({ items: [{ id: 'w1', roots: [root], name: null, source: 'live' }], total: 1, nextOffset: null })
  expect(await run('settingsFolder.get')).toEqual({ folder: null, missing: false })
})

it('declares notes, reviews, comments, and binary reads', async () => {
  const note = join(root, 'Note.md')
  await writeFile(note, '---\ncomments:\n  - id: c1\n    at: 2026-11-01T00:00:00Z\n    body: Looks good\n    mood: happy\n---\nBody\n')
  expect(await run('comment.list', { root, path: note })).toMatchObject({ items: [{ id: 'c1', mood: 'happy' }], total: 1 })
  await mkdir(join(root, '.yaseendocs')); await writeFile(join(root, '.yaseendocs/review.json'), '{"enabled":true}')
  const read = async () => (await run('file.read', { root, path: note }) as { revision: string }).revision
  await run('review.setEnabled', { root, path: note, revision: await read(), enabled: true })
  await run('review.reset', { root, path: note, revision: await read() })
  await utimes(note, 1_600_000_000, 1_600_000_000) // long overdue
  expect(await run('review.queue', { root })).toMatchObject({ root, items: [{ path: note }] })
  await writeFile(join(root, 'Picture.png'), Buffer.from([137, 80, 78, 71]))
  await writeFile(join(root, 'Paper.pdf'), '%PDF-1.4\n')
  expect(await run('image.read', { root, path: join(root, 'Picture.png') })).toMatchObject({ mime: 'image/png', encoding: 'base64' })
  expect(await run('pdf.read', { root, path: join(root, 'Paper.pdf') })).toMatchObject({ size: 9, source: 'disk' })
  expect(await run('pdf.export', { root, path: join(root, 'Paper.pdf'), outputFile: join(base, 'Paper copy.pdf') })).toMatchObject({ size: 9, diskSaved: true })
  await run('diagram.create', { root, path: join(root, 'Flow.drawio') })
  const { revision } = await run('diagram.read', { root, path: join(root, 'Flow.drawio') }) as { revision: string }
  expect(await run('diagram.setReadOnly', { root, path: join(root, 'Flow.drawio'), revision, on: true })).toMatchObject({ diskSaved: true })
  expect(await run('diagram.export', { root, path: join(root, 'Flow.drawio'), outputFile: join(base, 'Flow copy.drawio') })).toMatchObject({ source: 'disk' })
})

it('declares the media, component, and icon-pack results', async () => {
  const { component } = await run('component.save', { name: 'Card' }, JSON.stringify({ fragmentJson: JSON.stringify({ type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle' }], files: {} }), previewPng: 'data:image/png;base64,iVBORw0KGgo=' })) as { component: { slug: string } }
  expect(await run('component.read', { slug: component.slug })).toMatchObject({ slug: component.slug })
  for (const command of ['media.favoriteCopies', 'media.packStatus', 'media.downloadPacks', 'media.stopPacks', 'media.checkPacks', 'media.drawingIndex', 'media.packList', 'media.favoritesForPanel']) await run(command)
  // YAZ-4572: confirm: true answers the app's "Remove the icon packs?" sheet; without it nothing is removed.
  expect(() => run('media.removePacks')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: 'input: missing confirm' }))
  expect(await run('media.removePacks', { confirm: true })).toMatchObject({ state: 'none' })
  await run('media.search', { query: 'home', source: 'iconify' })
  await run('media.preview', { provider: 'iconify', id: 'mdi:home' })
  await run('media.drawing', { id: 'drawing:1' })
  expect(await run('media.favoriteElements', { itemKey: 'shape:a' })).toEqual({ itemKey: 'shape:a', fragmentJson: null })
  expect(await run('media.saveFavoriteElements', { itemKey: 'shape:a' }, '{"elements":[]}')).toEqual({ itemKey: 'shape:a', kept: true, diskSaved: true })
})

it('declares the connected-service and app results without any secret', async () => {
  const board = join(root, 'Board.excalidraw'); await writeFile(board, '{}')
  for (const command of ['languageHelper.state', 'languageHelper.install', 'languageHelper.cancel', 'share.status', 'app.diagnostics', 'update.state', 'update.notes', 'update.check']) await run(command)
  await run('sync.status', { root }); await run('sync.now', { root })
  expect(await run('share.accounts', {}, 'token')).toEqual({ items: [{ id: 'a', name: 'Account' }], total: 1, nextOffset: null })
  expect(await run('share.setup', {}, 'token')).toMatchObject({ state: 'ready' })
  await run('share.setDomain', { hostname: null })
  expect(await run('share.get', { root, path: board })).toMatchObject({ path: board, share: { id: 'share' } })
  await run('share.setPermission', { root, path: board, allowDownload: false })
})
