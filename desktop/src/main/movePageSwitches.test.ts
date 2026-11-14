import { describe, expect, it } from 'vitest'
import { defaultAppState, defaultFolderState, type AppState } from '@shared/types'
import { movePageSwitches, type MovedList } from './movePageSwitches'

/** The one-time move of the page switches from the app state into the pages (YAZ-4094 G4). */

const missing = Object.assign(new Error('gone'), { code: 'ENOENT' })

function setup(files: Record<string, string | Error>, folder: Partial<ReturnType<typeof defaultFolderState>>) {
  const state: AppState = { ...defaultAppState(), folders: { '/v': { ...defaultFolderState(), ...folder } } }
  const dropped: string[] = []
  const writes: Record<string, string> = {}
  const store = {
    get: () => state,
    dropPageSwitch: (root: string, file: string, list: MovedList) => {
      dropped.push(`${list}:${file}`)
      const { [file]: _gone, ...rest } = state.folders[root][list]
      state.folders[root] = { ...state.folders[root], [list]: rest }
    },
  }
  /** Each file's mtime; a test moves one between the read and the write with `onRead`. */
  const mtimes: Record<string, number> = {}
  let onRead = (_file: string): void => undefined
  const io = {
    readFile: async (file: string) => {
      const found = files[file]
      if (found === undefined || found instanceof Error) throw found ?? missing
      onRead(file)
      return found
    },
    mtime: async (file: string) => {
      if (files[file] === undefined) throw missing
      return mtimes[file] ?? 1
    },
    write: async (file: string, content: string | Uint8Array) => {
      if (file.includes('locked')) throw new Error('EACCES')
      writes[file] = String(content)
      files[file] = String(content)
      return { mtime: 1, size: 1 }
    },
  }
  return { store, io, dropped, writes, state, mtimes, readHook: (hook: (file: string) => void) => (onRead = hook) }
}

describe('movePageSwitches', () => {
  it('writes each page entry into its note, then drops it; a code file keeps its entry', async () => {
    const { store, io, dropped, writes, state } = setup(
      { '/v/a.md': '# A\n', '/v/b.md': '---\ntags: [x]\n---\nB\n' },
      { tocSwitches: { '/v/a.md': false, '/v/code.ts': false }, sectionIndents: { '/v/b.md': true } },
    )
    await movePageSwitches(store, io)
    expect(writes).toEqual({ '/v/b.md': '---\ntags: [x]\nsection-indent: true\n---\nB\n', '/v/a.md': '---\ntoc: false\n---\n# A\n' })
    expect(dropped.sort()).toEqual(['sectionIndents:/v/b.md', 'tocSwitches:/v/a.md'])
    expect(state.folders['/v'].tocSwitches).toEqual({ '/v/code.ts': false })
    expect(state.folders['/v'].sectionIndents).toEqual({})
  })

  it('a page that already holds the value is not written; a gone page or a block that does not parse drops its entry; a page that cannot be read or written now keeps it', async () => {
    const { store, io, dropped, writes, state } = setup(
      { '/v/same.md': '---\ntoc: false\n---\n', '/v/bad.md': '---\nkey: [\n---\n', '/v/locked.md': '# L\n', '/v/busy.md': new Error('EIO') },
      { tocSwitches: { '/v/same.md': false, '/v/gone.md': true, '/v/bad.md': false, '/v/locked.md': false, '/v/busy.md': true } },
    )
    await movePageSwitches(store, io)
    expect(writes).toEqual({})
    expect(dropped.sort()).toEqual(['tocSwitches:/v/bad.md', 'tocSwitches:/v/gone.md', 'tocSwitches:/v/same.md'])
    expect(state.folders['/v'].tocSwitches).toEqual({ '/v/locked.md': false, '/v/busy.md': true })
  })

  it('a page that already holds the key keeps its own value, also another one: the entry only goes (YAZ-4119 fix 5)', async () => {
    const { store, io, dropped, writes, state } = setup(
      { '/v/synced.md': '---\ntoc: true\n---\n', '/v/indent.md': '---\nsection-indent: false\n---\n' },
      { tocSwitches: { '/v/synced.md': false }, sectionIndents: { '/v/indent.md': true } },
    )
    await movePageSwitches(store, io)
    expect(writes).toEqual({})
    expect(dropped.sort()).toEqual(['sectionIndents:/v/indent.md', 'tocSwitches:/v/synced.md'])
    expect(state.folders['/v'].tocSwitches).toEqual({})
    expect(state.folders['/v'].sectionIndents).toEqual({})
  })

  it('a second run finds nothing left to move and writes nothing', async () => {
    const { store, io, dropped, writes } = setup({ '/v/a.md': '# A\n' }, { tocSwitches: { '/v/a.md': false } })
    await movePageSwitches(store, io)
    expect(writes).toEqual({ '/v/a.md': '---\ntoc: false\n---\n# A\n' })
    await movePageSwitches(store, io)
    expect(Object.keys(writes)).toEqual(['/v/a.md'])
    expect(dropped).toEqual(['tocSwitches:/v/a.md'])
  })

  it('a page written between the read and the write (an autosave) is not written over: the entry stays for the next launch', async () => {
    const { store, io, dropped, writes, state, mtimes, readHook } = setup({ '/v/busy.md': '# B\n', '/v/calm.md': '# C\n' }, { tocSwitches: { '/v/busy.md': false, '/v/calm.md': false } })
    readHook((file) => {
      if (file === '/v/busy.md') mtimes[file] = 2
    })
    await movePageSwitches(store, io)
    expect(writes).toEqual({ '/v/calm.md': '---\ntoc: false\n---\n# C\n' })
    expect(dropped).toEqual(['tocSwitches:/v/calm.md'])
    expect(state.folders['/v'].tocSwitches).toEqual({ '/v/busy.md': false })
  })
})
