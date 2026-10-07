import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_SETTINGS, MAX_COLLAPSED_GROUP_KEYS, MAX_FOLD_KEYS_PER_FILE, MAX_RECENT_ROOTS, MAX_VAULT_NAME, MAX_VAULT_SETS, MAX_WINDOW_ROOTS, SIDEBAR_DEFAULT_W, SIDEBAR_MAX_W, SIDEBAR_MIN_W, addRecentRoot, cleanVaultKey, cleanVaultName, defaultAppState, defaultRightPanelIdentity, listVaults, normalizeRoots, openVaultRoots, rootOfPath, sameVaults, type AppState, type VaultSet, type WindowEntry } from '@shared/types'
import { createStore } from './store'

// `rename` is the atomic write's last step: one rename = one write to disk.
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m, rename: vi.fn(m.rename) }
})
const renames = () => vi.mocked(rename).mock.calls.filter(([, to]) => String(to) === file)

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
const win = (id: string, extra: Partial<WindowEntry> = {}): WindowEntry => ({ id, root: null, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds, ...extra, roots: extra.roots ?? (extra.root == null ? [] : [extra.root]) })
/** A seed with every field valid, to vary one field at a time. */
const valid = (over: Record<string, unknown> = {}) => ({ ...defaultAppState(), ...over })
/** Each vault's number (YAZ-2555), root → key. */
const keysOf = (state: AppState) => Object.fromEntries(Object.entries(state.folders).map(([root, folder]) => [root, folder.key]))

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

describe("a window's vault list (YAZ-2602 D1)", () => {
  it('normalizeRoots: `root` is first, the rest keep their order with the trailing slash off, a vault appears once, the list is cut at MAX_WINDOW_ROOTS, and `root: null` ⇔ [] (S73, S74)', () => {
    expect(normalizeRoots([], '/a')).toEqual(['/a'])
    expect(normalizeRoots([], null)).toEqual([])
    expect(normalizeRoots(['/a', '/b'], null)).toEqual([]) // a window with no vault shows none
    expect(normalizeRoots(['/b', '/a', '/c'], '/a')).toEqual(['/a', '/b', '/c']) // `root` moves to the front
    expect(normalizeRoots(['/a/', '/b/', '/c', '/b', '/c/'], '/a')).toEqual(['/a', '/b', '/c']) // `/b` and `/b/` are one vault
    expect(normalizeRoots(['/b', '/a'], '/a/')).toEqual(['/a/', '/b']) // `root` as it is stored: roots[0] === root
    const many = Array.from({ length: 12 }, (_, i) => `/v${i}`)
    expect(normalizeRoots(many, '/v0')).toEqual(many.slice(0, MAX_WINDOW_ROOTS))
    expect(normalizeRoots(many, '/v11')).toEqual(['/v11', ...many.slice(0, MAX_WINDOW_ROOTS - 1)]) // `root` is never the one cut
    expect(many).toHaveLength(12) // the input is not changed
  })

  it('rootOfPath: the vault that holds a path — by SEGMENT, the most specific one, a vault holds itself, and none is null', () => {
    expect(rootOfPath(['/a/b', '/c'], '/a/b/x.md')).toBe('/a/b')
    expect(rootOfPath(['/a/b'], '/a/bc/x.md')).toBeNull() // `/a/b` does not hold `/a/bc/x.md`
    expect(rootOfPath(['/a/b'], '/a/b')).toBe('/a/b')
    expect(rootOfPath(['/a', '/a/b'], '/a/b/deep/x.md')).toBe('/a/b')
    expect(rootOfPath(['/a/b', '/a'], '/a/b/deep/x.md')).toBe('/a/b') // the order of the list does not decide
    expect(rootOfPath(['/a', '/a/b'], '/a/x.md')).toBe('/a')
    expect(rootOfPath(['/a/'], '/a/x.md')).toBe('/a/') // the answer is the entry as the list holds it
    expect(rootOfPath(['/'], '/x.md')).toBe('/')
    expect(rootOfPath(['/a', '/b'], '/c/x.md')).toBeNull()
    expect(rootOfPath([], '/a/x.md')).toBeNull()
  })

  it('openVaultRoots / listVaults: a vault that is only the SECOND vault of a window is open; a window object with no `roots` answers with its `root` (S59)', () => {
    expect(openVaultRoots([{ root: '/a', roots: ['/a', '/b/'] }, { root: null, roots: [] }, { root: '/b', roots: ['/b', '/c'] }])).toEqual(['/a', '/b', '/c'])
    // An old state file read raw: the entry has no `roots`.
    expect(openVaultRoots([{ root: '/old' }, { root: null }, { root: '/a', roots: ['/a', '/b'] }])).toEqual(['/old', '/a', '/b'])
    const vaults = listVaults({ recents: [{ path: '/b', lastOpened: 9 }, { path: '/closed', lastOpened: 3 }], windows: [{ root: '/a', roots: ['/a', '/b'] }, { root: '/old' }], folders: {} })
    expect(vaults.map((v) => [v.path, v.open])).toEqual([['/b', true], ['/closed', false], ['/a', true], ['/old', true]])
  })

  it('sameVaults: the same SET of vaults — the order and a trailing slash do not count, one vault more or fewer does (D8, S65)', () => {
    expect(sameVaults(['/a', '/b'], ['/b', '/a'])).toBe(true)
    expect(sameVaults(['/a/', '/b'], ['/b/', '/a'])).toBe(true)
    expect(sameVaults(['/a', '/b'], ['/a', '/b', '/c'])).toBe(false)
    expect(sameVaults(['/a', '/b', '/c'], ['/a', '/b'])).toBe(false)
    expect(sameVaults(['/a', '/b'], ['/a', '/c'])).toBe(false)
    expect(sameVaults(['/a', '/a/'], ['/a'])).toBe(true) // a vault counts once
    expect(sameVaults(['/a', '/a'], ['/a', '/b'])).toBe(false)
    expect(sameVaults(['/a/b'], ['/a/bc'])).toBe(false)
    expect(sameVaults([], [])).toBe(true)
    expect(sameVaults([], ['/a'])).toBe(false)
  })
})

describe('cleanVaultName (YAZ-1974 D3)', () => {
  it('trims and caps a name; empty, whitespace or a non-string is null (= the folder name)', () => {
    expect(cleanVaultName('  Business Wiki  ')).toBe('Business Wiki')
    expect(cleanVaultName('🚀 Launch')).toBe('🚀 Launch')
    expect(cleanVaultName('x'.repeat(100))).toBe('x'.repeat(MAX_VAULT_NAME))
    expect(cleanVaultName('🚀'.repeat(100))).toBe('🚀'.repeat(MAX_VAULT_NAME))
    expect(cleanVaultName('')).toBeNull()
    expect(cleanVaultName('   ')).toBeNull()
    expect(cleanVaultName(5)).toBeNull()
    expect(cleanVaultName(null)).toBeNull()
    expect(cleanVaultName(undefined)).toBeNull()
  })
})

describe('cleanVaultKey (YAZ-2555 D2)', () => {
  it('keeps a whole number 1–9; anything else is no number', () => {
    expect([1, 5, 9].map((raw) => cleanVaultKey(raw))).toEqual([1, 5, 9])
    expect([0, 10, -1, 2.5, Number.NaN, '3', null, undefined, true].map((raw) => cleanVaultKey(raw))).toEqual(Array.from({ length: 9 }, () => null))
  })
})

