/**
 * The icon packs on this Mac (YAZ-4359), against a stubbed network and a temp folder: the download, Stop and "Download
 * the rest", "Check for new icons" (only the changed packs), the unpkg backup, GitHub's limit, Remove and the folder
 * move. Then the local half through the providers: a search over every pack, and tiles and adds built from a pack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DEFAULT_MEDIA_FILTERS, ESTIMATED_PACK_BYTES, ESTIMATED_PACK_COUNT, type IconPacksStatus } from '@shared/iconPacks'
import type { MediaSearchResponse, StudioItem } from '@shared/types'
import type { MediaCache } from './cache'
import { createIconPacks, gitBlobSha, GITHUB_LIMIT_MESSAGE, newestTag, PACK_GZIP_RATIO, plannedBytes, sha256Of, visibleNames } from './iconPacks'
import { createMediaProviders } from './providers'
import { atomicWrite } from '../fs/fsUtils'

/**
 * The crash points (YAZ-4366): `beforeWrite` runs before each `atomicWrite` and may throw, as a crash there would stop
 * the run; `renameFails` makes a `rename` fail as it does across two disks (EXDEV).
 */
const crash = vi.hoisted(() => ({ beforeWrite: null as ((file: string) => void) | null, renameFails: null as ((from: string, to: string) => boolean) | null, removed: null as string[] | null }))
vi.mock('../fs/fsUtils', async (original) => {
  const real = await original<typeof import('../fs/fsUtils')>()
  return { ...real, atomicWrite: vi.fn(async (file: string, ...rest: [string | Uint8Array]) => (crash.beforeWrite?.(file), real.atomicWrite(file, ...rest))) }
})
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>()
  const rename = async (from: string, to: string) => {
    if (crash.renameFails?.(String(from), String(to))) throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
    return real.rename(from, to)
  }
  const rm: typeof real.rm = async (file, options) => {
    crash.removed?.push(path.basename(String(file)))
    return real.rm(file, options)
  }
  return { ...real, default: { ...real, rename, rm }, rename, rm }
})

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

/**
 * A fake GitHub + unpkg: `versions[tag]` is each pack's file text at that tag. `collections.json` at a tag lists each
 * pack but the `unlisted` ones, and marks the `hidden` ones, as Iconify's does.
 */
