import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defaultAppState, type AppState } from '@shared/types'
import { DEFAULT_LIBRARY_DIR, ensureLibraryFolder, followLibraryFolder, makeLibraryDir, resolveLibraryFolder } from './folder'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-library-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('resolveLibraryFolder (🔒 YAZ-1775 D5)', () => {
  it('null means `<userData>/library` — the default no vault has to know about', () => {
    expect(resolveLibraryFolder(null, '/Users/x/Application Support/Yaseen Docs')).toBe(path.join('/Users/x/Application Support/Yaseen Docs', DEFAULT_LIBRARY_DIR))
  })

  it('a chosen path is used as it stands — pointing it inside a synced vault IS the backup story', () => {
    expect(resolveLibraryFolder('/Users/x/Vault/Library', '/anything')).toBe('/Users/x/Vault/Library')
  })

  it('with a settings folder and no chosen path, the default is `<settings folder>/library`; a chosen path still wins (YAZ-4364)', () => {
    const there = () => true
    expect(resolveLibraryFolder(null, '/data', '/Sync/settings', there)).toBe(path.join('/Sync/settings', DEFAULT_LIBRARY_DIR))
    expect(resolveLibraryFolder(null, '/data', null, there)).toBe(path.join('/data', DEFAULT_LIBRARY_DIR))
    expect(resolveLibraryFolder('/Vault/Library', '/data', '/Sync/settings', there)).toBe('/Vault/Library')
  })

  it('a settings folder that is gone (renamed, drive out) gives `<userData>/library`, the library the move kept (YAZ-4383)', async () => {
    const settings = path.join(dir, 'Sync', 'settings')
    expect(resolveLibraryFolder(null, '/data', settings)).toBe(path.join('/data', DEFAULT_LIBRARY_DIR))
    await mkdir(settings, { recursive: true })
    expect(resolveLibraryFolder(null, '/data', settings)).toBe(path.join(settings, DEFAULT_LIBRARY_DIR))
  })
})

describe('followLibraryFolder', () => {
  it('answers the folder now, then reports each other folder the setting names, and nothing for any other change', () => {
    let state = defaultAppState()
    const listeners: Array<(s: AppState) => void> = []
    const change = (next: AppState) => listeners.forEach((l) => l((state = next)))
    const moves: string[] = []
    const store = { get: () => state, onChange: (l: (s: AppState) => void) => (listeners.push(l), () => undefined) }
    const settings = dir // a settings folder that is there
    expect(followLibraryFolder(store, '/data', (f) => moves.push(f))).toBe(path.join('/data', DEFAULT_LIBRARY_DIR))
    change({ ...state, recents: [] })
    change({ ...state, settings: { ...state.settings, libraryFolder: '/Vault/Library' } })
    change({ ...state, settings: { ...state.settings, libraryFolder: '/Vault/Library' } })
    change({ ...state, settings: { ...state.settings, libraryFolder: null } })
    // A settings folder moves the default (YAZ-4364); with a chosen path it changes nothing.
    change({ ...state, settingsFolder: settings })
    change({ ...state, settings: { ...state.settings, libraryFolder: '/Vault/Library' } })
    change({ ...state, settingsFolder: null })
    expect(moves).toEqual(['/Vault/Library', path.join('/data', DEFAULT_LIBRARY_DIR), path.join(settings, DEFAULT_LIBRARY_DIR), '/Vault/Library'])
  })
})

describe('ensureLibraryFolder', () => {
  it('creates the default folder and answers where it is', async () => {
    const folder = await ensureLibraryFolder(null, dir)
    expect(folder).toBe(path.join(dir, DEFAULT_LIBRARY_DIR))
    expect((await stat(folder)).isDirectory()).toBe(true)
  })

  it('creates a chosen folder, parents and all, and is safe to run again', async () => {
    const chosen = path.join(dir, 'a', 'b', 'Library')
    expect(await ensureLibraryFolder(chosen, dir)).toBe(chosen)
    expect(await ensureLibraryFolder(chosen, dir)).toBe(chosen)
    expect((await stat(chosen)).isDirectory()).toBe(true)
  })

  it('a folder it CANNOT create is still the answer — a launch must not fail over it', async () => {
    // A file where the folder should be: mkdir will refuse, and the row still says where it should be.
    const blocked = path.join(dir, 'blocked')
    await writeFile(blocked, 'not a folder')
    await expect(ensureLibraryFolder(blocked, dir)).resolves.toBe(blocked)
  })
})

describe('makeLibraryDir (YAZ-4383)', () => {
  it('makes the library folder and a folder in it, and is safe to run again', async () => {
    const library = path.join(dir, DEFAULT_LIBRARY_DIR)
    await makeLibraryDir(library, 'favorites')
    await makeLibraryDir(library, 'favorites')
    expect((await stat(path.join(library, 'favorites'))).isDirectory()).toBe(true)
  })

  it('never makes a missing parent: a settings folder that is gone does not come back', async () => {
    const gone = path.join(dir, 'Sync', 'settings')
    await expect(makeLibraryDir(path.join(gone, DEFAULT_LIBRARY_DIR), 'favorites')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(dir)).toEqual([])
  })
})
