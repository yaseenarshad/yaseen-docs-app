import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_SETTINGS, MAX_COLLAPSED_GROUP_KEYS, MAX_FOLD_KEYS_PER_FILE, MAX_RECENT_ROOTS, addRecentRoot, defaultAppState, type AppState, type WindowEntry } from '@shared/types'
import { createStore } from './store'

// `rename` is the atomic write's last step: one rename = one write to disk.
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m, rename: vi.fn(m.rename) }
})
const renames = () => vi.mocked(rename).mock.calls.filter(([, to]) => String(to).endsWith('yaseendocs.json'))

let dir: string
let file: string
beforeEach(async () => {
  vi.mocked(rename).mockClear()
  dir = await mkdtemp(path.join(tmpdir(), 'yd-store-'))
  file = path.join(dir, 'yaseendocs.json')
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

const seed = (v: unknown) => writeFile(file, typeof v === 'string' ? v : JSON.stringify(v))
const onDisk = async (): Promise<AppState> => JSON.parse(await readFile(file, 'utf8')) as AppState
const bounds = { x: 1, y: 2, width: 300, height: 200 }
const win = (id: string, extra: Partial<WindowEntry> = {}): WindowEntry => ({ id, root: null, file: null, tabs: [], bounds, ...extra })
/** A seed with every field valid, to vary one field at a time. */
const valid = (over: Record<string, unknown> = {}) => ({ ...defaultAppState(), ...over })

describe('addRecentRoot', () => {
  it('prepends, de-dupes and caps at MAX_RECENT_ROOTS', () => {
    let list = addRecentRoot([], '/a', 1)
    list = addRecentRoot(list, '/b', 2)
    list = addRecentRoot(list, '/a', 3)
    expect(list).toEqual([
      { path: '/a', lastOpened: 3 },
      { path: '/b', lastOpened: 2 },
    ])
    for (let i = 0; i < 20; i++) list = addRecentRoot(list, `/x${i}`, 10 + i)
    expect(list).toHaveLength(MAX_RECENT_ROOTS)
    expect(list[0].path).toBe('/x19')
  })
})

describe('createStore: loading', () => {
  it('a missing file yields the defaults and creates nothing until the first change', () => {
    const store = createStore(file)
    expect(store.get()).toEqual(defaultAppState())
    expect(existsSync(file)).toBe(false)
  })

  it('a valid file loads as is', async () => {
    const state: AppState = {
      version: 1,
      settings: { ...DEFAULT_SETTINGS, lineSpacing: 2, threadColor: '#00aaff' },
      sidebarCollapsed: true,
      recents: [{ path: '/v', lastOpened: 5 }],
      windows: [win('w1', { root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'] })],
      folders: { '/v': { expanded: ['/v/sub'], lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] }, baseGroups: { '/v/b.base::T': ['v:idea'] } } },
    }
    await seed(state)
    expect(createStore(file).get()).toEqual(state)
  })

  it('settings fall back field by field (partial shapes, junk types, width/colour ranges)', async () => {
    await seed(valid({ settings: { lineSpacing: 1.15 } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, lineSpacing: 1.15 })
    await seed(valid({ settings: { lineSpacing: 'big', blockGap: 8, bulletThreading: 'off' } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, blockGap: 8 })
    await seed(valid({ settings: { threadWidth: 3, threadColor: '#ff0000' } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, threadWidth: 3, threadColor: '#ff0000' })
    await seed(valid({ settings: { threadWidth: 5, threadColor: 'red' } }))
    expect(createStore(file).get().settings).toEqual(DEFAULT_SETTINGS)
    await seed(valid({ settings: { threadWidth: 'thick', threadColor: null } }))
    expect(createStore(file).get().settings).toEqual(DEFAULT_SETTINGS)
    await seed(valid({ settings: 'nope' }))
    expect(createStore(file).get().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('theme: an old settings object without the key sanitizes to system; junk falls back too (GRO-2218)', async () => {
    // A pre-K yaseendocs.json: every field but `theme` — the missing field must default, not corrupt the file.
    const { theme: _omitted, ...preThemeSettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: preThemeSettings }))
    expect(createStore(file).get().settings.theme).toBe('system')
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, theme: 'dark' } }))
    expect(createStore(file).get().settings.theme).toBe('dark')
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, theme: 'blue' } }))
    expect(createStore(file).get().settings.theme).toBe('system')
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, theme: 2 } }))
    expect(createStore(file).get().settings.theme).toBe('system')
  })

  it('newNoteLocation/newNoteFolder: a pre-C2 file without the keys sanitizes to root + ""; junk falls back (GRO-2240)', async () => {
    // A pre-C2 yaseendocs.json: every field but the Files & Links pair — missing fields just gain their defaults.
    const { newNoteLocation: _loc, newNoteFolder: _folder, ...preC2Settings } = DEFAULT_SETTINGS
    await seed(valid({ settings: preC2Settings }))
    expect(createStore(file).get().settings).toEqual(DEFAULT_SETTINGS)
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Notes/Inbox' } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Notes/Inbox' })
    // Junk location, absolute / dot-dot / trailing-slash folders: each field falls back alone.
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, newNoteLocation: 'desktop', newNoteFolder: 5 } }))
    expect(createStore(file).get().settings).toEqual(DEFAULT_SETTINGS)
    for (const bad of ['/abs', 'a/../b', 'a//b', 'Notes/']) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, newNoteFolder: bad } }))
      expect(createStore(file).get().settings.newNoteFolder).toBe('')
    }
  })

  it('sidebarCollapsed only honours booleans', async () => {
    await seed(valid({ sidebarCollapsed: 'true' }))
    expect(createStore(file).get().sidebarCollapsed).toBe(false)
    await seed(valid({ sidebarCollapsed: true }))
    expect(createStore(file).get().sidebarCollapsed).toBe(true)
  })

  it('recents: a wrong shape reads as empty, a long list is capped', async () => {
    await seed(valid({ recents: [{ path: '/a' }] }))
    expect(createStore(file).get().recents).toEqual([])
    await seed(valid({ recents: { '/a': 1 } }))
    expect(createStore(file).get().recents).toEqual([])
    const many = Array.from({ length: 15 }, (_, i) => ({ path: `/r${i}`, lastOpened: i }))
    await seed(valid({ recents: many }))
    expect(createStore(file).get().recents).toEqual(many.slice(0, MAX_RECENT_ROOTS))
  })

  it('windows: malformed entries are dropped, a non-array reads as empty', async () => {
    await seed(
      valid({
        windows: [
          win('ok', { root: '/v' }),
          { id: 'no-bounds', root: null, file: null },
          { id: 'bad-bounds', root: null, file: null, bounds: { x: 1, y: 2, width: 'w', height: 3 } },
          { id: 7, root: null, file: null, bounds },
          { id: 'bad-root', root: 5, file: null, bounds },
          'junk',
        ],
      }),
    )
    expect(createStore(file).get().windows).toEqual([win('ok', { root: '/v' })])
    await seed(valid({ windows: 'nope' }))
    expect(createStore(file).get().windows).toEqual([])
  })

  // Tabs (GRO-2232) are additive within version 1: an old build's sanitizer drops the unknown
  // `tabs` key and keeps using `file` (graceful downgrade); this build repairs the other way.
  it('tabs: a legacy entry without the key repairs from file ([file], or [] when file is null)', async () => {
    const legacy = (id: string, file: string | null) => ({ id, root: '/v', file, bounds })
    await seed(valid({ windows: [legacy('w1', '/v/a.md'), legacy('w2', null)] }))
    const windows = createStore(file).get().windows
    expect(windows[0].tabs).toEqual(['/v/a.md'])
    expect(windows[1].tabs).toEqual([])
  })

  it('tabs: junk elements (non-strings, relative paths) drop; duplicates de-dupe keeping the first; order survives', async () => {
    await seed(valid({ windows: [win('w1', { root: '/v', file: '/v/a.md', tabs: ['/v/a.md', 5, 'rel.md', '/v/b.md', '/v/a.md', null, '/v/b.md'] as never })] }))
    expect(createStore(file).get().windows[0].tabs).toEqual(['/v/a.md', '/v/b.md'])
  })

  it('tabs: a non-null file missing from tabs is prepended (file IS the active tab)', async () => {
    await seed(valid({ windows: [win('w1', { root: '/v', file: '/v/a.md', tabs: ['/v/b.md', '/v/c.md'] })] }))
    expect(createStore(file).get().windows[0].tabs).toEqual(['/v/a.md', '/v/b.md', '/v/c.md'])
  })

  it('tabs: a null file clears the list (tabs [] ⇔ file null) and a non-array reads as the repair path', async () => {
    await seed(valid({ windows: [win('w1', { root: '/v', file: null, tabs: ['/v/orphan.md'] })] }))
    expect(createStore(file).get().windows[0].tabs).toEqual([])
    await seed(valid({ windows: [win('w1', { root: '/v', file: '/v/a.md', tabs: 'nope' as never })] }))
    expect(createStore(file).get().windows[0].tabs).toEqual(['/v/a.md'])
  })

  it('folders: each folder entry falls back field by field; junk folds are dropped and capped', async () => {
    await seed(
      valid({
        folders: {
          '/a': { expanded: 'nope', lastFile: 5, folds: { '/a/x.md': ['k'], '/a/y.md': 'nope', '/a/z.md': [1, 2] } },
          '/b': 'nope',
          '/c': { expanded: ['/c/sub'], lastFile: '/c/a.md', folds: { '/c/a.md': Array.from({ length: MAX_FOLD_KEYS_PER_FILE + 5 }, (_, i) => `k${i}`) } },
          '/d': {},
        },
      }),
    )
    const { folders } = createStore(file).get()
    expect(folders['/a']).toEqual({ expanded: [], lastFile: null, folds: { '/a/x.md': ['k'] }, baseGroups: {} })
    expect(folders['/b']).toBeUndefined()
    expect(folders['/c'].expanded).toEqual(['/c/sub'])
    expect(folders['/c'].lastFile).toBe('/c/a.md')
    expect(folders['/c'].folds['/c/a.md']).toHaveLength(MAX_FOLD_KEYS_PER_FILE)
    expect(folders['/d']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {} })
    await seed(valid({ folders: [] }))
    expect(createStore(file).get().folders).toEqual({})
  })

  it('folders: junk baseGroups are dropped and capped; an old file without the field reads as {}', async () => {
    await seed(
      valid({
        folders: {
          '/a': { expanded: [], lastFile: null, folds: {}, baseGroups: { '/a/x.base::T': ['v:idea'], '/a/y.base::T': 'nope', '/a/z.base::T': [1, 2] } },
          '/b': { expanded: [], lastFile: null, folds: {} }, // pre-4C file: no baseGroups
          '/c': { expanded: [], lastFile: null, folds: {}, baseGroups: { '/c/x.base::T': Array.from({ length: MAX_COLLAPSED_GROUP_KEYS + 5 }, (_, i) => `v:${i}`) } },
        },
      }),
    )
    const { folders } = createStore(file).get()
    expect(folders['/a'].baseGroups).toEqual({ '/a/x.base::T': ['v:idea'] })
    expect(folders['/b']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {} })
    expect(folders['/c'].baseGroups['/c/x.base::T']).toHaveLength(MAX_COLLAPSED_GROUP_KEYS)
  })

  it('unknown top-level keys are dropped', async () => {
    await seed(valid({ extra: 1 }))
    expect(createStore(file).get()).toEqual(defaultAppState())
  })

  it.each([
    ['unparsable JSON', '{broken'],
    ['not an object', '[]'],
    ['wrong version', JSON.stringify(valid({ version: 2 }))],
  ])('a corrupt file (%s) is moved to yaseendocs.json.corrupt-<epoch> and the defaults are used', async (_name, raw) => {
    await seed(raw)
    const store = createStore(file)
    expect(store.get()).toEqual(defaultAppState())
    expect(existsSync(file)).toBe(false)
    const backups = (await readdir(dir)).filter((n) => /^yaseendocs\.json\.corrupt-\d+$/.test(n))
    expect(backups).toHaveLength(1)
    expect(await readFile(path.join(dir, backups[0]), 'utf8')).toBe(raw)
  })
})

