/**
 * The icon packs on this Mac (YAZ-4359), against a stubbed network and a temp folder: the download, Stop and "Download
 * the rest", "Check for new icons" (only the changed packs), the unpkg backup, GitHub's limit, Remove and the folder
 * move. Then the local half through the providers: a search over every pack, and tiles and adds built from a pack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DEFAULT_MEDIA_FILTERS, type IconPacksStatus } from '@shared/iconPacks'
import type { MediaSearchResponse } from '@shared/types'
import type { MediaCache } from './cache'
import { createIconPacks, gitBlobSha, GITHUB_LIMIT_MESSAGE, newestTag, sha256Of, visibleNames } from './iconPacks'
import { createMediaProviders } from './providers'

/** One pack file as `@iconify/json` has it. */
const packFile = (prefix: string, names: string[], over: Record<string, unknown> = {}) =>
  JSON.stringify({
    prefix,
    info: { name: `${prefix} icons`, total: names.length, license: { title: 'MIT', spdx: 'MIT' }, palette: false, ...((over.info as object) ?? {}) },
    width: 24,
    height: 24,
    icons: Object.fromEntries(names.map((name) => [name, { body: `<path d="${prefix}-${name}"/>` }])),
    aliases: { [`${names[0]}-turned`]: { parent: names[0], rotate: 1 } },
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'info')),
  })

/** A fake GitHub + unpkg: `versions[tag]` is each pack's file text at that tag. */
function network(versions: Record<string, Record<string, string>>, opts: { limited?: boolean; rawDown?: string[]; slow?: Promise<void> } = {}) {
  const calls: string[] = []
  const latest = Object.keys(versions).sort((a, b) => Number(a.split('.').at(-1)) - Number(b.split('.').at(-1))).at(-1) as string
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(url.toString())
    const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
    if (url.hostname === 'api.github.com') {
      if (opts.limited) return json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
      if (url.pathname.endsWith('/tags')) return json(Object.keys(versions).map((name) => ({ name })))
      const tag = decodeURIComponent(url.pathname.split('/').at(-1) as string)
      return json({ tree: [{ path: 'README.md', type: 'blob', sha: 'x', size: 1 }, ...Object.entries(versions[tag]).map(([prefix, text]) => ({ path: `json/${prefix}.json`, type: 'blob', sha: gitBlobSha(Buffer.from(text)), size: Buffer.byteLength(text) }))] })
    }
    if (url.hostname === 'raw.githubusercontent.com') {
      const [, , , tag, , file] = url.pathname.split('/')
      const prefix = file.replace('.json', '')
      if (opts.rawDown?.includes(prefix)) return new Response('down', { status: 500 })
      if (opts.slow) await Promise.race([opts.slow, new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))])
      return new Response(versions[decodeURIComponent(tag)][prefix])
    }
    if (url.hostname === 'unpkg.com') {
      if (url.pathname === '/@iconify/json/json/' && url.search === '?meta')
        return json({ version: latest, files: Object.entries(versions[latest]).map(([prefix, text]) => ({ path: `/json/${prefix}.json`, size: Buffer.byteLength(text), integrity: sha256Of(Buffer.from(text)) })) })
      const match = /^\/@iconify\/json@([^/]+)\/json\/([a-z0-9-]+)\.json$/.exec(url.pathname)
      if (match) return new Response(versions[decodeURIComponent(match[1])][match[2]])
    }
    return new Response('not here', { status: 404 })
  })
  return { fetch: fetchMock as unknown as typeof globalThis.fetch, calls }
}

const V1 = {
  mdi: packFile('mdi', ['arrow-left', 'arrow-right', 'home', 'hidden-one']).replace('"hidden-one":{', '"hidden-one":{"hidden":true,'),
  noto: packFile('noto', ['red-arrow', 'house'], { info: { palette: true, category: 'Emoji' } }),
  tabler: packFile('tabler', ['arrow-up', 'arrow-up-filled', 'star']),
}

let folder: string
beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'yd-icon-packs-'))
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('pure parts', () => {
  it('picks the newest tag by number, and lists only the visible names', () => {
    expect(newestTag(['2.2.99', '2.2.553', '2.2.552', 'latest'])).toBe('2.2.553')
    expect(newestTag(['x'])).toBeNull()
    expect(visibleNames({ icons: { a: {}, b: { hidden: true }, c: {} } })).toEqual(['a', 'c'])
  })
})

