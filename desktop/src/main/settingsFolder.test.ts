/**
 * THE SETTINGS FOLDER (YAZ-3276): the rules (`@shared/settingsSync`, `mergeFolderSettings`) and two "Macs"
 * — two stores with two Mac IDs — on one real temp folder with the real watcher. Each `it` is one story
 * of the approved behavior (D1, D3, D4, D5, D6 on YAZ-3277).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { newestFile, parseSettingsFile, SETTINGS_FILE_RE, settingsFileName, settingsFileText, type SettingsFile } from '@shared/settingsSync'
import { until } from './fs/testFixture'
import { followSettingsFolder, type SettingsFolder } from './settingsFolder'
import { createStore, mergeFolderSettings, type Store } from './store'

const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'
const file = (savedAt: number, settings: Partial<Record<keyof SettingsState, unknown>>): SettingsFile => ({ name: 'Mac', savedAt, settings })

describe('the rules (D3)', () => {
  it('the newest file wins; a tie or an older file changes nothing; only `settings-<Mac ID>.json` counts', () => {
    const files = [file(10, { theme: 'dark' }), file(30, { theme: 'light' }), file(20, { theme: 'system' })]
    expect(newestFile(files, 5)?.savedAt).toBe(30)
    expect(newestFile(files, 30)).toBeNull()
    expect(newestFile([], 0)).toBeNull()
    expect(SETTINGS_FILE_RE.test(settingsFileName(A))).toBe(true)
    for (const copy of [`settings-${A} 2.json`, `settings-${A}.sync-conflict-20261025-101010-ABC.json`, 'settings.json', `settings-${A}.json.tmp`]) expect(SETTINGS_FILE_RE.test(copy)).toBe(false)
  })

  it('a half-synced or foreign file is no file; a file holds only the fields that travel (D1)', () => {
    expect(parseSettingsFile('{"savedAt": 5, "settings": {')).toBeNull()
    expect(parseSettingsFile('{"settings": {}}')).toBeNull()
    expect(parseSettingsFile('[1, 2]')).toBeNull()
    const text = settingsFileText('Big Mac', 7, { ...DEFAULT_SETTINGS, libraryFolder: '/lib', tableOfContentsWidth: 300 })
    const parsed = parseSettingsFile(text)
    expect(parsed).toMatchObject({ name: 'Big Mac', savedAt: 7 })
    for (const local of ['libraryFolder', 'canvasPanel', 'tableOfContentsWidth']) expect(parsed?.settings).not.toHaveProperty(local)
    expect(parsed?.settings).toHaveProperty('theme')
  })

  it("another Mac's fields: a field this build can't read keeps this Mac's value; a repairable one is repaired; local fields never come in", () => {
    const here: SettingsState = { ...DEFAULT_SETTINGS, theme: 'dark', lineSpacing: 1.5, libraryFolder: '/here/lib', tableOfContentsWidth: 250 }
    // A file is foreign data: it can hold a key that is no field at all.
    const incoming: Record<string, unknown> = {
      theme: 'sepia', // a newer build's value: unreadable here
      lineSpacing: 2,
      canvas: { ...DEFAULT_SETTINGS.canvas, gridModeEnabled: true, aNewPref: 1 }, // one unknown pref: the rest is kept
      libraryFolder: '/there/lib',
      tableOfContentsWidth: 400,
      notAField: true,
    }
    const out = mergeFolderSettings(here, incoming)
    expect(out.theme).toBe('dark')
    expect(out.lineSpacing).toBe(2)
    expect(out.canvas.gridModeEnabled).toBe(true)
    expect(out.libraryFolder).toBe('/here/lib')
    expect(out.tableOfContentsWidth).toBe(250)
    expect(out).not.toHaveProperty('notAField')
  })

  it("YAZ-3302: a sidebar sort this build can't read keeps this Mac's whole sort (D3)", () => {
    const here: SettingsState = { ...DEFAULT_SETTINGS, sidebarSort: { files: { by: 'updated', reverse: true }, focus: { by: 'name', reverse: false }, favorites: { by: 'name', reverse: true } } }
    const out = mergeFolderSettings(here, { sidebarSort: { files: { by: 'created', reverse: false }, focus: { by: 'manual', reverse: false }, favorites: { by: 'updated', reverse: false } } })
    expect(out.sidebarSort).toEqual(here.sidebarSort)
  })

  it("YAZ-3309: the sidebar's level lines, their style and their colour travel; a file without them, or with a value this build can't read, keeps this Mac's (D3, D8, D9, S10)", () => {
    const here: SettingsState = { ...DEFAULT_SETTINGS, sidebarLines: 'always' }
    expect(mergeFolderSettings(here, { sidebarLines: 'off' }).sidebarLines).toBe('off')
    expect(mergeFolderSettings(here, { theme: 'dark' }).sidebarLines).toBe('always')
    expect(mergeFolderSettings(here, { sidebarLines: 'sometimes' }).sidebarLines).toBe('always')
    // The thread style and its colour travel the same way (D8, D9).
    const threaded: SettingsState = { ...here, sidebarLineStyle: 'thread', sidebarThreadColor: '#112233' }
    expect(mergeFolderSettings(threaded, { sidebarLineStyle: 'plain', sidebarThreadColor: null })).toMatchObject({ sidebarLineStyle: 'plain', sidebarThreadColor: null })
    expect(mergeFolderSettings(threaded, { theme: 'dark' })).toMatchObject({ sidebarLineStyle: 'thread', sidebarThreadColor: '#112233' })
    expect(mergeFolderSettings(threaded, { sidebarLineStyle: 'zigzag', sidebarThreadColor: 'red' })).toMatchObject({ sidebarLineStyle: 'thread', sidebarThreadColor: '#112233' })
  })

  it("YAZ-3397: the key changes travel as a whole list — a key another Mac reset does not come back from this one", () => {
    const here: SettingsState = { ...DEFAULT_SETTINGS, hotkeys: { search: 'CmdOrCtrl+Shift+K', closeTab: null } }
    expect(mergeFolderSettings(here, { hotkeys: { closeTab: null } }).hotkeys).toEqual({ closeTab: null })
    expect(mergeFolderSettings(here, { hotkeys: {} }).hotkeys).toEqual({})
    // A file without them keeps this Mac's; an id this build does not know is dropped, the rest come in.
    expect(mergeFolderSettings(here, { theme: 'dark' }).hotkeys).toEqual(here.hotkeys)
    expect(mergeFolderSettings(here, { hotkeys: { newTab: 'CmdOrCtrl+Alt+T', aNewCommand: 'CmdOrCtrl+J' } }).hotkeys).toEqual({ newTab: 'CmdOrCtrl+Alt+T' })
  })

  it("YAZ-3298: a canvas pref this build can't read, or that the file lacks, keeps this Mac's value (D3)", () => {
    const here: SettingsState = { ...DEFAULT_SETTINGS, canvas: { ...DEFAULT_SETTINGS.canvas, writingStrokeWidth: 7, toolLock: false } }
    const newer = mergeFolderSettings(here, { canvas: { ...DEFAULT_SETTINGS.canvas, toolLock: true, writingStrokeWidth: 'thick' } })
    expect(newer.canvas).toMatchObject({ toolLock: true, writingStrokeWidth: 7 })
    const { writingStrokeWidth: _lacks, ...older } = { ...DEFAULT_SETTINGS.canvas, toolLock: true }
    expect(mergeFolderSettings(here, { canvas: older }).canvas).toMatchObject({ toolLock: true, writingStrokeWidth: 7 })
  })
})

describe('two Macs on one folder (D4, D5, D6)', () => {
  let root: string
  let folder: string
  const open: SettingsFolder[] = []
  const stores: Store[] = []

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'yd-settings-folder-'))
    folder = path.join(root, 'Sync', 'yaseen-docs-settings')
    await mkdir(folder, { recursive: true })
  })
  afterEach(async () => {
    await Promise.all(open.splice(0).map((f) => f.close()))
    await Promise.all(stores.splice(0).map((s) => s.flush()))
    await rm(root, { recursive: true, force: true })
  })

  /** One Mac: its own state file, its Mac ID, the folder module as `index.ts` makes it. */
  function mac(id: string) {
    const store = createStore(path.join(root, id, 'yaseendocs.json'))
    const settingsFolder = followSettingsFolder(store, { macId: async () => id, host: `Mac ${id}`, debounceMs: 0, retryMs: 100 })
    stores.push(store)
    open.push(settingsFolder)
    return { store, settingsFolder, own: path.join(folder, settingsFileName(id)) }
  }
  const read = async (p: string) => parseSettingsFile(await readFile(p, 'utf8'))

  it('A fills an empty folder; B joins and takes all of it; a change on either one reaches the other; a local drag stays', async () => {
    const a = mac(A)
    a.store.setSettings({ ...DEFAULT_SETTINGS, theme: 'dark', lineSpacing: 1.5 }, 100)
    a.store.setSettingsFolder(folder, 200) // D6: an empty folder takes A's settings
    await until(() => existsSync(a.own))
    expect(await read(a.own)).toMatchObject({ savedAt: 200, settings: { theme: 'dark', lineSpacing: 1.5 } })

    const b = mac(B)
    b.store.setSettings({ ...DEFAULT_SETTINGS, blockGap: 9 }, 150) // B's own change, older than A's file
    b.store.setSettingsFolder(folder, 0) // D6: the folder holds A's file, so it wins
    await until(() => b.store.get().settings.theme === 'dark')
    expect(b.store.get().settings).toMatchObject({ lineSpacing: 1.5, blockGap: DEFAULT_SETTINGS.blockGap })
    expect(b.store.get().settingsSavedAt).toBe(200)
    expect(existsSync(b.own)).toBe(false) // taking a file never writes a mirror of it

    b.store.setSettings({ ...b.store.get().settings, theme: 'light' }, 300)
    await until(() => a.store.get().settings.theme === 'light', 5000)
    expect(a.store.get().settingsSavedAt).toBe(300)

    // A drag of a local width is no new save: nothing is written, and B keeps its own width.
    const text = await readFile(a.own, 'utf8')
    a.store.setSettings({ ...a.store.get().settings, tableOfContentsWidth: 333 }, 400)
    expect(a.store.get().settingsSavedAt).toBe(300)
    await a.settingsFolder.flush()
    expect(await readFile(a.own, 'utf8')).toBe(text)
    expect(b.store.get().settings.tableOfContentsWidth).toBe(DEFAULT_SETTINGS.tableOfContentsWidth)
  })

  it("a copy or a half-synced file never counts; a newer build's file changes only what this build can read", async () => {
    const a = mac(A)
    a.store.setSettings({ ...DEFAULT_SETTINGS, theme: 'dark' }, 100)
    a.store.setSettingsFolder(folder, 100)
    await until(() => existsSync(a.own))

    await writeFile(path.join(folder, `settings-${B} 2.json`), settingsFileText('copy', 900, { ...DEFAULT_SETTINGS, theme: 'light' }))
    await writeFile(path.join(folder, settingsFileName(B)), '{"savedAt": 900, "settings": {"theme": "li')
    await writeFile(path.join(folder, settingsFileName('cccccccccccc')), JSON.stringify({ name: 'new build', savedAt: 500, settings: { theme: 'sepia', lineSpacing: 2 } }))
    await until(() => a.store.get().settings.lineSpacing === 2)
    expect(a.store.get().settings.theme).toBe('dark')
    expect(a.store.get().settingsSavedAt).toBe(500)
  })

  it('D5: a missing folder keeps the settings and says so; an edit made then reaches the folder when it is back', async () => {
    const a = mac(A)
    a.store.setSettingsFolder(folder, 100)
    await until(() => existsSync(a.own))
    const b = mac(B)
    b.store.setSettingsFolder(folder, 0)
    await b.settingsFolder.flush()

    const away = path.join(root, 'moved')
    await rename(folder, away)
    a.store.setSettings({ ...a.store.get().settings, theme: 'dark' }, 700)
    await until(() => a.settingsFolder.missing())
    expect(a.store.get().settings.theme).toBe('dark')

    // The folder comes back. The next launch at the latest reads it, finds A newer than every file, and writes.
    await rename(away, folder)
    await a.settingsFolder.close()
    const again = followSettingsFolder(a.store, { macId: async () => A, host: 'Mac A', debounceMs: 0 })
    open.push(again)
    await again.ready
    expect(again.missing()).toBe(false)
    expect(await read(a.own)).toMatchObject({ savedAt: 700, settings: { theme: 'dark' } })
    await until(() => b.store.get().settings.theme === 'dark', 5000)
  })

  it('YAZ-3296: the folder comes back while the app runs — no relaunch — and the edit made meanwhile reaches it (D5)', async () => {
    const a = mac(A)
    a.store.setSettingsFolder(folder, 100)
    await until(() => existsSync(a.own))
    const b = mac(B)
    b.store.setSettingsFolder(folder, 0)
    await b.settingsFolder.settled()

    const away = path.join(root, 'moved')
    await rename(folder, away)
    a.store.setSettings({ ...a.store.get().settings, theme: 'dark' }, 700)
    await until(() => a.settingsFolder.missing())
    await rename(away, folder) // the same files come back: no file event at all
    await until(() => !a.settingsFolder.missing(), 5000)
    expect(await read(a.own)).toMatchObject({ savedAt: 700, settings: { theme: 'dark' } })
    await until(() => b.store.get().settings.theme === 'dark', 5000)
  })

  it('YAZ-3297: right after a choice, `missing` is the NEW folder\'s: a good folder after a missing one answers false, and the reverse', async () => {
    const a = mac(A)
    a.store.setSettingsFolder(path.join(root, 'gone'), 100)
    await until(() => a.settingsFolder.missing())
    a.store.setSettingsFolder(folder, Date.now())
    await a.settingsFolder.settled()
    expect(a.settingsFolder.missing()).toBe(false)
    a.store.setSettingsFolder(path.join(root, 'also-gone'), 100)
    await a.settingsFolder.settled()
    expect(a.settingsFolder.missing()).toBe(true)
  })

  it("YAZ-3299: a file from a Mac whose clock runs ahead never wins over this Mac's later edit", async () => {
    const a = mac(A)
    a.store.setSettingsFolder(folder, 100)
    await until(() => existsSync(a.own))
    const ahead = Date.now() + 60_000
    await writeFile(path.join(folder, settingsFileName(B)), settingsFileText('B', ahead, { ...DEFAULT_SETTINGS, theme: 'dark' }))
    await until(() => a.store.get().settings.theme === 'dark')
    a.store.setSettings({ ...a.store.get().settings, contentWidth: 'full' })
    expect(a.store.get().settingsSavedAt).toBeGreaterThan(ahead)
    await vi.waitFor(async () => expect((await read(a.own))?.settings.contentWidth).toBe('full'), { timeout: 3000 })
  })

  it('Reset to default keeps the settings and leaves the file; the watcher stops', async () => {
    const a = mac(A)
    a.store.setSettings({ ...DEFAULT_SETTINGS, theme: 'dark' }, 100)
    a.store.setSettingsFolder(folder, 100)
    await until(() => existsSync(a.own))
    a.store.setSettingsFolder(null, 100)
    await writeFile(path.join(folder, settingsFileName(B)), settingsFileText('B', 900, { ...DEFAULT_SETTINGS, theme: 'light' }))
    await new Promise((r) => setTimeout(r, 400))
    expect(a.store.get().settings.theme).toBe('dark')
    expect(existsSync(a.own)).toBe(true)
    expect(a.settingsFolder.missing()).toBe(false)
  })
})
