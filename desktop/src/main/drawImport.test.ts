/**
 * The Draw import (YAZ-3028 D6, YAZ-3041), in temp folders only: a fake Draw user-data folder, a
 * fake Docs user-data folder and a fake vault. It never looks at the real app data or a real vault.
 */
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CANVAS_PREFS, DEFAULT_SETTINGS, MAX_FAVORITES } from '@shared/types'
import { createDrawImporter, createFileOnce, fillSettings, importDrawAppData, importDrawVault, shouldImportDrawAppData, startDrawImport } from './drawImport'
import { createStore, type Store } from './store'

let tmp: string
let drawDir: string
let userData: string
let vault: string
let store: Store

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`
async function put(file: string, body: string, mode?: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  if (mode !== undefined) await chmod(file, mode)
}
const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'))
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false)

/** Every file under `dir` → its bytes' hash, its mtime and its mode: what "untouched" means. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = path.join(rel, e.name)
      if (e.isDirectory()) await walk(child)
      else {
        const file = path.join(dir, child)
        const st = await stat(file)
        out[child] = `${createHash('sha256').update(await readFile(file)).digest('hex')} ${st.mtimeMs} ${(st.mode & 0o777).toString(8)}`
      }
    }
  }
  await walk('')
  return out
}

const DRAW_SECRETS = json({ version: 2, values: { pixabayApiKey: 'k-123' } })
const DRAW_SHARING = json({ version: 1, accountId: 'acc', accountName: 'Me', bucketName: 'b', workerName: 'w', workersDevUrl: 'https://w.example', customDomain: null, readyAt: 1 })
const DRAW_SHARES = { version: 1, shares: { 'b.excalidraw': { id: 'abc', allowDownload: true, sharedAt: 1, updatedAt: 2 } } }

/** Draw as Yasin's Mac would have it: settings, windows and recents, secrets, sharing, a library. */
async function seedDraw(): Promise<void> {
  await put(
    path.join(drawDir, 'yaseendraw.json'),
    json({
      version: 1,
      settings: { theme: 'dark', libraryFolder: null, confirmDelete: true, hoverPreview: true, canvas: { ...DEFAULT_CANVAS_PREFS, gridModeEnabled: true, laserColor: '#2979ff', defaultFontFamily: 5, selectOn: 'junk' }, diagramDarkColors: 'keep' },
      windows: [{ id: 'w1', root: vault, file: path.join(vault, 'b.excalidraw'), tabs: [path.join(vault, 'b.excalidraw')] }],
      recents: [{ path: vault, lastOpened: 1 }],
    }),
  )
  await put(path.join(drawDir, 'secrets.json'), DRAW_SECRETS, 0o600)
  await put(path.join(drawDir, 'sharing.json'), DRAW_SHARING)
  await put(path.join(drawDir, 'library', 'media.json'), json({ version: 1, items: [{ id: 'm1' }] }))
  await put(path.join(drawDir, 'library', 'components', 'components.json'), json({ version: 1, components: ['arrow'] }))
  await put(path.join(drawDir, 'library', 'components', 'arrow.excalidrawlib'), '{"type":"excalidrawlib"}')
  await put(path.join(drawDir, 'library', 'components', 'arrow.png'), 'PNGDATA')
  await put(path.join(drawDir, 'library', '.DS_Store'), 'x')
  await put(path.join(drawDir, 'library', 'media.json.tmp-0a1b'), 'half')
  await put(path.join(drawDir, 'thumbs', 't.png'), 'thumb')
  await put(path.join(drawDir, 'media-cache', 'c.json'), '{}')
}

/** A Draw vault: notes, a board, a diagram, and Draw's dotfolder. */
async function seedVault(): Promise<void> {
  await put(path.join(vault, 'a.md'), '# A\n')
  await put(path.join(vault, 'd.md'), '# D\n')
  await put(path.join(vault, 'b.excalidraw'), '{}')
  await put(path.join(vault, 'c.drawio'), '<mxfile/>')
  await put(path.join(vault, '.yaseendraw', 'favorites.json'), json({ version: 1, favorites: ['b.excalidraw', 'c.drawio', 'gone.excalidraw', 'a.md', '../outside.md'] }))
  await put(path.join(vault, '.yaseendraw', 'github.json'), json({ enabled: true }))
  await put(path.join(vault, '.yaseendraw', 'shares.json'), json(DRAW_SHARES))
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'draw-import-'))
  drawDir = path.join(tmp, 'Application Support', 'Yaseen Draw')
  userData = path.join(tmp, 'Application Support', 'Yaseen Docs')
  vault = path.join(tmp, 'vault')
  await seedDraw()
  await seedVault()
  store = createStore(path.join(userData, 'yaseendocs.json'))
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(async () => {
  await store.flush()
  vi.restoreAllMocks()
  await rm(tmp, { recursive: true, force: true })
})

describe('into an empty Docs', () => {
  it('copies the library, secrets.json (owner-only) and sharing.json, and fills the canvas settings', async () => {
    const done = await importDrawAppData({ drawDir, userData, store })
    expect(done).toEqual({
      library: ['components/arrow.excalidrawlib', 'components/arrow.png', 'components/components.json', 'media.json'],
      files: ['secrets.json', 'sharing.json'],
      settings: ['canvas.gridModeEnabled', 'canvas.defaultFontFamily', 'canvas.laserColor', 'diagramDarkColors'],
    })
    expect(await readFile(path.join(userData, 'secrets.json'), 'utf8')).toBe(DRAW_SECRETS)
    expect((await stat(path.join(userData, 'secrets.json'))).mode & 0o777).toBe(0o600)
    expect(await readFile(path.join(userData, 'sharing.json'), 'utf8')).toBe(DRAW_SHARING)
    expect(await readFile(path.join(userData, 'library', 'components', 'arrow.png'), 'utf8')).toBe('PNGDATA')
    // Dot-entries, half-written tmp files and Draw's caches stay behind.
    expect(await exists(path.join(userData, 'library', '.DS_Store'))).toBe(false)
    expect(await exists(path.join(userData, 'library', 'media.json.tmp-0a1b'))).toBe(false)
    expect(await exists(path.join(userData, 'thumbs'))).toBe(false)
    expect(await exists(path.join(userData, 'media-cache'))).toBe(false)
    const { settings, windows, recents } = store.get()
    expect(settings.canvas).toEqual({ ...DEFAULT_CANVAS_PREFS, gridModeEnabled: true, laserColor: '#2979ff', defaultFontFamily: 5 })
    expect(settings.diagramDarkColors).toBe('keep')
    // Only canvas and diagram colours: never the theme, windows, tabs or recents.
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(windows).toEqual([])
    expect(recents).toEqual([])
  })

  it('unions the favorites, and copies github.json and shares.json, into .yaseendocs/', async () => {
    expect(await importDrawVault(vault)).toEqual({ favorites: 3, files: ['github.json', 'shares.json'] })
    // The gone file and the unsafe entry are not added (D14, R2.5).
    expect(await readJson(path.join(vault, '.yaseendocs', 'favorites.json'))).toEqual({ version: 1, favorites: ['b.excalidraw', 'c.drawio', 'a.md'] })
    expect(await readJson(path.join(vault, '.yaseendocs', 'github.json'))).toEqual({ enabled: true })
    expect(await readJson(path.join(vault, '.yaseendocs', 'shares.json'))).toEqual(DRAW_SHARES)
  })
})

describe('into a Docs with values', () => {
  it('overwrites no Docs value: Docs favorites lead, Docs files and settings stay', async () => {
    await put(path.join(vault, '.yaseendocs', 'favorites.json'), json({ version: 1, favorites: ['d.md', 'a.md'] }))
    await put(path.join(vault, '.yaseendocs', 'github.json'), json({ enabled: false }))
    await put(path.join(vault, '.yaseendocs', 'shares.json'), json({ version: 1, shares: {} }))
    await put(path.join(userData, 'secrets.json'), json({ version: 2, values: { pixabayApiKey: 'docs-key' } }), 0o600)
    await put(path.join(userData, 'library', 'media.json'), json({ version: 1, items: [] }))
    store.setSettings({ ...store.get().settings, canvas: { ...DEFAULT_CANVAS_PREFS, laserColor: '#00c853' }, diagramDarkColors: 'adapt' })
    const docsBefore = await snapshot(path.join(vault, '.yaseendocs'))
    const secretsBefore = await snapshot(userData)

    expect(await importDrawVault(vault)).toEqual({ favorites: 2, files: [] })
    expect(await readJson(path.join(vault, '.yaseendocs', 'favorites.json'))).toEqual({ version: 1, favorites: ['d.md', 'a.md', 'b.excalidraw', 'c.drawio'] })
    expect(await readJson(path.join(vault, '.yaseendocs', 'github.json'))).toEqual({ enabled: false })
    const docsAfter = await snapshot(path.join(vault, '.yaseendocs'))
    expect(docsAfter['github.json']).toBe(docsBefore['github.json'])
    expect(docsAfter['shares.json']).toBe(docsBefore['shares.json'])

    const done = await importDrawAppData({ drawDir, userData, store })
    expect(done?.files).toEqual(['sharing.json'])
    expect(done?.library).toEqual(['components/arrow.excalidrawlib', 'components/arrow.png', 'components/components.json'])
    const after = await snapshot(userData)
    expect(after['secrets.json']).toBe(secretsBefore['secrets.json'])
    expect(after[path.join('library', 'media.json')]).toBe(secretsBefore[path.join('library', 'media.json')])
    // A Docs pref that is not the default keeps its value; the defaults take Draw's.
    expect(store.get().settings.canvas.laserColor).toBe('#00c853')
    expect(store.get().settings.canvas.gridModeEnabled).toBe(true)
    expect(done?.settings).not.toContain('canvas.laserColor')
  })

  it('never writes a malformed Docs favorites.json', async () => {
    await put(path.join(vault, '.yaseendocs', 'favorites.json'), '{ not json')
    expect((await importDrawVault(vault))?.favorites).toBe(0)
    expect(await readFile(path.join(vault, '.yaseendocs', 'favorites.json'), 'utf8')).toBe('{ not json')
  })

  it('keeps the cap of 500: Draw entries fill only what is left', async () => {
    const docs = Array.from({ length: MAX_FAVORITES - 1 }, (_, i) => `n${i}.md`)
    await Promise.all(docs.map((rel) => put(path.join(vault, rel), '')))
    await put(path.join(vault, '.yaseendocs', 'favorites.json'), json({ version: 1, favorites: docs }))
    expect((await importDrawVault(vault))?.favorites).toBe(1)
    const { favorites } = (await readJson(path.join(vault, '.yaseendocs', 'favorites.json'))) as { favorites: string[] }
    expect(favorites).toEqual([...docs, 'b.excalidraw'])
  })
})

describe('a second run', () => {
  it('changes nothing, also without the marker', async () => {
    await importDrawAppData({ drawDir, userData, store })
    await importDrawVault(vault)
    await store.flush() // the state file's own debounced write lands now, not between the snapshots
    const docsVault = await snapshot(path.join(vault, '.yaseendocs'))
    const docsData = await snapshot(userData)
    const settings = store.get().settings

    expect(await importDrawAppData({ drawDir, userData, store })).toEqual({ library: [], files: [], settings: [] })
    expect(await importDrawVault(vault)).toEqual({ favorites: 0, files: [] })
    expect(await snapshot(path.join(vault, '.yaseendocs'))).toEqual(docsVault)
    expect(await snapshot(userData)).toEqual(docsData)
    expect(store.get().settings).toBe(settings) // no commit at all
    await store.flush()
    expect(await snapshot(userData)).toEqual(docsData)
  })
})

describe('Draw files', () => {
  it('are never changed, moved or deleted: same bytes, mtimes and modes', async () => {
    // Old mtimes, so a rewrite of the same bytes would still show.
    for (const dir of [drawDir, path.join(vault, '.yaseendraw')]) {
      for (const rel of Object.keys(await snapshot(dir))) await utimes(path.join(dir, rel), 1_000_000, 1_000_000)
    }
    const draw = await snapshot(drawDir)
    const drawVault = await snapshot(path.join(vault, '.yaseendraw'))
    const importer = createDrawImporter({ drawDir, userData, store, appData: true })
    importer.vaultsOpened([vault])
    await importer.idle()
    await importDrawAppData({ drawDir, userData, store })
    await importDrawVault(vault)
    expect(await snapshot(drawDir)).toEqual(draw)
    expect(await snapshot(path.join(vault, '.yaseendraw'))).toEqual(drawVault)
  })
})

describe('the importer and its marker', () => {
  it('runs each half once, records it, and the next launch skips the work', async () => {
    const first = createDrawImporter({ drawDir, userData, store, appData: true, now: () => 42 })
    first.vaultsOpened([vault])
    first.vaultsOpened([vault]) // the same root again in this process: nothing queued
    await first.idle()
    expect(await readJson(path.join(userData, 'draw-import.json'))).toEqual({ version: 1, appData: 42, vaults: { [vault]: 42 } })

    // The user removes a favorite and turns sync off in Docs; a later launch must not undo that.
    await put(path.join(vault, '.yaseendocs', 'favorites.json'), json({ version: 1, favorites: ['a.md'] }))
    await rm(path.join(vault, '.yaseendocs', 'github.json'))
    await rm(path.join(userData, 'sharing.json'))
    const next = createDrawImporter({ drawDir, userData, store, appData: true })
    next.vaultsOpened([vault])
    await next.idle()
    expect(await readJson(path.join(vault, '.yaseendocs', 'favorites.json'))).toEqual({ version: 1, favorites: ['a.md'] })
    expect(await exists(path.join(vault, '.yaseendocs', 'github.json'))).toBe(false)
    expect(await exists(path.join(userData, 'sharing.json'))).toBe(false)
  })

  it('records nothing for a vault without .yaseendraw/, or when Draw never ran here, and creates no Docs folder in the vault', async () => {
    const plain = path.join(tmp, 'plain')
    await put(path.join(plain, 'n.md'), '')
    await rm(drawDir, { recursive: true })
    const importer = createDrawImporter({ drawDir, userData, store, appData: true })
    importer.vaultsOpened([plain])
    await importer.idle()
    expect(await exists(path.join(plain, '.yaseendocs'))).toBe(false)
    expect(await exists(path.join(userData, 'draw-import.json'))).toBe(false)
    expect(await importDrawAppData({ drawDir, userData, store })).toBeNull()
    expect(await importDrawVault(plain)).toBeNull()
  })

  it('leaves app data alone when the app-data half is off', async () => {
    const importer = createDrawImporter({ drawDir, userData, store, appData: false })
    importer.vaultsOpened([vault])
    await importer.idle()
    expect(await exists(path.join(userData, 'secrets.json'))).toBe(false)
    expect(await exists(path.join(userData, 'library'))).toBe(false)
    expect(store.get().settings.canvas).toEqual(DEFAULT_CANVAS_PREFS)
    expect(await readJson(path.join(userData, 'draw-import.json'))).toEqual({ version: 1, vaults: { [vault]: expect.any(Number) } })
  })

  it('startDrawImport looks at the open vaults now and on each store change', async () => {
    const other = path.join(tmp, 'other')
    await put(path.join(other, 'x.excalidraw'), '{}')
    await put(path.join(other, '.yaseendraw', 'github.json'), json({ enabled: true }))
    const rootsOf = (s: { windows: Array<{ roots: string[] }> }): string[] => [...new Set(s.windows.flatMap((w) => w.roots))]
    store.upsertWindow({ id: 'w1', root: vault, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } } as never)
    const importer = startDrawImport({ drawDir, userData, store, appData: false, rootsOf })
    await importer.idle()
    expect(await exists(path.join(vault, '.yaseendocs', 'github.json'))).toBe(true)
    store.upsertWindow({ id: 'w2', root: other, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } } as never)
    await importer.idle()
    expect(await readJson(path.join(other, '.yaseendocs', 'github.json'))).toEqual({ enabled: true })
  })
})

describe("Draw's own library folder", () => {
  it('is the source when Draw set one', async () => {
    const custom = path.join(tmp, 'Synced', 'Library')
    await put(path.join(custom, 'media.json'), json({ version: 1, items: [{ id: 'custom' }] }))
    const state = (await readJson(path.join(drawDir, 'yaseendraw.json'))) as { settings: Record<string, unknown> }
    state.settings.libraryFolder = custom
    await put(path.join(drawDir, 'yaseendraw.json'), json(state))
    expect((await importDrawAppData({ drawDir, userData, store }))?.library).toEqual(['media.json'])
    expect(await readJson(path.join(userData, 'library', 'media.json'))).toEqual({ version: 1, items: [{ id: 'custom' }] })
  })
})

describe('createFileOnce', () => {
  it('creates with the mode from the first byte, and never writes over a file', async () => {
    const file = path.join(tmp, 'once.json')
    expect(await createFileOnce(file, Buffer.from('one'), 0o600)).toBe(true)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await createFileOnce(file, Buffer.from('two'))).toBe(false)
    expect(await readFile(file, 'utf8')).toBe('one')
    expect((await readdir(tmp)).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
})

describe('fillSettings', () => {
  it('fills defaults only, ignores invalid Draw values, and answers null when nothing changes', () => {
    expect(fillSettings(DEFAULT_SETTINGS, null)).toBeNull()
    expect(fillSettings(DEFAULT_SETTINGS, { canvas: DEFAULT_CANVAS_PREFS, diagramDarkColors: 'adapt' })).toBeNull()
    expect(fillSettings(DEFAULT_SETTINGS, { canvas: { zenModeEnabled: 'yes', vectorStrokeWidth: 0 }, diagramDarkColors: 'nope' })).toBeNull()
    const filled = fillSettings(DEFAULT_SETTINGS, { canvas: { zenModeEnabled: true } })
    expect(filled?.filled).toEqual(['canvas.zenModeEnabled'])
    expect(filled?.settings.canvas.zenModeEnabled).toBe(true)
    const docs = { ...DEFAULT_SETTINGS, diagramDarkColors: 'keep' as const }
    expect(fillSettings(docs, { diagramDarkColors: 'adapt' })).toBeNull()
  })
})

describe('shouldImportDrawAppData', () => {
  it('is off for an isolated profile and under the e2e harness', () => {
    expect(shouldImportDrawAppData({})).toBe(true)
    expect(shouldImportDrawAppData({ YASEEN_DOCS_USER_DATA_DIR: '  ' })).toBe(true)
    expect(shouldImportDrawAppData({ YASEEN_DOCS_USER_DATA_DIR: '/tmp/demo' })).toBe(false)
    expect(shouldImportDrawAppData({ YASEEN_DOCS_E2E: '1' })).toBe(false)
  })
})
