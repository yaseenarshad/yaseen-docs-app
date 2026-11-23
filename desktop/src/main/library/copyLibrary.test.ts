/**
 * A library that moves (YAZ-4364, round 3 decisions 1 and 3): the copy between two temp library folders with the real
 * stores — nothing is deleted, a component name clash gets `-2`, a second copy changes nothing — and the launch and
 * setting rules that start a copy. No real app data is read or written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defaultAppState, type AppState } from '@shared/types'
import { createComponentStore, type ComponentStore } from './componentStore'
import { copyLibrary, followLibraryMoves, LIBRARY_MARKER_FILE } from './copyLibrary'
import { createFavoriteCopies, favoriteCopyHash, type FavoriteCopies } from './favoriteCopies'
import { createMediaStore, type MediaStore } from './mediaStore'

const MAC = 'aaaaaaaaaaaa'
const fav = (key: string, updatedAt: number) => ({ itemKey: key, provider: 'iconify', providerId: key.slice(8), kind: 'icon', title: key, updatedAt })
const fragment = (id: string) => `${JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id, type: 'rectangle' }], files: {} })}\n`

let dir: string
let from: string
let to: string
let media: MediaStore
let components: ComponentStore
let copies: FavoriteCopies

/** Every file under `root`, relative, with its bytes — the proof that nothing changed or went. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (d: string): Promise<void> => {
    for (const name of await readdir(d)) {
      const p = path.join(d, name)
      if ((await stat(p)).isDirectory()) await walk(p)
      else out[path.relative(root, p)] = await readFile(p, 'utf8')
    }
  }
  await walk(root)
  return out
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-copy-library-'))
  from = path.join(dir, 'old')
  to = path.join(dir, 'new')
  // The old library: a pre-YAZ-4364 media.json, two favorite copies, three components.
  await mkdir(path.join(from, 'favorites'), { recursive: true })
  await mkdir(path.join(from, 'components'), { recursive: true })
  await writeFile(path.join(from, 'media.json'), JSON.stringify({ version: 1, favorites: [fav('iconify:mdi:old', 3)], recent: [fav('iconify:mdi:old', 3)] }))
  await writeFile(path.join(from, 'favorites', `${'a'.repeat(40)}.svg`), '<svg id="a"/>')
  await writeFile(path.join(from, 'favorites', `${'b'.repeat(40)}.png`), 'PNG-from')
  await writeFile(path.join(from, 'favorites', `${'c'.repeat(40)}.excalidraw`), fragment('kept-shape')) // an elements copy (YAZ-4370)
  for (const [slug, id] of [['card', 'c1'], ['logo', 'old-logo'], ['same', 's1']]) {
    await writeFile(path.join(from, 'components', `${slug}.excalidraw`), fragment(id))
    await writeFile(path.join(from, 'components', `${slug}.png`), `png-${id}`)
  }
  await writeFile(path.join(from, 'components.json'), JSON.stringify({ version: 1, items: [{ slug: 'logo', name: 'Logo', elementCount: 1, createdAt: 1, updatedAt: 1 }, { slug: 'card', name: 'Pricing card', elementCount: 1, createdAt: 2, updatedAt: 2 }] }))
  // The new library: its own logo (other bytes), the same "same", one copy of its own.
  await mkdir(path.join(to, 'components'), { recursive: true })
  await mkdir(path.join(to, 'favorites'), { recursive: true })
  await writeFile(path.join(to, 'components', 'logo.excalidraw'), fragment('new-logo'))
  await writeFile(path.join(to, 'components', 'same.excalidraw'), fragment('s1'))
  await writeFile(path.join(to, 'favorites', `${'b'.repeat(40)}.png`), 'PNG-to')
  await writeFile(path.join(to, `media-${MAC}.json`), JSON.stringify({ version: 1, favorites: [fav('iconify:mdi:new', 9)], recent: [], used: [], removed: {} }))

  media = createMediaStore(to, { macId: async () => MAC })
  components = createComponentStore(to, { trash: vi.fn(async () => undefined) })
  copies = createFavoriteCopies(to, { favorites: () => media.favorites({ op: 'list' }), hasPixabayKey: async () => false })
})
afterEach(async () => {
  await Promise.all([media.close(), components.close(), copies.close()])
  await rm(dir, { recursive: true, force: true })
})

describe('copyLibrary (YAZ-4364, round 3 decision 3)', () => {
  it('copies and merges into the new folder; nothing is deleted; a name clash gets -2; a second copy changes nothing', async () => {
    const oldBefore = await snapshot(from)
    const copied = await copyLibrary(from, { media, components, copies })
    expect(copied).toBeGreaterThan(0)

    // The old folder is exactly as it was.
    expect(await snapshot(from)).toEqual(oldBefore)

    // media: both favorites, in this Mac's file.
    expect((await media.favorites({ op: 'list' })).map((f) => f.itemKey)).toEqual(['iconify:mdi:new', 'iconify:mdi:old'])
    // favorite copies: the missing one copied; the one already there is not written over.
    expect(await readFile(path.join(to, 'favorites', `${'a'.repeat(40)}.svg`), 'utf8')).toBe('<svg id="a"/>')
    expect(await readFile(path.join(to, 'favorites', `${'b'.repeat(40)}.png`), 'utf8')).toBe('PNG-to')
    expect(await readFile(path.join(to, 'favorites', `${'c'.repeat(40)}.excalidraw`), 'utf8')).toBe(fragment('kept-shape'))
    // components: the missing one keeps its name; the clash is logo-2 "Logo 2"; the same bytes are not copied again.
    const list = await components.list()
    expect(list.map((c) => [c.slug, c.name]).sort()).toEqual([
      ['card', 'Pricing card'],
      ['logo', 'logo'],
      ['logo-2', 'Logo 2'],
      ['same', 'same'],
    ])
    expect(await readFile(path.join(to, 'components', 'logo.excalidraw'), 'utf8')).toBe(fragment('new-logo'))
    expect(await readFile(path.join(to, 'components', 'logo-2.excalidraw'), 'utf8')).toBe(fragment('old-logo'))
    expect(await readFile(path.join(to, 'components', 'logo-2.png'), 'utf8')).toBe('png-old-logo')
    expect(await readdir(path.join(to, 'components'))).not.toContain('same-2.excalidraw')

    // A second copy: nothing comes over, and no file in the new folder changes.
    const newAfter = await snapshot(to)
    expect(await copyLibrary(from, { media, components, copies })).toBe(0)
    expect(await snapshot(to)).toEqual(newAfter)
  })

  it('a favorite of a component whose name clashes follows it to logo-2: its tile and its add give the favorited one (YAZ-4378)', async () => {
    const logo = { itemKey: 'component:logo', provider: 'component', providerId: 'logo', kind: 'component', title: 'Logo', updatedAt: 4 }
    await writeFile(path.join(from, 'media.json'), JSON.stringify({ version: 1, favorites: [logo], recent: [logo], used: [{ ...logo, count: 2, words: ['brand'] }], removed: {} }))
    await writeFile(path.join(from, 'favorites', `${favoriteCopyHash('component:logo')}.excalidraw`), fragment('old-logo'))
    // The new folder already has a favorite of ITS logo, with its own copy.
    await writeFile(path.join(to, `media-${MAC}.json`), JSON.stringify({ version: 1, favorites: [{ ...logo, updatedAt: 9 }], recent: [], used: [], removed: {} }))
    await writeFile(path.join(to, 'favorites', `${favoriteCopyHash('component:logo')}.excalidraw`), fragment('new-logo'))

    await copyLibrary(from, { media, components, copies })
    const favs = await media.favorites({ op: 'list' })
    expect(favs.map((f) => [f.itemKey, f.providerId, f.title]).sort()).toEqual([
      ['component:logo', 'logo', 'Logo'],
      ['component:logo-2', 'logo-2', 'Logo 2'],
    ])
    // Each favorite: the tile (its component) and the add (its copy) are the same component.
    expect(await components.read({ slug: 'logo' })).toContain('new-logo')
    expect(await copies.readElements('component:logo')).toContain('new-logo')
    expect(await components.read({ slug: 'logo-2' })).toContain('old-logo')
    expect(await copies.readElements('component:logo-2')).toContain('old-logo')
    // Its count and words came along too.
    const lib = await media.used({ op: 'list' })
    expect(lib.used.find((u) => u.itemKey === 'component:logo-2')).toMatchObject({ count: 2, words: ['brand'] })
    expect(lib.recent.map((r) => r.itemKey)).toEqual(['component:logo-2'])

    // A second copy finds the bytes already at logo-2: the rows still follow them there, and nothing changes.
    const newAfter = await snapshot(to)
    expect(await copyLibrary(from, { media, components, copies })).toBe(0)
    expect(await snapshot(to)).toEqual(newAfter)
  })

  it('a move whose old folder holds every copy asks the network for none of them (YAZ-4382)', async () => {
    const names = ['n1', 'n2', 'n3']
    await writeFile(path.join(from, 'media.json'), JSON.stringify({ version: 1, favorites: names.map((n) => fav(`iconify:mdi:${n}`, 3)), recent: [], used: [] }))
    for (const n of names) await writeFile(path.join(from, 'favorites', `${favoriteCopyHash(`iconify:mdi:${n}`)}.svg`), `<svg id="old-${n}"/>`)
    const fetched: string[] = []
    media.onChanged(() => void copies.backfill())
    await copies.start({
      picture: async (req) => {
        fetched.push(req.id)
        return { mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${Buffer.from('<svg id="net"/>').toString('base64')}`, item: { itemKey: `iconify:${req.id}`, provider: 'iconify', providerId: req.id, kind: 'icon', title: req.id } }
      },
      drawing: async () => [],
    })
    await copyLibrary(from, { media, components, copies })
    await copies.backfill()
    expect(fetched).toEqual(['mdi:new']) // only the favorite that has no copy anywhere
    for (const n of names) expect(await readFile(path.join(to, 'favorites', `${favoriteCopyHash(`iconify:mdi:${n}`)}.svg`), 'utf8')).toBe(`<svg id="old-${n}"/>`)
  })

  it('a folder that is gone copies nothing', async () => {
    expect(await copyLibrary(path.join(dir, 'nowhere'), { media, components, copies })).toBe(0)
  })
})

describe('followLibraryMoves (YAZ-4364, round 3 decisions 1 and 3)', () => {
  let state: AppState
  let listeners: Array<(s: AppState) => void>
  const fakeStore = () => ({ get: () => state, onChange: (l: (s: AppState) => void) => (listeners.push(l), () => undefined) })
  const change = (next: AppState) => listeners.forEach((l) => l((state = next)))
  let userData: string

  beforeEach(async () => {
    state = defaultAppState()
    listeners = []
    userData = path.join(dir, 'userData')
    await mkdir(userData)
  })

  it('the first launch with a settings folder copies today`s library into <settings folder>/library once, and says so', async () => {
    state = { ...state, settingsFolder: path.join(dir, 'Sync') }
    await mkdir(path.join(dir, 'Sync'))
    const copy = vi.fn(async () => 3)
    const notice = vi.fn()
    await followLibraryMoves(fakeStore(), userData, { copy, notice }).settled()
    expect(copy).toHaveBeenCalledExactlyOnceWith(path.join(userData, 'library'))
    expect(notice).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^Your library is now in your settings folder, so it syncs to your other Macs\. Copied your library\. The old one is still at .*userData\/library$/))
    expect(JSON.parse(await readFile(path.join(userData, LIBRARY_MARKER_FILE), 'utf8'))).toEqual({ folder: path.join(dir, 'Sync', 'library') })

    // The next launch: the same folder, no copy.
    const again = vi.fn(async () => 0)
    await followLibraryMoves(fakeStore(), userData, { copy: again, notice }).settled()
    expect(again).not.toHaveBeenCalled()
  })

  it('without a settings folder nothing moves at launch; a picked folder that already was the setting copies nothing', async () => {
    const copy = vi.fn(async () => 1)
    await followLibraryMoves(fakeStore(), userData, { copy, notice: vi.fn() }).settled()
    state = { ...state, settings: { ...state.settings, libraryFolder: '/Vault/Library' } }
    await rm(path.join(userData, LIBRARY_MARKER_FILE))
    await followLibraryMoves(fakeStore(), userData, { copy, notice: vi.fn() }).settled()
    expect(copy).not.toHaveBeenCalled()
  })

  it('a change of the Library folder copies from the old one; a copy that brought nothing says nothing; a failed copy is tried again at the next launch', async () => {
    const copy = vi.fn(async () => 2)
    const notice = vi.fn()
    const moves = followLibraryMoves(fakeStore(), userData, { copy, notice })
    await moves.settled()
    change({ ...state, settings: { ...state.settings, libraryFolder: '/Vault/Library' } })
    await moves.settled()
    expect(copy).toHaveBeenLastCalledWith(path.join(userData, 'library'))
    expect(notice).toHaveBeenLastCalledWith(`Copied your library. The old one is still at ${path.join(userData, 'library')}`)

    copy.mockResolvedValueOnce(0)
    change({ ...state, settings: { ...state.settings, libraryFolder: null } })
    await moves.settled()
    expect(copy).toHaveBeenLastCalledWith('/Vault/Library')
    expect(notice).toHaveBeenCalledTimes(1)

    // A copy that fails leaves the marker on the old folder: the next launch copies again.
    copy.mockRejectedValueOnce(new Error('disk gone'))
    change({ ...state, settings: { ...state.settings, libraryFolder: path.join(dir, 'Elsewhere') } })
    await moves.settled()
    expect(JSON.parse(await readFile(path.join(userData, LIBRARY_MARKER_FILE), 'utf8'))).toEqual({ folder: path.join(userData, 'library') })
    const retry = vi.fn(async () => 1)
    await followLibraryMoves(fakeStore(), userData, { copy: retry, notice }).settled()
    expect(retry).toHaveBeenCalledExactlyOnceWith(path.join(userData, 'library'))
  })
})
