// rename-note-to-page: skip-file (these cases write the old names on purpose)
/** YAZ-5036: the one-time move of the saved names that said "note" (`shared/legacyNames.ts`): an old file in, the new file out. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_SETTINGS, SIDEBAR_DEFAULT_W, defaultAppState, type AppState } from '@shared/types'
import { createStore, mergeFolderSettings, sanitizeSettings } from './store'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-legacy-'))
  file = path.join(dir, 'yaseendocs.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})
const seed = (v: unknown) => writeFile(file, JSON.stringify(v))
const onDisk = async (): Promise<AppState> => JSON.parse(await readFile(file, 'utf8')) as AppState

describe('YAZ-5036: the saved names that said "note" move to "page" once', () => {
  /** A settings block as a build before YAZ-5036 wrote it: every old key changed from its default, and old values. */
  const OLD = {
    newNoteLocation: 'folder',
    newNoteFolder: 'Inbox',
    newNoteTitleTemplate: '{YYYY}-{MM}-{DD} ',
    noteBulletIndent: 40,
    noteBulletGap: 14,
    enterKeepsStyleNotes: true,
    dailyNotes: true,
    dailyNoteFolder: 'Journal',
    dailyNoteFormat: 'YYYY-MM-DD',
    dailyNoteDayFolder: true,
    dailyNoteOpens: 'note',
    newBoardFolder: 'note',
    sidebarIconColors: { note: '#aa0000', drawing: '#00aa00' },
    folderPages: { ...DEFAULT_SETTINGS.folderPages, subfolders: 'notes' },
    hotkeys: { 'note.bold': 'CmdOrCtrl+Alt+B', 'note.foldAll': null, dailyNote: 'CmdOrCtrl+Alt+T' },
    hotkeysAside: { 'app.dailyNote@drawing': true },
  }
  const OLD_KEYS = ['newNoteLocation', 'newNoteFolder', 'newNoteTitleTemplate', 'noteBulletIndent', 'noteBulletGap', 'enterKeepsStyleNotes', 'dailyNotes', 'dailyNoteFolder', 'dailyNoteFormat', 'dailyNoteDayFolder', 'dailyNoteOpens']
  const NEW = {
    newPageLocation: 'folder',
    newPageFolder: 'Inbox',
    newPageTitleTemplate: '{YYYY}-{MM}-{DD} ',
    pageBulletIndent: 40,
    pageBulletGap: 14,
    enterKeepsStylePages: true,
    dailyPages: true,
    dailyPageFolder: 'Journal',
    dailyPageFormat: 'YYYY-MM-DD',
    dailyPageDayFolder: true,
    dailyPageOpens: 'page',
    newBoardFolder: 'page',
  }

  it('sanitizeSettings reads every old key and old value; nothing goes back to its default', () => {
    const out = sanitizeSettings({ ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.keys(NEW).map((k) => [k, undefined])), ...OLD }) as unknown as Record<string, unknown>
    expect(Object.fromEntries(Object.keys(NEW).map((k) => [k, out[k]]))).toEqual(NEW)
    for (const old of OLD_KEYS) expect(out).not.toHaveProperty(old)
    expect(out.sidebarIconColors).toEqual({ page: '#aa0000', drawing: '#00aa00' })
    expect((out.folderPages as { subfolders: string }).subfolders).toBe('pages')
    expect(out.hotkeys).toEqual({ 'page.bold': 'CmdOrCtrl+Alt+B', 'page.foldAll': null, 'app.dailyPage': 'CmdOrCtrl+Alt+T' })
    expect(out.hotkeysAside).toEqual({ 'app.dailyPage@drawing': true })
  })

  it('a new key that is there already wins over its old key', () => {
    const out = sanitizeSettings({ ...DEFAULT_SETTINGS, dailyPageFolder: 'New', dailyNoteFolder: 'Old', hotkeys: { 'page.bold': 'CmdOrCtrl+Alt+B', 'note.bold': 'CmdOrCtrl+Alt+K' } })
    expect(out.dailyPageFolder).toBe('New')
    expect(out.hotkeys).toEqual({ 'page.bold': 'CmdOrCtrl+Alt+B' })
  })

  it('old file in → new file out: the store loads an old yaseendocs.json, keeps every value, and the next save writes only the new names', async () => {
    const state = defaultAppState() as unknown as { settings: Record<string, unknown> }
    const settings: Record<string, unknown> = { ...state.settings, ...OLD }
    for (const k of Object.keys(NEW)) if (k !== 'newBoardFolder') delete settings[k]
    await seed({ ...state, settings })
    const store = createStore(file)
    expect(store.get().settings).toMatchObject(NEW)
    expect(store.get().settings.hotkeys).toEqual({ 'page.bold': 'CmdOrCtrl+Alt+B', 'page.foldAll': null, 'app.dailyPage': 'CmdOrCtrl+Alt+T' })
    store.setSidebarWidth(SIDEBAR_DEFAULT_W + 10)
    await store.flush()
    const saved = (await onDisk()).settings as unknown as Record<string, unknown>
    expect(saved).toMatchObject(NEW)
    for (const old of OLD_KEYS) expect(saved).not.toHaveProperty(old)
    expect(JSON.stringify(saved.hotkeys)).not.toContain('note.')
    expect(saved.sidebarIconColors).toEqual({ page: '#aa0000', drawing: '#00aa00' })
    expect(createStore(file).get().settings).toMatchObject(NEW)
  })

  it("another Mac's settings file from an older build (the settings folder) moves the same way", () => {
    const out = mergeFolderSettings(DEFAULT_SETTINGS, { dailyNotes: true, dailyNoteFolder: 'Journal', hotkeys: { 'note.bold': 'CmdOrCtrl+Alt+B' } } as Parameters<typeof mergeFolderSettings>[1])
    expect([out.dailyPages, out.dailyPageFolder, out.hotkeys]).toEqual([true, 'Journal', { 'page.bold': 'CmdOrCtrl+Alt+B' }])
  })
})
