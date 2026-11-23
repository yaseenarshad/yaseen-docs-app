/**
 * The Image Studio's three channels (🔒 YAZ-1775 D4, YAZ-1818): the guard layer. What is pinned here is
 * that a sandboxed renderer's arguments are checked BEFORE a provider is touched, that a typed
 * failure reaches the envelope with its code intact, and that the cache folder is made and swept
 * at registration rather than on the first search.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { PIXABAY_SECRET } from '@shared/types'
import { CONTRACT, type Envelope } from '@shared/ipc'
import { CACHE_TTL_MS } from '../media/cachePolicy'
import type { Secrets } from '../secrets'
import { MEDIA_CACHE_SWEEP_MS, registerMediaStudioIpc } from './mediaStudio'
import { registered } from './ipcFixture'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, BrowserWindow: { getAllWindows: vi.fn(() => []) } }))

const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })

const until = async (pred: () => Promise<boolean>, ms = 3000) => {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** The secrets instance `registerSecretsIpc` returns, reduced to what the providers use. */
function fakeSecrets(key: string | null): Secrets & { reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    set: async () => undefined,
    has: async () => key !== null,
    read: async (name: string) => {
      reads.push(name)
      return key
    },
  }
}

let userData: string
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  userData = await mkdtemp(path.join(tmpdir(), 'yd-media-studio-'))
})
afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
})

describe('registration', () => {
  it('makes the cache folder and sweeps yesterday out of it, detached', async () => {
    const folder = registerMediaStudioIpc(userData, fakeSecrets(null), vi.fn() as unknown as typeof globalThis.fetch)
    await until(async () => (await stat(folder).then(() => true, () => false)))
    const stale = path.join(folder, 'deadbeef.json')
    await writeFile(stale, '{}')
    const old = new Date(Date.now() - CACHE_TTL_MS - 1000)
    await utimes(stale, old, old)

    vi.mocked(ipcMain.handle).mockClear()
    const second = registerMediaStudioIpc(userData, fakeSecrets(null), vi.fn() as unknown as typeof globalThis.fetch)
    await until(async () => (await readdir(second)).length === 0)
    expect(await readdir(second)).toEqual([])
  })
})

describe('the hourly sweep (YAZ-3044 A34)', () => {
  it('a running app sweeps again each hour: an entry that went stale mid-session is gone after the next tick', async () => {
    const tick = vi.spyOn(globalThis, 'setInterval')
    const folder = registerMediaStudioIpc(userData, fakeSecrets(null), vi.fn() as unknown as typeof globalThis.fetch)
    await until(async () => (await stat(folder).then(() => true, () => false)))
    const call = tick.mock.calls.find(([, ms]) => ms === MEDIA_CACHE_SWEEP_MS)
    expect(call).toBeDefined()
    const stale = path.join(folder, 'cafebabe.json')
    await writeFile(stale, '{}')
    const old = new Date(Date.now() - CACHE_TTL_MS - 1000)
    await utimes(stale, old, old)
    ;(call?.[0] as () => void)()
    await until(async () => (await readdir(folder)).length === 0)
    tick.mockRestore()
  })
})

describe('the guards', () => {
  const noFetch = vi.fn(async () => {
    throw new Error('a guarded request must never reach a provider')
  })

  it('refuses a search with no request, a bad source or a non-string cursor', async () => {
    registerMediaStudioIpc(userData, fakeSecrets(null), noFetch as unknown as typeof globalThis.fetch)
    const search = registered(CONTRACT.media.search)
    await expect(search(null)).resolves.toEqual(bad('BAD_REQUEST'))
    await expect(search(null, { q: 'money bag' })).resolves.toEqual(bad('BAD_REQUEST'))
    await expect(search(null, { q: 'money bag', source: 'web' })).resolves.toEqual(bad('BAD_REQUEST'))
    await expect(search(null, { q: 'money bag', source: 'all', cursor: 7 })).resolves.toEqual(bad('BAD_REQUEST'))
    await expect(search(null, { q: 'a', source: 'all' })).resolves.toEqual(bad('BAD_REQUEST'))
    // YAZ-4360: a filter set this build cannot read is a bad request, never "no filter".
    await expect(search(null, { q: 'money bag', source: 'all', filters: { colors: 'red', style: 'any', packs: [], license: 'any' } })).resolves.toEqual(bad('BAD_REQUEST'))
    await expect(search(null, { q: 'money bag', source: 'all', filters: { colors: 'any', style: 'any', packs: ['../x'], license: 'any' } })).resolves.toEqual(bad('BAD_REQUEST'))
  })

  it('refuses preview and import for a provider that serves no bytes — `shape` is drawn, not fetched', async () => {
    registerMediaStudioIpc(userData, fakeSecrets(null), noFetch as unknown as typeof globalThis.fetch)
    for (const door of [CONTRACT.media.preview, CONTRACT.media.import]) {
      const call = registered(door)
      await expect(call(null, { provider: 'shape', id: 'rectangle' })).resolves.toEqual(bad('BAD_REQUEST'))
      await expect(call(null, { provider: 'iconify', id: '' })).resolves.toEqual(bad('BAD_REQUEST'))
      await expect(call(null, { provider: 'iconify' })).resolves.toEqual(bad('BAD_REQUEST'))
      await expect(call(null, 'noto:rocket')).resolves.toEqual(bad('BAD_REQUEST'))
    }
    // The hover zoom's width (YAZ-4447): only a width Pixabay serves.
    await expect(registered(CONTRACT.media.preview)(null, { provider: 'pixabay', id: '1', zoomWidth: 4000 })).resolves.toEqual(bad('BAD_REQUEST'))
  })
})

