import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { APP_ZOOM_STEPS, addClosed, addEdit, addOpen, addRecentRoot, cleanVaultKey, cleanVaultName, DEFAULT_ROW_DATES, DEFAULT_SEARCH_SORT, DEFAULT_SETTINGS, DEFAULT_SIDEBAR_SORT, DEFAULT_SIDEBAR_TABS, DEFAULT_TOOLBAR, defaultAppState, defaultRightPanelIdentity, defaultTabCanvas, EDIT_GAP_MS, HOVER_PLACES, hoverOn, listVaults, LOCAL_SETTINGS, MAX_CANVAS_CARDS, MAX_CLOSED, MAX_COLLAPSED_GROUP_KEYS, MAX_EDITS, MAX_FAVORITES_ORDER, MAX_FOLD_KEYS_PER_FILE, MAX_OPENS, MAX_RECENT_ROOTS, MAX_SESSION_TABS, MAX_SESSIONS, MAX_VAULT_NAME, MAX_VAULT_SETS, MAX_WINDOW_ROOTS, normalizeRoots, OPEN_HALF_LIFE_MS, openScore, openVaultRoots, rootOfPath, sameVaults, SIDEBAR_DEFAULT_W, SIDEBAR_LINE_STYLES, SIDEBAR_MAX_W, SIDEBAR_MIN_W, SIDEBAR_ZOOM_STEPS, stepSidebarZoom, stepZoom, TOC_DEFAULT_W, TOC_LINES, TOC_MAX_W, TOC_MIN_W, type AppState, type CanvasCard, type OpenStat, type Session, type StoredTab, type VaultSet, type WindowEntry } from '@shared/types'
import { copyFoldKey } from '@shared/foldKey'
import { createStore, isSettings, mergeFolderSettings, normalizeTabStrip, sanitizeSettings, sanitizeSidebarTabs, sanitizeToolbarPrefs } from './store'

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
const win = (id: string, extra: Partial<WindowEntry> = {}): WindowEntry => ({ id, root: null, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds, ...extra, roots: extra.roots ?? (extra.root == null ? [] : [extra.root]) })
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

  it('openVaultRoots / listVaults: a vault that is only the SECOND vault of a window is open (S59)', () => {
    expect(openVaultRoots([{ roots: ['/a', '/b/'] }, { roots: [] }, { roots: ['/b', '/c'] }])).toEqual(['/a', '/b', '/c'])
    const vaults = listVaults({ recents: [{ path: '/b', lastOpened: 9 }, { path: '/closed', lastOpened: 3 }], windows: [{ roots: ['/a', '/b'] }, { roots: ['/old'] }], folders: {} })
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
      folders: { '/v': { expanded: ['/v/sub'], lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] }, baseGroups: { '/v/b.md::T': ['v:idea'] }, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null } },
      vaultSets: [],
      favoritesOrder: ['/v/a.md', '/w/b.md'],
      focusOrder: ['/w/docs', '/v/sub'],
      sessions: [{ id: 's1', name: 'Work', tabs: [{ path: '/v/a.md', active: true }, { path: '/v/a.md', name: 'Copy' }], roots: ['/v'], lastUsed: 7 }],
      settingsFolder: '/Sync/yaseen-docs-settings',
      settingsSavedAt: 42,
      tabCanvas: { allWindows: true, snap: true, cards: [{ win: 'w1', path: '/v/a.md', copy: 0, by: 'folder', x: 10, y: -20.5 }], frames: [] },
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

  it('Settings › Notifications (YAZ-3303 D1): a file from before 3303 reads 4 s, every toast type on and the sounds on; each value survives; junk falls back field by field (S1, S2)', async () => {
    const { noticeLength: _a, noticeUndo: _b, noticeClipboard: _c, noticeLists: _d, gestureSounds: _e, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toMatchObject({ noticeLength: '4s', noticeUndo: true, noticeClipboard: true, noticeLists: true, gestureSounds: true })

    for (const noticeLength of ['4s', '8s', '15s', 'closed']) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, noticeLength, noticeUndo: false, noticeClipboard: false, noticeLists: false, gestureSounds: false } }))
      expect(createStore(file).get().settings).toMatchObject({ noticeLength, noticeUndo: false, noticeClipboard: false, noticeLists: false, gestureSounds: false })
    }

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, noticeLength: '9s', noticeUndo: 'yes', noticeClipboard: false, gestureSounds: 0 } }))
    expect(createStore(file).get().settings).toMatchObject({ noticeLength: '4s', noticeUndo: true, noticeClipboard: false, noticeLists: true, gestureSounds: true })
  })

  it('Settings › Code (YAZ-3449 S6): a file from before the code tab reads edit mode, wrap on, minimap off; each value survives; a wrong value falls back to its default, field by field', async () => {
    const { codeReadOnly: _a, codeWrap: _b, codeMinimap: _c, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toMatchObject({ codeReadOnly: false, codeWrap: true, codeMinimap: false })

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, codeReadOnly: true, codeWrap: false, codeMinimap: true } }))
    expect(createStore(file).get().settings).toMatchObject({ codeReadOnly: true, codeWrap: false, codeMinimap: true })

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, codeReadOnly: 'yes', codeWrap: 0, codeMinimap: null } }))
    expect(createStore(file).get().settings).toMatchObject({ codeReadOnly: false, codeWrap: true, codeMinimap: false })
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, codeReadOnly: 1, codeWrap: 'off', codeMinimap: true })).toMatchObject({ codeReadOnly: false, codeWrap: true, codeMinimap: true })
    // The IPC boundary refuses the whole object (it never repairs).
    expect(isSettings({ ...DEFAULT_SETTINGS, codeWrap: 'off' })).toBe(false)
    expect(isSettings({ ...DEFAULT_SETTINGS, codeWrap: false })).toBe(true)
  })

  it('"Jump across files" (YAZ-3500): a file from before it reads off; on survives a restart; a wrong value reads off; it stays on this Mac', async () => {
    const { codeLanguageHelpers: _a, ...legacySettings } = DEFAULT_SETTINGS
    expect(DEFAULT_SETTINGS.codeLanguageHelpers).toBe(false)
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings.codeLanguageHelpers).toBe(false)
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, codeLanguageHelpers: true } }))
    expect(createStore(file).get().settings.codeLanguageHelpers).toBe(true)
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, codeLanguageHelpers: 'yes' } }))
    expect(createStore(file).get().settings.codeLanguageHelpers).toBe(false)
    expect(isSettings({ ...DEFAULT_SETTINGS, codeLanguageHelpers: 1 })).toBe(false)
    // The helpers are a download on this Mac: the switch never travels in a settings folder.
    expect(LOCAL_SETTINGS).toContain('codeLanguageHelpers')
  })

  it('⌘D\'s place (YAZ-3556 D2): a file from before it reads the Files tab; each kind survives a restart; a wrong value reads the default; it travels whole', async () => {
    const { goTo: _a, ...legacySettings } = DEFAULT_SETTINGS
    expect(DEFAULT_SETTINGS.goTo).toEqual({ kind: 'tab', tab: 'files' })
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings.goTo).toEqual({ kind: 'tab', tab: 'files' })
    for (const goTo of [{ kind: 'tab', tab: 'recents' }, { kind: 'folder', path: 'Projects/Alpha' }, { kind: 'folder', path: '' }, { kind: 'file', path: 'Inbox/Today.md' }, { kind: 'daily' }]) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, goTo } }))
      expect(createStore(file).get().settings.goTo).toEqual(goTo)
    }
    // A tab the sidebar does not have, an absolute or hidden path, a file with no path, a value with the parts of two kinds.
    for (const goTo of [{ kind: 'tab', tab: 'search' }, { kind: 'folder', path: '/Users/x' }, { kind: 'folder', path: 'a/.git' }, { kind: 'file', path: '' }, { kind: 'folder', tab: 'files', path: 'a' }, { kind: 'daily', path: 'a' }, 'files', null]) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, goTo } }))
      expect(createStore(file).get().settings.goTo, JSON.stringify(goTo)).toEqual({ kind: 'tab', tab: 'files' })
      expect(isSettings({ ...DEFAULT_SETTINGS, goTo })).toBe(false)
    }
    // From a settings folder the other Mac's place replaces this one whole: never a mix of a tab and a folder.
    expect(LOCAL_SETTINGS).not.toContain('goTo')
    expect(mergeFolderSettings(DEFAULT_SETTINGS, { goTo: { kind: 'folder', path: 'Projects' } }).goTo).toStrictEqual({ kind: 'folder', path: 'Projects' })
    const here = { ...DEFAULT_SETTINGS, goTo: { kind: 'file' as const, path: 'a.md' } }
    expect(mergeFolderSettings(here, { goTo: { kind: 'tab', tab: 'focus' } }).goTo).toStrictEqual({ kind: 'tab', tab: 'focus' })
    expect(mergeFolderSettings(here, { goTo: { kind: 'tab', tab: 'nowhere' } }).goTo).toStrictEqual(here.goTo)
  })

  it('Daily notes (YAZ-3607 D2, D4, D12): a file from before them reads off, the vault folder, YYYY-MM-DD and no day folders; each survives a restart; a wrong value reads its default; they travel', async () => {
    const { dailyNotes: _a, dailyNoteFolder: _b, dailyNoteFormat: _c, dailyNoteDayFolder: _d, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    const before = createStore(file).get().settings
    expect([before.dailyNotes, before.dailyNoteFolder, before.dailyNoteFormat, before.dailyNoteDayFolder]).toEqual([false, '', 'YYYY-MM-DD', false])
    const set = { dailyNotes: true, dailyNoteFolder: 'Journal/Daily', dailyNoteFormat: 'MM_DD- ddd', dailyNoteDayFolder: true }
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, ...set } }))
    expect(createStore(file).get().settings).toMatchObject(set)
    // A hidden or absolute folder; a style with no day, with a "/", or hidden; a switch that is not a boolean.
    for (const wrong of [{ dailyNoteFolder: '.trash' }, { dailyNoteFolder: '/Users/x' }, { dailyNoteFormat: 'YYYY-MM' }, { dailyNoteFormat: 'YYYY/MM/DD' }, { dailyNoteFormat: '[.]DD' }, { dailyNotes: 'yes' }, { dailyNoteDayFolder: 1 }]) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, ...wrong } }))
      const [key] = Object.keys(wrong) as (keyof typeof DEFAULT_SETTINGS)[]
      expect(createStore(file).get().settings[key], JSON.stringify(wrong)).toEqual(DEFAULT_SETTINGS[key])
      expect(isSettings({ ...DEFAULT_SETTINGS, ...wrong })).toBe(false)
    }
    for (const key of ['dailyNotes', 'dailyNoteFolder', 'dailyNoteFormat', 'dailyNoteDayFolder'] as const) expect(LOCAL_SETTINGS).not.toContain(key)
  })

  it('the code Outline (YAZ-3486 S4, S5): a file from before it reads Position and no hidden kind; each value survives a restart; a wrong value is repaired', async () => {
    const { codeOutlineSort: _a, codeOutlineHidden: _b, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toMatchObject({ codeOutlineSort: 'position', codeOutlineHidden: [] })

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, codeOutlineSort: 'type', codeOutlineHidden: ['variable', 'constant'] } }))
    expect(createStore(file).get().settings).toMatchObject({ codeOutlineSort: 'type', codeOutlineHidden: ['variable', 'constant'] })

    // A kind a later build removed, and a repeat, are dropped; the rest is kept. A sort that is no sort reads Position.
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, codeOutlineSort: 'size', codeOutlineHidden: ['variable', 'gadget', 'variable', 7] } }))
    expect(createStore(file).get().settings).toMatchObject({ codeOutlineSort: 'position', codeOutlineHidden: ['variable'] })
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, codeOutlineHidden: 'variable' }).codeOutlineHidden).toEqual([])
    // The IPC boundary refuses the whole object (it never repairs).
    expect(isSettings({ ...DEFAULT_SETTINGS, codeOutlineHidden: ['gadget'] })).toBe(false)
    expect(isSettings({ ...DEFAULT_SETTINGS, codeOutlineHidden: ['field', 'field'] })).toBe(false)
    expect(isSettings({ ...DEFAULT_SETTINGS, codeOutlineSort: 'name', codeOutlineHidden: ['field'] })).toBe(true)
  })

  it('the code Outline\'s names inside functions (YAZ-3507): a file from before it reads off; on survives a restart; junk reads off', async () => {
    const { codeOutlineLocals: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings.codeOutlineLocals).toBe(false)
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, codeOutlineLocals: true } }))
    expect(createStore(file).get().settings.codeOutlineLocals).toBe(true)
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, codeOutlineLocals: 'yes' }).codeOutlineLocals).toBe(false)
    expect(isSettings({ ...DEFAULT_SETTINGS, codeOutlineLocals: 1 })).toBe(false)
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

  it('sidebarSort (YAZ-3227 D1): a file without the key reads the defaults; a sort of each tab survives; Manual on Files, a bad way or a missing tab falls back', async () => {
    const { sidebarSort: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings.sidebarSort).toEqual(DEFAULT_SIDEBAR_SORT)

    const sorted = { files: { by: 'updated', reverse: true }, focus: { by: 'name', reverse: false }, favorites: { by: 'manual', reverse: false } }
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, sidebarSort: sorted } }))
    expect(createStore(file).get().settings.sidebarSort).toEqual(sorted)

    for (const bad of [{ ...sorted, files: { by: 'manual', reverse: false } }, { ...sorted, focus: { by: 'created', reverse: false } }, { ...sorted, favorites: { by: 'name' } }, { files: sorted.files }, 'name']) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, sidebarSort: bad } }))
      expect(createStore(file).get().settings.sidebarSort).toEqual(DEFAULT_SIDEBAR_SORT)
      expect(isSettings({ ...DEFAULT_SETTINGS, sidebarSort: bad })).toBe(false) // the IPC boundary refuses it too
    }
  })

  it('searchSort and rowDates (YAZ-3511 D1, D10, D12): a file without them reads Best match, with the dates on Search only; a pick survives; a bad value falls back and keeps every other field', async () => {
    const { searchSort: _sort, rowDates: _dates, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: { ...legacySettings, searchDates: false } }))
    expect(createStore(file).get().settings).toMatchObject({ searchSort: { by: 'best', reverse: false }, rowDates: DEFAULT_ROW_DATES })
    expect(DEFAULT_ROW_DATES).toEqual({ files: false, focus: false, favorites: false, search: true })

    const picked = { searchSort: { by: 'updated', reverse: true }, rowDates: { files: true, focus: false, favorites: true, search: false } }
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, ...picked } }))
    expect(createStore(file).get().settings).toMatchObject(picked)

    const files = { by: 'updated', reverse: true }
    for (const bad of [{ by: 'manual', reverse: false }, { by: 'created', reverse: false }, { by: 'name' }, 'name']) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, searchSort: bad, sidebarSort: { ...DEFAULT_SIDEBAR_SORT, files } } }))
      const settings = createStore(file).get().settings
      expect(settings.searchSort).toEqual(DEFAULT_SEARCH_SORT)
      expect(settings.sidebarSort.files).toEqual(files)
      expect(isSettings({ ...DEFAULT_SETTINGS, searchSort: bad })).toBe(false) // the IPC boundary refuses it too
    }
    for (const bad of [{ files: true, focus: true, favorites: true }, { ...DEFAULT_ROW_DATES, files: 'yes' }, true]) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, rowDates: bad } }))
      expect(createStore(file).get().settings.rowDates).toEqual(DEFAULT_ROW_DATES)
      expect(isSettings({ ...DEFAULT_SETTINGS, rowDates: bad })).toBe(false)
    }
  })

  it('Best match is the Search sort alone (YAZ-3511 D12, edge case 36): a Files sort of best falls back', async () => {
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, sidebarSort: { ...DEFAULT_SIDEBAR_SORT, files: { by: 'best', reverse: false } } } }))
    expect(createStore(file).get().settings.sidebarSort).toEqual(DEFAULT_SIDEBAR_SORT)
  })

  it('sidebarTabs (YAZ-3273 D8, S29): a file without the key reads the default; a set row survives a restart; the repair drops unknown names and duplicates, puts missing tabs at the end and never keeps Files hidden', async () => {
    const { sidebarTabs: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings.sidebarTabs).toEqual(DEFAULT_SIDEBAR_TABS)

    const set = { order: ['search', 'files', 'recents', 'focus', 'favorites', 'sessions'], hidden: ['focus', 'sessions'], hiddenButtons: ['fold', 'more'] }
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, sidebarTabs: set } }))
    expect(createStore(file).get().settings.sidebarTabs).toEqual(set)
    expect(isSettings({ ...DEFAULT_SETTINGS, sidebarTabs: set })).toBe(true)

    // The repair, field by field (S29).
    const repaired: [unknown, unknown][] = [
      [{ order: ['recents', 'topics', 'recents', 'files'], hidden: ['files', 'focus', 'focus', 'nope'], hiddenButtons: ['sort', 'sort', 'zoom'] }, { order: ['recents', 'files', 'search', 'focus', 'favorites', 'sessions'], hidden: ['focus'], hiddenButtons: ['sort'] }],
      [{ order: 'files', hidden: null }, DEFAULT_SIDEBAR_TABS],
      [{ hidden: ['search'] }, { ...DEFAULT_SIDEBAR_TABS, hidden: ['search'] }],
      ['files', DEFAULT_SIDEBAR_TABS],
    ]
    for (const [bad, fixed] of repaired) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, sidebarTabs: bad } }))
      expect(createStore(file).get().settings.sidebarTabs).toEqual(fixed)
      expect(sanitizeSidebarTabs(bad)).toEqual(fixed)
      expect(isSettings({ ...DEFAULT_SETTINGS, sidebarTabs: bad })).toBe(false) // the IPC boundary refuses it whole
    }
    // The boundary is strict where the loader repairs: a missing tab, Files hidden, a duplicate.
    for (const bad of [{ ...set, order: set.order.slice(1) }, { ...set, hidden: ['files'] }, { ...set, hiddenButtons: ['more', 'more'] }, { ...set, order: [...set.order, 'files'] }]) expect(isSettings({ ...DEFAULT_SETTINGS, sidebarTabs: bad })).toBe(false)
  })

  it('selectionToolbar (YAZ-3806 T5): a file without the key reads the default; a set toolbar survives a restart; the repair drops unknown names and duplicates, and a missing group or button goes at the end', async () => {
    const { selectionToolbar: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings.selectionToolbar).toEqual(DEFAULT_TOOLBAR)

    const set = { groups: ['lists', 'lineType', 'insert', 'textStyle'], buttons: ['link', ...DEFAULT_TOOLBAR.buttons.filter((b) => b !== 'link')], hidden: ['bold', 'highlight-pink'] }
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, selectionToolbar: set } }))
    expect(createStore(file).get().settings.selectionToolbar).toEqual(set)
    expect(isSettings({ ...DEFAULT_SETTINGS, selectionToolbar: set })).toBe(true)

    // A file from a version without Underline: the button joins the end of its list, so the end of its group.
    const noUnderline = DEFAULT_TOOLBAR.buttons.filter((b) => b !== 'underline')
    const repaired: [unknown, unknown][] = [
      [{ groups: ['insert', 'tables', 'insert'], buttons: noUnderline, hidden: ['bold', 'bold', 'sparkle'] }, { groups: ['insert', 'lineType', 'lists', 'textStyle'], buttons: [...noUnderline, 'underline'], hidden: ['bold'] }],
      [{ groups: 'lists', hidden: null }, DEFAULT_TOOLBAR],
      [{ hidden: ['link'] }, { ...DEFAULT_TOOLBAR, hidden: ['link'] }],
      ['toolbar', DEFAULT_TOOLBAR],
    ]
    for (const [bad, fixed] of repaired) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, selectionToolbar: bad } }))
      expect(createStore(file).get().settings.selectionToolbar).toEqual(fixed)
      expect(sanitizeToolbarPrefs(bad)).toEqual(fixed)
      expect(isSettings({ ...DEFAULT_SETTINGS, selectionToolbar: bad })).toBe(false) // the IPC boundary refuses it whole
    }
  })

  it('section indent: a file from before YAZ-2709 sanitizes to 30px, always; every listed value survives; junk falls back', async () => {
    const { sectionStep: _step, sectionLines: _lines, ...legacySettings } = DEFAULT_SETTINGS
    const defaults = { sectionStep: 30, sectionLines: 'always' }
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toMatchObject(defaults)

    const listed = { sectionStep: [24, 30, 36], sectionLines: ['always', 'hover'] }
    for (const [field, values] of Object.entries(listed)) {
      for (const value of values) {
        await seed(valid({ settings: { ...DEFAULT_SETTINGS, [field]: value } }))
        expect(createStore(file).get().settings).toMatchObject({ [field]: value })
      }
    }

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, sectionStep: 18, sectionLines: 'never' } }))
    expect(createStore(file).get().settings).toMatchObject(defaults)
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, sectionStep: '30' } }))
    expect(createStore(file).get().settings).toMatchObject(defaults)
  })

  it('startupWindows: an older file without the key sanitizes to last; the three values survive; junk falls back (YAZ-2589 D2, S16, S17)', async () => {
    const { startupWindows: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toMatchObject({ startupWindows: 'last' })

    for (const startupWindows of ['all', 'last', 'none']) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, startupWindows } }))
      expect(createStore(file).get().settings).toMatchObject({ startupWindows })
    }

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, startupWindows: 'everything' } }))
    expect(createStore(file).get().settings).toMatchObject({ startupWindows: 'last' })
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, startupWindows: true } }))
    expect(createStore(file).get().settings).toMatchObject({ startupWindows: 'last' })
  })

  it('tableOfContents: an older file without the key sanitizes to auto; the two stored values survive; junk falls back (YAZ-2700)', async () => {
    const { tableOfContents: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toMatchObject({ tableOfContents: 'auto' })

    for (const tableOfContents of ['auto', 'pinned']) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, tableOfContents } }))
      expect(createStore(file).get().settings).toMatchObject({ tableOfContents })
    }

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, tableOfContents: 'outline' } }))
    expect(createStore(file).get().settings).toMatchObject({ tableOfContents: 'auto' })
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, tableOfContents: true } }))
    expect(createStore(file).get().settings).toMatchObject({ tableOfContents: 'auto' })
  })

  it('tocOnByDefault: the split of the old Off (YAZ-3558 D2, S19–S22): an old `off` reads as default Off and Pin default Off; `pinned` and `auto` read as default On; a file that has the field keeps it; a sync from an older Mac keeps this Mac\'s values', async () => {
    const { tocOnByDefault: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    expect(DEFAULT_SETTINGS.tocOnByDefault).toBe(true)
    await seed(valid({ settings: { ...legacySettings, tableOfContents: 'off' } }))
    expect(createStore(file).get().settings).toMatchObject({ tocOnByDefault: false, tableOfContents: 'auto' })
    for (const tableOfContents of ['pinned', 'auto'] as const) {
      await seed(valid({ settings: { ...legacySettings, tableOfContents } }))
      expect(createStore(file).get().settings).toMatchObject({ tocOnByDefault: true, tableOfContents })
    }
    // The field is there: it wins, and a stray `off` beside it loads as Pin default Off.
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, tocOnByDefault: true, tableOfContents: 'off' } }))
    expect(createStore(file).get().settings).toMatchObject({ tocOnByDefault: true, tableOfContents: 'auto' })
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, tocOnByDefault: 'no' } }))
    expect(createStore(file).get().settings).toMatchObject({ tocOnByDefault: true })
    // An older Mac's settings file sends `off` and no `tocOnByDefault`: neither value moves this Mac (YAZ-3276 D3).
    const here = { ...DEFAULT_SETTINGS, tocOnByDefault: false, tableOfContents: 'pinned' as const }
    expect(mergeFolderSettings(here, { tableOfContents: 'off' })).toMatchObject({ tocOnByDefault: false, tableOfContents: 'pinned' })
  })

  it('tableOfContentsWidth: an older file without the key loads with 200; 160 to 480 load as they are; anything else loads as 200, never clamped, and fails the channel check (YAZ-2752 D1, D3)', async () => {
    expect([TOC_MIN_W, TOC_DEFAULT_W, TOC_MAX_W]).toEqual([160, 200, 480])
    expect(DEFAULT_SETTINGS.tableOfContentsWidth).toBe(200)
    const { tableOfContentsWidth: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toEqual(DEFAULT_SETTINGS)
    const loaded = async (tableOfContentsWidth: unknown): Promise<number> => {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, tableOfContents: 'pinned', tableOfContentsWidth } }))
      const { settings } = createStore(file).get()
      // One bad field costs that field only: the mode beside it loads as stored.
      expect(settings.tableOfContents).toBe('pinned')
      return settings.tableOfContentsWidth
    }

    for (const width of [160, 161, 320, 479, 480]) expect(await loaded(width)).toBe(width)
    // A string, what JSON makes of a NaN (null), and one px past each limit: the default, not the nearest limit.
    for (const width of ['240', null, true, 159, 481, 0, -200, 100000]) expect(await loaded(width)).toBe(200)
    // JSON cannot hold these two, so they are given to the guard itself.
    for (const width of [NaN, Infinity]) expect(sanitizeSettings({ ...DEFAULT_SETTINGS, tableOfContentsWidth: width }).tableOfContentsWidth).toBe(200)

    // `state.setSettings` is strict: a write with a width outside the limits is refused as a whole.
    for (const width of [160, 480]) expect(isSettings({ ...DEFAULT_SETTINGS, tableOfContentsWidth: width })).toBe(true)
    for (const width of [159, 481, NaN, '200', undefined]) expect(isSettings({ ...DEFAULT_SETTINGS, tableOfContentsWidth: width })).toBe(false)
  })

  it('hotkeys (YAZ-3397 D2): a file from before has none and loads `{}`; a bad id or key costs that entry only; the IPC guard is strict', async () => {
    const { hotkeys: _hotkeys, hotkeysAside: _aside, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: { ...legacySettings, theme: 'dark' } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(createStore(file).get().settings.hotkeys).toEqual({})

    await seed(valid({ settings: { ...DEFAULT_SETTINGS, hotkeys: { search: 'CmdOrCtrl+Shift+K', closeTab: null, quit: 'CmdOrCtrl+Q', newTab: 7, openFolder: 'Not+A+Key' } } }))
    // An old unscoped id loads as its scoped one (YAZ-3564 K2).
    expect(createStore(file).get().settings.hotkeys).toEqual({ 'app.search': 'CmdOrCtrl+Shift+K', 'app.closeTab': null })
    for (const junk of [null, 'x', [], 3]) expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeys: junk }).hotkeys).toEqual({})

    expect(isSettings({ ...DEFAULT_SETTINGS, hotkeys: { search: 'CmdOrCtrl+Shift+K', closeTab: null } })).toBe(true)
    for (const bad of [{ quit: 'CmdOrCtrl+Q' }, { search: 3 }, { search: '' }, [], null, undefined]) expect(isSettings({ ...DEFAULT_SETTINGS, hotkeys: bad })).toBe(false)
  })

  it('hotkeys (YAZ-3410 item 4): a key the recorder refuses is dropped, and no two commands keep one key; the IPC guard refuses both', () => {
    // A bare letter would take every typed "a" in every window; ⌘Q is the app's Quit (App standard).
    // ⌘⇧V and ⌘= are fixed keys of the menu (YAZ-3419): Paste as plain text and Zoom In's hidden twin.
    for (const key of ['A', 'Shift+A', 'CmdOrCtrl+Q', 'CmdOrCtrl+Shift+V', 'CmdOrCtrl+=']) {
      expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeys: { search: key, closeTab: null } }).hotkeys, key).toEqual({ 'app.closeTab': null })
      expect(isSettings({ ...DEFAULT_SETTINGS, hotkeys: { search: key } }), key).toBe(false)
    }
    // ⌘⇧B is Toggle sidebar's default (YAZ-3564 D10): the change that clashes with it goes, and Search the vault has ⌘K again.
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeys: { search: 'CmdOrCtrl+Shift+B', closeTab: null } }).hotkeys).toEqual({ 'app.closeTab': null })
    expect(isSettings({ ...DEFAULT_SETTINGS, hotkeys: { search: 'CmdOrCtrl+Shift+B' } })).toBe(false)
    // Two changes on one key: the one LAST in `HOTKEY_COMMANDS` order goes (Copy path after Search the vault).
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeys: { search: 'CmdOrCtrl+Alt+J', copyPath: 'CmdOrCtrl+Alt+J' } }).hotkeys).toEqual({ 'app.search': 'CmdOrCtrl+Alt+J' })
    // An old change that is the default now goes (YAZ-3564 D10: Toggle sidebar's ⌘⇧B), so the page shows no Reset for it.
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeys: { toggleSidebar: 'CmdOrCtrl+Shift+B', search: 'CmdOrCtrl+Alt+J' } }).hotkeys).toEqual({ 'app.search': 'CmdOrCtrl+Alt+J' })
    // The tabs' picks (YAZ-3564): per tab; an old one-switch entry becomes its tabs; an unknown row, tab or value goes. The IPC boundary takes only the per-tab form.
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeysAside: { 'app.goTo': false, 'app.search@code': true, 'app.nope@code': true, 'app.search@note': true, 'app.goTo@drawing': 'no' } as never }).hotkeysAside).toEqual({ 'app.goTo@drawing': false, 'app.goTo@diagram': false, 'app.goTo@code': false, 'app.search@code': true })
    expect(isSettings({ ...DEFAULT_SETTINGS, hotkeysAside: { 'app.goTo@drawing': false } })).toBe(true)
    expect(isSettings({ ...DEFAULT_SETTINGS, hotkeysAside: { 'app.goTo': false } })).toBe(false)
    // Dropping one change can uncover the next clash: Tab overview's ⌘⇧M comes back, so Search the vault's ⌘⇧M goes too.
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeys: { search: 'CmdOrCtrl+Shift+M', copyPath: 'CmdOrCtrl+Alt+J', tabOverview: 'CmdOrCtrl+Alt+J' } }).hotkeys).toEqual({ 'app.copyPath': 'CmdOrCtrl+Alt+J' })
    // A move (D6) is no clash: the key left New Files window, which has "No key" now.
    const moved = { search: 'CmdOrCtrl+Shift+W', newFilesWindow: null }
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeys: moved }).hotkeys).toEqual({ 'app.search': 'CmdOrCtrl+Shift+W', 'app.newFilesWindow': null })
    expect(isSettings({ ...DEFAULT_SETTINGS, hotkeys: moved })).toBe(true)
  })

  it('hotkeys holds the clicks too (YAZ-3936): a gesture change by its row id, null for "No gesture"; a default, a bad gesture or an unknown id costs that entry only', () => {
    const stored = { 'links.thisTab': 'Click', 'links.newTab': 'CmdOrCtrl+Click', 'bullets.backgroundTab': null, 'app.search': 'CmdOrCtrl+Shift+K' }
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeys: stored }).hotkeys).toEqual(stored)
    expect(isSettings({ ...DEFAULT_SETTINGS, hotkeys: stored })).toBe(true)
    // The default (⌘-click is Links › Open in a background tab's) is no change; a key is no gesture; a gesture is no key; an id no row has goes.
    const junk = { 'links.backgroundTab': 'Command+Click', 'links.newTab': 'CmdOrCtrl+K', 'note.bold': 'CmdOrCtrl+Click', 'links.window': 'Click', 'bullets.newTab': 'Alt+Click' }
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hotkeys: junk }).hotkeys).toEqual({ 'bullets.newTab': 'Alt+Click' })
    for (const bad of [{ 'links.newTab': 'CmdOrCtrl+K' }, { 'note.bold': 'CmdOrCtrl+Click' }, { 'links.window': 'Click' }, { 'links.newTab': 3 }]) expect(isSettings({ ...DEFAULT_SETTINGS, hotkeys: bad }), JSON.stringify(bad)).toBe(false)
  })

  it('sidebarZoom (YAZ-3389): an older file without the key loads at 100; junk loads at 100; an off-step number inside 50–200 is kept (D7), one outside is clamped; the channel takes 50–200 only', async () => {
    expect(DEFAULT_SETTINGS.sidebarZoom).toBe(100)
    const { sidebarZoom: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toEqual(DEFAULT_SETTINGS)
    const loaded = async (sidebarZoom: unknown): Promise<number> => {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, theme: 'dark', sidebarZoom } }))
      const { settings } = createStore(file).get()
      expect(settings.theme).toBe('dark') // one bad field costs that field only
      return settings.sidebarZoom
    }
    for (const zoom of [50, 90, 125, 200, 110]) expect(await loaded(zoom)).toBe(zoom)
    for (const zoom of ['125', null, true, {}]) expect(await loaded(zoom)).toBe(100)
    expect(await loaded(10)).toBe(50)
    expect(await loaded(-3)).toBe(50)
    expect(await loaded(500)).toBe(200)
    for (const zoom of [NaN, Infinity]) expect(sanitizeSettings({ ...DEFAULT_SETTINGS, sidebarZoom: zoom }).sidebarZoom).toBe(100)

    for (const zoom of [50, 125, 200]) expect(isSettings({ ...DEFAULT_SETTINGS, sidebarZoom: zoom })).toBe(true)
    for (const zoom of [49, 201, NaN, '100', undefined]) expect(isSettings({ ...DEFAULT_SETTINGS, sidebarZoom: zoom })).toBe(false)
  })

  it('appZoom (YAZ-3432): an older file without the key loads at 100; only 90 · 100 · 110 · 125 · 150 · 175 · 200 are kept (200 since YAZ-3487), anything else loads at 100; the channel takes those only', async () => {
    expect(DEFAULT_SETTINGS.appZoom).toBe(100)
    expect([...APP_ZOOM_STEPS]).toEqual([90, 100, 110, 125, 150, 175, 200])
    const { appZoom: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toEqual(DEFAULT_SETTINGS)
    const loaded = async (appZoom: unknown): Promise<number> => {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, theme: 'dark', appZoom } }))
      const { settings } = createStore(file).get()
      expect(settings.theme).toBe('dark') // one bad field costs that field only
      return settings.appZoom
    }
    for (const zoom of APP_ZOOM_STEPS) expect(await loaded(zoom)).toBe(zoom)
    for (const zoom of [105, 80, 250, 0, -125, '125', null, true, {}]) expect(await loaded(zoom)).toBe(100)
    for (const zoom of [NaN, Infinity]) expect(sanitizeSettings({ ...DEFAULT_SETTINGS, appZoom: zoom }).appZoom).toBe(100)

    for (const zoom of APP_ZOOM_STEPS) expect(isSettings({ ...DEFAULT_SETTINGS, appZoom: zoom })).toBe(true)
    for (const zoom of [95, 160, NaN, '100', undefined]) expect(isSettings({ ...DEFAULT_SETTINGS, appZoom: zoom })).toBe(false)
  })

  it('hoverPreviewIn (YAZ-3403 D7, S37): a file from before reads every place on; a missing or broken place reads on and the others keep their values; the channel takes eight booleans only', async () => {
    const allOn = { ...DEFAULT_SETTINGS.hoverPreviewIn }
    expect(allOn).toEqual(Object.fromEntries(HOVER_PLACES.map((place) => [place, true])))
    const { hoverPreviewIn: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: { ...legacySettings, hoverPreview: false } }))
    const legacy = createStore(file).get().settings
    expect(legacy.hoverPreviewIn).toEqual(allOn)
    expect(legacy.hoverPreview).toBe(false) // the master keeps its own value

    const { links: _gone, ...noLinks } = { ...allOn, tabs: false, search: false }
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, theme: 'dark', hoverPreviewIn: { ...noLinks, newTab: 'no' } } }))
    const some = createStore(file).get().settings
    expect(some.hoverPreviewIn).toEqual({ ...allOn, tabs: false, search: false }) // links missing → on, newTab broken → on
    expect(some.theme).toBe('dark') // one bad place costs that place only
    for (const bad of ['off', null, 7]) expect(sanitizeSettings({ ...DEFAULT_SETTINGS, hoverPreviewIn: bad }).hoverPreviewIn).toEqual(allOn)

    expect(isSettings({ ...DEFAULT_SETTINGS, hoverPreviewIn: { ...allOn, links: false } })).toBe(true)
    for (const bad of [{ ...allOn, links: 'false' }, noLinks, 'on', undefined]) expect(isSettings({ ...DEFAULT_SETTINGS, hoverPreviewIn: bad })).toBe(false)
  })

  it('hoverOn (YAZ-3403 D7, S36, S37): a place shows the panel only while the master and its own switch are both on', () => {
    const places = { ...DEFAULT_SETTINGS.hoverPreviewIn, links: false }
    expect(hoverOn({ hoverPreview: true, hoverPreviewIn: places }, 'newTab')).toBe(true)
    expect(hoverOn({ hoverPreview: true, hoverPreviewIn: places }, 'links')).toBe(false) // the place off wins (S36)
    expect(hoverOn({ hoverPreview: false, hoverPreviewIn: places }, 'newTab')).toBe(false) // the master off wins (S37)
  })

  it('stepSidebarZoom (YAZ-3389) and stepZoom (YAZ-3432): one step each way along the steps, an off-step value snaps to the next step that way, a wall stays put', () => {
    const walk = (from: number, dir: 1 | -1): number[] => {
      const out = [from]
      while (out.length < 20 && stepSidebarZoom(out[out.length - 1], dir) !== out[out.length - 1]) out.push(stepSidebarZoom(out[out.length - 1], dir))
      return out
    }
    expect(walk(50, 1)).toEqual([...SIDEBAR_ZOOM_STEPS])
    expect(walk(200, -1)).toEqual([...SIDEBAR_ZOOM_STEPS].reverse())
    expect([stepSidebarZoom(110, 1), stepSidebarZoom(110, -1)]).toEqual([125, 100])
    expect([stepSidebarZoom(60, 1), stepSidebarZoom(60, -1)]).toEqual([75, 50])
    expect([stepSidebarZoom(50, -1), stepSidebarZoom(200, 1)]).toEqual([50, 200])
    // The same walk over the App sizes (YAZ-3432): 90 and 125 are the walls; an off-step value snaps.
    expect([90, 100, 110, 125, 200].map((p) => stepZoom(APP_ZOOM_STEPS, p, 1))).toEqual([100, 110, 125, 150, 200])
    expect([90, 100, 110, 125].map((p) => stepZoom(APP_ZOOM_STEPS, p, -1))).toEqual([90, 90, 100, 110])
    expect([stepZoom(APP_ZOOM_STEPS, 105, 1), stepZoom(APP_ZOOM_STEPS, 105, -1)]).toEqual([110, 100])
  })

  it('canvas and diagramDarkColors (YAZ-3037 done-when): a yaseendocs.json from before YAZ-3028 loads with the defaults; a file with some canvas prefs keeps them', async () => {
    const { canvas: _canvas, diagramDarkColors: _dark, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: { ...legacySettings, theme: 'dark' } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
    // One canvas pref written, the rest missing or junk: each field is repaired on its own.
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, canvas: { gridModeEnabled: true, defaultFontFamily: 'Helvetica' }, diagramDarkColors: 'keep' } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, canvas: { ...DEFAULT_SETTINGS.canvas, gridModeEnabled: true }, diagramDarkColors: 'keep' })
    // The channel check stays strict: a settings write without them is refused as a whole.
    expect(isSettings(legacySettings)).toBe(false)
  })

  it('libraryFolder and canvasPanel (YAZ-3038): an older file loads with null and the default panel; a bad tab or a relative folder falls back; the channel check is strict', async () => {
    const { libraryFolder: _folder, canvasPanel: _panel, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: legacySettings }))
    expect(createStore(file).get().settings).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.libraryFolder).toBeNull()
    expect(DEFAULT_SETTINGS.canvasPanel).toEqual({ tab: 'components', docked: false })
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, libraryFolder: '/Vault/Library', canvasPanel: { tab: 'presentation', docked: true } } }))
    expect(createStore(file).get().settings).toMatchObject({ libraryFolder: '/Vault/Library', canvasPanel: { tab: 'presentation', docked: true } })
    // One bad half costs that half only; '' or a relative path is never a library folder (it would resolve to the cwd).
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, libraryFolder: 'Library', canvasPanel: { tab: 'boards', docked: true } } }))
    expect(createStore(file).get().settings).toMatchObject({ libraryFolder: null, canvasPanel: { tab: 'components', docked: true } })
    for (const libraryFolder of ['', 'rel/dir', 7]) expect(isSettings({ ...DEFAULT_SETTINGS, libraryFolder })).toBe(false)
    expect(isSettings({ ...DEFAULT_SETTINGS, canvasPanel: { tab: 'image-studio' } })).toBe(false)
    expect(isSettings(legacySettings)).toBe(false)
  })

  it('tocLines: an older file without the key loads with hover; the three values load as they are; anything else loads as hover, and fails the channel check (YAZ-2762 D5)', async () => {
    expect(TOC_LINES).toEqual(['hover', 'always', 'off'])
    expect(DEFAULT_SETTINGS.tocLines).toBe('hover')
    // A yaseendocs.json from before YAZ-2762: the missing field gets its default, and no other field changes.
    const { tocLines: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: { ...legacySettings, tableOfContents: 'pinned', tableOfContentsWidth: 320 } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, tableOfContents: 'pinned', tableOfContentsWidth: 320 })
    const loaded = async (tocLines: unknown): Promise<string> => {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, tableOfContents: 'pinned', tocLines } }))
      const { settings } = createStore(file).get()
      // One bad field costs that field only: the mode beside it loads as stored.
      expect(settings.tableOfContents).toBe('pinned')
      return settings.tocLines
    }

    for (const tocLines of TOC_LINES) expect(await loaded(tocLines)).toBe(tocLines)
    // A word of another setting ("Never" is `off` here, not `never`), another case, and values that are not a string.
    for (const tocLines of ['never', 'on', 'Hover', '', null, true, 1, ['always'], { value: 'always' }]) expect(await loaded(tocLines)).toBe('hover')

    // `state.setSettings` is strict: a write with a value outside the three, or with no `tocLines`, is refused as a whole.
    for (const tocLines of TOC_LINES) expect(isSettings({ ...DEFAULT_SETTINGS, tocLines })).toBe(true)
    for (const tocLines of ['never', true, undefined]) expect(isSettings({ ...DEFAULT_SETTINGS, tocLines })).toBe(false)
    expect(isSettings(legacySettings)).toBe(false)
    // A value that is good is saved and read again by the next start.
    const store = createStore(file)
    store.setSettings({ ...DEFAULT_SETTINGS, tocLines: 'always' })
    await store.flush()
    expect((await onDisk()).settings.tocLines).toBe('always')
    expect(createStore(file).get().settings.tocLines).toBe('always')
  })

  it("sidebarLines: an older file without the key loads with hover; the three values load as they are; anything else loads as hover, and fails the channel check; the TOC's own setting stays apart (YAZ-3309 D3)", async () => {
    expect(DEFAULT_SETTINGS.sidebarLines).toBe('hover')
    // A yaseendocs.json from before YAZ-3309: the missing field gets its default, and no other field changes.
    const { sidebarLines: _omitted, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: { ...legacySettings, tocLines: 'off' } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, tocLines: 'off' })
    const loaded = async (sidebarLines: unknown): Promise<string> => {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, tocLines: 'always', sidebarLines } }))
      const { settings } = createStore(file).get()
      // One bad field costs that field only: the TOC's lines beside it load as stored (S11).
      expect(settings.tocLines).toBe('always')
      return settings.sidebarLines
    }

    for (const sidebarLines of TOC_LINES) expect(await loaded(sidebarLines)).toBe(sidebarLines)
    for (const sidebarLines of ['sometimes', 'never', 'Always', '', null, false, 0, ['off']]) expect(await loaded(sidebarLines)).toBe('hover')

    // `state.setSettings` is strict: a write with a value outside the three, or with no `sidebarLines`, is refused as a whole.
    for (const sidebarLines of TOC_LINES) expect(isSettings({ ...DEFAULT_SETTINGS, sidebarLines })).toBe(true)
    for (const sidebarLines of ['sometimes', true, undefined]) expect(isSettings({ ...DEFAULT_SETTINGS, sidebarLines })).toBe(false)
    expect(isSettings(legacySettings)).toBe(false)
    const store = createStore(file)
    store.setSettings({ ...DEFAULT_SETTINGS, sidebarLines: 'off' })
    await store.flush()
    expect((await onDisk()).settings.sidebarLines).toBe('off')
    expect(createStore(file).get().settings.sidebarLines).toBe('off')
  })

  it('folder icons (YAZ-3554 D2, D5): the three words load; an old boolean, a missing key or a bad value loads Plain, with no conversion; another Mac\'s old boolean keeps this Mac\'s choice', () => {
    for (const v of ['plain', 'named', 'off'] as const) expect(sanitizeSettings({ ...DEFAULT_SETTINGS, sidebarFolderIcons: v }).sidebarFolderIcons).toBe(v)
    for (const v of [true, false, 'yes', undefined]) expect(sanitizeSettings({ ...DEFAULT_SETTINGS, sidebarFolderIcons: v }).sidebarFolderIcons).toBe('plain')
    expect(isSettings({ ...DEFAULT_SETTINGS, sidebarFolderIcons: true })).toBe(false)
    expect(mergeFolderSettings({ ...DEFAULT_SETTINGS, sidebarFolderIcons: 'named' }, { sidebarFolderIcons: true }).sidebarFolderIcons).toBe('named')
  })

  it('the sidebar tree\'s look (YAZ-3440): an older file without the keys loads the defaults; a bad value loads its default and fails the channel check; a bad icon colour costs its own entry; another Mac\'s colours replace this Mac\'s as a whole', () => {
    expect([DEFAULT_SETTINGS.sidebarStickyLevels, DEFAULT_SETTINGS.sidebarIconSet, DEFAULT_SETTINGS.sidebarFileIcons, DEFAULT_SETTINGS.sidebarFolderIcons, DEFAULT_SETTINGS.sidebarArrowMotion, DEFAULT_SETTINGS.sidebarIconColors]).toEqual([7, 'material', 'quiet', 'plain', 'instant', {}])
    const { sidebarStickyLevels: _a, sidebarIconSet: _b, sidebarFileIcons: _c, sidebarFolderIcons: _d, sidebarArrowMotion: _e, sidebarIconColors: _f, ...legacy } = DEFAULT_SETTINGS
    expect(sanitizeSettings(legacy)).toEqual(DEFAULT_SETTINGS)
    const good = { sidebarStickyLevels: 3, sidebarIconSet: 'line', sidebarFileIcons: 'grey', sidebarFolderIcons: 'named', sidebarArrowMotion: 'smooth', sidebarIconColors: { pdf: '#112233' } }
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, ...good })).toEqual({ ...DEFAULT_SETTINGS, ...good })
    expect(isSettings({ ...DEFAULT_SETTINGS, ...good })).toBe(true)
    const bad = { sidebarStickyLevels: 4, sidebarIconSet: 'emoji', sidebarFileIcons: 'loud', sidebarFolderIcons: 'yes', sidebarArrowMotion: 'slow' }
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, ...bad })).toEqual(DEFAULT_SETTINGS)
    for (const [key, value] of Object.entries({ ...bad, sidebarIconColors: { note: 'blue' } })) expect(isSettings({ ...DEFAULT_SETTINGS, [key]: value }), key).toBe(false)
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, sidebarIconColors: { note: 'blue', text: '#00aa55', nope: '#000000' } }).sidebarIconColors).toEqual({ text: '#00aa55' })
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, sidebarIconColors: ['#000000'] }).sidebarIconColors).toEqual({})
    const here = { ...DEFAULT_SETTINGS, sidebarIconColors: { pdf: '#112233', image: '#445566' } }
    expect(mergeFolderSettings(here, { sidebarIconColors: { pdf: '#112233' } }).sidebarIconColors).toEqual({ pdf: '#112233' })
    expect(mergeFolderSettings(here, { sidebarIconColors: 'red' }).sidebarIconColors).toEqual(here.sidebarIconColors)
  })

  it('sidebarRevealActive (YAZ-3440 D13): default off; an older file without it loads off; a bad value loads off and fails the channel check; it travels with the settings folder', () => {
    expect(DEFAULT_SETTINGS.sidebarRevealActive).toBe(false)
    const { sidebarRevealActive: _reveal, ...legacy } = DEFAULT_SETTINGS
    expect(sanitizeSettings(legacy).sidebarRevealActive).toBe(false)
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, sidebarRevealActive: true }).sidebarRevealActive).toBe(true)
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, sidebarRevealActive: 'yes' }).sidebarRevealActive).toBe(false)
    expect([isSettings({ ...DEFAULT_SETTINGS, sidebarRevealActive: true }), isSettings({ ...DEFAULT_SETTINGS, sidebarRevealActive: 1 })]).toEqual([true, false])
    expect(mergeFolderSettings(DEFAULT_SETTINGS, { sidebarRevealActive: true }).sidebarRevealActive).toBe(true)
  })

  it('sidebarIconRules (YAZ-3440 D9): an older file without it loads none; a rule that does not read costs itself alone; the channel check takes only rules that all read; it travels whole', () => {
    expect(DEFAULT_SETTINGS.sidebarIconRules).toEqual([])
    const { sidebarIconRules: _rules, ...legacy } = DEFAULT_SETTINGS
    expect(sanitizeSettings(legacy).sidebarIconRules).toEqual([])
    const good = [{ match: '*.gif', kind: 'file', icon: 'image' }, { match: 'src', kind: 'folder', icon: 'folder-src' }]
    const raw = [...good, { match: '', kind: 'file', icon: 'image' }, { match: '*.x', kind: 'note', icon: 'image' }, { match: '*.y', kind: 'file', icon: 'not an id' }, 'nope']
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, sidebarIconRules: raw }).sidebarIconRules).toEqual(good)
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, sidebarIconRules: { a: 1 } }).sidebarIconRules).toEqual([])
    expect(isSettings({ ...DEFAULT_SETTINGS, sidebarIconRules: good })).toBe(true)
    expect(isSettings({ ...DEFAULT_SETTINGS, sidebarIconRules: raw })).toBe(false)
    const here = { ...DEFAULT_SETTINGS, sidebarIconRules: good as typeof DEFAULT_SETTINGS.sidebarIconRules }
    expect(mergeFolderSettings(here, { sidebarIconRules: [good[1]] }).sidebarIconRules).toEqual([good[1]])
    expect(mergeFolderSettings(here, { sidebarIconRules: 'x' }).sidebarIconRules).toEqual(good)
  })

  it("sidebarLineStyle and sidebarThreadColor: an older file without them loads plain lines and the default colour; a bad style loads plain, a bad colour null, and each fails the channel check; good values stay (YAZ-3309 D8, D9)", async () => {
    expect([DEFAULT_SETTINGS.sidebarLineStyle, DEFAULT_SETTINGS.sidebarThreadColor]).toEqual(['plain', null])
    // A yaseendocs.json from before the thread style: the two missing fields get their defaults, and no other field changes.
    const { sidebarLineStyle: _style, sidebarThreadColor: _colour, ...legacySettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: { ...legacySettings, sidebarLines: 'always', threadColor: '#ff0000' } }))
    expect(createStore(file).get().settings).toEqual({ ...DEFAULT_SETTINGS, sidebarLines: 'always', threadColor: '#ff0000' })
    const loaded = async (sidebarLineStyle: unknown, sidebarThreadColor: unknown): Promise<[string, string | null]> => {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, sidebarLines: 'off', sidebarLineStyle, sidebarThreadColor } }))
      const { settings } = createStore(file).get()
      // One bad field costs that field only: Show beside them loads as stored.
      expect(settings.sidebarLines).toBe('off')
      return [settings.sidebarLineStyle, settings.sidebarThreadColor]
    }

    expect(await loaded('thread', '#00aa55')).toEqual(['thread', '#00aa55'])
    expect(await loaded('plain', null)).toEqual(['plain', null])
    for (const style of ['Thread', 'threads', 'bullet', '', null, true, 1]) expect((await loaded(style, null))[0]).toBe('plain')
    for (const colour of ['red', '#fff', '#00aa5', '#00aa55ff', 'accent', '', 0, false]) expect((await loaded('thread', colour))[1]).toBeNull()

    // `state.setSettings` is strict: a value outside the rules, or a write without the field, is refused as a whole.
    for (const sidebarLineStyle of SIDEBAR_LINE_STYLES) expect(isSettings({ ...DEFAULT_SETTINGS, sidebarLineStyle })).toBe(true)
    for (const sidebarLineStyle of ['thread ', true, undefined]) expect(isSettings({ ...DEFAULT_SETTINGS, sidebarLineStyle })).toBe(false)
    for (const sidebarThreadColor of [null, '#00aa55']) expect(isSettings({ ...DEFAULT_SETTINGS, sidebarThreadColor })).toBe(true)
    for (const sidebarThreadColor of ['red', '', undefined]) expect(isSettings({ ...DEFAULT_SETTINGS, sidebarThreadColor })).toBe(false)
    expect(isSettings(legacySettings)).toBe(false)
    const store = createStore(file)
    store.setSettings({ ...DEFAULT_SETTINGS, sidebarLineStyle: 'thread', sidebarThreadColor: '#123abc' })
    await store.flush()
    expect((await onDisk()).settings).toMatchObject({ sidebarLineStyle: 'thread', sidebarThreadColor: '#123abc' })
    expect(createStore(file).get().settings).toMatchObject({ sidebarLineStyle: 'thread', sidebarThreadColor: '#123abc' })
  })

  it('the 1.0.15 heading styles (YAZ-3066 D11): the settings never hold them; a valid map is handed out once, then `{}`; a bad map is `{}`; the next write drops the key from the file', async () => {
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('headingStyles')
    const legacy = { h1: { size: 25 }, h2: { size: 21, underline: true }, h3: { size: 18 }, h4: { size: 15, highlight: 'yellow' } }
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, lineSpacing: 2, headingStyles: legacy } }))
    const store = createStore(file)
    // The settings load as stored, without the retired key. The strict channel check ignores it: it checks only the known keys.
    expect(store.get().settings).toEqual({ ...DEFAULT_SETTINGS, lineSpacing: 2 })
    expect(isSettings({ ...DEFAULT_SETTINGS, headingStyles: legacy })).toBe(true)
    expect(store.takeLegacyHeadingStyles()).toEqual(legacy)
    expect(store.takeLegacyHeadingStyles()).toEqual({})
    // The next write of the state file has no `headingStyles` key.
    store.setSidebarWidth(300)
    await store.flush()
    const disk = await onDisk()
    expect(Object.keys(disk.settings)).not.toContain('headingStyles')
    expect(disk.settings.lineSpacing).toBe(2)
    expect(createStore(file).takeLegacyHeadingStyles()).toEqual({})

    // A map that is not valid as a whole, and a file with no key, give `{}`.
    for (const bad of [{ h1: { size: 30 }, h2: { size: 100 } }, { h7: { size: 20 } }, null, 'big', undefined]) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, headingStyles: bad } }))
      expect(createStore(file).takeLegacyHeadingStyles(), JSON.stringify(bad)).toEqual({})
    }
    // No state file at all.
    await rm(file)
    expect(createStore(file).takeLegacyHeadingStyles()).toEqual({})
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

  it('hoverPreview: a file without the key reads ON, OFF survives, junk falls back to ON (Draw\'s YAZ-1800 D2; YAZ-3044 A20)', async () => {
    const { hoverPreview: _omitted, ...preHoverSettings } = DEFAULT_SETTINGS
    await seed(valid({ settings: preHoverSettings }))
    expect(createStore(file).get().settings).toMatchObject({ hoverPreview: true })
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, hoverPreview: false } }))
    expect(createStore(file).get().settings).toMatchObject({ hoverPreview: false })
    await seed(valid({ settings: { ...DEFAULT_SETTINGS, hoverPreview: 'no' } }))
    expect(createStore(file).get().settings).toMatchObject({ hoverPreview: true })
  })

  it('linkOpen is dropped on load (YAZ-3936): the gestures of Settings › Hotkeys took its place; the rest of the file loads as stored', async () => {
    for (const linkOpen of ['this-tab', 'new-tab', 'background-tab', 'window']) {
      await seed(valid({ settings: { ...DEFAULT_SETTINGS, theme: 'dark', linkOpen } }))
      const settings = createStore(file).get().settings
      expect(settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
      expect('linkOpen' in settings).toBe(false)
    }
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
        windows: [{ id: 'w', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], bounds, sidebarLens: 'favorites', focusTopics: ['/v/T.md'] }],
        folders: { '/v': { lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] }, baseGroups: {}, topicsExpanded: ['/v/Metrics.md'], name: 'Wiki' } },
      }),
    )
    const store = createStore(file)
    expect((await readdir(dir)).filter((n) => n.includes('.corrupt-'))).toEqual([])
    expect(store.get().windows[0]).toEqual(win('w', { root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarLens: 'favorites' }))
    expect(store.get().folders['/v']).toEqual({ expanded: [], lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] }, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: 'Wiki', key: null })
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
    expect(folders['/a']).toEqual({ expanded: [], lastFile: null, folds: { '/a/x.md': ['k'] }, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    expect(folders['/b']).toBeUndefined()
    expect(folders['/c'].expanded).toEqual([]) // a session list: the file's value is ignored (YAZ-1642)
    expect(folders['/c'].lastFile).toBe('/c/a.md')
    expect(folders['/c'].folds['/c/a.md']).toHaveLength(MAX_FOLD_KEYS_PER_FILE)
    expect(folders['/d']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
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
    expect(folders['/b']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    expect(folders['/c'].baseGroups['/c/x.md::T']).toHaveLength(MAX_COLLAPSED_GROUP_KEYS)
  })

  it('folders: a damaged file — a number that is not a whole number 1–9 reads as none, and one number on two vaults stays with the first (YAZ-2555 S21)', async () => {
    await seed(valid({ folders: { '/a': { key: 3 }, '/b': { key: 12 }, '/c': { key: '2' }, '/d': { key: 3 }, '/e': { key: 1.5 }, '/f': { key: 9 }, '/g': {} } }))
    expect(keysOf(createStore(file).get())).toEqual({ '/a': 3, '/b': null, '/c': null, '/d': null, '/e': null, '/f': 9, '/g': null })
  })

  it('an old file\'s window focus — `focusList` (YAZ-2619), `focusDirs` / `focusFavorites` before it — is not read: no migration, the entry holds no focus, and the next write drops the keys (YAZ-2702 Decision 4, S16; YAZ-2619 R1, S32)', async () => {
    await seed(valid({ windows: [{ id: 'w', root: '/v', file: null, tabs: [], bounds, focusList: ['/v/sub', '/v/a.md'], focusDirs: ['/v/sub'], focusFavorites: ['/v/f'] }] }))
    const store = createStore(file)
    expect((await readdir(dir)).filter((n) => n.includes('.corrupt-'))).toEqual([])
    expect(store.get().windows[0]).toEqual(win('w', { root: '/v' }))
    store.setSidebarWidth(321)
    await store.flush()
    const persisted = JSON.parse(await readFile(file, 'utf8')) as { windows: Array<Record<string, unknown>> }
    expect(persisted.windows[0]).not.toHaveProperty('focusList')
    expect(persisted.windows[0]).not.toHaveProperty('focusDirs')
    expect(persisted.windows[0]).not.toHaveProperty('focusFavorites')
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
    expect(store.get().folders['/v']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    expect(store.get().windows[0]).toEqual(win('w1', { root: '/v' }))
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
    expect(store.get().folders['/r1']).toEqual({ expanded: ['/r1/a'], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    store.setFolder('/r1', { lastFile: '/r1/a/x.md' })
    expect(store.get().folders['/r1']).toEqual({ expanded: ['/r1/a'], lastFile: '/r1/a/x.md', folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    store.setFolder('/r1', { lastFile: null, folds: { '/r1/a.md': ['k'] } } as never)
    expect(store.get().folders['/r1']).toEqual({ expanded: ['/r1/a'], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    store.setFolder('/r2', {})
    expect(store.get().folders['/r2']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
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

  it('folders: `tocSources` loads as `{}` from a file written before it; a wrong entry drops alone — a relative path, `auto`, any other value (YAZ-2700 D14)', async () => {
    await seed(valid({ folders: { '/v': { lastFile: '/v/a.md', folds: {}, baseGroups: {}, opens: {}, name: null, key: null } } })) // no key at all
    expect(createStore(file).get().folders['/v'].tocSources).toEqual({})
    for (const junk of ['nope', 5, null, ['/v/a.md']]) {
      await seed(valid({ folders: { '/v': { tocSources: junk } } }))
      expect(createStore(file).get().folders['/v'].tocSources).toEqual({})
    }
    await seed(valid({ folders: { '/v': { tocSources: { '/v/a.md': 'headings', '/v/b.md': 'bullets', '/v/c.md': 'auto', '/v/d.md': 'Headings', '/v/e.md': 3, '/v/f.md': null, 'g.md': 'bullets' } } } }))
    expect(createStore(file).get().folders['/v'].tocSources).toEqual({ '/v/a.md': 'headings', '/v/b.md': 'bullets' })
  })

  it('setTocSource is keyed by root then file; `null` — Auto — removes the entry and is never stored; the same choice again is no commit (YAZ-2700 D14)', async () => {
    const store = createStore(file)
    const seen = vi.fn()
    store.onChange(seen)
    store.setTocSource('/r1', '/r1/a.md', 'bullets')
    store.setTocSource('/r1', '/r1/b.md', 'headings')
    store.setTocSource('/r2', '/r2/a.md', 'headings')
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: { '/r1/a.md': 'bullets', '/r1/b.md': 'headings' }, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    expect(store.get().folders['/r2'].tocSources).toEqual({ '/r2/a.md': 'headings' })
    store.setTocSource('/r1', '/r1/a.md', 'headings') // the choice replaces
    expect(store.get().folders['/r1'].tocSources['/r1/a.md']).toBe('headings')
    expect(seen).toHaveBeenCalledTimes(4)
    store.setTocSource('/r1', '/r1/a.md', 'headings')
    store.setTocSource('/r1', '/r1/never.md', null)
    store.setTocSource('/r3', '/r3/a.md', null) // Auto on a note of a vault with no state: no bucket is made for it
    expect(seen).toHaveBeenCalledTimes(4)
    expect(store.get().folders['/r3']).toBeUndefined()
    store.setTocSource('/r1', '/r1/a.md', null)
    store.setTocSource('/r1', '/r1/b.md', null)
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    // What is written holds no `auto` and no `null`: only the notes with a choice.
    await store.flush()
    expect((await onDisk()).folders).toEqual({ '/r1': { lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null }, '/r2': { lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: { '/r2/a.md': 'headings' }, sectionIndents: {}, tocSwitches: {}, name: null, key: null } })
    expect(createStore(file).get().folders['/r2'].tocSources).toEqual({ '/r2/a.md': 'headings' })
  })

  it('folders: `sectionIndents` loads as `{}` from a file written before it; `true` and `false` both load; a wrong entry drops alone — a relative path, a value that is not a boolean (YAZ-2709 D2)', async () => {
    await seed(valid({ folders: { '/v': { lastFile: '/v/a.md', folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, name: null, key: null } } })) // a file of YAZ-2700: no key at all
    expect(createStore(file).get().folders['/v'].sectionIndents).toEqual({})
    for (const junk of ['nope', 5, null, true, ['/v/a.md']]) {
      await seed(valid({ folders: { '/v': { sectionIndents: junk } } }))
      expect(createStore(file).get().folders['/v'].sectionIndents).toEqual({})
    }
    await seed(valid({ folders: { '/v': { sectionIndents: { '/v/a.md': true, '/v/b.md': false, '/v/c.md': 1, '/v/d.md': 'true', '/v/e.md': null, '/v/f.md': 0, 'g.md': true } } } }))
    expect(createStore(file).get().folders['/v'].sectionIndents).toEqual({ '/v/a.md': true, '/v/b.md': false })
  })

  it('setSectionIndent is keyed by root then file; on AND off are stored, and off never removes the entry; the same value again is no commit; both come back from the file (YAZ-2709 D2)', async () => {
    const store = createStore(file)
    const seen = vi.fn()
    store.onChange(seen)
    store.setSectionIndent('/r1', '/r1/a.md', true)
    store.setSectionIndent('/r1', '/r1/b.md', true)
    store.setSectionIndent('/r2', '/r2/a.md', true)
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: { '/r1/a.md': true, '/r1/b.md': true }, tocSwitches: {}, name: null, key: null })
    store.setSectionIndent('/r1', '/r1/a.md', false) // off is a value of its own: the entry stays, unlike Auto in `tocSources`
    expect(store.get().folders['/r1'].sectionIndents).toEqual({ '/r1/a.md': false, '/r1/b.md': true })
    expect(seen).toHaveBeenCalledTimes(4)
    store.setSectionIndent('/r1', '/r1/a.md', false)
    store.setSectionIndent('/r1', '/r1/b.md', true)
    expect(seen).toHaveBeenCalledTimes(4)
    // Off on a note that was never touched is a choice too: it is written.
    store.setSectionIndent('/r1', '/r1/c.md', false)
    expect(seen).toHaveBeenCalledTimes(5)
    await store.flush()
    expect((await onDisk()).folders['/r1'].sectionIndents).toEqual({ '/r1/a.md': false, '/r1/b.md': true, '/r1/c.md': false })
    const again = createStore(file).get().folders
    expect(again['/r1'].sectionIndents).toEqual({ '/r1/a.md': false, '/r1/b.md': true, '/r1/c.md': false })
    expect(again['/r2'].sectionIndents).toEqual({ '/r2/a.md': true })
  })

  it('folders: `tocSwitches` loads as `{}` from a file written before it; `true` and `false` both load; a wrong entry drops alone (YAZ-2950)', async () => {
    await seed(valid({ folders: { '/v': { lastFile: '/v/a.md', folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, name: null, key: null } } })) // a file of YAZ-2709: no key at all
    expect(createStore(file).get().folders['/v'].tocSwitches).toEqual({})
    for (const junk of ['nope', 5, null, true, ['/v/a.md']]) {
      await seed(valid({ folders: { '/v': { tocSwitches: junk } } }))
      expect(createStore(file).get().folders['/v'].tocSwitches).toEqual({})
    }
    await seed(valid({ folders: { '/v': { tocSwitches: { '/v/a.md': false, '/v/b.md': true, '/v/c.md': 0, '/v/d.md': 'false', '/v/e.md': null, 'f.md': false } } } }))
    expect(createStore(file).get().folders['/v'].tocSwitches).toEqual({ '/v/a.md': false, '/v/b.md': true })
  })

  it('setTocSwitch is keyed by root then file; on AND off are stored, and on never removes the entry; the same value again is no commit; both come back from the file (YAZ-2950)', async () => {
    const store = createStore(file)
    const seen = vi.fn()
    store.onChange(seen)
    store.setTocSwitch('/r1', '/r1/a.md', false)
    store.setTocSwitch('/r2', '/r2/a.md', false)
    expect(store.get().folders['/r1'].tocSwitches).toEqual({ '/r1/a.md': false })
    store.setTocSwitch('/r1', '/r1/a.md', true) // on again is a value of its own: the entry stays
    expect(store.get().folders['/r1'].tocSwitches).toEqual({ '/r1/a.md': true })
    expect(seen).toHaveBeenCalledTimes(3)
    store.setTocSwitch('/r1', '/r1/a.md', true)
    expect(seen).toHaveBeenCalledTimes(3)
    // The other saved switch is untouched.
    expect(store.get().folders['/r1'].sectionIndents).toEqual({})
    await store.flush()
    expect((await onDisk()).folders['/r1'].tocSwitches).toEqual({ '/r1/a.md': true })
    const again = createStore(file).get().folders
    expect(again['/r1'].tocSwitches).toEqual({ '/r1/a.md': true })
    expect(again['/r2'].tocSwitches).toEqual({ '/r2/a.md': false })
  })

  it('setFolds is keyed by root then file, capped, and an empty list removes the file entry but keeps the folder', () => {
    const store = createStore(file)
    store.setFolds('/r1', '/r1/a.md', ['k1', 'k2'])
    store.setFolds('/r1', '/r1/b.md', ['k3'])
    store.setFolds('/r2', '/r2/a.md', ['k4'])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: { '/r1/a.md': ['k1', 'k2'], '/r1/b.md': ['k3'] }, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    store.setFolds('/r1', '/r1/a.md', ['k2']) // the live set replaces, never merges
    expect(store.get().folders['/r1'].folds['/r1/a.md']).toEqual(['k2'])
    store.setFolder('/r1', { lastFile: '/r1/a.md' })
    store.setFolds('/r1', '/r1/a.md', [])
    store.setFolds('/r1', '/r1/b.md', [])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: '/r1/a.md', folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    store.setFolds('/r2', '/r2/a.md', Array.from({ length: MAX_FOLD_KEYS_PER_FILE + 50 }, (_, i) => `k${i}`))
    expect(store.get().folders['/r2'].folds['/r2/a.md']).toHaveLength(MAX_FOLD_KEYS_PER_FILE)
  })

  it('setBaseGroups is keyed by root then base::view, capped, and an empty list removes the entry but keeps the folder', () => {
    const store = createStore(file)
    store.setBaseGroups('/r1', '/r1/a.md::T', ['v:idea', 'v:done'])
    store.setBaseGroups('/r1', '/r1/a.md::T 2', ['∅'])
    store.setBaseGroups('/r2', '/r2/a.md::T', ['v:x'])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: { '/r1/a.md::T': ['v:idea', 'v:done'], '/r1/a.md::T 2': ['∅'] }, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    store.setBaseGroups('/r1', '/r1/a.md::T', ['v:done']) // the live set replaces, never merges
    expect(store.get().folders['/r1'].baseGroups['/r1/a.md::T']).toEqual(['v:done'])
    store.setBaseGroups('/r1', '/r1/a.md::T', [])
    store.setBaseGroups('/r1', '/r1/a.md::T 2', [])
    expect(store.get().folders['/r1']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
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

  it('removeWindow takes several ids and drops them in ONE commit; none that match is no commit (YAZ-2589 D3)', () => {
    const store = createStore(file)
    for (const id of ['w1', 'w2', 'w3']) store.upsertWindow(win(id))
    let commits = 0
    store.onChange(() => commits++)
    store.removeWindow('w1', 'w3', 'nope')
    expect(store.get().windows).toEqual([win('w2')])
    expect(commits).toBe(1)
    store.removeWindow()
    store.removeWindow('nope', 'w1')
    expect(commits).toBe(1)
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

    it('the table of contents source follows its renamed note, and no other note\'s moves (YAZ-2700 D14)', () => {
      const store = createStore(file)
      store.setTocSource('/v', OLD, 'bullets')
      store.setTocSource('/v', '/v/x.md', 'headings')
      store.renamePath(OLD, NEW)
      expect(store.get().folders['/v'].tocSources).toEqual({ [NEW]: 'bullets', '/v/x.md': 'headings' })
    })

    it('the section indent switch follows its renamed note, on or off, and no other note\'s moves (YAZ-2709 D2)', () => {
      const store = createStore(file)
      store.setSectionIndent('/v', OLD, true)
      store.setSectionIndent('/v', '/v/x.md', false)
      store.renamePath(OLD, NEW)
      expect(store.get().folders['/v'].sectionIndents).toEqual({ [NEW]: true, '/v/x.md': false })
    })

    it('the table of contents switch follows its renamed note, on or off, and no other note\'s moves (YAZ-2950)', () => {
      const store = createStore(file)
      store.setTocSwitch('/v', OLD, false)
      store.setTocSwitch('/v', '/v/x.md', true)
      store.renamePath(OLD, NEW)
      expect(store.get().folders['/v'].tocSwitches).toEqual({ [NEW]: false, '/v/x.md': true })
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
      store.setTocSource('/v', GONE, 'bullets')
      store.setTocSource('/v', '/v/x.md', 'headings')
      store.setSectionIndent('/v', GONE, true)
      store.setSectionIndent('/v', '/v/x.md', false)
      store.setTocSwitch('/v', GONE, false)
      store.setTocSwitch('/v', '/v/x.md', false)
      store.removePath(GONE)
      expect(store.get().folders['/v'].lastFile).toBeNull()
      expect(store.get().folders['/v'].folds).toEqual({ '/v/x.md': ['k2'] })
      // The source goes with its note (YAZ-2700 D14); another note's stays.
      expect(store.get().folders['/v'].tocSources).toEqual({ '/v/x.md': 'headings' })
      // And so does the section indent switch (YAZ-2709 D2): a deleted note leaves no entry, another note's stays, off as it was.
      expect(store.get().folders['/v'].sectionIndents).toEqual({ '/v/x.md': false })
      // And the table of contents switch (YAZ-2950), on the same terms.
      expect(store.get().folders['/v'].tocSwitches).toEqual({ '/v/x.md': false })
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

    it('remaps folder state under the dir: lastFile, expanded dirs, fold keys, baseGroups keys — and the folder-state KEY of a root at/under it', () => {
      const store = createStore(file)
      store.setFolder('/v', { lastFile: `${OLD}/a.md`, expanded: [OLD, `${OLD}/deep`, '/v/other'] })
      store.setFolds('/v', `${OLD}/a.md`, ['k1'])
      store.setFolds('/v', '/v/x.md', ['k2'])
      store.setBaseGroups('/v', `${OLD}/T.md::Table`, ['g1'])
      store.setTocSource('/v', `${OLD}/a.md`, 'headings')
      store.setTocSource('/v', '/v/x.md', 'bullets')
      store.setSectionIndent('/v', `${OLD}/a.md`, true)
      store.setSectionIndent('/v', '/v/x.md', false)
      store.setTocSwitch('/v', `${OLD}/a.md`, false)
      store.setTocSwitch('/v', '/v/x.md', true)
      store.setFolder(OLD, { lastFile: `${OLD}/a.md` }) // the subfolder's own folder-state entry (it was opened as a root)
      store.renamePath(OLD, NEW)
      expect(store.get().folders['/v']).toEqual({
        lastFile: `${NEW}/a.md`,
        expanded: [NEW, `${NEW}/deep`, '/v/other'],
        folds: { [`${NEW}/a.md`]: ['k1'], '/v/x.md': ['k2'] },
        baseGroups: { [`${NEW}/T.md::Table`]: ['g1'] },
        opens: {},
        edits: {},
        closed: {},
        tocSources: { [`${NEW}/a.md`]: 'headings', '/v/x.md': 'bullets' },
        sectionIndents: { [`${NEW}/a.md`]: true, '/v/x.md': false },
        tocSwitches: { [`${NEW}/a.md`]: false, '/v/x.md': true },
        name: null,
        key: null,
      })
      expect(store.get().folders[OLD]).toBeUndefined()
      expect(store.get().folders[NEW]).toEqual({ lastFile: `${NEW}/a.md`, expanded: [], folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
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

    it('a copy fold key of Focus or Favorites (YAZ-3131 S7, S8): a rename moves each half on its own; a delete drops the key when either half goes', () => {
      const store = createStore(file)
      const key = (top: string, path: string) => copyFoldKey(top, path)
      store.setFolder('/v', { expanded: [`${OLD}/deep`, key(OLD, OLD), key(OLD, `${OLD}/deep`), key(`${OLD}/deep`, `${OLD}/deep/sub`), key('/v/x', '/v/x/y')] })
      store.renamePath(OLD, NEW)
      expect(store.get().folders['/v'].expanded).toEqual([`${NEW}/deep`, key(NEW, NEW), key(NEW, `${NEW}/deep`), key(`${NEW}/deep`, `${NEW}/deep/sub`), key('/v/x', '/v/x/y')])
      // A rename BELOW the top moves the path half alone.
      store.renamePath(`${NEW}/deep`, `${NEW}/inner`)
      expect(store.get().folders['/v'].expanded).toEqual([`${NEW}/inner`, key(NEW, NEW), key(NEW, `${NEW}/inner`), key(`${NEW}/inner`, `${NEW}/inner/sub`), key('/v/x', '/v/x/y')])
      // A delete below the top drops the keys whose path half went; the top's own key stays.
      store.removePath(`${NEW}/inner`)
      expect(store.get().folders['/v'].expanded).toEqual([key(NEW, NEW), key('/v/x', '/v/x/y')])
      store.removePath(NEW)
      expect(store.get().folders['/v'].expanded).toEqual([key('/v/x', '/v/x/y')])
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

describe('the tab strip: copies, display names and the active copy (YAZ-3057 D1, D2)', () => {
  const A = '/v/a.md'
  const B = '/v/b.md'
  /** Two copies of A — the first named, the second on show — and B. */
  const strip = [{ path: A, name: 'Draft' }, { path: A, active: true as const }, { path: B }]

  describe('normalizeTabStrip', () => {
    it('keeps a strip whose paths, each once and in order, are `tabs`', () => {
      expect(normalizeTabStrip(strip, [A, B], A)).toEqual(strip)
      expect(normalizeTabStrip(undefined, [A, B], A)).toBeUndefined()
    })

    it('drops a tab that is no longer open; drops the whole strip when it still disagrees with `tabs` (S26)', () => {
      expect(normalizeTabStrip([...strip, { path: '/v/gone.md', name: 'Gone' }], [A, B], A)).toEqual(strip)
      expect(normalizeTabStrip(strip, [B, A], A)).toBeUndefined() // another order
      expect(normalizeTabStrip(strip, [A, B, '/v/c.md'], A)).toBeUndefined() // a tab the strip does not have
    })

    it('keeps nothing for a strip with no copy and no name (S23): the window stores what it always did', () => {
      expect(normalizeTabStrip([{ path: A, active: true }, { path: B }], [A, B], A)).toBeUndefined()
      expect(normalizeTabStrip([{ path: A, name: 'Solo' }, { path: B }], [A, B], A)).toEqual([{ path: A, name: 'Solo' }, { path: B }])
    })

    it('keeps the active mark on ONE copy of `file` only (D4)', () => {
      const marked = [{ path: A, active: true as const }, { path: A, active: true as const }, { path: B, active: true as const }]
      expect(normalizeTabStrip(marked, [A, B], A)).toEqual([{ path: A, active: true }, { path: A }, { path: B }])
      expect(normalizeTabStrip(strip, [A, B], B)).toEqual([{ path: A, name: 'Draft' }, { path: A }, { path: B }])
    })
  })

  it('loads a stored strip; junk elements drop, a name is cleaned like a vault name, and a strip that disagrees drops whole (S24, S26)', async () => {
    const junk = [{ path: A, name: `  ${'n'.repeat(MAX_VAULT_NAME + 3)} ` }, 5, { path: 'rel.md' }, null, { path: A, active: true }, { path: B, name: 7 }]
    await seed(valid({ windows: [win('w1', { root: '/v', file: A, tabs: [A, B], tabStrip: junk as never }), win('w2', { root: '/v', file: A, tabs: [A, B], tabStrip: [{ path: B }, { path: A }, { path: A }] })] }))
    const [one, two] = createStore(file).get().windows
    expect(one.tabStrip).toEqual([{ path: A, name: 'n'.repeat(MAX_VAULT_NAME) }, { path: A, active: true }, { path: B }])
    expect(two).not.toHaveProperty('tabStrip')
    expect(two.tabs).toEqual([A, B])
  })

  it('keeps each tab\'s zoom key (YAZ-3646 D14): a strip with only a zoom is kept; a junk key drops, and the tab stays', async () => {
    expect(normalizeTabStrip([{ path: A, zoom: 'k1:0' }, { path: B }], [A, B], A)).toEqual([{ path: A, zoom: 'k1:0' }, { path: B }])
    const zoomed = [{ path: A, zoom: 'k1:0', active: true }, { path: A, zoom: 'not a key' }, { path: B, zoom: 7 }]
    await seed(valid({ windows: [win('w1', { root: '/v', file: A, tabs: [A, B], tabStrip: zoomed as never })] }))
    expect(createStore(file).get().windows[0].tabStrip).toEqual([{ path: A, zoom: 'k1:0', active: true }, { path: A }, { path: B }])
  })

  it('a window without a strip (an older build\'s file) opens its tabs as before (S24)', async () => {
    await seed(valid({ windows: [win('w1', { root: '/v', file: A, tabs: [A, B] })] }))
    expect(createStore(file).get().windows[0]).toEqual(win('w1', { root: '/v', file: A, tabs: [A, B] }))
  })

  it('survives a real flush and reload: the restart brings back the copies, the names and the active copy (S1 to S4)', async () => {
    const store = createStore(file)
    store.upsertWindow(win('w1', { root: '/v', file: A, tabs: [A, B], tabStrip: strip }))
    await store.flush()
    expect(createStore(file).get().windows).toEqual([win('w1', { root: '/v', file: A, tabs: [A, B], tabStrip: strip })])
  })

  it('a vault switch empties the tabs, and the strip goes with them (S17)', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1', { root: '/v', file: A, tabs: [A, B], tabStrip: strip }))
    store.upsertWindow({ ...store.get().windows[0], root: '/w', roots: ['/w'], file: null, tabs: [] })
    expect(store.get().windows[0]).not.toHaveProperty('tabStrip')
  })

  it('renamePath: every copy and its name follow the file, and a folder rename moves them too (S8, S9)', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1', { root: '/v', file: A, tabs: [A, B], tabStrip: strip }))
    store.renamePath(A, '/v/z.md')
    expect(store.get().windows[0].tabStrip).toEqual([{ path: '/v/z.md', name: 'Draft' }, { path: '/v/z.md', active: true }, { path: B }])
    store.renamePath('/v', '/n')
    expect(store.get().windows[0].tabStrip).toEqual([{ path: '/n/z.md', name: 'Draft' }, { path: '/n/z.md', active: true }, { path: '/n/b.md' }])
  })

  it('removePath: the deleted file\'s copies leave, the other tabs keep their names; the active mark goes with its copy (S10, S11)', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1', { root: '/v', file: A, tabs: [A, B], tabStrip: [...strip, { path: B, name: 'Bee' }] }))
    store.removePath(A)
    expect(store.get().windows[0]).toMatchObject({ file: B, tabs: [B], tabStrip: [{ path: B }, { path: B, name: 'Bee' }] })
    store.upsertWindow(win('w2', { root: '/v', file: B, tabs: [B], tabStrip: [{ path: B, name: 'Solo' }] }))
    store.removePath(B)
    expect(store.get().windows[1]).not.toHaveProperty('tabStrip')
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

  it('restores the Focus tab of a window after a real flush and reload; the focus LIST is the vault\'s, so the file holds none (YAZ-2619 S24, YAZ-2702 Decision 1)', async () => {
    const store = createStore(file)
    store.upsertWindow(win('w1', { root: '/v', sidebarLens: 'focus' }))
    store.upsertWindow(win('w2', { root: '/v' }))
    await store.flush()
    expect(createStore(file).get().windows).toEqual([win('w1', { root: '/v', sidebarLens: 'focus' }), win('w2', { root: '/v' })])
    expect(await readFile(file, 'utf8')).not.toContain('focusList')
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
    expect(await onDisk()).toEqual({ ...store.get(), folders: { '/v': { lastFile: null, folds: { '/v/a.md': ['k1'] }, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null } } })
    expect((await readdir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('the session list lives in get() for every window but never reaches disk, so a relaunch starts collapsed (YAZ-1642)', async () => {
    const store = createStore(file)
    store.setFolder('/v', { expanded: ['/v/sub'] })
    expect(store.get().folders['/v']).toEqual({ expanded: ['/v/sub'], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    await store.flush()
    expect((await onDisk()).folders['/v']).toEqual({ lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    expect(createStore(file).get().folders['/v']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
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

// The two orders across vaults have ONE rule and one merge function (YAZ-2702 Decision 3): each test runs for the two.
describe.each([
  ['favoritesOrder', 'setFavoritesOrder'],
  ['focusOrder', 'setFocusOrder'],
] as const)('%s: an order across vaults (YAZ-2631 D1; the focus order by the same rule, YAZ-2702 Decision 3)', (key, setter) => {
  /** A store that counts its commits: each one is a `state:changed`. */
  const counted = () => {
    const store = createStore(file)
    const seen: AppState[] = []
    store.onChange((s) => seen.push(s))
    return { store, seen }
  }
  const [a1, a2, b1, b2, c1, c2] = ['/v/a/1.md', '/v/a/2.md', '/v/b/1.md', '/v/b/2.md', '/v/c/1.md', '/v/c/2.md']

  it('loads: a file without the key, or a junk list, is []; a relative element drops; a long list is cut to the first MAX_FAVORITES_ORDER (R7)', async () => {
    const { [key]: _omitted, ...before } = valid({ recents: [{ path: '/v', lastOpened: 5 }] })
    await seed(before)
    expect(createStore(file).get()).toEqual({ ...defaultAppState(), recents: [{ path: '/v', lastOpened: 5 }] })
    for (const junk of ['nope', { a: 1 }, 5, null, [a1, 5]]) {
      await seed(valid({ [key]: junk }))
      expect(createStore(file).get()[key]).toEqual([])
    }
    await seed(valid({ [key]: [a1, 'rel/x.md', b1, ''] }))
    expect(createStore(file).get()[key]).toEqual([a1, b1])
    const long = Array.from({ length: MAX_FAVORITES_ORDER + 5 }, (_, i) => `/v/a/n${i}.md`)
    await seed(valid({ [key]: long }))
    expect(createStore(file).get()[key]).toEqual(long.slice(0, MAX_FAVORITES_ORDER))
  })

  it('the mutator merges: the entries of the window\'s vaults take the new order in the places they held, an entry of a vault the window does not show keeps its place, and a path with no place goes last; the same order is no commit; the list is cut at MAX_FAVORITES_ORDER, and it is there after a relaunch (R1, R5, R7, S13)', async () => {
    const { store, seen } = counted()
    store[setter](['/v/a', '/v/b'], [a1, b1, a2])
    expect(store.get()[key]).toEqual([a1, b1, a2])
    expect(seen).toHaveLength(1)
    // A window on A and C: C's favorites are new, so they go last. B's entry keeps its place.
    store[setter](['/v/a', '/v/c/'], [c1, a2, a1, c2])
    expect(store.get()[key]).toEqual([c1, b1, a2, a1, c2])
    // The window on A and B again: its three entries take their new order in the three places they held (S13).
    store[setter](['/v/a', '/v/b'], [b1, a1, a2])
    expect(store.get()[key]).toEqual([c1, b1, a1, a2, c2])
    // A favorite the window no longer has leaves; one it gained goes last.
    store[setter](['/v/a', '/v/b'], [b2, a2, b1])
    expect(store.get()[key]).toEqual([c1, b2, a2, c2, b1])
    expect(seen).toHaveLength(4)
    // What is stored already: no commit, so no broadcast and no write.
    store[setter](['/v/a', '/v/b'], [b2, a2, b1])
    store[setter](['/v/x'], [])
    expect(seen).toHaveLength(4)
    // A path given twice has one place.
    store[setter](['/v/a', '/v/b'], [a2, b2, a2, b1])
    expect(store.get()[key]).toEqual([c1, a2, b2, c2, b1])

    await store.flush()
    expect((await onDisk())[key]).toEqual([c1, a2, b2, c2, b1])
    expect(createStore(file).get()[key]).toEqual([c1, a2, b2, c2, b1])

    const long = Array.from({ length: MAX_FAVORITES_ORDER + 5 }, (_, i) => `/v/a/n${i}.md`)
    store[setter](['/v/a'], long)
    expect(store.get()[key]).toEqual([c1, b2, c2, b1, ...long].slice(0, MAX_FAVORITES_ORDER))
  })

  it('renamePath moves a renamed favorite in its place, a file as a folder with what is under it; removePath drops a deleted one; each is ONE commit also when the order alone holds the path, and none when it does not (R6, S10, S11)', () => {
    const { store, seen } = counted()
    store[setter](['/v/a', '/v/b'], [a1, '/v/b/docs', a2, '/v/b/docs/d.md', '/v/b/docs2'])
    seen.length = 0
    store.renamePath(a1, '/v/a/sub/one.md')
    expect(store.get()[key]).toEqual(['/v/a/sub/one.md', '/v/b/docs', a2, '/v/b/docs/d.md', '/v/b/docs2'])
    store.renamePath('/v/b/docs', '/v/b/papers')
    expect(store.get()[key]).toEqual(['/v/a/sub/one.md', '/v/b/papers', a2, '/v/b/papers/d.md', '/v/b/docs2'])
    expect(seen).toHaveLength(2)
    store.renamePath('/v/a/other.md', '/v/a/else.md')
    expect(seen).toHaveLength(2)

    store.removePath(a2)
    expect(store.get()[key]).toEqual(['/v/a/sub/one.md', '/v/b/papers', '/v/b/papers/d.md', '/v/b/docs2'])
    store.removePath('/v/b/papers')
    expect(store.get()[key]).toEqual(['/v/a/sub/one.md', '/v/b/docs2'])
    expect(seen).toHaveLength(4)
    store.removePath('/v/a/other.md')
    expect(seen).toHaveLength(4)
  })
})

describe('sessions (YAZ-3147 D1, D2)', () => {
  const counted = () => {
    const store = createStore(file)
    const seen: AppState[] = []
    store.onChange((s) => seen.push(s))
    return { store, seen }
  }
  const A = '/v/a.md'
  const B = '/v/b.md'
  const W = '/w/c.md'

  it('loads with the windows\' rule: a bad entry drops alone, tabs are read as a strip and cut at MAX_SESSION_TABS, one active mark, only the vaults that hold a tab, at most MAX_SESSIONS; a file without the key is []', async () => {
    await seed(valid({ sessions: undefined }))
    expect(createStore(file).get().sessions).toEqual([])
    await seed(valid({ sessions: 'junk' }))
    expect(createStore(file).get().sessions).toEqual([])
    const many = Array.from({ length: MAX_SESSION_TABS + 5 }, (_, i) => ({ path: `/v/${i}.md` }))
    await seed(valid({
      sessions: [
        { id: 'good', name: '  Work  ', tabs: [{ path: A, active: true }, { path: 'relative.md' }, 5, { path: W, name: '  Mine ', active: true }], roots: ['/v/', '/w', '/x', 'rel'], lastUsed: 'soon' },
        { id: 'good', name: 'Twice', tabs: [], roots: [], lastUsed: 1 }, // the same id again
        { id: 7, name: 'No id', tabs: [], roots: [], lastUsed: 1 },
        { id: 'blank', name: '   ', tabs: [], roots: [], lastUsed: 1 },
        { id: 'empty', name: 'Empty', tabs: 'none', roots: 'none', lastUsed: 3 }, // S31: no tab is a good session
        { id: 'many', name: 'Many', tabs: many, roots: ['/v'], lastUsed: 4 },
        null,
      ],
    }))
    expect(createStore(file).get().sessions).toEqual([
      { id: 'good', name: 'Work', tabs: [{ path: A, active: true }, { path: W, name: 'Mine' }], roots: ['/v', '/w'], lastUsed: 0 },
      { id: 'empty', name: 'Empty', tabs: [], roots: [], lastUsed: 3 },
      { id: 'many', name: 'Many', tabs: many.slice(0, MAX_SESSION_TABS), roots: ['/v'], lastUsed: 4 },
    ])
    await seed(valid({ sessions: Array.from({ length: MAX_SESSIONS + 3 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, tabs: [], roots: [], lastUsed: i })) }))
    expect(createStore(file).get().sessions).toHaveLength(MAX_SESSIONS)
  })

  it('saveSession: a new session at the front with the vaults that hold its tabs (S6); copies and names kept (S5); names may repeat (S10); cut at 40 tabs (S8); a copy of the list, stored per machine', async () => {
    const { store, seen } = counted()
    const tabs: StoredTab[] = [{ path: A }, { path: A, name: 'Second', active: true }, { path: W }]
    const work = store.saveSession('  Work  ', tabs, ['/v', '/x', '/w/'], undefined, 10) as Session
    expect(work).toEqual({ id: expect.any(String), name: 'Work', tabs: [{ path: A }, { path: A, name: 'Second', active: true }, { path: W }], roots: ['/v', '/w'], lastUsed: 10 })
    tabs.push({ path: B })
    expect(store.get().sessions[0].tabs).toHaveLength(3)
    const twin = store.saveSession('Work', [{ path: B }], ['/v'], undefined, 20) as Session
    expect(twin.id).not.toBe(work.id)
    expect(store.get().sessions.map((s) => s.id)).toEqual([twin.id, work.id])
    expect(seen).toHaveLength(2)
    // The most specific vault holds a tab: a vault inside another keeps only the tabs below it.
    expect(store.saveSession('Nested', [{ path: '/v/sub/x.md' }], ['/v', '/v/sub'], undefined, 25)?.roots).toEqual(['/v/sub'])
    const many = Array.from({ length: MAX_SESSION_TABS + 5 }, (_, i) => ({ path: `/v/${i}.md` }))
    expect(store.saveSession('Many', many, ['/v'], undefined, 30)?.tabs).toEqual(many.slice(0, MAX_SESSION_TABS))

    await store.flush()
    expect((await onDisk()).sessions).toEqual(store.get().sessions)
    expect(createStore(file).get().sessions).toEqual(store.get().sessions)
  })

  it('saveSession with replaceId ("Update with open tabs", S28): the id and the name stay, the tabs and vaults are new, it moves to the front; refused with null and no commit — no tab (S29), an empty name, an unknown id, or a NEW session when 30 exist (S7)', () => {
    const { store, seen } = counted()
    const old = store.saveSession('Old', [{ path: A }], ['/v'], undefined, 1) as Session
    const other = store.saveSession('Other', [{ path: B }], ['/v'], undefined, 2) as Session
    seen.length = 0
    expect(store.saveSession('Ignored', [{ path: W, active: true }], ['/v', '/w'], old.id, 3)).toEqual({ id: old.id, name: 'Old', tabs: [{ path: W, active: true }], roots: ['/w'], lastUsed: 3 })
    expect(store.get().sessions.map((s) => s.id)).toEqual([old.id, other.id])
    expect(seen).toHaveLength(1)

    const before = store.get()
    expect(store.saveSession('Old', [], ['/v'], old.id, 4)).toBeNull() // S29
    expect(store.saveSession('None', [{ path: 'rel.md' }], ['/v'], undefined, 4)).toBeNull()
    expect(store.saveSession('   ', [{ path: A }], ['/v'], undefined, 4)).toBeNull()
    expect(store.saveSession('X', [{ path: A }], ['/v'], 'nope', 4)).toBeNull()
    expect(store.get()).toBe(before)

    for (let i = 2; i < MAX_SESSIONS; i++) expect(store.saveSession(`S${i}`, [{ path: A }], ['/v'], undefined, 10 + i)).not.toBeNull()
    expect(store.get().sessions).toHaveLength(MAX_SESSIONS)
    const full = store.get()
    expect(store.saveSession('The 31st', [{ path: A }], ['/v'], undefined, 99)).toBeNull()
    expect(store.get()).toBe(full)
    // An update at the cap still saves (S7).
    expect(store.saveSession('', [{ path: B }], ['/v'], other.id, 100)?.id).toBe(other.id)
    expect(store.get().sessions).toHaveLength(MAX_SESSIONS)
    expect(store.get().sessions[0].id).toBe(other.id)
  })

  it('renameSession, setSessionTabs, removeSession, touchSession: one commit each; refusals and unknown ids change nothing', () => {
    const { store, seen } = counted()
    const a = store.saveSession('A', [{ path: A, active: true }, { path: W }], ['/v', '/w'], undefined, 1) as Session
    const b = store.saveSession('B', [{ path: B }], ['/v'], undefined, 2) as Session
    seen.length = 0

    expect(store.renameSession(a.id, '  Alpha  ')).toBe(true)
    expect(store.renameSession(a.id, 'B')).toBe(true) // S10: a name another session has is good
    expect(store.renameSession(a.id, '   ')).toBe(false) // S13
    expect(store.renameSession('nope', 'New')).toBe(false)
    expect(store.renameSession(a.id, 'x'.repeat(MAX_VAULT_NAME + 5))).toBe(true) // S15: cut at 80
    expect(store.get().sessions[1].name).toBe('x'.repeat(MAX_VAULT_NAME))
    expect(store.renameSession(a.id, 'x'.repeat(MAX_VAULT_NAME))).toBe(true) // its own name: nothing to write
    expect(seen).toHaveLength(3)

    // Remove from session (S30, S31): the place in the list stays; the vault with no tab left goes; no tab left is still a session.
    seen.length = 0
    expect(store.setSessionTabs(a.id, [{ path: A, active: true }])).toBe(true)
    expect(store.get().sessions[1]).toMatchObject({ id: a.id, tabs: [{ path: A, active: true }], roots: ['/v'], lastUsed: 1 })
    expect(store.setSessionTabs(a.id, [])).toBe(true)
    expect(store.get().sessions[1]).toMatchObject({ id: a.id, tabs: [], roots: [] })
    expect(store.setSessionTabs('nope', [])).toBe(false)
    expect(seen).toHaveLength(2)

    store.touchSession(a.id, 50) // S26
    expect(store.get().sessions.map((s) => [s.id, s.lastUsed])).toEqual([[a.id, 50], [b.id, 2]])
    store.touchSession(a.id, 50)
    store.touchSession('nope', 60)
    expect(seen).toHaveLength(3)

    store.upsertWindow(win('w1', { root: '/v', file: B, tabs: [B] }))
    seen.length = 0
    const windows = store.get().windows
    store.removeSession(b.id) // S32
    expect(store.get().sessions.map((s) => s.id)).toEqual([a.id])
    expect(store.get().windows).toBe(windows)
    store.removeSession('nope')
    expect(seen).toHaveLength(1)
  })

  it('repair (S34): a rename in the app moves each session\'s tabs, names and vaults; a delete drops the tabs and a vault with no tab left; a session with no tab stays; nothing else is one commit', () => {
    const { store, seen } = counted()
    const s1 = store.saveSession('One', [{ path: A, name: 'Named', active: true }, { path: A }, { path: '/v/sub/d.md' }, { path: W }], ['/v', '/w'], undefined, 1) as Session
    const s2 = store.saveSession('Two', [{ path: W }], ['/w'], undefined, 2) as Session
    seen.length = 0

    store.renamePath(A, '/v/z.md')
    expect(store.get().sessions[1].tabs).toEqual([{ path: '/v/z.md', name: 'Named', active: true }, { path: '/v/z.md' }, { path: '/v/sub/d.md' }, { path: W }])
    store.renamePath('/v/sub', '/v/moved')
    expect(store.get().sessions[1].tabs[2]).toEqual({ path: '/v/moved/d.md' })
    // A vault folder renamed in another window: the session's vault follows.
    store.renamePath('/w', '/w2')
    expect(store.get().sessions.map((s) => s.roots)).toEqual([['/w2'], ['/v', '/w2']])
    expect(seen).toHaveLength(3)
    store.renamePath('/nothing', '/else')
    expect(seen).toHaveLength(3)

    store.removePath('/v/z.md') // both copies go, and the active mark with them
    expect(store.get().sessions[1]).toMatchObject({ id: s1.id, tabs: [{ path: '/v/moved/d.md' }, { path: '/w2/c.md' }], roots: ['/v', '/w2'] })
    store.removePath('/v/moved')
    expect(store.get().sessions[1]).toMatchObject({ tabs: [{ path: '/w2/c.md' }], roots: ['/w2'] })
    store.removePath('/w2/c.md')
    expect(store.get().sessions).toEqual([{ ...s2, tabs: [], roots: [] }, { ...s1, tabs: [], roots: [] }])
    expect(seen).toHaveLength(6)
    store.removePath('/nothing')
    expect(seen).toHaveLength(6)
  })
})

describe('the open history (YAZ-2663 D1, D2)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const T = 1_700_000_000_000
  /** A store that counts its commits: each one is a `state:changed`. */
  const counted = () => {
    const store = createStore(file)
    const seen: AppState[] = []
    store.onChange((s) => seen.push(s))
    return { store, seen }
  }

  it('S6: a score is worth half after 14 days with no use — 4 is 2, and 1 after 28 days; a clock that went back takes nothing off', () => {
    expect(OPEN_HALF_LIFE_MS).toBe(14 * DAY)
    const stat: OpenStat = { score: 4, last: T }
    expect(openScore(stat, T)).toBe(4)
    expect(openScore(stat, T + 14 * DAY)).toBe(2)
    expect(openScore(stat, T + 28 * DAY)).toBe(1)
    expect(openScore(stat, T + 7 * DAY)).toBeCloseTo(4 / Math.SQRT2, 10)
    expect(openScore(stat, T - DAY)).toBe(4)
  })

  it('S1, S7: addOpen is one more use on what the score is worth now, with the time; the 101st page puts out the page whose score is worth the least now, and the page just used stays', () => {
    const first = addOpen({}, '/v/a.md', T)
    expect(first).toEqual({ '/v/a.md': { score: 1, last: T } })
    const second = addOpen(first, '/v/a.md', T)
    expect(second).toEqual({ '/v/a.md': { score: 2, last: T } })
    expect(first).toEqual({ '/v/a.md': { score: 1, last: T } }) // pure: the record handed in is not changed
    // 14 days with no use: 2 is worth 1, and one more use makes 2.
    expect(addOpen(second, '/v/a.md', T + 14 * DAY)).toEqual({ '/v/a.md': { score: 2, last: T + 14 * DAY } })

    // S7: 100 pages. `old.md` has the highest stored score, 8, but its last use was 56 days ago: it is worth 0.5 now, the least.
    const full: Record<string, OpenStat> = { '/v/old.md': { score: 8, last: T - 56 * DAY } }
    for (let i = 1; i < MAX_OPENS; i++) full[`/v/p${i}.md`] = { score: 1 + i, last: T }
    expect(Object.keys(full)).toHaveLength(MAX_OPENS)
    const next = addOpen(full, '/v/new.md', T)
    expect(Object.keys(next)).toHaveLength(MAX_OPENS)
    expect(next['/v/old.md']).toBeUndefined()
    expect(next['/v/new.md']).toEqual({ score: 1, last: T }) // worth less than each page that stays, and it stays
    expect(next['/v/p1.md']).toEqual({ score: 2, last: T })
    // One more use of a page that is in a full record puts out nothing.
    expect(Object.keys(addOpen(next, '/v/p1.md', T)).sort()).toEqual(Object.keys(next).sort())
  })

  it('S9: a state file with no `opens` loads with an empty record; a wrong entry is dropped and the others load; a long record is cut at MAX_OPENS', async () => {
    await seed(valid({ folders: { '/v': { lastFile: '/v/a.md', folds: {}, baseGroups: {}, name: null, key: null } } })) // a file of 1.0.0: no key
    expect(createStore(file).get().folders['/v']).toEqual({ expanded: [], lastFile: '/v/a.md', folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    for (const junk of ['nope', 5, null, ['/v/a.md']]) {
      await seed(valid({ folders: { '/v': { opens: junk } } }))
      expect(createStore(file).get().folders['/v'].opens).toEqual({})
    }
    await seed(
      valid({
        folders: {
          '/v': {
            opens: {
              '/v/a.md': { score: 2.5, last: T },
              '/v/b.md': 'nope',
              '/v/c.md': { score: 'x', last: T },
              '/v/d.md': { score: 1 },
              '/v/e.md': { score: 0, last: T },
              'rel/f.md': { score: 1, last: T },
              '/v/g.md': { score: 1, last: T + 1, extra: true },
            },
          },
        },
      }),
    )
    expect(createStore(file).get().folders['/v'].opens).toEqual({ '/v/a.md': { score: 2.5, last: T }, '/v/g.md': { score: 1, last: T + 1 } })
    await seed(valid({ folders: { '/v': { opens: Object.fromEntries(Array.from({ length: MAX_OPENS + 5 }, (_, i) => [`/v/n${i}.md`, { score: 1, last: T }])) } } }))
    expect(Object.keys(createStore(file).get().folders['/v'].opens)).toHaveLength(MAX_OPENS)
  })

  it('S1 (R2): upsertWindow with the page that came on show adds one use to the record of the vault of the window that holds the page, in the SAME commit as the window; a page in no vault of the window adds nothing, and no page named adds nothing; the record is in the file and there after a relaunch', async () => {
    const { store, seen } = counted()
    store.setFolder('/v', { name: 'Wiki', lastFile: '/v/a.md' })
    seen.length = 0
    const on = (page: string) => win('w1', { root: '/v', roots: ['/v', '/w', '/v/deep'], file: page, tabs: [page] })
    store.upsertWindow(on('/v/a.md'), '/v/a.md', T)
    expect(seen).toHaveLength(1)
    expect(seen[0].windows).toEqual([on('/v/a.md')])
    // The other fields of the vault stay as they were.
    expect(seen[0].folders['/v']).toEqual({ expanded: [], lastFile: '/v/a.md', folds: {}, baseGroups: {}, opens: { '/v/a.md': { score: 1, last: T } }, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: 'Wiki', key: null })
    // A second vault of the window, and a vault inside a vault: the most specific one holds the page.
    store.upsertWindow(on('/w/b.md'), '/w/b.md', T + 1)
    store.upsertWindow(on('/v/deep/c.md'), '/v/deep/c.md', T + 2)
    expect(store.get().folders['/w'].opens).toEqual({ '/w/b.md': { score: 1, last: T + 1 } })
    expect(store.get().folders['/v/deep'].opens).toEqual({ '/v/deep/c.md': { score: 1, last: T + 2 } })
    expect(store.get().folders['/v'].opens).toEqual({ '/v/a.md': { score: 1, last: T } })
    expect(seen).toHaveLength(3)
    // A page that no vault of the window holds: the window changes, no record does.
    store.upsertWindow(on('/else/d.md'), '/else/d.md', T + 3)
    // No page named (a move of the window, a change of its lens): no use.
    store.upsertWindow(on('/v/a.md'))
    expect(seen).toHaveLength(5)
    expect(Object.keys(store.get().folders).sort()).toEqual(['/v', '/v/deep', '/w'])
    expect(store.get().folders['/v'].opens).toEqual({ '/v/a.md': { score: 1, last: T } })

    await store.flush()
    expect((await onDisk()).folders['/v'].opens).toEqual({ '/v/a.md': { score: 1, last: T } })
    expect(createStore(file).get().folders['/v'].opens).toEqual({ '/v/a.md': { score: 1, last: T } })
  })

  it('S8: renamePath moves the record of a renamed or moved page, and of each page under a renamed folder; removePath drops the record of a deleted page, and of a deleted folder by prefix; each is ONE commit also when the record alone holds the path, and none when it does not', () => {
    const { store, seen } = counted()
    const pages = ['/v/a.md', '/v/docs/b.md', '/v/docs/sub/c.md', '/v/docs2/d.md', '/v/x.md']
    pages.forEach((page, i) => store.upsertWindow(win('w1', { root: '/v', file: page }), page, T + i))
    const stat = (i: number): OpenStat => ({ score: 1, last: T + i })
    seen.length = 0
    // The window shows `x.md`: of the other pages, the record alone holds the path.
    store.renamePath('/v/a.md', '/v/docs/a2.md')
    store.renamePath('/v/docs', '/v/papers')
    expect(store.get().folders['/v'].opens).toEqual({ '/v/papers/a2.md': stat(0), '/v/papers/b.md': stat(1), '/v/papers/sub/c.md': stat(2), '/v/docs2/d.md': stat(3), '/v/x.md': stat(4) })
    expect(seen).toHaveLength(2)
    store.renamePath('/v/nope.md', '/v/else.md')
    expect(seen).toHaveLength(2)

    store.removePath('/v/papers/b.md')
    expect(store.get().folders['/v'].opens).toEqual({ '/v/papers/a2.md': stat(0), '/v/papers/sub/c.md': stat(2), '/v/docs2/d.md': stat(3), '/v/x.md': stat(4) })
    store.removePath('/v/papers')
    expect(store.get().folders['/v'].opens).toEqual({ '/v/docs2/d.md': stat(3), '/v/x.md': stat(4) })
    expect(seen).toHaveLength(4)
    store.removePath('/v/nope.md')
    expect(seen).toHaveLength(4)

    // The folder of the vault itself is renamed: its record follows it, with each page.
    store.renamePath('/v', '/vault')
    expect(store.get().folders['/v']).toBeUndefined()
    expect(store.get().folders['/vault'].opens).toEqual({ '/vault/docs2/d.md': stat(3), '/vault/x.md': stat(4) })
  })
})

describe('the save log (YAZ-3235 D1)', () => {
  const T = 1_700_000_000_000
  const counted = () => {
    const store = createStore(file)
    const seen: AppState[] = []
    store.onChange((s) => seen.push(s))
    return { store, seen }
  }

  it('S1, S2, S8: addEdit logs the save with its time; a save under EDIT_GAP_MS after the last one logs nothing (null); a clock that went back logs; the 501st file puts out the oldest save, and the file just saved stays', () => {
    expect(EDIT_GAP_MS).toBe(60_000)
    const first = addEdit({}, '/v/a.md', T)
    expect(first).toEqual({ '/v/a.md': T })
    expect(addEdit(first!, '/v/a.md', T + EDIT_GAP_MS - 1)).toBeNull()
    expect(addEdit(first!, '/v/a.md', T + EDIT_GAP_MS)).toEqual({ '/v/a.md': T + EDIT_GAP_MS })
    expect(addEdit(first!, '/v/a.md', T - 1)).toEqual({ '/v/a.md': T - 1 })
    expect(first).toEqual({ '/v/a.md': T }) // pure

    const full: Record<string, number> = {}
    for (let i = 0; i < MAX_EDITS; i++) full[`/v/n${i}.md`] = T + i
    const next = addEdit(full, '/v/new.md', T - 5)! // older than every other save, and still it stays
    expect(Object.keys(next)).toHaveLength(MAX_EDITS)
    expect(next['/v/n0.md']).toBeUndefined()
    expect(next['/v/new.md']).toBe(T - 5)
    expect(next['/v/n1.md']).toBe(T + 1)
  })

  it('S1, S2: store.addEdit logs in the most specific vault of the roots, in ONE commit; a save inside the gap and a path in no vault commit nothing; the log is in the file and there after a relaunch', async () => {
    const { store, seen } = counted()
    store.addEdit(['/v', '/w', '/v/deep'], '/v/a.md', T)
    store.addEdit(['/v', '/w', '/v/deep'], '/v/deep/b.md', T + 1)
    store.addEdit(['/v', '/w', '/v/deep'], '/w/c.excalidraw', T + 2)
    expect(seen).toHaveLength(3)
    expect(store.get().folders['/v'].edits).toEqual({ '/v/a.md': T })
    expect(store.get().folders['/v/deep'].edits).toEqual({ '/v/deep/b.md': T + 1 })
    expect(store.get().folders['/w'].edits).toEqual({ '/w/c.excalidraw': T + 2 })
    store.addEdit(['/v'], '/v/a.md', T + 30_000)
    store.addEdit(['/v'], '/else/d.md', T)
    store.addEdit([], '/v/a.md', T + EDIT_GAP_MS)
    // A hidden file of the vault never draws a row, so it takes no place: a folder page's settings, the app's own folder.
    store.addEdit(['/v'], '/v/docs/.folder.md', T)
    store.addEdit(['/v'], '/v/.yaseendocs/x.md', T)
    expect(seen).toHaveLength(3)
    // The other fields of the vault stay as they were.
    expect(store.get().folders['/v']).toEqual({ expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, edits: { '/v/a.md': T }, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null })
    await store.flush()
    expect((await onDisk()).folders['/v'].edits).toEqual({ '/v/a.md': T })
    expect(createStore(file).get().folders['/v'].edits).toEqual({ '/v/a.md': T })
    // A dot in the path ABOVE the vault is not the vault's: its files log.
    store.addEdit(['/u/.hidden/w'], '/u/.hidden/w/e.md', T)
    expect(store.get().folders['/u/.hidden/w'].edits).toEqual({ '/u/.hidden/w/e.md': T })
  })

  it('S11: a state file with no `edits` loads with an empty log; a wrong entry drops alone; a long log is cut at MAX_EDITS', async () => {
    await seed(valid({ folders: { '/v': { lastFile: null, folds: {}, baseGroups: {}, opens: {}, name: null, key: null } } }))
    expect(createStore(file).get().folders['/v'].edits).toEqual({})
    for (const junk of ['nope', 5, null, ['/v/a.md']]) {
      await seed(valid({ folders: { '/v': { edits: junk } } }))
      expect(createStore(file).get().folders['/v'].edits).toEqual({})
    }
    await seed(valid({ folders: { '/v': { edits: { '/v/a.md': T, '/v/b.md': 'x', 'rel/c.md': T, '/v/d.md': Number.NaN, '/v/e.md': null, '/v/f.md': T + 1 } } } }))
    expect(createStore(file).get().folders['/v'].edits).toEqual({ '/v/a.md': T, '/v/f.md': T + 1 })
    // A long log (only a hand-edited file) keeps its newest saves: the 5 oldest go, wherever they stand in the file.
    await seed(valid({ folders: { '/v': { edits: Object.fromEntries(Array.from({ length: MAX_EDITS + 5 }, (_, i) => [`/v/n${i}.md`, T + ((i + 5) % (MAX_EDITS + 5))])) } } }))
    const kept = createStore(file).get().folders['/v'].edits
    expect(Object.keys(kept)).toHaveLength(MAX_EDITS)
    expect(Math.min(...Object.values(kept))).toBe(T + 5)
  })

  it('S5, S6: renamePath moves the log of a renamed file and of each file under a renamed folder, with its time; removePath drops a deleted file, and a deleted folder by prefix', () => {
    const { store } = counted()
    for (const [i, page] of ['/v/a.md', '/v/docs/b.md', '/v/docs/sub/c.drawio', '/v/x.md'].entries()) store.addEdit(['/v'], page, T + i)
    store.renamePath('/v/a.md', '/v/docs/a2.md')
    store.renamePath('/v/docs', '/v/papers')
    expect(store.get().folders['/v'].edits).toEqual({ '/v/papers/a2.md': T, '/v/papers/b.md': T + 1, '/v/papers/sub/c.drawio': T + 2, '/v/x.md': T + 3 })
    store.removePath('/v/papers/b.md')
    store.removePath('/v/papers/sub')
    expect(store.get().folders['/v'].edits).toEqual({ '/v/papers/a2.md': T, '/v/x.md': T + 3 })
  })
})

describe('the tab board canvas and window names (YAZ-3343 D1, D14)', () => {
  it('YAZ-3343 D28: a stored card whose tab left its window is PRUNED when that window\'s tabs change — from the demo\'s state: two stale cards sharing cells with live ones; idempotent', async () => {
    const strip = (paths: string[]) => paths.map((path) => ({ path }))
    const roadmap: WindowEntry = { ...win('demo-a'), root: '/v', roots: ['/v'], file: '/v/Roadmap.md', tabs: ['/v/Roadmap.md', '/v/Note 08.md', '/v/Wireframe.md'], tabStrip: [{ path: '/v/Roadmap.md', name: 'Plan' }, ...strip(['/v/Note 08.md', '/v/Wireframe.md'])] }
    const card = (path: string, copy: number, x: number, y: number): CanvasCard => ({ win: 'demo-a', path, copy, by: 'window', x, y })
    await seed(valid({
      windows: [roadmap],
      tabCanvas: { allWindows: true, cards: [card('/v/Note 08.md', 0, 1266, 142), card('/v/Roadmap.md', 1, 1266, 142), card('/v/Wireframe.md', 0, 1266, 248), card('/v/Note 03.md', 0, 1266, 248), card('/v/Roadmap.md', 0, 1036, 142)] },
    }))
    const store = createStore(file)
    // The window writes its tabs (unchanged): the two cards of tabs it no longer has go — a second copy of Roadmap, and Note 03.
    store.upsertWindow({ ...roadmap })
    expect(store.get().tabCanvas.cards.map((c) => [c.path, c.copy])).toEqual([['/v/Note 08.md', 0], ['/v/Wireframe.md', 0], ['/v/Roadmap.md', 0]])
    const held = store.get().tabCanvas
    store.upsertWindow({ ...roadmap })
    expect(store.get().tabCanvas).toBe(held)
  })

  it('YAZ-3343 D16: frame places are stored per window (the last set wins), loaded leniently, cut at MAX_CANVAS_FRAMES, and go with their window', async () => {
    await seed(valid({ windows: [win('w1'), win('w2')], tabCanvas: { allWindows: true, cards: [], frames: [{ win: 'w1', x: 10, y: 20 }, { win: 'w1', x: 1, y: 1 }, { win: 'gone', x: 0, y: 0 }, { win: 'w2', x: 'far', y: 0 }, null] } }))
    const store = createStore(file)
    expect(store.get().tabCanvas.frames).toEqual([{ win: 'w1', x: 10, y: 20 }])
    store.setTabCanvas({ setFrames: [{ win: 'w2', x: 5, y: 6 }] })
    expect(store.get().tabCanvas.frames).toEqual([{ win: 'w2', x: 5, y: 6 }, { win: 'w1', x: 10, y: 20 }])
    store.setTabCanvas({ forgetFrames: ['w1'] })
    expect(store.get().tabCanvas.frames).toEqual([{ win: 'w2', x: 5, y: 6 }])
    store.removeWindow('w2')
    expect(store.get().tabCanvas.frames).toEqual([])
  })

  const card = (win: string, path: string, x = 0, extra: Partial<CanvasCard> = {}): CanvasCard => ({ win, path, copy: 0, by: 'folder', x, y: 0, ...extra })

  it('D1 load: a missing key is the default, a bad card drops alone, a card of a window the file lacks drops, duplicates keep the first, the list is cut at MAX_CANVAS_CARDS', async () => {
    await seed(valid({ windows: [win('w1')] }))
    expect(createStore(file).get().tabCanvas).toEqual(defaultTabCanvas())
    await seed(valid({ tabCanvas: 'junk' }))
    expect(createStore(file).get().tabCanvas).toEqual(defaultTabCanvas())
    const good = card('w1', '/v/a.md', 1)
    await seed(valid({
      windows: [win('w1')],
      tabCanvas: {
        allWindows: 'yes',
        cards: [good, card('w1', '/v/a.md', 99), card('w2', '/v/b.md'), { ...good, path: 'rel.md' }, { ...good, copy: -1 }, { ...good, copy: 1.5 }, { ...good, by: 'grid' }, { ...good, x: 'far' }, { ...good, win: '' }, null, card('w1', '/v/a.md', 2, { copy: 1 }), card('w1', '/v/a.md', 3, { by: 'window' })],
      },
    }))
    // A switch that is not `false` is the default, ON (D19); a stored `false` stays off.
    expect(createStore(file).get().tabCanvas).toEqual({ allWindows: true, snap: true, cards: [good, card('w1', '/v/a.md', 2, { copy: 1 }), card('w1', '/v/a.md', 3, { by: 'window' })], frames: [] })
    expect(defaultTabCanvas().allWindows).toBe(true)
    await seed(valid({ windows: [win('w1')], tabCanvas: { allWindows: false, snap: true, cards: [] } }))
    expect(createStore(file).get().tabCanvas).toEqual({ allWindows: false, snap: true, cards: [], frames: [] })
    await seed(valid({ windows: [win('w1')], tabCanvas: { cards: [] } }))
    expect(createStore(file).get().tabCanvas.allWindows).toBe(true)
    await seed(valid({ windows: [win('w1')], tabCanvas: { allWindows: true, snap: true, cards: Array.from({ length: MAX_CANVAS_CARDS + 5 }, (_, i) => card('w1', `/v/${i}.md`, i)) } }))
    const loaded = createStore(file).get().tabCanvas
    expect(loaded.allWindows).toBe(true)
    expect(loaded.cards).toHaveLength(MAX_CANVAS_CARDS)
    expect(loaded.cards[0].path).toBe('/v/0.md')
  })

  it('D1 setTabCanvas: one commit per patch; set replaces its key and moves to the front; forget drops; allWindows sets; a no-op or an unknown window commits nothing', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1'))
    store.upsertWindow(win('w2'))
    const commits = vi.fn()
    store.onChange(commits)
    store.setTabCanvas({ set: [card('w1', '/v/a.md', 1), card('w1', '/v/b.md', 2)] })
    store.setTabCanvas({ set: [card('w2', '/v/c.md', 3)] })
    expect(store.get().tabCanvas.cards.map((c) => c.path)).toEqual(['/v/c.md', '/v/a.md', '/v/b.md'])
    // The same key again: replaced, frontmost; the other layout is a card of its own.
    store.setTabCanvas({ set: [card('w1', '/v/b.md', 9), card('w1', '/v/b.md', 7, { by: 'window' })] })
    expect(store.get().tabCanvas.cards).toEqual([card('w1', '/v/b.md', 9), card('w1', '/v/b.md', 7, { by: 'window' }), card('w2', '/v/c.md', 3), card('w1', '/v/a.md', 1)])
    // forget and allWindows in ONE commit.
    commits.mockClear()
    store.setTabCanvas({ allWindows: true, forget: [{ win: 'w1', path: '/v/b.md', copy: 0, by: 'folder' }, { win: 'w2', path: '/v/c.md', copy: 0, by: 'folder' }] })
    expect(commits).toHaveBeenCalledTimes(1)
    expect(store.get().tabCanvas).toEqual({ allWindows: true, snap: true, cards: [card('w1', '/v/b.md', 7, { by: 'window' }), card('w1', '/v/a.md', 1)], frames: [] })
    // Nothing changes: the same switch, the frontmost card where it is, a forget of no card, a card of no window.
    commits.mockClear()
    store.setTabCanvas({ allWindows: true })
    store.setTabCanvas({ set: [card('w1', '/v/b.md', 7, { by: 'window' })] })
    store.setTabCanvas({ forget: [{ win: 'w9', path: '/v/a.md', copy: 0, by: 'folder' }] })
    store.setTabCanvas({ set: [card('w9', '/v/z.md')] })
    store.setTabCanvas({})
    expect(commits).not.toHaveBeenCalled()
    // The cap: last moved first, the oldest goes.
    store.setTabCanvas({ set: Array.from({ length: MAX_CANVAS_CARDS }, (_, i) => card('w2', `/v/n${i}.md`, i)) })
    expect(store.get().tabCanvas.cards).toHaveLength(MAX_CANVAS_CARDS)
    expect(store.get().tabCanvas.cards.some((c) => c.path === '/v/a.md')).toBe(false)
  })

  it('D1 repairs: a rename moves card paths (a folder by prefix), a delete drops them, a removed window takes its cards; nothing referenced, no commit', () => {
    const store = createStore(file)
    store.upsertWindow(win('w1', { root: '/v', file: '/v/d/a.md', tabs: ['/v/d/a.md', '/v/b.md'] }))
    store.upsertWindow(win('w2', { root: '/v', file: '/v/b.md', tabs: ['/v/b.md'] }))
    store.setTabCanvas({ set: [card('w1', '/v/d/a.md', 1), card('w1', '/v/b.md', 2, { copy: 1 }), card('w2', '/v/b.md', 3)] })
    store.renamePath('/v/d', '/v/e')
    store.renamePath('/v/b.md', '/v/c.md')
    expect(store.get().tabCanvas.cards).toEqual([card('w1', '/v/e/a.md', 1), card('w1', '/v/c.md', 2, { copy: 1 }), card('w2', '/v/c.md', 3)])
    store.removePath('/v/e')
    expect(store.get().tabCanvas.cards).toEqual([card('w1', '/v/c.md', 2, { copy: 1 }), card('w2', '/v/c.md', 3)])
    store.removeWindow('w1')
    expect(store.get().tabCanvas.cards).toEqual([card('w2', '/v/c.md', 3)])
    const commits = vi.fn()
    store.onChange(commits)
    store.renamePath('/v/none.md', '/v/x.md')
    store.removePath('/v/none.md')
    store.removeWindow('w1')
    expect(commits).not.toHaveBeenCalled()
  })

  it('D14 names: cleaned like a vault name on load and on set; null or blank removes the key; an unknown id is false; set-identity writes keep it', async () => {
    await seed(valid({ windows: [{ ...win('w1'), name: '  Writing  ' }, { ...win('w2'), name: '   ' }, { ...win('w3'), name: 42 }, { ...win('w4'), name: 'x'.repeat(MAX_VAULT_NAME + 10) }] }))
    const store = createStore(file)
    expect(store.get().windows.map((w) => w.name)).toEqual(['Writing', undefined, undefined, 'x'.repeat(MAX_VAULT_NAME)])
    expect(store.get().windows[1]).not.toHaveProperty('name')
    const commits = vi.fn()
    store.onChange(commits)
    expect(store.setWindowName('w1', 'Writing')).toBe(true) // the same name: no commit
    expect(commits).not.toHaveBeenCalled()
    expect(store.setWindowName('w2', '  Research ')).toBe(true)
    expect(store.get().windows[1].name).toBe('Research')
    // A window write that does not name it (bounds, set-identity) keeps the name.
    store.upsertWindow({ ...store.get().windows[1], bounds: { ...bounds, x: 50 } })
    expect(store.get().windows[1].name).toBe('Research')
    expect(store.setWindowName('w2', '  ')).toBe(true)
    expect(store.get().windows[1]).not.toHaveProperty('name')
    expect(store.setWindowName('w1', null)).toBe(true)
    expect(store.get().windows[0]).not.toHaveProperty('name')
    expect(store.setWindowName('nope', 'Name')).toBe(false)
  })
})

describe('Files windows (YAZ-3357 D1)', () => {
  it('kind loads as `files` exactly; any other value is a full window, never a bad entry; a window write keeps it, and the file holds it', async () => {
    await seed(valid({ windows: [{ ...win('w1'), kind: 'files' }, { ...win('w2'), kind: 'tabs' }, { ...win('w3'), kind: 7 }, win('w4')] }))
    const store = createStore(file)
    expect(store.get().windows.map((w) => [w.id, w.kind])).toEqual([['w1', 'files'], ['w2', undefined], ['w3', undefined], ['w4', undefined]])
    for (const w of store.get().windows.slice(1)) expect(w).not.toHaveProperty('kind')
    store.upsertWindow({ ...store.get().windows[0], bounds: { ...bounds, x: 50 } })
    expect(store.get().windows[0].kind).toBe('files')
    await store.flush()
    expect(createStore(file).get().windows[0].kind).toBe('files')
  })

  it('zoom (YAZ-3389 D13) is a sidebar zoom percent on every Files window: an old Chromium level or junk is the default, off-range clamps, a full window has none', async () => {
    const old = [{ ...win('w1'), kind: 'files', zoom: 1.5 }, { ...win('w2'), kind: 'files', zoom: -8 }, { ...win('w3'), kind: 'files', zoom: 'big' }, { ...win('w4'), kind: 'files' }]
    const percents = [{ ...win('w5'), kind: 'files', zoom: 150 }, { ...win('w6'), kind: 'files', zoom: 40 }, { ...win('w7'), kind: 'files', zoom: 900 }, { ...win('w8'), zoom: 150 }]
    await seed(valid({ windows: [...old, ...percents] }))
    const store = createStore(file)
    expect(store.get().windows.map((w) => w.zoom)).toEqual([125, 125, 125, 125, 150, 50, 200, undefined])
    expect(store.get().windows[7]).not.toHaveProperty('zoom')
  })
})

describe('the closed notes (YAZ-3487 D9, "Recently closed")', () => {
  const T = 1_700_000_000_000

  it('S31, S40: addClosed sets each file\'s time, newest wins; past MAX_CLOSED (50) the oldest go; it is pure', () => {
    expect(MAX_CLOSED).toBe(50)
    const first = addClosed({}, ['/v/a.md', '/v/b.md'], T)
    expect(first).toEqual({ '/v/a.md': T, '/v/b.md': T })
    expect(addClosed(first, ['/v/a.md'], T + 5)).toEqual({ '/v/a.md': T + 5, '/v/b.md': T })
    expect(first).toEqual({ '/v/a.md': T, '/v/b.md': T }) // pure
    const full: Record<string, number> = {}
    for (let i = 0; i < MAX_CLOSED; i++) full[`/v/n${i}.md`] = T + i
    const next = addClosed(full, ['/v/new.md'], T + 100)
    expect(Object.keys(next)).toHaveLength(MAX_CLOSED)
    expect(next['/v/n0.md']).toBeUndefined()
    expect(next['/v/new.md']).toBe(T + 100)
  })

  it('S31, S33: store.addClosed puts each file in the vault of the roots that holds it, in ONE commit; a file in no vault is left out; the list is in the file after a relaunch', async () => {
    const store = createStore(file)
    const seen: AppState[] = []
    store.onChange((s) => seen.push(s))
    store.addClosed(['/v', '/w'], ['/v/a.md', '/w/b.md', '/else/c.md'], T)
    expect(seen).toHaveLength(1)
    expect(store.get().folders['/v'].closed).toEqual({ '/v/a.md': T })
    expect(store.get().folders['/w'].closed).toEqual({ '/w/b.md': T })
    store.addClosed(['/v'], [], T)
    expect(seen).toHaveLength(1) // nothing to add, nothing written
    await store.flush()
    expect(createStore(file).get().folders['/v'].closed).toEqual({ '/v/a.md': T })
  })

  it('S41: a state file with no `closed` loads it as {}; a wrong entry drops alone', async () => {
    await seed(valid({ folders: { '/v': { lastFile: null, folds: {}, baseGroups: {}, opens: {}, name: null, key: null } } }))
    expect(createStore(file).get().folders['/v'].closed).toEqual({})
    await seed(valid({ folders: { '/v': { closed: { '/v/a.md': T, '/v/b.md': 'x', 'rel/c.md': T } } } }))
    expect(createStore(file).get().folders['/v'].closed).toEqual({ '/v/a.md': T })
  })

  it('D14: forgetClosed drops the files named, or with null every closed note of the roots\' vaults, in ONE commit; other vaults keep theirs', () => {
    const store = createStore(file)
    store.addClosed(['/v', '/w', '/u'], ['/v/a.md', '/v/b.md', '/w/c.md', '/u/d.md'], T)
    const seen: AppState[] = []
    store.onChange((s) => seen.push(s))
    store.forgetClosed(['/v', '/w'], ['/v/a.md'])
    expect(store.get().folders['/v'].closed).toEqual({ '/v/b.md': T })
    store.forgetClosed(['/v', '/w'], null)
    expect([store.get().folders['/v'].closed, store.get().folders['/w'].closed, store.get().folders['/u'].closed]).toEqual([{}, {}, { '/u/d.md': T }])
    expect(seen).toHaveLength(2)
    store.forgetClosed(['/v'], null) // nothing left: no commit
    expect(seen).toHaveLength(2)
  })

  it('S38, S39: a renamed note keeps its entry under the new path; a deleted note drops it', () => {
    const store = createStore(file)
    store.addClosed(['/v'], ['/v/a.md', '/v/docs/b.md'], T)
    store.renamePath('/v/a.md', '/v/a2.md')
    store.renamePath('/v/docs', '/v/papers')
    expect(store.get().folders['/v'].closed).toEqual({ '/v/a2.md': T, '/v/papers/b.md': T })
    store.removePath('/v/papers/b.md')
    expect(store.get().folders['/v'].closed).toEqual({ '/v/a2.md': T })
  })
})