describe('createStore: mutations', () => {
  it('setSettings / setSidebarCollapsed replace the value and notify listeners synchronously with the new state', () => {
    const store = createStore(file)
    const seen: AppState[] = []
    const off = store.onChange((s) => seen.push(s))
    const before = store.get()
    store.setSettings({ ...DEFAULT_SETTINGS, blockGap: 12 })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(store.get())
    expect(store.get().settings.blockGap).toBe(12)
    expect(before.settings.blockGap).toBe(DEFAULT_SETTINGS.blockGap) // snapshots are immutable
    store.setSidebarCollapsed(true)
    expect(store.get().sidebarCollapsed).toBe(true)
    expect(seen).toHaveLength(2)
    off()
    store.setSidebarCollapsed(false)
    expect(seen).toHaveLength(2)
  })

  it('pushRecent is MRU, de-duplicated and capped', () => {
    const store = createStore(file)
    store.pushRecent('/a', 1)
    store.pushRecent('/b', 2)
    store.pushRecent('/a', 3)
    expect(store.get().recents).toEqual([
      { path: '/a', lastOpened: 3 },
      { path: '/b', lastOpened: 2 },
    ])
    for (let i = 0; i < 20; i++) store.pushRecent(`/x${i}`, 10 + i)
    expect(store.get().recents).toHaveLength(MAX_RECENT_ROOTS)
    expect(store.get().recents[0].path).toBe('/x19')
    store.pushRecent('/now')
    expect(store.get().recents[0].lastOpened).toBeGreaterThan(0)
  })

  it('removeRecent drops the entry; removing an unknown path changes (and notifies) nothing', () => {
    const store = createStore(file)
    const seen: AppState[] = []
    store.onChange((s) => seen.push(s))
    store.pushRecent('/a', 1)
    store.pushRecent('/b', 2)
    store.removeRecent('/a')
    expect(store.get().recents).toEqual([{ path: '/b', lastOpened: 2 }])
    expect(seen).toHaveLength(3)
    store.removeRecent('/gone') // no change → no notification
    expect(seen).toHaveLength(3)
    expect(store.get().recents).toEqual([{ path: '/b', lastOpened: 2 }])
  })

  it('setFolder creates the entry with defaults, merges the patch and ignores unknown keys', () => {
    const store = createStore(file)
    store.setFolder('/r1', { expanded: ['/r1/a'] })
    expect(store.get().folders['/r1']).toEqual({ expanded: ['/r1/a'], lastFile: null, folds: {}, baseGroups: {} })
    store.setFolder('/r1', { lastFile: '/r1/a/x.md' })
    expect(store.get().folders['/r1']).toEqual({ expanded: ['/r1/a'], lastFile: '/r1/a/x.md', folds: {}, baseGroups: {} })
    store.setFolder('/r1', { lastFile: null, folds: { '/r1/a.md': ['k'] } } as never)
    expect(store.get().folders['/r1']).toEqual({ expanded: ['/r1/a'], lastFile: null, folds: {}, baseGroups: {} })
    store.setFolder('/r2', {})
    expect(store.get().folders['/r2']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {} })
  })

  it('setFolds is keyed by root then file, capped, and an empty list removes the file entry but keeps the folder', () => {
    const store = createStore(file)
    store.setFolds('/r1', '/r1/a.md', ['k1', 'k2'])
    store.setFolds('/r1', '/r1/b.md', ['k3'])
    store.setFolds('/r2', '/r2/a.md', ['k4'])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: { '/r1/a.md': ['k1', 'k2'], '/r1/b.md': ['k3'] }, baseGroups: {} })
    store.setFolds('/r1', '/r1/a.md', ['k2']) // the live set replaces, never merges
    expect(store.get().folders['/r1'].folds['/r1/a.md']).toEqual(['k2'])
    store.setFolder('/r1', { lastFile: '/r1/a.md' })
    store.setFolds('/r1', '/r1/a.md', [])
    store.setFolds('/r1', '/r1/b.md', [])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: '/r1/a.md', folds: {}, baseGroups: {} })
    store.setFolds('/r2', '/r2/a.md', Array.from({ length: MAX_FOLD_KEYS_PER_FILE + 50 }, (_, i) => `k${i}`))
    expect(store.get().folders['/r2'].folds['/r2/a.md']).toHaveLength(MAX_FOLD_KEYS_PER_FILE)
  })

  it('setBaseGroups is keyed by root then base::view, capped, and an empty list removes the entry but keeps the folder', () => {
    const store = createStore(file)
    store.setBaseGroups('/r1', '/r1/a.base::T', ['v:idea', 'v:done'])
    store.setBaseGroups('/r1', '/r1/a.base::T 2', ['∅'])
    store.setBaseGroups('/r2', '/r2/a.base::T', ['v:x'])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: { '/r1/a.base::T': ['v:idea', 'v:done'], '/r1/a.base::T 2': ['∅'] } })
    store.setBaseGroups('/r1', '/r1/a.base::T', ['v:done']) // the live set replaces, never merges
    expect(store.get().folders['/r1'].baseGroups['/r1/a.base::T']).toEqual(['v:done'])
    store.setBaseGroups('/r1', '/r1/a.base::T', [])
    store.setBaseGroups('/r1', '/r1/a.base::T 2', [])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {} })
    store.setBaseGroups('/r2', '/r2/a.base::T', Array.from({ length: MAX_COLLAPSED_GROUP_KEYS + 50 }, (_, i) => `v:${i}`))
    expect(store.get().folders['/r2'].baseGroups['/r2/a.base::T']).toHaveLength(MAX_COLLAPSED_GROUP_KEYS)
  })

  it('upsertWindow replaces by id or appends; removeWindow drops by id', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1'))
    store.upsertWindow(win('w2', { root: '/v' }))
    store.upsertWindow(win('w1', { root: '/other', file: '/other/a.md' }))
    expect(store.get().windows).toEqual([win('w1', { root: '/other', file: '/other/a.md' }), win('w2', { root: '/v' })])
    store.removeWindow('w1')
    expect(store.get().windows).toEqual([win('w2', { root: '/v' })])
    store.removeWindow('nope')
    expect(store.get().windows).toEqual([win('w2', { root: '/v' })])
  })

  describe('renamePath (Links E1, GRO-2194: the store repair after an in-app rename)', () => {
    const OLD = '/v/B.md'
    const NEW = '/v/C.md'

    it('remaps window file and tabs (through normalizeTabs) in every affected window', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: OLD, tabs: [OLD, '/v/x.md'] }))
      store.upsertWindow(win('w2', { root: '/v', file: '/v/x.md', tabs: ['/v/x.md', OLD] }))
      store.upsertWindow(win('w3', { root: '/other', file: '/other/a.md', tabs: ['/other/a.md'] }))
      store.renamePath(OLD, NEW)
      expect(store.get().windows).toEqual([
        win('w1', { root: '/v', file: NEW, tabs: [NEW, '/v/x.md'] }),
        win('w2', { root: '/v', file: '/v/x.md', tabs: ['/v/x.md', NEW] }),
        win('w3', { root: '/other', file: '/other/a.md', tabs: ['/other/a.md'] }),
      ])
    })

    it('de-duplicates when the new path was somehow already a tab (normalizeTabs invariant)', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: OLD, tabs: [OLD, NEW] }))
      store.renamePath(OLD, NEW)
      expect(store.get().windows[0].tabs).toEqual([NEW])
      expect(store.get().windows[0].file).toBe(NEW)
    })

    it('remaps folders: lastFile, fold keys and baseGroups keys (base rename)', () => {
      const store = createStore(file)
      store.setFolder('/v', { lastFile: OLD })
      store.setFolds('/v', OLD, ['k1'])
      store.setFolds('/v', '/v/x.md', ['k2'])
      store.setBaseGroups('/v', '/v/T.base::Table', ['g1'])
      store.renamePath(OLD, NEW)
      expect(store.get().folders['/v'].lastFile).toBe(NEW)
      expect(store.get().folders['/v'].folds).toEqual({ [NEW]: ['k1'], '/v/x.md': ['k2'] })
      store.renamePath('/v/T.base', '/v/U.base')
      expect(store.get().folders['/v'].baseGroups).toEqual({ '/v/U.base::Table': ['g1'] })
    })

    it('a rename nothing references changes (and notifies) nothing', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: '/v/x.md', tabs: ['/v/x.md'] }))
      const seen: AppState[] = []
      store.onChange((s) => seen.push(s))
      store.renamePath('/v/unreferenced.md', '/v/other.md')
      expect(seen).toHaveLength(0)
      expect(store.get().windows).toEqual([win('w1', { root: '/v', file: '/v/x.md', tabs: ['/v/x.md'] })])
    })
  })

  describe('removePath (GRO-2272: the store repair after an in-app delete)', () => {
    const GONE = '/v/B.md'

    it('deleting the ONLY tab leaves the window empty (file null, tabs [])', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: GONE, tabs: [GONE] }))
      store.removePath(GONE)
      expect(store.get().windows[0].file).toBeNull()
      expect(store.get().windows[0].tabs).toEqual([])
    })

    it('deleting the ACTIVE tab promotes the right neighbour, else the left — never discards survivors', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: GONE, tabs: ['/v/left.md', GONE, '/v/right.md'] }))
      store.removePath(GONE)
      expect(store.get().windows[0].file).toBe('/v/right.md')
      expect(store.get().windows[0].tabs).toEqual(['/v/left.md', '/v/right.md'])
      // No right neighbour: fall back to the nearest surviving tab on the left.
      const store2 = createStore(`${file}.2`)
      store2.upsertWindow(win('w2', { root: '/v', file: GONE, tabs: ['/v/left.md', GONE] }))
      store2.removePath(GONE)
      expect(store2.get().windows[0].file).toBe('/v/left.md')
    })

    it('drops the deleted tab and keeps the window on a surviving active file', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: '/v/x.md', tabs: ['/v/x.md', GONE] }))
      store.upsertWindow(win('w2', { root: '/other', file: '/other/a.md', tabs: ['/other/a.md'] }))
      store.removePath(GONE)
      expect(store.get().windows).toEqual([
        win('w1', { root: '/v', file: '/v/x.md', tabs: ['/v/x.md'] }),
        win('w2', { root: '/other', file: '/other/a.md', tabs: ['/other/a.md'] }),
      ])
    })

    it('leaves window ROOT alone — the renderer onRootMissing probe owns that repair', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v/Sub', file: '/v/Sub/a.md', tabs: ['/v/Sub/a.md'] }))
      store.removePath('/v/Sub')
      expect(store.get().windows[0].root).toBe('/v/Sub') // untouched by design
      expect(store.get().windows[0].file).toBeNull() // the file under it still goes
      expect(store.get().windows[0].tabs).toEqual([])
    })

    it('a DIRECTORY removes by prefix: every file and tab under it goes, siblings stay', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: '/v/Old/a.md', tabs: ['/v/Old/a.md', '/v/x.md', '/v/Old/deep/b.md'] }))
      store.removePath('/v/Old')
      expect(store.get().windows[0].file).toBe('/v/x.md')
      expect(store.get().windows[0].tabs).toEqual(['/v/x.md'])
    })

    it('a prefix must be a real path segment: /v/Older is not under /v/Old', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: '/v/Older.md', tabs: ['/v/Older.md'] }))
      store.removePath('/v/Old')
      expect(store.get().windows[0].tabs).toEqual(['/v/Older.md'])
    })

    it('drops the recents entry for a deleted folder', () => {
      const store = createStore(file)
      store.pushRecent('/v/Sub')
      store.pushRecent('/v/Keep')
      store.removePath('/v/Sub')
      expect(store.get().recents.map((r) => r.path)).toEqual(['/v/Keep'])
    })

    it('drops folder state at or under the path: the key itself, expanded, lastFile, folds, baseGroups', () => {
      const store = createStore(file)
      store.setFolder('/v', { lastFile: GONE, expanded: ['/v/Old', '/v/Keep'] })
      store.setFolds('/v', GONE, ['k1'])
      store.setFolds('/v', '/v/x.md', ['k2'])
      store.setBaseGroups('/v', '/v/T.base::Table', ['g1'])
      store.setBaseGroups('/v', '/v/K.base::Table', ['g2'])
      store.removePath(GONE)
      expect(store.get().folders['/v'].lastFile).toBeNull()
      expect(store.get().folders['/v'].folds).toEqual({ '/v/x.md': ['k2'] })
      store.removePath('/v/Old')
      expect(store.get().folders['/v'].expanded).toEqual(['/v/Keep'])
      // A baseGroups key is `<basePath>::<view>` — the exact-file half needs its own test.
      store.removePath('/v/T.base')
      expect(store.get().folders['/v'].baseGroups).toEqual({ '/v/K.base::Table': ['g2'] })
    })

    it('drops the whole folder-state entry when the deleted folder was itself a stored root', () => {
      const store = createStore(file)
      store.setFolder('/v/Sub', { lastFile: '/v/Sub/a.md' })
      store.setFolder('/v/Keep', { lastFile: '/v/Keep/b.md' })
      store.removePath('/v/Sub')
      expect(Object.keys(store.get().folders)).toEqual(['/v/Keep'])
    })

    it('a delete nothing references changes (and notifies) nothing', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: '/v/x.md', tabs: ['/v/x.md'] }))
      const seen: AppState[] = []
      store.onChange((s) => seen.push(s))
      store.removePath('/v/unreferenced.md')
      expect(seen).toHaveLength(0)
    })

    it('commits ONCE for a delete that touches several places at once', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: GONE, tabs: [GONE] }))
      store.upsertWindow(win('w2', { root: '/v', file: '/v/x.md', tabs: ['/v/x.md', GONE] }))
      store.setFolder('/v', { lastFile: GONE })
      store.setFolds('/v', GONE, ['k1'])
      const seen: AppState[] = []
      store.onChange((s) => seen.push(s))
      store.removePath(GONE)
      expect(seen).toHaveLength(1)
    })
  })

  describe('renamePath with a DIRECTORY (Links E1b, GRO-2241: prefix repair)', () => {
    const OLD = '/v/Old'
    const NEW = '/v/New'

    it('remaps every window path at or under the dir — file, tabs, and a window ROOTED at (or under) it — in one commit', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: `${OLD}/a.md`, tabs: [`${OLD}/a.md`, '/v/x.md', `${OLD}/deep/b.md`] }))
      store.upsertWindow(win('w2', { root: OLD, file: `${OLD}/a.md`, tabs: [`${OLD}/a.md`] })) // the subfolder opened as a vault
      store.upsertWindow(win('w3', { root: `${OLD}/deep`, file: null, tabs: [] }))
      store.upsertWindow(win('w4', { root: '/other', file: '/other/a.md', tabs: ['/other/a.md'] }))
      const seen: AppState[] = []
      store.onChange((s) => seen.push(s))
      store.renamePath(OLD, NEW)
      expect(seen).toHaveLength(1) // ONE commit, one notify, for the whole repair
      expect(store.get().windows).toEqual([
        win('w1', { root: '/v', file: `${NEW}/a.md`, tabs: [`${NEW}/a.md`, '/v/x.md', `${NEW}/deep/b.md`] }),
        win('w2', { root: NEW, file: `${NEW}/a.md`, tabs: [`${NEW}/a.md`] }),
        win('w3', { root: `${NEW}/deep`, file: null, tabs: [] }),
        win('w4', { root: '/other', file: '/other/a.md', tabs: ['/other/a.md'] }),
      ])
    })

    it('remaps folder state under the dir: lastFile, expanded dirs, fold keys, baseGroups keys — and the folder-state KEY of a root at/under it', () => {
      const store = createStore(file)
      store.setFolder('/v', { lastFile: `${OLD}/a.md`, expanded: [OLD, `${OLD}/deep`, '/v/other'] })
      store.setFolds('/v', `${OLD}/a.md`, ['k1'])
      store.setFolds('/v', '/v/x.md', ['k2'])
      store.setBaseGroups('/v', `${OLD}/T.base::Table`, ['g1'])
      store.setFolder(OLD, { lastFile: `${OLD}/a.md` }) // the subfolder's own folder-state entry (it was opened as a root)
      store.renamePath(OLD, NEW)
      expect(store.get().folders['/v']).toEqual({
        lastFile: `${NEW}/a.md`,
        expanded: [NEW, `${NEW}/deep`, '/v/other'],
        folds: { [`${NEW}/a.md`]: ['k1'], '/v/x.md': ['k2'] },
        baseGroups: { [`${NEW}/T.base::Table`]: ['g1'] },
      })
      expect(store.get().folders[OLD]).toBeUndefined()
      expect(store.get().folders[NEW]).toEqual({ lastFile: `${NEW}/a.md`, expanded: [], folds: {}, baseGroups: {} })
    })

    it('remaps a recents entry at or under the dir (a subfolder that was opened as a vault)', () => {
      const store = createStore(file)
      store.pushRecent('/other', 1)
      store.pushRecent(OLD, 2)
      store.renamePath(OLD, NEW)
      expect(store.get().recents.map((r) => r.path)).toEqual([NEW, '/other'])
    })

    it('a FILE rename never trips the prefix branch (nothing is stored under a file path)', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: '/v/B.md', tabs: ['/v/B.md', '/v/B.md.md'] }))
      store.renamePath('/v/B.md', '/v/C.md')
      // `/v/B.md.md` does NOT start with `/v/B.md/` — only the exact match moved.
      expect(store.get().windows[0].tabs).toEqual(['/v/C.md', '/v/B.md.md'])
    })
  })
})