describe('the download (round 2 decisions 4 and 8)', () => {
  it('downloads every pack of the newest tag: gzip pack, names list, manifest; progress after each pack', async () => {
    const net = network({ '2.2.1': V1, '2.2.10': V1 })
    const seen: IconPacksStatus[] = []
    const packs = createIconPacks({ folder, fetch: net.fetch, onStatus: (s) => seen.push(s) })
    const done = await packs.download()

    expect(done).toMatchObject({ state: 'complete', version: '2.2.10', packs: 3, total: 3, failed: false, message: 'All 3 icon packs are on this Mac.' })
    expect(done.bytes).toBe(done.totalBytes)
    expect((await readdir(folder)).sort()).toEqual(['manifest.json', 'mdi.json.gz', 'mdi.names.gz', 'noto.json.gz', 'noto.names.gz', 'tabler.json.gz', 'tabler.names.gz'])
    expect(gunzipSync(await readFile(path.join(folder, 'mdi.json.gz'))).toString()).toBe(V1.mdi)
    expect(gunzipSync(await readFile(path.join(folder, 'mdi.names.gz'))).toString()).toBe('arrow-left\narrow-right\nhome')
    const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))
    expect(manifest.packs.noto.info).toMatchObject({ name: 'noto icons', palette: true, category: 'Emoji', license: { spdx: 'MIT' } })
    // The run starts, the plan lands, each pack lands (three at a time, so the counts can jump), the run ends.
    expect(seen.map((s) => s.state)).toEqual(['downloading', 'downloading', 'downloading', 'downloading', 'downloading', 'complete'])
    expect(seen.map((s) => s.packs).every((n, i, all) => i === 0 || n >= all[i - 1])).toBe(true)
    expect(seen.at(-1)?.packs).toBe(3)
    // Two GitHub API requests: the tags and the tree.
    expect(net.calls.filter((url) => url.includes('api.github.com'))).toHaveLength(2)
    // A new main reads it back from the folder.
    expect(await createIconPacks({ folder, fetch: net.fetch }).status()).toMatchObject({ state: 'complete', packs: 3 })
  })

  it('a Stop keeps the finished packs; "Download the rest" needs no GitHub request', async () => {
    let release = () => undefined as void
    const slow = new Promise<void>((resolve) => (release = resolve))
    const net = network({ '2.2.1': V1 }, { slow })
    const packs = createIconPacks({ folder, fetch: net.fetch })
    const running = packs.download()
    await vi.waitFor(() => expect(net.calls.filter((url) => url.includes('raw.githubusercontent.com')).length).toBeGreaterThan(0))
    const stopped = await packs.stop()
    release()
    expect(await running).toEqual(stopped)
    expect(stopped.state).toBe('none')
    expect(stopped.message).toBe('Stopped. 0 of 3 packs are on this Mac.')

    const apiBefore = net.calls.filter((url) => url.includes('api.github.com')).length
    const rest = await packs.download()
    expect(rest).toMatchObject({ state: 'complete', packs: 3 })
    expect(net.calls.filter((url) => url.includes('api.github.com')).length).toBe(apiBefore)
  })

  it('resumes after a stop in the middle: only the missing packs come', async () => {
    const net = network({ '2.2.1': V1 })
    const first = createIconPacks({ folder, fetch: net.fetch })
    await first.download()
    // As if the run had stopped after two packs: one pack's files and entry are gone.
    const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))
    delete manifest.packs.tabler
    await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest))
    const packs = createIconPacks({ folder, fetch: net.fetch })
    expect(await packs.status()).toMatchObject({ state: 'partial', packs: 2, total: 3 })
    net.calls.length = 0
    expect(await packs.download()).toMatchObject({ state: 'complete' })
    expect(net.calls).toEqual(['https://raw.githubusercontent.com/iconify/icon-sets/2.2.1/json/tabler.json'])
  })

  it('"Check for new icons" downloads only the packs whose sha changed, and drops a pack that left', async () => {
    const net = network({ '2.2.1': V1 })
    const packs = createIconPacks({ folder, fetch: net.fetch })
    await packs.download()
    const v2 = { mdi: V1.mdi, noto: packFile('noto', ['red-arrow', 'house', 'new-one'], { info: { palette: true } }), lucide: packFile('lucide', ['arrow']) }
    const net2 = network({ '2.2.1': V1, '2.2.2': v2 })
    const updater = createIconPacks({ folder, fetch: net2.fetch, now: () => 1234 })
    const after = await updater.check()
    expect(after).toMatchObject({ state: 'complete', version: '2.2.2', packs: 3, checkedAt: 1234, message: '2 packs updated to version 2.2.2.' })
    expect(net2.calls.filter((url) => url.includes('raw.githubusercontent.com')).sort()).toEqual([
      'https://raw.githubusercontent.com/iconify/icon-sets/2.2.2/json/lucide.json',
      'https://raw.githubusercontent.com/iconify/icon-sets/2.2.2/json/noto.json',
    ])
    expect((await readdir(folder)).filter((f) => f.startsWith('tabler'))).toEqual([])
    // Nothing changed: no pack downloads.
    net2.calls.length = 0
    expect((await updater.check()).message).toBe('Up to date: version 2.2.2.')
    expect(net2.calls.some((url) => url.includes('raw.githubusercontent.com'))).toBe(false)
  })

  it('takes a pack from unpkg when GitHub cannot give it, and keeps no file whose checksum does not match', async () => {
    const net = network({ '2.2.1': V1 }, { rawDown: ['noto'] })
    const done = await createIconPacks({ folder, fetch: net.fetch }).download()
    expect(done.state).toBe('complete')
    expect(net.calls).toContain('https://unpkg.com/@iconify/json@2.2.1/json/noto.json')

    // A file that is not the one the tree names: neither source's copy is kept.
    await rm(folder, { recursive: true, force: true })
    const tampered = network({ '2.2.1': V1 })
    const tamperedFetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/tabler.json')) return new Response(V1.tabler.replace('star', 'stab'))
      return tampered.fetch(input)
    }) as typeof globalThis.fetch
    const bad = await createIconPacks({ folder, fetch: tamperedFetch }).download()
    expect(bad).toMatchObject({ state: 'partial', packs: 2, failed: true })
    expect(bad.message).toBe('1 pack could not download (tabler did not match its checksum). Try again.')
  })

  it("says so clearly at GitHub's limit, and plans from unpkg instead", async () => {
    const net = network({ '2.2.1': V1, '2.2.7': V1 }, { limited: true })
    const done = await createIconPacks({ folder, fetch: net.fetch }).download()
    expect(done).toMatchObject({ state: 'complete', version: '2.2.7', failed: false })
    expect(done.message).toBe(`${GITHUB_LIMIT_MESSAGE} All 3 icon packs are on this Mac.`)
    expect(net.calls).toContain('https://unpkg.com/@iconify/json/json/?meta')
  })

  it('offline, it says so and keeps nothing half done', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const done = await createIconPacks({ folder, fetch: fetchMock as unknown as typeof globalThis.fetch }).download()
    expect(done).toMatchObject({ state: 'none', failed: true, message: "You're offline. Connect to the internet to download icon packs." })
  })

  it('Remove deletes only the pack files and the manifest; other files in a chosen folder stay', async () => {
    const packs = createIconPacks({ folder, fetch: network({ '2.2.1': V1 }).fetch })
    await packs.download()
    await writeFile(path.join(folder, 'my-notes.txt'), 'mine')
    expect(await packs.remove()).toMatchObject({ state: 'none', packs: 0, version: null })
    expect(await readdir(folder)).toEqual(['my-notes.txt'])
    expect(packs.has('mdi')).toBe(false)
  })

  it('stores a big pack in parts, and builds any icon of it from its part, an alias too', async () => {
    const big = packFile('big', Array.from({ length: 40 }, (_, i) => `icon-${i}`))
    const packs = createIconPacks({ folder, fetch: network({ '2.2.1': { big } }).fetch, split: { above: 1000, part: 600 } })
    const done = await packs.download()
    const parts = Math.ceil(Buffer.byteLength(big) / 600)
    expect(done.state).toBe('complete')
    expect((await readdir(folder)).filter((f) => f.includes('.part-'))).toHaveLength(parts)
    for (const n of [0, 17, 39]) expect(await packs.svg(`big:icon-${n}`)).toContain(`<path d="big-icon-${n}"/>`)
    expect(await packs.svg('big:icon-0-turned')).toContain('rotate(90 12 12)')
    expect(await packs.svg('big:nope')).toBeNull()
    await packs.remove()
    expect(await readdir(folder).catch(() => [])).toEqual([])
  })

  it('"Choose a folder…" moves the packs; a folder that has packs is used as it is', async () => {
    const packs = createIconPacks({ folder, fetch: network({ '2.2.1': V1 }).fetch })
    await packs.download()
    const next = path.join(folder, 'elsewhere')
    expect(await packs.moveTo(next)).toMatchObject({ state: 'complete', folder: next, packs: 3 })
    expect((await readdir(folder)).sort()).toEqual(['elsewhere'])
    expect((await readdir(next)).length).toBe(7)
    expect(await packs.svg('mdi:home')).toContain('mdi-home')

    // A folder with packs of its own (another download there): re-pointed only, and the old folder keeps its packs.
    const other = path.join(folder, 'other')
    await createIconPacks({ folder: other, fetch: network({ '2.2.9': { lucide: packFile('lucide', ['arrow']) } }).fetch }).download()
    expect(await packs.moveTo(other)).toMatchObject({ folder: other, state: 'complete', version: '2.2.9', packs: 1 })
    expect((await readdir(next)).length).toBe(7)
  })
})