describe('createStore: loading', () => {
  it('a missing file yields the defaults and creates nothing until the first change', () => {
    const store = createStore(file)
    expect(store.get()).toEqual(defaultAppState())
    expect(existsSync(file)).toBe(false)
  })

  it('a valid file loads as is — except the session list, which a launch never restores (YAZ-1642)', async () => {
    const state: AppState = {
      version: 1,
      settings: { ...DEFAULT_SETTINGS, lineSpacing: 2, threadColor: '#00aaff' },
      sidebarWidth: 320,
      recents: [{ path: '/v', lastOpened: 5 }],
      windows: [win('w1', { root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'], sidebarCollapsed: true, sidebarLens: 'favorites' })],
      folders: { '/v': { expanded: ['/v/sub'], lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] }, baseGroups: { '/v/b.md::T': ['v:idea'] }, name: null, key: null } },
      vaultSets: [],
    }
    await seed(state)
    expect(createStore(file).get()).toEqual({ ...state, folders: { '/v': { ...state.folders['/v'], expanded: [], name: null, key: null } } })
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

  it('contentWidth: legacy state defaults to narrow; supported presets survive; junk falls back (YAZ-1176)', async () => {
    const { contentWidth: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toMatchObject({ contentWidth: 'narrow' })

    for (const contentWidth of ['narrow', 'medium', 'full']) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, contentWidth } }))
      expect(createStore(file).get().settings).toMatchObject({ contentWidth })
    }

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, contentWidth: 'wide' } }))
    expect(createStore(file).get().settings).toMatchObject({ contentWidth: 'narrow' })
  })

  it('commentsOrder: a pre-1515 file without the key sanitizes to oldest; both orders survive; junk falls back (YAZ-1515)', async () => {
    const { commentsOrder: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toMatchObject({ commentsOrder: 'oldest' })

    for (const commentsOrder of ['oldest', 'newest']) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, commentsOrder } }))
      expect(createStore(file).get().settings).toMatchObject({ commentsOrder })
    }

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, commentsOrder: 'latest' } }))
    expect(createStore(file).get().settings).toMatchObject({ commentsOrder: 'oldest' })
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, commentsOrder: 1 } }))
    expect(createStore(file).get().settings).toMatchObject({ commentsOrder: 'oldest' })
  })

  it('confirmRename: a file without the key sanitizes to on; off survives; junk falls back (YAZ-2420 3C1)', async () => {
    const { confirmRename: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toMatchObject({ confirmRename: true })
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, confirmRename: false } }))
    expect(createStore(file).get().settings).toMatchObject({ confirmRename: false })
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, confirmRename: 'no' } }))
    expect(createStore(file).get().settings).toMatchObject({ confirmRename: true })
  })

  it('newNoteLocation/newNoteFolder: a pre-C2 file without the keys sanitizes to the defaults (current + "", YAZ-1643); junk falls back (GRO-2240)', async () => {
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

  it('sidebarCollapsed migrates from the legacy global value into each window, while a per-window boolean wins', async () => {
    await seed(
      valid({
        sidebarCollapsed: true,
        windows: [
          { id: 'legacy', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], bounds },
          { id: 'new', root: '/v', file: null, tabs: [], bounds, sidebarCollapsed: false },
        ],
      }),
    )
    const store = createStore(file)
    const loaded = store.get() as unknown as { sidebarCollapsed?: unknown; windows: Array<{ sidebarCollapsed: boolean }> }
    expect(loaded).not.toHaveProperty('sidebarCollapsed')
    expect(loaded.windows.map((w) => w.sidebarCollapsed)).toEqual([true, false])

    // The next write completes the additive-within-v1 migration rather than preserving a
    // shadow global value that could later become a second source of truth.
    store.setSidebarWidth(321)
    await store.flush()
    const persisted = JSON.parse(await readFile(file, 'utf8')) as { sidebarCollapsed?: unknown; windows: Array<{ sidebarCollapsed: boolean }> }
    expect(persisted).not.toHaveProperty('sidebarCollapsed')
    expect(persisted.windows.map((w) => w.sidebarCollapsed)).toEqual([true, false])
  })

  it('sidebarCollapsed migration treats a missing or non-boolean legacy value as open', async () => {
    await seed(valid({ windows: [{ id: 'missing', root: null, file: null, tabs: [], bounds }] }))
    expect((createStore(file).get().windows[0] as unknown as { sidebarCollapsed: boolean }).sidebarCollapsed).toBe(false)

    await seed(valid({ sidebarCollapsed: 'true', windows: [{ id: 'junk', root: null, file: null, tabs: [], bounds }] }))
    expect((createStore(file).get().windows[0] as unknown as { sidebarCollapsed: boolean }).sidebarCollapsed).toBe(false)
  })

  it('sidebarWidth clamps a finite number and defaults when it is missing or junk', async () => {
    await seed(valid({ sidebarWidth: 5 }))
    expect(createStore(file).get().sidebarWidth).toBe(SIDEBAR_MIN_W)
    await seed(valid({ sidebarWidth: 9999 }))
    expect(createStore(file).get().sidebarWidth).toBe(SIDEBAR_MAX_W)
    await seed(valid({ sidebarWidth: '300' }))
    expect(createStore(file).get().sidebarWidth).toBe(SIDEBAR_DEFAULT_W)
    const { sidebarWidth: _omitted, ...preResize } = valid()
    await seed(preResize)
    expect(createStore(file).get().sidebarWidth).toBe(SIDEBAR_DEFAULT_W)
  })

  it('sidebarLens migrates from the legacy global value into each window, while a per-window lens wins (YAZ-847 → YAZ-1628)', async () => {
    await seed(
      valid({
        sidebarLens: 'files',
        windows: [
          { id: 'legacy', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], bounds },
          { id: 'own', root: '/v', file: null, tabs: [], bounds, sidebarLens: 'favorites' },
          { id: 'junk', root: null, file: null, tabs: [], bounds, sidebarLens: 'graph' },
        ],
      }),
    )
    const store = createStore(file)
    const loaded = store.get() as unknown as { sidebarLens?: unknown; windows: Array<{ sidebarLens: string }> }
    expect(loaded).not.toHaveProperty('sidebarLens')
    expect(loaded.windows.map((w) => w.sidebarLens)).toEqual(['files', 'favorites', 'files'])

    // The next write completes the migration (the YAZ-1280 shape): no shadow global lens survives on disk.
    store.setSidebarWidth(321)
    await store.flush()
    const persisted = JSON.parse(await readFile(file, 'utf8')) as { sidebarLens?: unknown; windows: Array<{ sidebarLens: string }> }
    expect(persisted).not.toHaveProperty('sidebarLens')
    expect(persisted.windows.map((w) => w.sidebarLens)).toEqual(['files', 'favorites', 'files'])
  })

  it('sidebarLens migration treats a junk or missing legacy value as the default, Files — a PRE-847 file has no key anywhere (YAZ-847, YAZ-1628, YAZ-1846)', async () => {
    await seed(valid({ sidebarLens: 'graph', windows: [{ id: 'w', root: null, file: null, tabs: [], bounds }] }))
    expect(createStore(file).get().windows[0].sidebarLens).toBe('files')
    await seed(valid({ sidebarLens: 1, windows: [{ id: 'w', root: null, file: null, tabs: [], bounds, sidebarLens: 1 }] }))
    expect(createStore(file).get().windows[0].sidebarLens).toBe('files')
    await seed(valid({ windows: [{ id: 'w', root: null, file: null, tabs: [], bounds }] }))
    expect(createStore(file).get().windows[0].sidebarLens).toBe('files')
  })

  it('a saved Topics lens — the lens YAZ-2290 retired — falls back to Files, per window and as the legacy global value alike, and the file is not read as corrupt', async () => {
    await seed(valid({ windows: [{ id: 'w', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], bounds, sidebarLens: 'topics' }] }))
    const store = createStore(file)
    expect(store.get().windows[0]).toMatchObject({ root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarLens: 'files' })
    expect((await readdir(dir)).filter((n) => n.includes('.corrupt-'))).toEqual([])
    // The next write stores the lens the window now shows.
    store.setSidebarWidth(321)
    await store.flush()
    expect((await onDisk()).windows[0].sidebarLens).toBe('files')
    await seed(valid({ sidebarLens: 'topics', windows: [{ id: 'w', root: null, file: null, tabs: [], bounds }] }))
    expect(createStore(file).get().windows[0].sidebarLens).toBe('files')
  })

  it('an old file still carrying the retired Topics state loads cleanly: `focusTopics` and `topicsExpanded` are ignored, everything beside them is kept (YAZ-2290)', async () => {
    await seed(
      valid({
        windows: [{ id: 'w', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], bounds, sidebarLens: 'favorites', focusDirs: ['/v/sub'], focusTopics: ['/v/T.md'], focusFavorites: ['/v/f'] }],
        folders: { '/v': { lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] }, baseGroups: {}, topicsExpanded: ['/v/Metrics.md'], name: 'Wiki' } },
      }),
    )
    const store = createStore(file)
    expect((await readdir(dir)).filter((n) => n.includes('.corrupt-'))).toEqual([])
    expect(store.get().windows[0]).toEqual(win('w', { root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarLens: 'favorites', focusDirs: ['/v/sub'], focusFavorites: ['/v/f'] }))
    expect(store.get().folders['/v']).toEqual({ expanded: [], lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] }, baseGroups: {}, name: 'Wiki', key: null })
    // The next write drops both keys from disk.
    store.setSidebarWidth(321)
    await store.flush()
    const persisted = JSON.parse(await readFile(file, 'utf8')) as { windows: Array<Record<string, unknown>>; folders: Record<string, Record<string, unknown>> }
    expect(persisted.windows[0]).not.toHaveProperty('focusTopics')
    expect(persisted.folders['/v']).not.toHaveProperty('topicsExpanded')
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

  it('rightPanel: a legacy entry gains the closed empty default without changing state version 1', async () => {
    const legacy = { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], bounds }
    await seed(valid({ windows: [legacy] }))
    expect(createStore(file).get().windows[0]).toMatchObject({
      rightPanel: { open: false, width: 440, items: [], expanded: null },
    })
  })

  it('rightPanel: normalizes geometry, absolute unique items, expanded membership, and exclusive ownership', async () => {
    await seed(valid({
      windows: [{
        ...win('w1', { root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] }),
        rightPanel: {
          open: true,
          width: 9_999,
          items: ['/v/a.md', '/v/b.md', 'relative.md', '/v/b.md'],
          expanded: '/v/a.md',
        },
      }],
    }))
    expect(createStore(file).get().windows[0]).toMatchObject({
      rightPanel: { open: true, width: 720, items: ['/v/b.md'], expanded: null },
    })

    await seed(valid({
      windows: [{ ...win('w2'), rightPanel: { open: 'yes', width: Number.NaN, items: 'nope', expanded: 3 } }],
    }))
    expect(createStore(file).get().windows[0]).toMatchObject({
      rightPanel: { open: false, width: 440, items: [], expanded: null },
    })
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
    expect(folders['/a']).toEqual({ expanded: [], lastFile: null, folds: { '/a/x.md': ['k'] }, baseGroups: {}, name: null, key: null })
    expect(folders['/b']).toBeUndefined()
    expect(folders['/c'].expanded).toEqual([]) // a session list: the file's value is ignored (YAZ-1642)
    expect(folders['/c'].lastFile).toBe('/c/a.md')
    expect(folders['/c'].folds['/c/a.md']).toHaveLength(MAX_FOLD_KEYS_PER_FILE)
    expect(folders['/d']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
    await seed(valid({ folders: [] }))
    expect(createStore(file).get().folders).toEqual({})
  })

  it('folders: junk baseGroups are dropped and capped; an old file without the field reads as {}', async () => {
    await seed(
      valid({
        folders: {
          '/a': { expanded: [], lastFile: null, folds: {}, baseGroups: { '/a/x.md::T': ['v:idea'], '/a/y.md::T': 'nope', '/a/z.md::T': [1, 2] } },
          '/b': { expanded: [], lastFile: null, folds: {} }, // pre-4C file: no baseGroups
          '/c': { expanded: [], lastFile: null, folds: {}, baseGroups: { '/c/x.md::T': Array.from({ length: MAX_COLLAPSED_GROUP_KEYS + 5 }, (_, i) => `v:${i}`) } },
        },
      }),
    )
    const { folders } = createStore(file).get()
    expect(folders['/a'].baseGroups).toEqual({ '/a/x.md::T': ['v:idea'] })
    expect(folders['/b']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
    expect(folders['/c'].baseGroups['/c/x.md::T']).toHaveLength(MAX_COLLAPSED_GROUP_KEYS)
  })

  it('folders: a damaged file — a number that is not a whole number 1–9 reads as none, and one number on two vaults stays with the first (YAZ-2555 S21)', async () => {
    await seed(valid({ folders: { '/a': { key: 3 }, '/b': { key: 12 }, '/c': { key: '2' }, '/d': { key: 3 }, '/e': { key: 1.5 }, '/f': { key: 9 }, '/g': {} } }))
    expect(keysOf(createStore(file).get())).toEqual({ '/a': 3, '/b': null, '/c': null, '/d': null, '/e': null, '/f': 9, '/g': null })
  })

  it('windows: focusDirs / focusFavorites load with the tabs rule — relative elements drop, a missing or junk list is no focus (YAZ-1628)', async () => {
    await seed(
      valid({
        windows: [
          { id: 'a', root: '/v', file: null, tabs: [], bounds, focusDirs: ['/v/x', 'rel', '/v/y'], focusFavorites: ['/v/f'] },
          { id: 'b', root: '/v', file: null, tabs: [], bounds }, // pre-1628 entry: no focus fields
          { id: 'c', root: '/v', file: null, tabs: [], bounds, focusDirs: '/v/x', focusFavorites: [1] },
        ],
      }),
    )
    const { windows } = createStore(file).get()
    expect(windows[0]).toMatchObject({ focusDirs: ['/v/x', '/v/y'], focusFavorites: ['/v/f'] })
    expect(windows[1]).toMatchObject({ focusDirs: [], focusFavorites: [] })
    expect(windows[2]).toMatchObject({ focusDirs: [], focusFavorites: [] }) // junk voids the list, like `tabs`
  })

  // The vault list (YAZ-2602 D1) is additive within version 1, like `tabs`: an old build's sanitizer drops
  // the unknown `roots` key and opens `root` alone; this build repairs the other way.
  it('roots: an entry without the key repairs from root ([root], or [] when root is null) — and the repaired list is what is written (YAZ-2602 S73)', async () => {
    const legacy = (id: string, root: string | null) => ({ id, root, file: null, tabs: [], bounds })
    await seed(valid({ windows: [legacy('w1', '/v'), legacy('w2', null)] }))
    const store = createStore(file)
    expect(store.get().windows.map((w) => w.roots)).toEqual([['/v'], []])
    store.upsertWindow({ ...store.get().windows[0], sidebarCollapsed: true })
    await store.flush()
    expect((await onDisk()).windows.map((w) => w.roots)).toEqual([['/v'], []])
  })

  it('roots: non-strings and relative paths drop, a vault appears once, entries after the 8th drop, and `root` is put first (YAZ-2602 S74)', async () => {
    const entry = (id: string, root: string | null, roots: unknown) => ({ id, root, file: null, tabs: [], bounds, roots })
    await seed(
      valid({
        windows: [
          entry('junk', '/a', ['/a', 5, 'rel', null, '/b', { path: '/x' }, '/c']), // each bad element drops; the others stay
          entry('dupes', '/a', ['/a', '/b', '/b/', '/a/', '/b']),
          entry('long', '/v0', Array.from({ length: 12 }, (_, i) => `/v${i}`)),
          entry('order', '/b', ['/a', '/b', '/c']), // `root` is not the first entry
          entry('missing', '/z', ['/a', '/b']), // `root` is not in the list at all
          entry('not-a-list', '/a', '/b'),
          entry('welcome', null, ['/a', '/b']), // no vault: no list
        ],
      }),
    )
    expect(Object.fromEntries(createStore(file).get().windows.map((w) => [w.id, w.roots]))).toEqual({
      junk: ['/a', '/b', '/c'],
      dupes: ['/a', '/b'],
      long: ['/v0', '/v1', '/v2', '/v3', '/v4', '/v5', '/v6', '/v7'],
      order: ['/b', '/a', '/c'],
      missing: ['/z', '/a', '/b'],
      'not-a-list': ['/a'],
      welcome: [],
    })
  })

  it('a legacy per-vault focus (folders[root].focusDirs / focusTopics, pre-1628) is dropped on load and absent from the written file', async () => {
    await seed(
      valid({
        windows: [{ id: 'w1', root: '/v', file: null, tabs: [], bounds }],
        folders: { '/v': { expanded: [], lastFile: null, folds: {}, baseGroups: {}, topicsExpanded: [], favorites: [], focusDirs: ['/v/x'], focusTopics: ['/v/T.md'], focusFavorites: [] } },
      }),
    )
    const store = createStore(file)
    // No migration: the vault bucket could not say WHICH window was focused, so every window starts unfocused.
    expect(store.get().folders['/v']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
    expect(store.get().windows[0]).toMatchObject({ focusDirs: [], focusFavorites: [] })
    store.setSidebarWidth(321)
    await store.flush()
    const persisted = JSON.parse(await readFile(file, 'utf8')) as { folders: Record<string, Record<string, unknown>> }
    expect(persisted.folders['/v']).not.toHaveProperty('focusDirs')
    expect(persisted.folders['/v']).not.toHaveProperty('focusTopics')
  })

  it('folders: expanded is a session list — present, junk or missing, a launch reads it as [] (YAZ-1642)', async () => {
    await seed(
      valid({
        folders: {
          '/a': { expanded: ['/a/sub'], lastFile: null, folds: {}, baseGroups: {} }, // a pre-1642 file still carrying it
          '/b': { lastFile: null, folds: {}, baseGroups: {} }, // what this version writes: no key
          '/c': { expanded: 'nope', lastFile: null, folds: {}, baseGroups: {} },
        },
      }),
    )
    const { folders } = createStore(file).get()
    for (const root of ['/a', '/b', '/c']) {
      expect(folders[root].expanded).toEqual([])
    }
  })

  it('vaultSets (YAZ-2602 D8): a missing or junk list is []; a bad entry drops alone, its vaults are cleaned like a window\'s, a junk `lastUsed` reads 0, and the list is cut at MAX_VAULT_SETS', async () => {
    // A state file from before the key: additive within version 1, so it loads.
    const { vaultSets: _omitted, ...before } = valid({ recents: [{ path: '/v', lastOpened: 5 }] })
    await seed(before)
    expect(createStore(file).get()).toEqual({ ...defaultAppState(), recents: [{ path: '/v', lastOpened: 5 }] })
    for (const junk of ['nope', { a: 1 }, 5, null]) {
      await seed(valid({ vaultSets: junk }))
      expect(createStore(file).get().vaultSets).toEqual([])
    }
    const many = Array.from({ length: MAX_WINDOW_ROOTS + 4 }, (_, i) => `/v${i}`)
    await seed(
      valid({
        vaultSets: [
          { id: 'ok', name: '  Work  ', roots: ['/a/', 'rel', 5, '/b', '/a', '/b/'], lastUsed: 7, extra: true },
          'junk',
          { name: 'No id', roots: ['/a', '/b'], lastUsed: 1 },
          { id: 5, name: 'Id is not a string', roots: ['/a', '/b'], lastUsed: 1 },
          { id: 'ok', name: 'The id again', roots: ['/c', '/d'], lastUsed: 1 },
          { id: 'blank', name: '   ', roots: ['/a', '/b'], lastUsed: 1 },
          { id: 'named-5', name: 5, roots: ['/a', '/b'], lastUsed: 1 },
          { id: 'one', name: 'One vault twice', roots: ['/a', '/a/', 'b'], lastUsed: 1 },
          { id: 'none', name: 'No list', lastUsed: 1 },
          { id: 'time', name: 'Time', roots: ['/a', '/b'], lastUsed: 'yesterday' },
          { id: 'many', name: 'Many', roots: many, lastUsed: 3 },
        ],
      }),
    )
    expect(createStore(file).get().vaultSets).toEqual([
      { id: 'ok', name: 'Work', roots: ['/a', '/b'], lastUsed: 7 },
      { id: 'time', name: 'Time', roots: ['/a', '/b'], lastUsed: 0 },
      { id: 'many', name: 'Many', roots: many.slice(0, MAX_WINDOW_ROOTS), lastUsed: 3 },
    ])
    await seed(valid({ vaultSets: Array.from({ length: MAX_VAULT_SETS + 5 }, (_, i) => ({ id: `s${i}`, name: `Set ${i}`, roots: ['/a', '/b'], lastUsed: i })) }))
    expect(createStore(file).get().vaultSets.map((s) => s.id)).toEqual(Array.from({ length: MAX_VAULT_SETS }, (_, i) => `s${i}`))
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
  it('setSettings replaces the value and notifies listeners synchronously with the new state', () => {
    const store = createStore(file)
    const seen: AppState[] = []
    const off = store.onChange((s) => seen.push(s))
    const before = store.get()
    store.setSettings({ ...DEFAULT_SETTINGS, blockGap: 12 })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(store.get())
    expect(store.get().settings.blockGap).toBe(12)
    expect(before.settings.blockGap).toBe(DEFAULT_SETTINGS.blockGap) // snapshots are immutable
    off()
    store.setSettings(DEFAULT_SETTINGS)
    expect(seen).toHaveLength(1)
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
    expect(store.get().folders['/r1']).toEqual({ expanded: ['/r1/a'], lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
    store.setFolder('/r1', { lastFile: '/r1/a/x.md' })
    expect(store.get().folders['/r1']).toEqual({ expanded: ['/r1/a'], lastFile: '/r1/a/x.md', folds: {}, baseGroups: {}, name: null, key: null })
    store.setFolder('/r1', { lastFile: null, folds: { '/r1/a.md': ['k'] } } as never)
    expect(store.get().folders['/r1']).toEqual({ expanded: ['/r1/a'], lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
    store.setFolder('/r2', {})
    expect(store.get().folders['/r2']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
  })

  it('setFolder cleans the display name, other patches leave it alone, and removeRecent keeps it (YAZ-1974 D3)', () => {
    const store = createStore(file)
    store.pushRecent('/v', 1)
    store.setFolder('/v', { name: '  Business Wiki  ' })
    expect(store.get().folders['/v'].name).toBe('Business Wiki')
    store.setFolder('/v', { lastFile: '/v/a.md' })
    store.removeRecent('/v') // forgets the MRU entry only — folders are not pruned with recents
    expect(store.get().folders['/v'].name).toBe('Business Wiki')
    store.setFolder('/v', { name: 'x'.repeat(MAX_VAULT_NAME + 20) })
    expect(store.get().folders['/v'].name).toHaveLength(MAX_VAULT_NAME)
    store.setFolder('/v', { name: '   ' })
    expect(store.get().folders['/v'].name).toBeNull()
  })

  it('setFolder gives a vault its number: one vault per number in ONE commit, null clears it, and it is there after a relaunch (YAZ-2555 D2, S14–S17)', async () => {
    const store = createStore(file)
    store.setFolder('/a', { key: 2, name: 'Wiki' })
    store.setFolder('/b', { key: 1 })
    const seen: AppState[] = []
    store.onChange((s) => seen.push(s))
    store.setFolder('/b', { key: 2 }) // S15: the number moves from /a, and /a keeps everything else
    expect(seen).toHaveLength(1)
    expect(keysOf(seen[0])).toEqual({ '/a': null, '/b': 2 })
    expect(store.get().folders['/a'].name).toBe('Wiki')
    store.setFolder('/b', { key: 5 }) // S16: 2 is free again
    store.setFolder('/a', { key: 2 })
    store.setFolder('/a', { lastFile: '/a/x.md' }) // any other patch leaves the number alone
    expect(keysOf(store.get())).toEqual({ '/a': 2, '/b': 5 })
    store.setFolder('/c', { key: 12 }) // not 1–9: no number, and nobody loses theirs
    store.pushRecent('/b', 1)
    store.removeRecent('/b') // A3: a folder that is gone leaves the recents — its number stays
    expect(keysOf(store.get())).toEqual({ '/a': 2, '/b': 5, '/c': null })
    await store.flush()
    expect(keysOf(createStore(file).get())).toEqual({ '/a': 2, '/b': 5, '/c': null })
    store.setFolder('/b', { key: null }) // S17: "No shortcut"
    expect(keysOf(store.get())).toEqual({ '/a': 2, '/b': null, '/c': null })
  })

  it('two windows on one root hold independent focusDirs / focusFavorites — upsertWindow on one leaves the other untouched (YAZ-1628)', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1', { root: '/v', focusDirs: ['/v/a', '/v/b'], focusFavorites: ['/v/f'] }))
    store.upsertWindow(win('w2', { root: '/v', focusDirs: ['/v/c'] }))
    expect(store.get().windows[0]).toMatchObject({ focusDirs: ['/v/a', '/v/b'], focusFavorites: ['/v/f'] })
    expect(store.get().windows[1]).toMatchObject({ focusDirs: ['/v/c'], focusFavorites: [] })
    store.upsertWindow({ ...store.get().windows[0], focusDirs: [] }) // one window's exit leaves its other lens AND the other window alone
    expect(store.get().windows[0]).toMatchObject({ focusDirs: [], focusFavorites: ['/v/f'] })
    expect(store.get().windows[1]).toMatchObject({ focusDirs: ['/v/c'], focusFavorites: [] })
  })

  it('setFolds is keyed by root then file, capped, and an empty list removes the file entry but keeps the folder', () => {
    const store = createStore(file)
    store.setFolds('/r1', '/r1/a.md', ['k1', 'k2'])
    store.setFolds('/r1', '/r1/b.md', ['k3'])
    store.setFolds('/r2', '/r2/a.md', ['k4'])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: { '/r1/a.md': ['k1', 'k2'], '/r1/b.md': ['k3'] }, baseGroups: {}, name: null, key: null })
    store.setFolds('/r1', '/r1/a.md', ['k2']) // the live set replaces, never merges
    expect(store.get().folders['/r1'].folds['/r1/a.md']).toEqual(['k2'])
    store.setFolder('/r1', { lastFile: '/r1/a.md' })
    store.setFolds('/r1', '/r1/a.md', [])
    store.setFolds('/r1', '/r1/b.md', [])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: '/r1/a.md', folds: {}, baseGroups: {}, name: null, key: null })
    store.setFolds('/r2', '/r2/a.md', Array.from({ length: MAX_FOLD_KEYS_PER_FILE + 50 }, (_, i) => `k${i}`))
    expect(store.get().folders['/r2'].folds['/r2/a.md']).toHaveLength(MAX_FOLD_KEYS_PER_FILE)
  })

  it('setBaseGroups is keyed by root then base::view, capped, and an empty list removes the entry but keeps the folder', () => {
    const store = createStore(file)
    store.setBaseGroups('/r1', '/r1/a.md::T', ['v:idea', 'v:done'])
    store.setBaseGroups('/r1', '/r1/a.md::T 2', ['∅'])
    store.setBaseGroups('/r2', '/r2/a.md::T', ['v:x'])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: { '/r1/a.md::T': ['v:idea', 'v:done'], '/r1/a.md::T 2': ['∅'] }, name: null, key: null })
    store.setBaseGroups('/r1', '/r1/a.md::T', ['v:done']) // the live set replaces, never merges
    expect(store.get().folders['/r1'].baseGroups['/r1/a.md::T']).toEqual(['v:done'])
    store.setBaseGroups('/r1', '/r1/a.md::T', [])
    store.setBaseGroups('/r1', '/r1/a.md::T 2', [])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
    store.setBaseGroups('/r2', '/r2/a.md::T', Array.from({ length: MAX_COLLAPSED_GROUP_KEYS + 50 }, (_, i) => `v:${i}`))
    expect(store.get().folders['/r2'].baseGroups['/r2/a.md::T']).toHaveLength(MAX_COLLAPSED_GROUP_KEYS)
  })

  it('upsertWindow replaces by id or appends; removeWindow drops by id', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1'))
    store.upsertWindow(win('w2', { root: '/v' }))
    store.upsertWindow(win('w1', { root: '/other', file: '/other/a.md' }))
    expect(store.get().windows).toEqual([win('w1', { root: '/other', file: '/other/a.md', tabs: ['/other/a.md'] }), win('w2', { root: '/v' })])
    store.removeWindow('w1')
    expect(store.get().windows).toEqual([win('w2', { root: '/v' })])
    store.removeWindow('nope')
    expect(store.get().windows).toEqual([win('w2', { root: '/v' })])
  })

  it('upsertWindow keeps the vault-list invariant on the entry as written: no `roots` is `root` alone, and `root` leads a list that does not start with it (YAZ-2602 D1)', () => {
    const store = createStore(file)
    const { roots: _, ...noRoots } = win('w1', { root: '/a' })
    store.upsertWindow(noRoots)
    expect(store.get().windows[0].roots).toEqual(['/a'])
    store.upsertWindow(win('w1', { root: '/a', roots: ['/a', '/b', '/b/'] }))
    expect(store.get().windows[0].roots).toEqual(['/a', '/b'])
    store.upsertWindow({ ...store.get().windows[0], root: '/b' }) // a new first vault: the list follows
    expect(store.get().windows[0]).toMatchObject({ root: '/b', roots: ['/b', '/a'] })
    store.upsertWindow({ ...store.get().windows[0], root: null }) // Welcome shows no vault
    expect(store.get().windows[0]).toMatchObject({ root: null, roots: [] })
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

    it('remaps right-panel items and expanded while preserving order', () => {
      const store = createStore(file)
      store.upsertWindow({
        ...win('w1', { root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] }),
        rightPanel: { open: true, width: 440, items: [OLD, '/v/x.md'], expanded: OLD },
      } as unknown as WindowEntry)
      store.renamePath(OLD, NEW)
      expect(store.get().windows[0]).toMatchObject({
        rightPanel: { open: true, width: 440, items: [NEW, '/v/x.md'], expanded: NEW },
      })
    })

    it('remaps folders: lastFile, fold keys and baseGroups keys (base rename)', () => {
      const store = createStore(file)
      store.setFolder('/v', { lastFile: OLD })
      store.setFolds('/v', OLD, ['k1'])
      store.setFolds('/v', '/v/x.md', ['k2'])
      store.setBaseGroups('/v', '/v/T.md::Table', ['g1'])
      store.renamePath(OLD, NEW)
      expect(store.get().folders['/v'].lastFile).toBe(NEW)
      expect(store.get().folders['/v'].folds).toEqual({ [NEW]: ['k1'], '/v/x.md': ['k2'] })
      store.renamePath('/v/T.md', '/v/U.md')
      expect(store.get().folders['/v'].baseGroups).toEqual({ '/v/U.md::Table': ['g1'] })
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
    it('drops focusDirs / focusFavorites entries at or under the deleted path in every window, like tabs (YAZ-1628)', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', focusDirs: ['/v/Sub', '/v/Sub/deep', '/v/other'], focusFavorites: ['/v/Sub/fav', '/v/keep'] }))
      store.upsertWindow(win('w2', { root: '/v', focusDirs: ['/v/Sub'], focusFavorites: [] }))
      store.removePath('/v/Sub')
      expect(store.get().windows[0]).toMatchObject({ focusDirs: ['/v/other'], focusFavorites: ['/v/keep'] })
      expect(store.get().windows[1]).toMatchObject({ focusDirs: [], focusFavorites: [] }) // the last one leaving ends the focus
    })

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

    it('drops deleted right items and promotes the next item, then the previous, then null', () => {
      const store = createStore(file)
      store.upsertWindow({
        ...win('w1', { root: '/v', file: '/v/main.md', tabs: ['/v/main.md'] }),
        rightPanel: { open: true, width: 440, items: ['/v/left.md', GONE, '/v/right.md'], expanded: GONE },
      } as unknown as WindowEntry)
      store.removePath(GONE)
      expect(store.get().windows[0].rightPanel).toEqual({
        open: true,
        width: 440,
        items: ['/v/left.md', '/v/right.md'],
        expanded: '/v/right.md',
      })

      store.removePath('/v/right.md')
      expect(store.get().windows[0].rightPanel.expanded).toBe('/v/left.md')
      store.removePath('/v/left.md')
      expect(store.get().windows[0].rightPanel).toEqual({ open: true, width: 440, items: [], expanded: null })
    })

    it('leaves window ROOT alone — the renderer onRootMissing probe owns that repair', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v/Sub', file: '/v/Sub/a.md', tabs: ['/v/Sub/a.md'] }))
      store.removePath('/v/Sub')
      expect(store.get().windows[0].root).toBe('/v/Sub') // untouched by design
      expect(store.get().windows[0].file).toBeNull() // the file under it still goes
      expect(store.get().windows[0].tabs).toEqual([])
    })

    it('leaves the vault LIST alone too: a deleted folder that is the second vault of a window stays in `roots`, and only its tabs go (YAZ-2602 S49)', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', roots: ['/v', '/w/Sub'], file: '/w/Sub/a.md', tabs: ['/w/Sub/a.md', '/v/x.md'] }))
      store.removePath('/w/Sub')
      expect(store.get().windows[0]).toMatchObject({ root: '/v', roots: ['/v', '/w/Sub'], file: '/v/x.md', tabs: ['/v/x.md'] })
      store.removePath('/w') // a parent of it: the same
      expect(store.get().windows[0].roots).toEqual(['/v', '/w/Sub'])
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
      store.setBaseGroups('/v', '/v/T.md::Table', ['g1'])
      store.setBaseGroups('/v', '/v/K.md::Table', ['g2'])
      store.removePath(GONE)
      expect(store.get().folders['/v'].lastFile).toBeNull()
      expect(store.get().folders['/v'].folds).toEqual({ '/v/x.md': ['k2'] })
      store.removePath('/v/Old')
      expect(store.get().folders['/v'].expanded).toEqual(['/v/Keep'])
      // A baseGroups key is `<basePath>::<view>` — the exact-file half needs its own test.
      store.removePath('/v/T.md')
      expect(store.get().folders['/v'].baseGroups).toEqual({ '/v/K.md::Table': ['g2'] })
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

    it('every vault of a window follows its folder: the SECOND vault moves in `roots`, and `roots[0] === root` holds when the first one is renamed (YAZ-2602 S48)', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/other', roots: ['/other', OLD, '/v/Older'], file: `${OLD}/a.md`, tabs: [`${OLD}/a.md`] })) // the subfolder is this window's second vault
      store.upsertWindow(win('w2', { root: `${OLD}/deep`, roots: [`${OLD}/deep`, '/other'] })) // a first vault UNDER the renamed folder
      store.upsertWindow(win('w3', { root: '/other', roots: ['/other', '/else'] }))
      const untouched = store.get().windows[2]
      store.renamePath(OLD, NEW)
      const [w1, w2, w3] = store.get().windows
      expect(w1).toMatchObject({ root: '/other', roots: ['/other', NEW, '/v/Older'], file: `${NEW}/a.md` }) // `/v/Older` is not under `/v/Old`
      expect(w2).toMatchObject({ root: `${NEW}/deep`, roots: [`${NEW}/deep`, '/other'] })
      expect(w2.roots[0]).toBe(w2.root)
      expect(w3).toEqual(untouched)
      store.renamePath('/other', '/moved') // the first vault of w1 and w3
      expect(store.get().windows.map((w) => [w.root, w.roots])).toEqual([
        ['/moved', ['/moved', NEW, '/v/Older']],
        [`${NEW}/deep`, [`${NEW}/deep`, '/moved']],
        ['/moved', ['/moved', '/else']],
      ])
    })

    it("a FOLDER's own tab follows its rename and goes with its delete: the folder itself is a tab (YAZ-2290 D3)", () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', file: OLD, tabs: [OLD, '/v/x.md'] }))
      store.setBaseGroups('/v', `${OLD}::Table`, ['g1'])
      store.renamePath(OLD, NEW)
      expect(store.get().windows[0]).toMatchObject({ file: NEW, tabs: [NEW, '/v/x.md'] })
      expect(store.get().folders['/v'].baseGroups).toEqual({ [`${NEW}::Table`]: ['g1'] })
      store.removePath(NEW)
      expect(store.get().windows[0]).toMatchObject({ file: '/v/x.md', tabs: ['/v/x.md'] })
      expect(store.get().folders['/v'].baseGroups).toEqual({})
    })

    it('remaps focusDirs / focusFavorites at or under the dir in every window rooted there — a focused dir INSIDE the renamed folder follows it, one outside is untouched (YAZ-1628)', () => {
      const store = createStore(file)
      store.upsertWindow(win('w1', { root: '/v', focusDirs: [`${OLD}/deep`, '/v/other'], focusFavorites: [`${OLD}/fav`, '/v/keep'] }))
      store.upsertWindow(win('w2', { root: '/v', focusDirs: [OLD], focusFavorites: [] }))
      store.upsertWindow(win('w3', { root: '/other', focusDirs: ['/other/x'], focusFavorites: [] }))
      store.renamePath(OLD, NEW)
      expect(store.get().windows[0]).toMatchObject({ focusDirs: [`${NEW}/deep`, '/v/other'], focusFavorites: [`${NEW}/fav`, '/v/keep'] })
      expect(store.get().windows[1]).toMatchObject({ focusDirs: [NEW], focusFavorites: [] })
      expect(store.get().windows[2]).toMatchObject({ focusDirs: ['/other/x'], focusFavorites: [] })
    })

    it('remaps folder state under the dir: lastFile, expanded dirs, fold keys, baseGroups keys — and the folder-state KEY of a root at/under it', () => {
      const store = createStore(file)
      store.setFolder('/v', { lastFile: `${OLD}/a.md`, expanded: [OLD, `${OLD}/deep`, '/v/other'] })
      store.setFolds('/v', `${OLD}/a.md`, ['k1'])
      store.setFolds('/v', '/v/x.md', ['k2'])
      store.setBaseGroups('/v', `${OLD}/T.md::Table`, ['g1'])
      store.setFolder(OLD, { lastFile: `${OLD}/a.md` }) // the subfolder's own folder-state entry (it was opened as a root)
      store.renamePath(OLD, NEW)
      expect(store.get().folders['/v']).toEqual({
        lastFile: `${NEW}/a.md`,
        expanded: [NEW, `${NEW}/deep`, '/v/other'],
        folds: { [`${NEW}/a.md`]: ['k1'], '/v/x.md': ['k2'] },
        baseGroups: { [`${NEW}/T.md::Table`]: ['g1'] },
        name: null,
        key: null,
      })
      expect(store.get().folders[OLD]).toBeUndefined()
      expect(store.get().folders[NEW]).toEqual({ lastFile: `${NEW}/a.md`, expanded: [], folds: {}, baseGroups: {}, name: null, key: null })
    })

    it('a renamed vault ROOT keeps its display name and its number under the new key (YAZ-1974 D3, YAZ-2555 S20); a deleted one loses both', () => {
      const store = createStore(file)
      store.setFolder(OLD, { name: 'Old Notes', key: 4 })
      store.renamePath(OLD, NEW)
      expect(store.get().folders[NEW]).toMatchObject({ name: 'Old Notes', key: 4 })
      expect(store.get().folders[OLD]).toBeUndefined()
      store.removePath(NEW)
      expect(store.get().folders[NEW]).toBeUndefined()
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
  it('restores opposite sidebar values for two windows after a real flush and reload (YAZ-1280)', async () => {
    const store = createStore(file)
    store.upsertWindow(win('open', { root: '/v', sidebarCollapsed: false }))
    store.upsertWindow(win('closed', { root: '/w', sidebarCollapsed: true }))
    await store.flush()
    expect(createStore(file).get().windows.map(({ id, sidebarCollapsed }) => ({ id, sidebarCollapsed }))).toEqual([
      { id: 'open', sidebarCollapsed: false },
      { id: 'closed', sidebarCollapsed: true },
    ])
  })

  it('coalesces a burst of changes into one debounced atomic write that matches get()', async () => {
    vi.useFakeTimers()
    const store = createStore(file)
    store.setSidebarWidth(321)
    store.pushRecent('/v', 1)
    store.setFolds('/v', '/v/a.md', ['k1'])
    await vi.advanceTimersByTimeAsync(100)
    expect(existsSync(file)).toBe(false)
    await vi.advanceTimersByTimeAsync(60)
    await store.flush()
    expect(renames()).toHaveLength(1)
    expect(await onDisk()).toEqual({ ...store.get(), folders: { '/v': { lastFile: null, folds: { '/v/a.md': ['k1'] }, baseGroups: {}, name: null, key: null } } })
    expect((await readdir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('the session list lives in get() for every window but never reaches disk, so a relaunch starts collapsed (YAZ-1642)', async () => {
    const store = createStore(file)
    store.setFolder('/v', { expanded: ['/v/sub'] })
    expect(store.get().folders['/v']).toEqual({ expanded: ['/v/sub'], lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
    await store.flush()
    expect((await onDisk()).folders['/v']).toEqual({ lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
    expect(createStore(file).get().folders['/v']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, name: null, key: null })
  })

  it('a change that leaves the file byte-identical (folder expand / collapse) writes nothing; the next real change does (YAZ-2198)', async () => {
    const store = createStore(file)
    store.setSettings({ ...DEFAULT_SETTINGS, lineSpacing: 2 })
    await store.flush()
    expect(renames()).toHaveLength(1)
    store.setFolder('/v', { expanded: ['/v/sub'] })
    await store.flush()
    store.setFolder('/v', { expanded: [] })
    await store.flush()
    expect(renames()).toHaveLength(2) // the folder's first entry is real bytes; the expand/collapse after it is not
    store.setFolder('/v', { expanded: ['/v/other'] })
    await store.flush()
    expect(renames()).toHaveLength(2)
    store.setSidebarWidth(333)
    await store.flush()
    expect(renames()).toHaveLength(3)
    expect((await onDisk()).sidebarWidth).toBe(333)
  })

  it('the display name is persisted and restored; a junk one reads as null (YAZ-1974 D3)', async () => {
    const store = createStore(file)
    store.setFolder('/v', { name: 'Business Wiki' })
    await store.flush()
    expect((await onDisk()).folders['/v'].name).toBe('Business Wiki')
    expect(createStore(file).get().folders['/v'].name).toBe('Business Wiki')
    await seed(valid({ folders: { '/v': { lastFile: null, name: 42 } } }))
    expect(createStore(file).get().folders['/v'].name).toBeNull()
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

/**
 * Favorites' per-window focus list (YAZ-1766 D5): `WindowEntry.focusFavorites` rides `focusDirs`'
 * rules — path-keyed, so `renamePath` / `removePath` repair it exactly as they repair `focusDirs`.
 * (The favorites LIST itself left this store for `.yaseendocs/favorites.json` in 6A/D15 — see `favorites.test.ts`.)
 */
describe('focusFavorites (YAZ-1766 D5)', () => {
  it('windows: focusFavorites loads with the tabs rule, upserts and duplicates by value', async () => {
    await seed(valid({ windows: [{ id: 'a', root: '/v', file: null, tabs: [], bounds, focusFavorites: ['/v/x', 'rel'] }, { id: 'b', root: '/v', file: null, tabs: [], bounds, focusFavorites: 1 }] }))
    const store = createStore(file)
    expect(store.get().windows[0]).toMatchObject({ focusFavorites: ['/v/x'] })
    expect(store.get().windows[1]).toMatchObject({ focusFavorites: [] })
    store.upsertWindow(win('c', { root: '/v', focusFavorites: ['/v/a'] }))
    expect(store.get().windows[2]).toMatchObject({ focusFavorites: ['/v/a'] })
  })

  it('renamePath remaps a focused dir and everything under it in every window\'s focusFavorites', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1', { root: '/v', focusFavorites: ['/v/Sub', '/v/Sub/deep', '/v/other'] }))
    store.renamePath('/v/Sub', '/v/Moved')
    expect(store.get().windows[0]).toMatchObject({ focusFavorites: ['/v/Moved', '/v/Moved/deep', '/v/other'] })
  })

  it('removePath drops a deleted focus dir from focusFavorites', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1', { root: '/v', focusFavorites: ['/v/Sub', '/v/other'] }))
    store.removePath('/v/Sub')
    expect(store.get().windows[0]).toMatchObject({ focusFavorites: ['/v/other'] })
  })
})

/**
 * Saved sets of vaults (YAZ-2602 D8): what the user reads as a "workspace". The store keeps the list
 * last used first, and `renamePath` / `removePath` repair each set as they repair a window's lists.
 */
describe('vaultSets (YAZ-2602 D8)', () => {
  /** A store that counts its commits: each one is a `state:changed`. */
  const counted = () => {
    const store = createStore(file)
    const seen: AppState[] = []
    store.onChange((s) => seen.push(s))
    return { store, seen }
  }
  const names = (store: { get(): AppState }) => store.get().vaultSets.map((s) => s.name)

  it('saveVaultSet: a new name is a new set at the front; the SAME name replaces — it keeps its id, takes the new vaults and moves to the front (S63); a window that changes its vaults changes no set (S69)', async () => {
    const { store, seen } = counted()
    const work = store.saveVaultSet('  Work  ', ['/a/', '/b', '/a'], 10) as VaultSet
    expect(work).toEqual({ id: expect.any(String), name: 'Work', roots: ['/a', '/b'], lastUsed: 10 })
    const home = store.saveVaultSet('Home', ['/c', '/d'], 20) as VaultSet
    expect(home.id).not.toBe(work.id)
    expect(store.get().vaultSets).toEqual([home, work])
    expect(seen).toHaveLength(2)

    const again = store.saveVaultSet(' Work ', ['/b', '/c', '/d'], 30)
    expect(again).toEqual({ id: work.id, name: 'Work', roots: ['/b', '/c', '/d'], lastUsed: 30 })
    expect(store.get().vaultSets).toEqual([again, home])
    expect(seen).toHaveLength(3) // a replace is one commit

    // S69: the set is a saved copy. A window on the same vaults that adds, removes or closes changes nothing here.
    store.upsertWindow(win('w1', { root: '/b', roots: ['/b', '/c', '/d'] }))
    store.upsertWindow(win('w1', { root: '/b', roots: ['/b', '/x'] }))
    store.removeWindow('w1')
    expect(store.get().vaultSets).toEqual([again, home])
    // …and the list a caller passed in is not the list the store keeps.
    const mine = ['/p', '/q']
    store.saveVaultSet('Copy', mine, 40)
    mine.push('/r')
    expect(store.get().vaultSets[0].roots).toEqual(['/p', '/q'])

    // Per machine, in the app state file: a relaunch reads the same sets back.
    await store.flush()
    expect((await onDisk()).vaultSets).toEqual(store.get().vaultSets)
    expect(createStore(file).get().vaultSets).toEqual(store.get().vaultSets)
  })

  it('saveVaultSet refuses with null and no commit: fewer than two vaults after cleaning, an empty name, and a NEW name when MAX_VAULT_SETS exist — a replace at the limit is still saved (S68, R12)', () => {
    const { store, seen } = counted()
    expect(store.saveVaultSet('One', ['/a'], 1)).toBeNull()
    expect(store.saveVaultSet('One twice', ['/a', '/a/'], 1)).toBeNull()
    expect(store.saveVaultSet('Relative', ['/a', 'b'], 1)).toBeNull()
    expect(store.saveVaultSet('   ', ['/a', '/b'], 1)).toBeNull()
    expect(seen).toHaveLength(0)
    expect(store.get().vaultSets).toEqual([])
    // More vaults than a window shows: the set is cut like a window's list.
    const many = Array.from({ length: MAX_WINDOW_ROOTS + 2 }, (_, i) => `/v${i}`)
    expect(store.saveVaultSet('Many', many, 1)?.roots).toEqual(many.slice(0, MAX_WINDOW_ROOTS))

    for (let i = 1; i < MAX_VAULT_SETS; i++) expect(store.saveVaultSet(`Set ${i}`, ['/a', '/b'], 10 + i)).not.toBeNull()
    expect(store.get().vaultSets).toHaveLength(MAX_VAULT_SETS)
    const full = store.get()
    expect(store.saveVaultSet('The 21st', ['/a', '/b'], 99)).toBeNull()
    expect(store.get()).toBe(full) // refused: the same snapshot, no commit
    // The same name is not a 21st set: it replaces at the limit.
    const oldest = full.vaultSets[MAX_VAULT_SETS - 1]
    expect(store.saveVaultSet('Many', ['/x', '/y'], 100)).toEqual({ id: oldest.id, name: 'Many', roots: ['/x', '/y'], lastUsed: 100 })
    expect(store.get().vaultSets).toHaveLength(MAX_VAULT_SETS)
    expect(names(store)[0]).toBe('Many')
  })

  it('renameVaultSet, removeVaultSet (S67) and touchVaultSet (S65): one commit each; an unknown id, an empty name or a name another set has changes nothing', () => {
    const { store, seen } = counted()
    const a = store.saveVaultSet('A', ['/a', '/b'], 1) as VaultSet
    const b = store.saveVaultSet('B', ['/c', '/d'], 2) as VaultSet
    const c = store.saveVaultSet('C', ['/e', '/f'], 3) as VaultSet
    seen.length = 0

    // Rename: the name alone moves. The id, the vaults, the time and the place in the list stay.
    expect(store.renameVaultSet(b.id, '  Bee  ')).toBe(true)
    expect(store.get().vaultSets).toEqual([c, { ...b, name: 'Bee' }, a])
    expect(seen).toHaveLength(1)
    expect(store.renameVaultSet(b.id, 'A')).toBe(false) // a different set has the name
    expect(store.renameVaultSet(b.id, '   ')).toBe(false)
    expect(store.renameVaultSet('nope', 'New')).toBe(false)
    expect(store.renameVaultSet(b.id, 'Bee')).toBe(true) // its own name: nothing to write
    expect(seen).toHaveLength(1)

    // Touch: the set is the last used one — the time, and the front of the list.
    store.touchVaultSet(a.id, 50)
    expect(store.get().vaultSets).toEqual([{ ...a, lastUsed: 50 }, c, { ...b, name: 'Bee' }])
    expect(seen).toHaveLength(2)
    store.touchVaultSet(a.id, 50) // already in front, at that time
    store.touchVaultSet('nope', 60)
    expect(seen).toHaveLength(2)
    store.touchVaultSet(a.id, 70) // in front already: the time still moves
    expect(store.get().vaultSets[0]).toEqual({ ...a, lastUsed: 70 })
    expect(seen).toHaveLength(3)

    // Remove forgets the entry and nothing else: no window, recent or folder bucket is touched.
    store.upsertWindow(win('w1', { root: '/e', roots: ['/e', '/f'] }))
    store.pushRecent('/e', 5)
    store.setFolder('/e', { name: 'E' })
    seen.length = 0
    const before = store.get()
    store.removeVaultSet(c.id)
    expect(store.get()).toEqual({ ...before, vaultSets: [{ ...a, lastUsed: 70 }, { ...b, name: 'Bee' }] })
    expect(seen).toHaveLength(1)
    store.removeVaultSet(c.id)
    store.removeVaultSet('nope')
    expect(seen).toHaveLength(1)
  })

  it('renamePath moves a renamed folder inside every set, and removePath drops a deleted one — a set with fewer than two vaults left is removed (S71); each is still ONE commit', () => {
    const { store, seen } = counted()
    store.saveVaultSet('Pair', ['/v/a', '/v/b'], 1)
    store.saveVaultSet('Three', ['/v/b', '/v/a', '/w/c'], 2)
    store.saveVaultSet('Nested', ['/v/a/sub', '/w/c', '/w/d'], 3)
    store.saveVaultSet('Other', ['/w/c', '/w/d'], 4)
    const sets = () => Object.fromEntries(store.get().vaultSets.map((s) => [s.name, s.roots]))
    const ids = store.get().vaultSets.map((s) => s.id)
    store.upsertWindow(win('w1', { root: '/v/a', roots: ['/v/a', '/v/b'], file: '/v/a/n.md', tabs: ['/v/a/n.md'] }))
    seen.length = 0

    // A vault's folder is renamed: it follows in each set, and so does a vault inside it. `/v/ab` is not inside `/v/a`.
    store.renamePath('/v/a', '/v/z')
    expect(sets()).toEqual({ Other: ['/w/c', '/w/d'], Nested: ['/v/z/sub', '/w/c', '/w/d'], Three: ['/v/b', '/v/z', '/w/c'], Pair: ['/v/z', '/v/b'] })
    expect(store.get().vaultSets.map((s) => s.id)).toEqual(ids) // the same sets, in the same order
    expect(store.get().windows[0].roots).toEqual(['/v/z', '/v/b'])
    expect(seen).toHaveLength(1)
    store.renamePath('/v/nowhere', '/v/else')
    expect(seen).toHaveLength(1)

    // A set alone references the folder (no window, recent or bucket does): the rename still commits.
    store.renamePath('/w/d', '/w/e')
    expect(sets().Other).toEqual(['/w/c', '/w/e'])
    expect(seen).toHaveLength(2)

    // A deleted folder leaves each set, with what is under it. "Pair" is down to one vault: it is removed.
    store.removePath('/v/z')
    expect(sets()).toEqual({ Other: ['/w/c', '/w/e'], Nested: ['/w/c', '/w/e'], Three: ['/v/b', '/w/c'] })
    expect(seen).toHaveLength(3)
    // A deleted FILE inside a vault is not a vault: no set moves.
    const kept = store.get().vaultSets
    store.removePath('/w/c/note.md')
    expect(store.get().vaultSets).toEqual(kept)
    expect(seen).toHaveLength(3)
    store.removePath('/w/c')
    expect(sets()).toEqual({}) // each set fell under two vaults
    expect(seen).toHaveLength(4)

    // A rename onto a path the set already holds (that folder was gone from the disk): the set keeps each vault once.
    store.saveVaultSet('Gone', ['/x/a', '/x/gone', '/x/b'], 5)
    store.saveVaultSet('Two', ['/x/a', '/x/gone'], 6)
    store.renamePath('/x/a', '/x/gone')
    expect(sets()).toEqual({ Gone: ['/x/gone', '/x/b'] })
  })
})