describe('createStore: persistence', () => {
  it('coalesces a burst of changes into one debounced atomic write that matches get()', async () => {
    vi.useFakeTimers()
    const store = createStore(file)
    store.setSidebarCollapsed(true)
    store.pushRecent('/v', 1)
    store.setFolds('/v', '/v/a.md', ['k1'])
    await vi.advanceTimersByTimeAsync(100)
    expect(existsSync(file)).toBe(false)
    await vi.advanceTimersByTimeAsync(60)
    await store.flush()
    expect(renames()).toHaveLength(1)
    expect(await onDisk()).toEqual(store.get())
    expect((await readdir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('flush writes at once, cancels the pending timer, and is a no-op when nothing changed', async () => {
    vi.useFakeTimers()
    const store = createStore(file)
    await store.flush()
    expect(existsSync(file)).toBe(false)
    store.setSettings({ ...DEFAULT_SETTINGS, lineSpacing: 2 })
    await store.flush()
    expect((await onDisk()).settings.lineSpacing).toBe(2)
    await vi.advanceTimersByTimeAsync(500)
    await store.flush()
    expect(renames()).toHaveLength(1)
  })

  it('the file on disk is the pretty-printed state and the parent directory is created on demand', async () => {
    const nested = path.join(dir, 'deeper', 'yaseendocs.json')
    const store = createStore(nested)
    store.upsertWindow(win('w1', { root: '/v' }))
    await store.flush()
    const raw = await readFile(nested, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw.split('\n').length).toBeGreaterThan(5)
    expect(JSON.parse(raw)).toEqual(store.get())
    expect(createStore(nested).get()).toEqual(store.get())
  })
})