describe('the packs answer search, tiles and adds (decision 5)', () => {
  function memoryCache(): MediaCache {
    const store = new Map<string, unknown>()
    return { read: async <T,>(key: string) => (store.has(key) ? (store.get(key) as T) : null), write: async (key, value) => void store.set(key, value), sweep: async () => 0 }
  }

  async function withPacks() {
    const packs = createIconPacks({ folder, fetch: network({ '2.2.1': V1 }).fetch })
    await packs.download()
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    return { packs, offline, providers: createMediaProviders({ fetch: offline as unknown as typeof globalThis.fetch, readPixabayKey: async () => null, cache: memoryCache(), packs }) }
  }
  const ids = (page: MediaSearchResponse) => page.items.map(({ providerId }) => providerId)

  it('finds names in every pack, best first, with no network', async () => {
    const { providers, offline } = await withPacks()
    const page = await providers.search({ q: 'arrow', source: 'iconify' })
    expect(ids(page)).toEqual(['noto:red-arrow', 'tabler:arrow-up', 'mdi:arrow-left', 'mdi:arrow-right', 'tabler:arrow-up-filled'].sort((a, b) => order(a) - order(b)))
    expect(page.items.find(({ providerId }) => providerId === 'noto:red-arrow')).toMatchObject({ collectionName: 'noto icons', licenseName: 'MIT' })
    expect(ids(await providers.search({ q: 'arrow left', source: 'iconify' }))).toEqual(['mdi:arrow-left'])
    // A hidden icon is not found.
    expect(ids(await providers.search({ q: 'hidden', source: 'all' }))).toEqual([])
    expect(offline).not.toHaveBeenCalled()
  })

  it('applies a filter at once from the pack data: no network', async () => {
    const { providers, offline } = await withPacks()
    expect(ids(await providers.search({ q: 'arrow', source: 'iconify', filters: { ...DEFAULT_MEDIA_FILTERS, colors: 'many' } }))).toEqual(['noto:red-arrow'])
    expect(ids(await providers.search({ q: 'arrow', source: 'iconify', filters: { ...DEFAULT_MEDIA_FILTERS, style: 'filled' } }))).toEqual(['tabler:arrow-up-filled'])
    expect(offline).not.toHaveBeenCalled()
  })

  it('pages a long answer with a local cursor, and opens one pack`s every icon with an empty search', async () => {
    const { providers } = await withPacks()
    const all = await providers.search({ q: '', source: 'iconify', filters: { ...DEFAULT_MEDIA_FILTERS, packs: ['mdi'] } })
    expect(ids(all)).toEqual(['mdi:arrow-left', 'mdi:arrow-right', 'mdi:home'])
    expect(all.nextCursor).toBeNull()
  })

  it('builds tiles and adds from the pack, a turned alias too', async () => {
    const { providers, offline } = await withPacks()
    const tile = await providers.preview({ provider: 'iconify', id: 'tabler:star' })
    expect(Buffer.from(tile.dataURL.split(',')[1], 'base64').toString()).toContain('<path d="tabler-star"/>')
    const added = await providers.import({ provider: 'iconify', id: 'mdi:arrow-left-turned' })
    expect(Buffer.from(added.dataURL.split(',')[1], 'base64').toString()).toContain('rotate(90 12 12)')
    expect(added.item).toMatchObject({ itemKey: 'iconify:mdi:arrow-left-turned', collectionName: 'mdi icons', licenseName: 'MIT' })
    expect(offline).not.toHaveBeenCalled()
    // A pack that is not here goes to the network as before.
    await expect(providers.preview({ provider: 'iconify', id: 'lucide:arrow' })).rejects.toMatchObject({ code: 'OFFLINE' })
  })
})

/** The expected local order: exact, then starts-with, then the rest; shorter first; then the pack order (noto, a colour set, first). */
function order(id: string): number {
  const name = id.split(':')[1]
  const tier = name === 'arrow' ? 0 : name.startsWith('arrow') ? 1 : 2
  const pack = ['noto', 'mdi', 'tabler'].indexOf(id.split(':')[0])
  return tier * 10_000 + name.length * 100 + pack
}