function network(versions: Record<string, Record<string, string>>, opts: { limited?: boolean; rawDown?: string[]; slow?: Promise<void>; hidden?: string[]; unlisted?: string[] } = {}) {
  const calls: string[] = []
  const latest = Object.keys(versions).sort((a, b) => Number(a.split('.').at(-1)) - Number(b.split('.').at(-1))).at(-1) as string
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(url.toString())
    const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
    const listed = (tag: string) =>
      json(Object.fromEntries(Object.keys(versions[tag] ?? {}).filter((prefix) => !opts.unlisted?.includes(prefix)).map((prefix) => [prefix, { name: prefix, ...(opts.hidden?.includes(prefix) ? { hidden: true } : {}) }])))
    if (url.hostname === 'api.github.com') {
      if (opts.limited) return json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
      if (url.pathname.endsWith('/tags')) return json(Object.keys(versions).map((name) => ({ name })))
      const tag = decodeURIComponent(url.pathname.split('/').at(-1) as string)
      return json({ tree: [{ path: 'README.md', type: 'blob', sha: 'x', size: 1 }, ...Object.entries(versions[tag]).map(([prefix, text]) => ({ path: `json/${prefix}.json`, type: 'blob', sha: gitBlobSha(Buffer.from(text)), size: Buffer.byteLength(text) }))] })
    }
    if (url.hostname === 'raw.githubusercontent.com') {
      if (url.pathname.endsWith('/collections.json')) return listed(decodeURIComponent(url.pathname.split('/')[3]))
      const [, , , tag, , file] = url.pathname.split('/')
      const prefix = file.replace('.json', '')
      if (opts.rawDown?.includes(prefix)) return new Response('down', { status: 500 })
      if (opts.slow) await Promise.race([opts.slow, new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))])
      return new Response(versions[decodeURIComponent(tag)][prefix])
    }
    if (url.hostname === 'unpkg.com') {
      if (url.pathname === '/@iconify/json/json/' && url.search === '?meta')
        return json({ version: latest, files: Object.entries(versions[latest]).map(([prefix, text]) => ({ path: `/json/${prefix}.json`, size: Buffer.byteLength(text), integrity: sha256Of(Buffer.from(text)) })) })
      const list = /^\/@iconify\/json@([^/]+)\/collections\.json$/.exec(url.pathname)
      if (list) return listed(decodeURIComponent(list[1]))
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
  crash.beforeWrite = null
  crash.renameFails = null
  crash.removed = null
  vi.mocked(atomicWrite).mockClear()
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

  it('Stop ends the run even when a body read does not end on abort (YAZ-4376)', async () => {
    const net = network({ '2.2.1': V1 })
    // Measured on the real network: after a Stop, one pack's `arrayBuffer()` never settled. This body never ends and
    // does not hear the abort.
    const stalled = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/tabler.json')) return new Response(new ReadableStream({ start: () => undefined }), { status: 200 })
      return net.fetch(input, init)
    }) as typeof globalThis.fetch
    const packs = createIconPacks({ folder, fetch: stalled })
    void packs.download()
    await vi.waitFor(async () => expect((await packs.status()).packs).toBe(2))
    const stopped = await Promise.race([packs.stop(), new Promise<'still running'>((resolve) => setTimeout(() => resolve('still running'), 3000))])
    expect(stopped).not.toBe('still running')
    expect(stopped).toMatchObject({ state: 'partial', packs: 2, message: 'Stopped. 2 of 3 packs are on this Mac.' })
    // The run is over: "Download the rest" starts a new one, and its Stop ends it too.
    const again = packs.download()
    expect((await packs.status()).state).toBe('downloading')
    expect(await packs.stop()).toMatchObject({ state: 'partial', packs: 2 })
    await again
  })

  it('a body that stops sending with no Stop fails that pack after the idle limit, and the run ends', async () => {
    const net = network({ '2.2.1': V1 })
    const stalled = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/tabler.json')) return new Response(new ReadableStream({ start: () => undefined }), { status: 200 })
      return net.fetch(input, init)
    }) as typeof globalThis.fetch
    const done = await createIconPacks({ folder, fetch: stalled, idleMs: 50 }).download()
    expect(done).toMatchObject({ state: 'partial', packs: 2, failed: true })
    expect(done.message).toBe('1 pack could not download (a server stopped sending). Try again.')
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
    expect(net2.calls.filter((url) => url.includes('raw.githubusercontent.com') && url.includes('/json/')).sort()).toEqual([
      'https://raw.githubusercontent.com/iconify/icon-sets/2.2.2/json/lucide.json',
      'https://raw.githubusercontent.com/iconify/icon-sets/2.2.2/json/noto.json',
    ])
    expect((await readdir(folder)).filter((f) => f.startsWith('tabler'))).toEqual([])
    // Nothing changed: no pack downloads.
    net2.calls.length = 0
    expect((await updater.check()).message).toBe('Up to date: version 2.2.2.')
    expect(net2.calls.some((url) => url.includes('raw.githubusercontent.com') && url.includes('/json/'))).toBe(false)
  })

  it('a Stop during "Check for new icons" keeps search on the packs and says what is not updated (YAZ-4384)', async () => {
    const packs = createIconPacks({ folder, fetch: network({ '2.2.1': V1 }).fetch })
    await packs.download()
    const v2 = { mdi: packFile('mdi', ['arrow-left', 'new']), noto: packFile('noto', ['red-arrow', 'new'], { info: { palette: true } }), tabler: V1.tabler }
    const net2 = network({ '2.2.1': V1, '2.2.2': v2 })
    let packAsked = () => undefined as void
    const asked = new Promise<void>((resolve) => (packAsked = resolve))
    const seen: IconPacksStatus[] = []
    const updater = createIconPacks({
      folder,
      onStatus: (s) => seen.push(s),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (/\/json\/[a-z]+\.json$/.test(String(input))) {
          packAsked()
          await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
        }
        return net2.fetch(input, init)
      }) as typeof globalThis.fetch,
    })
    const running = updater.check()
    await asked
    // During the check the count is the packs that are up to date: 1 of 3 (tabler did not change).
    expect(seen.at(-1)).toMatchObject({ state: 'checking', packs: 1, total: 3 })
    const stopped = await updater.stop()
    await running
    // Every pack is still on the Mac (two in the older version): complete, not "3 of 3 … Download the rest".
    expect(stopped).toMatchObject({ state: 'complete', packs: 3, total: 3, failed: false, message: 'Stopped. 2 packs are not updated yet. Check for new icons to update them.' })
    expect(updater.searchReady()).toBe(true)
  })

  it('the size total keeps the confirm box`s measure (bytes on the Mac) through the download (YAZ-4384)', async () => {
    // Before a plan: the estimate the confirm box shows.
    const packs = createIconPacks({ folder, fetch: network({ '2.2.1': V1 }).fetch })
    expect(await packs.status()).toMatchObject({ total: ESTIMATED_PACK_COUNT, totalBytes: ESTIMATED_PACK_BYTES })
    // The checker's case: the first packs gzip worse than the rest (31 packs: 9.6 MB stored of about 31 MB raw). The
    // total is the bytes on the Mac plus each missing pack's planned bytes times ONE measured ratio, never the first
    // packs' ratio applied to every pack (that gave "of 168 MB" for 141.8 MB).
    const stored = (raw: number, bytes: number) => ({ sha: 'x', sha256: 'y', bytes: raw, stored: bytes, info: { prefix: 'a', name: 'a', total: 1, license: { title: 'MIT' }, palette: false } })
    const plan = { a: { sha: 'x', sha256: null, size: 31_000_000 }, b: { sha: 'x', sha256: null, size: 611_000_000 } }
    expect(plannedBytes({ plan, packs: {} })).toBe(Math.round(642_000_000 * PACK_GZIP_RATIO))
    expect(plannedBytes({ plan, packs: { a: stored(31_000_000, 9_600_000) } })).toBe(9_600_000 + Math.round(611_000_000 * PACK_GZIP_RATIO))
    expect(plannedBytes({ plan, packs: { a: stored(31_000_000, 9_600_000), b: stored(611_000_000, 132_000_000) } })).toBe(141_600_000)
    // Through a real run: the plan's total is the estimate, and the end's total is the bytes on the Mac.
    const seen: IconPacksStatus[] = []
    const watched = createIconPacks({ folder: path.join(folder, 'w'), fetch: network({ '2.2.1': V1 }).fetch, onStatus: (s) => seen.push(s) })
    const done = await watched.download()
    const raw = Object.values(V1).reduce((sum, text) => sum + Buffer.byteLength(text), 0)
    expect(seen.find((s) => s.packs === 0 && s.total === 3)?.totalBytes).toBe(Math.round(raw * PACK_GZIP_RATIO))
    expect(done.totalBytes).toBe(done.bytes)
  })

  it('leaves out the packs that Iconify hides: not downloaded, not searched; a check drops one an older download kept (YAZ-4384)', async () => {
    const versions = { '2.2.1': { ...V1, feather: packFile('feather', ['arrow-up']), bubbles: packFile('bubbles', ['arrow']) } }
    const net = network(versions, { hidden: ['feather'], unlisted: ['bubbles'] })
    const packs = createIconPacks({ folder, fetch: net.fetch })
    const done = await packs.download()
    expect(done).toMatchObject({ state: 'complete', packs: 3, total: 3 })
    expect(net.calls.some((url) => /\/(feather|bubbles)\.json$/.test(url))).toBe(false)
    expect(net.calls).toContain('https://raw.githubusercontent.com/iconify/icon-sets/2.2.1/collections.json')
    expect([...(await packs.names()).keys()].sort()).toEqual(['mdi', 'noto', 'tabler'])

    // A folder from a build that kept every file: the next check removes the hidden pack.
    const all = createIconPacks({ folder: path.join(folder, 'old'), fetch: network(versions).fetch })
    expect((await all.download()).packs).toBe(5)
    const checked = await createIconPacks({ folder: path.join(folder, 'old'), fetch: net.fetch }).check()
    expect(checked).toMatchObject({ state: 'complete', packs: 3, total: 3 })
    expect((await readdir(path.join(folder, 'old'))).filter((f) => f.startsWith('feather') || f.startsWith('bubbles'))).toEqual([])
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
    await writeFile(path.join(folder, 'my-pages.txt'), 'mine')
    expect(await packs.remove()).toMatchObject({ state: 'none', packs: 0, version: null })
    expect(await readdir(folder)).toEqual(['my-pages.txt'])
    expect(packs.has('mdi')).toBe(false)
  })

  it('a move that fails part way keeps every pack usable in one folder (YAZ-4377)', async () => {
    const from = path.join(folder, 'from')
    const next = path.join(folder, 'next')
    const packs = createIconPacks({ folder: from, fetch: network({ '2.2.1': V1 }).fetch })
    await packs.download()
    // The new folder holds a non-empty folder where one pack file must go: its rename and its copy fail.
    await mkdir(path.join(next, 'noto.json.gz', 'blocker'), { recursive: true })
    const after = await packs.moveTo(next)
    expect(after).toMatchObject({ state: 'complete', folder: from, packs: 3, failed: true })
    expect(after.message).toMatch(/^The icon packs could not move to the new folder, so they stay in .*from\. /)
    for (const id of ['mdi:home', 'noto:house', 'tabler:star']) expect(await packs.svg(id)).not.toBeNull()
    expect((await packs.names()).get('mdi')).toEqual(['arrow-left', 'arrow-right', 'home'])
    // Each folder's manifest names only files that are in it: the old one is whole, the new one has none of ours.
    expect((await readdir(from)).sort()).toEqual(['manifest.json', 'mdi.json.gz', 'mdi.names.gz', 'noto.json.gz', 'noto.names.gz', 'tabler.json.gz', 'tabler.names.gz'])
    expect(await readdir(next)).toEqual(['noto.json.gz'])
    // A new main at the old folder reads every pack.
    expect(await createIconPacks({ folder: from, fetch: network({}).fetch }).status()).toMatchObject({ state: 'complete', packs: 3 })
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

describe('crash and data safety (YAZ-4366)', () => {
  /** The manifest on disk now, as a new main would read it. */
  const diskManifest = (dir = folder) => JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { packs: Record<string, { sha: string; parts?: number }> }

  it('an update that stops between its files never leaves the manifest naming a mixed pack', async () => {
    const split = { above: 1000, part: 600 }
    const v1 = { big: packFile('big', Array.from({ length: 40 }, (_, i) => `icon-${i}`)), mdi: V1.mdi }
    const v2 = { big: packFile('big', Array.from({ length: 90 }, (_, i) => `icon-${i}`)), mdi: V1.mdi }
    await createIconPacks({ folder, fetch: network({ '2.2.1': v1 }).fetch, split }).download()
    // The crash point: the new parts and main file are written, the names file is next.
    let atCrash: ReturnType<typeof diskManifest> | null = null
    crash.beforeWrite = (file) => {
      if (path.basename(file) !== 'big.names.gz') return
      atCrash = diskManifest()
      throw new Error('the Mac lost power')
    }
    const updater = createIconPacks({ folder, fetch: network({ '2.2.1': v1, '2.2.2': v2 }).fetch, split })
    const after = await updater.check()
    crash.beforeWrite = null
    // What a crash there leaves: the manifest does not name the pack whose files are half old, half new.
    expect(atCrash).not.toBeNull()
    expect(atCrash!.packs.big).toBeUndefined()
    // The run that saw the failure agrees with the disk: the pack is not on the Mac, and nothing reads its files.
    expect(after).toMatchObject({ state: 'partial', packs: 1, failed: true })
    expect(updater.has('big')).toBe(false)
    expect(diskManifest().packs.big).toBeUndefined()
    // A new main reads no mixed pack; "Download the rest" brings the new version whole.
    const restarted = createIconPacks({ folder, fetch: network({ '2.2.1': v1, '2.2.2': v2 }).fetch, split })
    expect(await restarted.status()).toMatchObject({ state: 'partial' })
    expect(await restarted.download()).toMatchObject({ state: 'complete' })
    for (let n = 0; n < 90; n++) expect(await restarted.svg(`big:icon-${n}`)).toContain(`<path d="big-icon-${n}"/>`)
  })

  it('a move across two disks writes each copy durably before the old file goes', async () => {
    const from = path.join(folder, 'from')
    const next = path.join(folder, 'next')
    const packs = createIconPacks({ folder: from, fetch: network({ '2.2.1': V1 }).fetch })
    await packs.download()
    // Across two disks a rename fails with EXDEV, so every pack file is copied.
    crash.renameFails = (src, dst) => path.dirname(src) === from && path.dirname(dst) === next
    vi.mocked(atomicWrite).mockClear()
    expect(await packs.moveTo(next)).toMatchObject({ state: 'complete', folder: next, packs: 3 })
    // Each copy went through `atomicWrite` (fsynced before its rename), so a power loss after the old file went
    // cannot leave the only copy unflushed.
    const durable = vi.mocked(atomicWrite).mock.calls.map(([file]) => path.relative(next, file))
    for (const file of ['mdi.json.gz', 'mdi.names.gz', 'noto.json.gz', 'noto.names.gz', 'tabler.json.gz', 'tabler.names.gz', 'manifest.json']) expect(durable).toContain(file)
    expect(existsSync(from)).toBe(false)
    expect(await packs.svg('mdi:home')).toContain('mdi-home')
  })

  it('a folder on a drive that is gone fails plainly, and makes nothing on the boot disk', async () => {
    const drive = path.join(folder, 'Volumes', 'Icons')
    const packs = createIconPacks({ folder: path.join(drive, 'icon-packs'), fetch: network({ '2.2.1': V1 }).fetch })
    const done = await packs.download()
    expect(done).toMatchObject({ state: 'none', failed: true, message: `The icon packs folder is not there: ${path.join(drive, 'icon-packs')}. Connect its drive, or choose another folder in Settings.` })
    expect(existsSync(path.join(folder, 'Volumes'))).toBe(false)
    // The drive is back: Try again downloads (a failed manifest write does not block the next one).
    await mkdir(drive, { recursive: true })
    expect(await packs.download()).toMatchObject({ state: 'complete', failed: false })

    // A move to a folder on a gone drive: the packs stay, and nothing is made there.
    const here = createIconPacks({ folder: path.join(folder, 'here'), fetch: network({ '2.2.1': V1 }).fetch })
    await here.download()
    await rm(path.join(folder, 'Volumes'), { recursive: true })
    const moved = await here.moveTo(path.join(drive, 'icon-packs'))
    expect(moved).toMatchObject({ state: 'complete', folder: path.join(folder, 'here'), failed: true })
    expect(moved.message).toBe(`The icon packs folder is not there: ${path.join(drive, 'icon-packs')}. The icon packs stay in ${path.join(folder, 'here')}.`)
    expect(existsSync(path.join(folder, 'Volumes'))).toBe(false)
  })

  it('"Check for new icons" saves the manifest without a pack that left before it removes that pack`s files', async () => {
    await createIconPacks({ folder, fetch: network({ '2.2.1': V1 }).fetch }).download()
    // At the first manifest write of the check, a crash: whatever the manifest on disk names must still be whole.
    let named: string[] | null = null
    let missing: string[] = []
    crash.beforeWrite = (file) => {
      if (path.basename(file) !== 'manifest.json' || named !== null) return
      named = Object.keys(diskManifest().packs)
      missing = named.filter((prefix) => !existsSync(path.join(folder, `${prefix}.json.gz`)) || !existsSync(path.join(folder, `${prefix}.names.gz`)))
    }
    const v2 = { mdi: V1.mdi, noto: V1.noto }
    expect(await createIconPacks({ folder, fetch: network({ '2.2.1': V1, '2.2.2': v2 }).fetch }).check()).toMatchObject({ state: 'complete', packs: 2 })
    expect(named).toContain('tabler')
    expect(missing).toEqual([])
    expect((await readdir(folder)).filter((f) => f.startsWith('tabler'))).toEqual([])
  })

  it('Remove also takes the parts and tmp files a stopped first download left, so the folder goes', async () => {
    // tabler fails from both sources: planned, never stored.
    const net = network({ '2.2.1': V1 })
    const fetchBoth = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/tabler.json') ? new Response('down', { status: 500 }) : net.fetch(input, init)) as typeof globalThis.fetch
    const partial = await createIconPacks({ folder, fetch: fetchBoth }).download()
    expect(partial).toMatchObject({ state: 'partial', packs: 2 })
    // What a stop or a crash in a split pack's first download leaves: its first parts, and a tmp file of a write.
    await writeFile(path.join(folder, 'tabler.part-0.json.gz'), 'part')
    await writeFile(path.join(folder, 'tabler.part-1.json.gz.tmp-0123456789ab'), 'tmp')
    await writeFile(path.join(folder, 'manifest.json.tmp-0123456789ab'), 'tmp')
    await writeFile(path.join(folder, 'my-pages.txt'), 'mine')
    expect(await createIconPacks({ folder, fetch: fetchBoth }).remove()).toMatchObject({ state: 'none' })
    expect(await readdir(folder)).toEqual(['my-pages.txt'])
    await rm(path.join(folder, 'my-pages.txt'))
    expect(await createIconPacks({ folder, fetch: fetchBoth }).remove()).toMatchObject({ state: 'none' })
    expect(existsSync(folder)).toBe(false)
  })

  it('Remove takes the manifest first: a crash on the way leaves no manifest that names a pack with no files', async () => {
    await createIconPacks({ folder, fetch: network({ '2.2.1': V1 }).fetch }).download()
    const packs = createIconPacks({ folder, fetch: network({ '2.2.1': V1 }).fetch })
    await packs.status()
    crash.removed = []
    await packs.remove()
    expect(crash.removed[0]).toBe('manifest.json')
    expect(crash.removed).toContain('mdi.json.gz')
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

  it('a search after "Check for new icons" finds the new names, not the matches kept from before (YAZ-4366)', async () => {
    const versions: Record<string, Record<string, string>> = { '2.2.1': V1 }
    const packs = createIconPacks({ folder, fetch: network(versions).fetch })
    await packs.download()
    const providers = createMediaProviders({ fetch: network({}).fetch, readPixabayKey: async () => null, cache: memoryCache(), packs })
    expect(ids(await providers.search({ q: 'arrow', source: 'iconify' }))).toContain('mdi:arrow-left')
    versions['2.2.2'] = { ...V1, mdi: packFile('mdi', ['arrow-down', 'home']) }
    expect(await packs.check()).toMatchObject({ state: 'complete', version: '2.2.2' })
    const after = ids(await providers.search({ q: 'arrow', source: 'iconify' }))
    expect(after).toContain('mdi:arrow-down')
    expect(after).not.toContain('mdi:arrow-left')
  })

  it("a favorite's own copy (YAZ-4363) answers before the pack; with no copy, the pack answers", async () => {
    const { packs, offline } = await withPacks()
    const copyImage = { mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,Y29weQ==' }
    const copyItem = { itemKey: 'iconify:tabler:star', provider: 'iconify', providerId: 'tabler:star' } as StudioItem
    const has = (id: string) => id === 'tabler:star'
    const favoriteCopy = {
      find: vi.fn(async ({ id }: { id: string }) => (has(id) ? { mimeType: copyImage.mimeType, size: 4 } : null)),
      preview: vi.fn(async ({ id }: { id: string }) => (has(id) ? copyImage : null)),
      import: vi.fn(async ({ id }: { id: string }) => (has(id) ? { ...copyImage, item: copyItem } : null)),
    }
    const providers = createMediaProviders({ fetch: offline as unknown as typeof globalThis.fetch, readPixabayKey: async () => null, cache: memoryCache(), packs, favoriteCopy })
    expect(await providers.preview({ provider: 'iconify', id: 'tabler:star' })).toEqual(copyImage)
    expect(await providers.import({ provider: 'iconify', id: 'tabler:star' })).toMatchObject({ dataURL: copyImage.dataURL, item: copyItem })
    const fromPack = await providers.import({ provider: 'iconify', id: 'mdi:home' })
    expect(Buffer.from(fromPack.dataURL.split(',')[1], 'base64').toString()).toContain('<path d="mdi-home"/>')
    expect(favoriteCopy.import).toHaveBeenCalledTimes(2)
    expect(offline).not.toHaveBeenCalled()
  })
})

/** The expected local order: exact, then starts-with, then the rest; shorter first; then the pack order (noto, a colour set, first). */
function order(id: string): number {
  const name = id.split(':')[1]
  const tier = name === 'arrow' ? 0 : name.startsWith('arrow') ? 1 : 2
  const pack = ['noto', 'mdi', 'tabler'].indexOf(id.split(':')[0])
  return tier * 10_000 + name.length * 100 + pack
}
