/**
 * THE LIBRARY ON TWO MACS (YAZ-4364): two "Macs" (two userData folders) on one settings folder, with the real stores
 * wired as `ipc/index.ts` wires them. Temp folders only; the fetchers are stubs (no network). The checker wrote these
 * in round 1 (YAZ-4362); each bug's case stays: S1b YAZ-4378, S3 YAZ-4380, S4 YAZ-4381, S6 YAZ-4382, S9 YAZ-4383.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MediaBytesRequest, MediaImportResponse, MediaItem } from '@shared/types'
import { BridgeFailure } from '../fs/fsUtils'
import type { MediaCache } from '../media/cache'
import { createMediaProviders } from '../media/providers'
import { createStore, type Store } from '../store'
import { createComponentStore, type ComponentStore } from './componentStore'
import { copyLibrary, followLibraryMoves, type LibraryMoves } from './copyLibrary'
import { createFavoriteCopies, favoriteCopyHash, type FavoriteCopies } from './favoriteCopies'
import { followLibraryFolder } from './folder'
import { createMediaStore, type MediaStore } from './mediaStore'

const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'
const icon = (name: string, updatedAt = 1) => ({ itemKey: `iconify:mdi:${name}`, provider: 'iconify', providerId: `mdi:${name}`, kind: 'icon', title: name, updatedAt })
const comp = (slug: string, updatedAt = 1) => ({ itemKey: `component:${slug}`, provider: 'component', providerId: slug, kind: 'component', title: slug, updatedAt })
const asItem = (row: { updatedAt: number }): MediaItem => {
  const { updatedAt: _u, ...item } = row as Record<string, unknown>
  return item as unknown as MediaItem
}
const fragment = (id: string) => `${JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id, type: 'rectangle' }], files: {} })}\n`
const svgResp = (id: string): MediaImportResponse => ({ mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${Buffer.from(`<svg id="net-${id}"/>`).toString('base64')}`, item: asItem(icon(id.split(':')[1])) })

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (d: string): Promise<void> => {
    for (const name of await readdir(d)) {
      const p = path.join(d, name)
      if ((await stat(p)).isDirectory()) await walk(p)
      else out[path.relative(root, p)] = await readFile(p, 'utf8')
    }
  }
  await walk(root).catch(() => undefined)
  return out
}

interface Mac {
  store: Store
  media: MediaStore
  components: ComponentStore
  copies: FavoriteCopies
  moves: LibraryMoves
  fetched: string[]
  notices: string[]
  offline: { on: boolean }
  close(): Promise<void>
}

let dir: string
let settings: string
const macs: Mac[] = []

/** One Mac, wired as `ipc/index.ts` + `ipc/mediaLibrary.ts` + `ipc/mediaStudio.ts` wire it. */
function launch(macId: string, userData: string, withSettings: boolean, now?: () => number): Mac {
  const store = createStore(path.join(userData, 'yaseendocs.json'))
  if (withSettings && store.get().settingsFolder !== settings) store.setSettingsFolder(settings, 1)
  const fetched: string[] = []
  const notices: string[] = []
  const offline = { on: false }
  let media!: MediaStore
  let copies!: FavoriteCopies
  let components!: ComponentStore
  const folder = followLibraryFolder(store, userData, (next) => {
    media.setFolder(next)
    copies.setFolder(next)
    components.setFolder(next)
  })
  components = createComponentStore(folder, { trash: vi.fn(async () => undefined) })
  media = createMediaStore(folder, { macId: async () => macId, now })
  copies = createFavoriteCopies(folder, {
    favorites: () => media.favorites({ op: 'list' }),
    hasPixabayKey: async () => true,
    readComponent: (slug) => components.read({ slug }),
    wait: async () => undefined,
  })
  media.onChanged(() => void copies.backfill())
  void copies.start({
    picture: async (req: MediaBytesRequest) => {
      fetched.push(`${req.provider}:${req.id}`)
      if (offline.on) throw new BridgeFailure('OFFLINE', 'no network')
      return svgResp(req.id)
    },
    drawing: async (id) => {
      fetched.push(`excalidraw:${id}`)
      throw new BridgeFailure('OFFLINE', 'no network')
    },
  })
  const moves = followLibraryMoves(store, userData, { copy: (from) => copyLibrary(from, { media, components, copies }), notice: (m) => notices.push(m) })
  const mac: Mac = {
    store,
    media,
    components,
    copies,
    moves,
    fetched,
    notices,
    offline,
    close: async () => {
      moves.close()
      await copies.close()
      await media.close()
      await components.close()
      await store.flush()
    },
  }
  macs.push(mac)
  return mac
}