describe('what reaches the renderer', () => {
  it('answers a search through the envelope and asks the secrets instance for the key', async () => {
    const secrets = fakeSecrets(null)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ icons: ['noto:money-bag'], collections: { noto: { name: 'Noto' } }, total: 1 }), { headers: { 'Content-Type': 'application/json' } }))
    registerMediaStudioIpc(userData, secrets, fetchMock as unknown as typeof globalThis.fetch)
    const answer = (await registered(CONTRACT.media.search)(null, { q: 'money bag', source: 'all' })) as Envelope<{ items: unknown[]; pixabayAvailable: boolean }>
    expect(answer.ok).toBe(true)
    expect(answer.ok && answer.value.pixabayAvailable).toBe(false)
    expect(answer.ok && answer.value.items).toHaveLength(1)
    expect(secrets.reads).toContain(PIXABAY_SECRET)
  })

  it('carries a provider failure through with its typed code', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    registerMediaStudioIpc(userData, fakeSecrets(null), fetchMock as unknown as typeof globalThis.fetch)
    await expect(registered(CONTRACT.media.search)(null, { q: 'money bag', source: 'iconify' })).resolves.toEqual(bad('OFFLINE'))
    await expect(registered(CONTRACT.media.preview)(null, { provider: 'iconify', id: 'noto:money-bag' })).resolves.toEqual(bad('OFFLINE'))
  })

  it('answers an import with the bytes as a dataURL and the provider item', async () => {
    const fetchMock = vi.fn(async () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }))
    registerMediaStudioIpc(userData, fakeSecrets(null), fetchMock as unknown as typeof globalThis.fetch)
    const answer = (await registered(CONTRACT.media.import)(null, { provider: 'iconify', id: 'noto:money-bag' })) as Envelope<{ mimeType: string; dataURL: string; item: { itemKey: string } }>
    expect(answer.ok).toBe(true)
    expect(answer.ok && answer.value.mimeType).toBe('image/svg+xml')
    expect(answer.ok && answer.value.dataURL.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(answer.ok && answer.value.item.itemKey).toBe('iconify:noto:money-bag')
  })
})

describe('the icon packs door (YAZ-4359)', () => {
  it('refuses a verb it does not know, answers the status, and follows the folder setting', async () => {
    const listeners: Array<(state: { settings: { iconPacksFolder: string | null } }) => void> = []
    let settings = { iconPacksFolder: null as string | null }
    const store = { get: () => ({ settings }), onChange: (fn: (typeof listeners)[number]) => listeners.push(fn) }
    registerMediaStudioIpc(userData, fakeSecrets(null), vi.fn() as unknown as typeof globalThis.fetch, store as never)
    const packs = registered(CONTRACT.media.packs)
    await expect(packs(null, { op: 'explode' })).resolves.toEqual(bad('BAD_REQUEST'))
    const first = (await packs(null, { op: 'status' })) as Envelope<{ state: string; folder: string }>
    expect(first.ok && first.value).toMatchObject({ state: 'none', folder: path.join(userData, 'icon-packs') })
    settings = { iconPacksFolder: path.join(userData, 'elsewhere') }
    for (const fn of listeners) fn({ settings })
    await until(async () => {
      const now = (await packs(null, { op: 'status' })) as Envelope<{ folder: string }>
      return now.ok && now.value.folder === path.join(userData, 'elsewhere')
    })
  })

  it('a move that fails sets the folder setting back, so the next launch reads the folder that has the packs (YAZ-4377)', async () => {
    // One pack on the Mac, in the default folder, as a download leaves it.
    const home = path.join(userData, 'icon-packs')
    await mkdir(home, { recursive: true })
    const raw = JSON.stringify({ prefix: 'mdi', info: { name: 'mdi icons', total: 1, license: { title: 'MIT' } }, icons: { home: { body: '<path/>' } } })
    await writeFile(path.join(home, 'mdi.json.gz'), gzipSync(raw))
    await writeFile(path.join(home, 'mdi.names.gz'), gzipSync('home'))
    const pack = { sha: 'x', sha256: 'y', bytes: raw.length, stored: 10, info: { prefix: 'mdi', name: 'mdi icons', total: 1, license: { title: 'MIT' }, palette: false } }
    await writeFile(path.join(home, 'manifest.json'), JSON.stringify({ version: 1, tag: '2.2.1', source: 'github', plan: { mdi: { sha: 'x', sha256: null, size: raw.length } }, packs: { mdi: pack }, checkedAt: null }))
    // The chosen folder has a folder in the way of the pack's file name: the move fails.
    const chosen = path.join(userData, 'chosen')
    await mkdir(path.join(chosen, 'mdi.json.gz', 'blocker'), { recursive: true })
    const listeners: Array<() => void> = []
    let settings = { iconPacksFolder: null as string | null }
    const store = { get: () => ({ settings }), onChange: (fn: () => void) => listeners.push(fn), setSettings: vi.fn((next: typeof settings) => ((settings = next), listeners.forEach((fn) => fn()))) }
    registerMediaStudioIpc(userData, fakeSecrets(null), vi.fn() as unknown as typeof globalThis.fetch, store as never)
    const packs = registered(CONTRACT.media.packs)
    await until(async () => ((await packs(null, { op: 'status' })) as Envelope<{ state: string }>).ok)
    settings = { iconPacksFolder: chosen }
    for (const fn of listeners) fn()
    await until(async () => store.setSettings.mock.calls.length > 0)
    expect(store.setSettings).toHaveBeenCalledWith(expect.objectContaining({ iconPacksFolder: null }))
    const after = (await packs(null, { op: 'status' })) as Envelope<{ state: string; folder: string; failed: boolean }>
    expect(after.ok && after.value).toMatchObject({ state: 'complete', folder: home, failed: true })
  })
})