async function oldLibrary(userData: string, favs: unknown[], files: Record<string, string>): Promise<string> {
  const lib = path.join(userData, 'library')
  await mkdir(path.join(lib, 'favorites'), { recursive: true })
  await mkdir(path.join(lib, 'components'), { recursive: true })
  await writeFile(path.join(lib, 'media.json'), JSON.stringify({ version: 1, favorites: favs, recent: [], used: [] }))
  for (const [rel, text] of Object.entries(files)) await writeFile(path.join(lib, rel), text)
  return lib
}

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.all(macs.map(async (m) => (await m.moves.settled(), await m.copies.backfill())))
    await new Promise((r) => setTimeout(r, 30))
  }
}
const keys = async (m: Mac) => (await m.media.favorites({ op: 'list' })).map((f) => f.itemKey).sort()
const copyName = (itemKey: string, ext: string) => path.join('favorites', `${favoriteCopyHash(itemKey)}.${ext}`)

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-checker-g3-'))
  settings = path.join(dir, 'Sync', 'yaseen-docs-settings')
  await mkdir(settings, { recursive: true })
})
afterEach(async () => {
  for (const m of macs.splice(0)) await m.close()
  await rm(dir, { recursive: true, force: true })
})

describe('the library on two Macs, one settings folder (YAZ-4364)', () => {
  it('S1: both Macs move their old library into <settings>/library; nothing is lost or deleted', async () => {
    const uA = path.join(dir, 'macA')
    const uB = path.join(dir, 'macB')
    const libA = await oldLibrary(uA, [icon('a'), icon('shared'), comp('logo')], {
      [copyName('iconify:mdi:a', 'svg')]: '<svg id="A-a"/>',
      [copyName('iconify:mdi:shared', 'svg')]: '<svg id="A-shared"/>',
      [copyName('component:logo', 'excalidraw')]: fragment('A-logo'),
      'components/logo.excalidraw': fragment('A-logo'),
      'components.json': JSON.stringify({ version: 1, items: [{ slug: 'logo', name: 'Logo', elementCount: 1, createdAt: 1, updatedAt: 1 }] }),
    })
    const libB = await oldLibrary(uB, [icon('b'), icon('shared')], {
      [copyName('iconify:mdi:b', 'svg')]: '<svg id="B-b"/>',
      [copyName('iconify:mdi:shared', 'svg')]: '<svg id="B-shared"/>',
      'components/logo.excalidraw': fragment('B-logo'),
      'components.json': JSON.stringify({ version: 1, items: [{ slug: 'logo', name: 'Logo', elementCount: 1, createdAt: 1, updatedAt: 1 }] }),
    })
    const beforeA = await snapshot(libA)
    const beforeB = await snapshot(libB)

    const macB = launch(B, uB, true)
    await settle()
    const macA = launch(A, uA, true)
    await settle()

    const lib = path.join(settings, 'library')
    expect((await readdir(lib)).filter((n) => n.endsWith('.json')).sort()).toEqual(['components.json', `media-${A}.json`, `media-${B}.json`])
    // A's favorite of its own logo follows it to logo-2 (YAZ-4378).
    const all = ['component:logo-2', 'iconify:mdi:a', 'iconify:mdi:b', 'iconify:mdi:shared']
    expect(await keys(macA)).toEqual(all)
    expect(await keys(macB)).toEqual(all)
    // The old folders: untouched.
    expect(await snapshot(libA)).toEqual(beforeA)
    expect(await snapshot(libB)).toEqual(beforeB)
    // Every copy is in the synced library.
    const files = await snapshot(lib)
    expect(files[copyName('iconify:mdi:a', 'svg')]).toBe('<svg id="A-a"/>')
    expect(files[copyName('iconify:mdi:b', 'svg')]).toBe('<svg id="B-b"/>')
    expect(files[copyName('iconify:mdi:shared', 'svg')]).toBeDefined()
    // Components: B's logo kept, A's became logo-2.
    expect(files['components/logo.excalidraw']).toBe(fragment('B-logo'))
    expect(files['components/logo-2.excalidraw']).toBe(fragment('A-logo'))
    expect(macA.notices).toHaveLength(1)
    expect(macB.notices).toHaveLength(1)
    // Every copy was in an old folder: no Mac asks the network (YAZ-4382).
    expect(macA.fetched).toEqual([])
    expect(macB.fetched).toEqual([])
    expect(files[copyName('component:logo-2', 'excalidraw')]).toBe(fragment('A-logo'))
    expect(await macA.copies.status()).toMatchObject({ favorites: 4, saved: 4 })
  })

  it("S1b: Mac A's favorite of its own component \"logo\" still means A's logo after the move (name clash)", async () => {
    const uA = path.join(dir, 'macA')
    const uB = path.join(dir, 'macB')
    await oldLibrary(uA, [comp('logo')], {
      [copyName('component:logo', 'excalidraw')]: fragment('A-logo'),
      'components/logo.excalidraw': fragment('A-logo'),
      'components.json': JSON.stringify({ version: 1, items: [{ slug: 'logo', name: 'Logo', elementCount: 1, createdAt: 1, updatedAt: 1 }] }),
    })
    await oldLibrary(uB, [], {
      'components/logo.excalidraw': fragment('B-logo'),
      'components.json': JSON.stringify({ version: 1, items: [{ slug: 'logo', name: 'Logo', elementCount: 1, createdAt: 1, updatedAt: 1 }] }),
    })
    launch(B, uB, true)
    await settle()
    const macA = launch(A, uA, true)
    await settle()
    const favs = await macA.media.favorites({ op: 'list' })
    expect(favs.map((f) => [f.itemKey, f.title])).toEqual([['component:logo-2', 'Logo 2']])
    // The favorite's component, as the tile and "Open" see it, and its copy, as the add sees it: both A's logo.
    const pointsAt = await macA.components.read({ slug: favs[0].providerId })
    expect(pointsAt).toContain('A-logo')
    expect(await macA.copies.readElements(favs[0].itemKey)).toContain('A-logo')
  })

  it('S2: a removal on Mac A stays removed on Mac B; its copy goes; a later re-add on B comes back on A', async () => {
    const macA = launch(A, path.join(dir, 'macA'), true)
    const macB = launch(B, path.join(dir, 'macB'), true)
    await settle()
    await macA.media.favorites({ op: 'add', item: asItem(icon('x')) })
    await settle()
    expect(await keys(macB)).toEqual(['iconify:mdi:x'])
    // B writes its own file (a use of another item), so B's file holds x as well.
    await macB.media.used({ op: 'record', item: asItem(icon('y')), query: 'y' })
    const bFile = JSON.parse(await readFile(path.join(settings, 'library', `media-${B}.json`), 'utf8')) as { favorites: { itemKey: string }[] }
    expect(bFile.favorites.map((f) => f.itemKey)).toContain('iconify:mdi:x')
    await new Promise((r) => setTimeout(r, 5))
    await macA.media.favorites({ op: 'remove', itemKey: 'iconify:mdi:x' })
    await macA.copies.remove('iconify:mdi:x')
    await settle()
    expect(await keys(macA)).toEqual([])
    expect(await keys(macB)).toEqual([])
    await new Promise((r) => setTimeout(r, 5))
    await macB.media.favorites({ op: 'add', item: asItem(icon('x')) })
    await settle()
    expect(await keys(macA)).toEqual(['iconify:mdi:x'])
  })

  it('S3: a favorite removed on Mac A does not come back on the very next add on Mac B (the count starts again)', async () => {
    let t = 1000
    const macA = launch(A, path.join(dir, 'macA'), true, () => t)
    const macB = launch(B, path.join(dir, 'macB'), true, () => t)
    await settle()
    // Three adds on B: the auto-favorite.
    for (let i = 0; i < 3; i++) {
      t += 10
      await macB.media.used({ op: 'record', item: asItem(icon('z')), query: 'z' })
    }
    await settle()
    expect(await keys(macA)).toEqual(['iconify:mdi:z'])
    t += 10
    await macA.media.favorites({ op: 'remove', itemKey: 'iconify:mdi:z' })
    await settle()
    expect(await keys(macB)).toEqual([])
    // One more add on B. On ONE Mac this never favorites again (YAZ-4157 demo 6A: AUTO_FAVORITE_USES more adds).
    t += 10
    await macB.media.used({ op: 'record', item: asItem(icon('z')), query: 'z' })
    const usedB = (await macB.media.used({ op: 'list' })).used.find((u) => u.itemKey === 'iconify:mdi:z')
    expect(usedB?.count).toBe(1)
    expect(await keys(macB)).toEqual([])
  })

  it('S4: a removal sticks when the other Mac clock runs ahead', async () => {
    let tA = 10_000
    let tB = 10_000 + 3_600_000 // B is one hour ahead
    const macA = launch(A, path.join(dir, 'macA'), true, () => tA)
    const macB = launch(B, path.join(dir, 'macB'), true, () => tB)
    await settle()
    await macB.media.favorites({ op: 'add', item: asItem(icon('w')) })
    await settle()
    tA += 60_000
    tB += 60_000
    // A minute later, Mac A removes it.
    await macA.media.favorites({ op: 'remove', itemKey: 'iconify:mdi:w' })
    await settle()
    expect(await keys(macA)).toEqual([])
    expect(await keys(macB)).toEqual([])
  })

  it('S5: Mac B adds a favorite offline from the copy that Mac A made', async () => {
    const macA = launch(A, path.join(dir, 'macA'), true)
    const macB = launch(B, path.join(dir, 'macB'), true)
    await settle()
    await macA.media.favorites({ op: 'add', item: asItem(icon('off')) })
    await settle()
    expect(await readdir(path.join(settings, 'library', 'favorites'))).toContain(`${favoriteCopyHash('iconify:mdi:off')}.svg`)
    const offlineFetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const cache: MediaCache = { read: async () => null, write: async () => undefined, sweep: async () => 0 }
    const providers = createMediaProviders({ fetch: offlineFetch as unknown as typeof globalThis.fetch, readPixabayKey: async () => null, cache, favoriteCopy: macB.copies })
    const got = await providers.import({ provider: 'iconify', id: 'mdi:off' })
    expect(Buffer.from(got.dataURL.split(',')[1], 'base64').toString()).toBe('<svg id="net-mdi:off"/>')
    expect(got.item).toMatchObject({ itemKey: 'iconify:mdi:off' })
    expect(offlineFetch).not.toHaveBeenCalled()
    const prev = await providers.preview({ provider: 'iconify', id: 'mdi:off' })
    expect(prev.mimeType).toBe('image/svg+xml')
  })

  it('S6: a move with copies in the old folder asks the network for none of them', async () => {
    const uA = path.join(dir, 'macA')
    const names = ['n1', 'n2', 'n3', 'n4', 'n5']
    const files: Record<string, string> = {}
    for (const n of names) files[copyName(`iconify:mdi:${n}`, 'svg')] = `<svg id="old-${n}"/>`
    await oldLibrary(uA, names.map((n) => icon(n)), files)
    const macA = launch(A, uA, true)
    await settle()
    const lib = await snapshot(path.join(settings, 'library'))
    const fromNet = names.filter((n) => lib[copyName(`iconify:mdi:${n}`, 'svg')]?.includes('net-'))
    expect(macA.fetched).toEqual([])
    expect(fromNet).toEqual([])
  })

  it('S7: clearing the settings folder copies back; a favorite removed meanwhile stays removed', async () => {
    const uA = path.join(dir, 'macA')
    await oldLibrary(uA, [icon('keep'), icon('gone')], {})
    const macA = launch(A, uA, true)
    await settle()
    expect(await keys(macA)).toEqual(['iconify:mdi:gone', 'iconify:mdi:keep'])
    await new Promise((r) => setTimeout(r, 5))
    await macA.media.favorites({ op: 'remove', itemKey: 'iconify:mdi:gone' })
    macA.store.setSettingsFolder(null, Date.now())
    await settle()
    // Back in <userData>/library, where the old media.json still holds "gone".
    expect(await keys(macA)).toEqual(['iconify:mdi:keep'])
    expect(await readdir(path.join(uA, 'library'))).toContain('media.json')
  })

  it("S8: another Mac's half-synced file is skipped and kept; its favorites come back when it is whole", async () => {
    const macA = launch(A, path.join(dir, 'macA'), true)
    await settle()
    const bFile = path.join(settings, 'library', `media-${B}.json`)
    await mkdir(path.dirname(bFile), { recursive: true })
    await writeFile(bFile, '{"version":1,"favorites":[{"itemKey":"icon')
    await macA.media.favorites({ op: 'add', item: asItem(icon('a1')) })
    expect(await readFile(bFile, 'utf8')).toBe('{"version":1,"favorites":[{"itemKey":"icon')
    await writeFile(bFile, JSON.stringify({ version: 1, favorites: [icon('b1', 5)], recent: [], used: [], removed: {} }))
    expect(await keys(macA)).toEqual(['iconify:mdi:a1', 'iconify:mdi:b1'])
  })
  it('S9: the settings folder is gone at a launch (renamed, drive out): the favorites stay, and no write makes the gone folder again', async () => {
    const uA = path.join(dir, 'macA')
    await oldLibrary(uA, [icon('p1'), icon('p2')], {})
    let macA = launch(A, uA, true)
    await settle()
    expect(await keys(macA)).toEqual(['iconify:mdi:p1', 'iconify:mdi:p2'])
    await macA.close()
    macs.splice(macs.indexOf(macA), 1)
    // The user renames the synced folder (or the drive is out) before the next launch.
    await rename(path.join(dir, 'Sync'), path.join(dir, 'Sync-renamed'))
    macA = launch(A, uA, true)
    await settle()
    expect(await keys(macA)).toEqual(['iconify:mdi:p1', 'iconify:mdi:p2'])
    await macA.media.favorites({ op: 'add', item: asItem(icon('p3')) })
    await settle()
    expect(await keys(macA)).toEqual(['iconify:mdi:p1', 'iconify:mdi:p2', 'iconify:mdi:p3'])
    expect(await readdir(path.join(dir, 'Sync')).then(() => true, () => false)).toBe(false)

    // The folder comes back: the next launch merges what changed meanwhile into it.
    await macA.close()
    macs.splice(macs.indexOf(macA), 1)
    await rename(path.join(dir, 'Sync-renamed'), path.join(dir, 'Sync'))
    macA = launch(A, uA, true)
    await settle()
    expect(await keys(macA)).toEqual(['iconify:mdi:p1', 'iconify:mdi:p2', 'iconify:mdi:p3'])
    expect(await readdir(path.join(settings, 'library'))).toContain(`media-${A}.json`)
  })
})
