import { describe, expect, it } from 'vitest'
import { defaultAppState, defaultFolderState, type AppState } from '@shared/types'
import { movePageSwitches, type MovedList } from './movePageSwitches'

/** The one-time move of the page switches from the app state into the notes (YAZ-4094 G4). */

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
  const io = {
    readFile: async (file: string) => {
      const found = files[file]
      if (found === undefined || found instanceof Error) throw found ?? missing
      return found
    },
    write: async (file: string, content: string | Uint8Array) => {
      if (file.includes('locked')) throw new Error('EACCES')
      writes[file] = String(content)
      return { mtime: 1, size: 1 }
    },
  }
  return { store, io, dropped, writes, state }
}

describe('movePageSwitches', () => {
  it('writes each note entry into its note, then drops it; a code file keeps its entry', async () => {
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

  it('a note that already holds the value is not written; a gone note or a block that does not parse drops its entry; a note that cannot be read or written now keeps it', async () => {
    const { store, io, dropped, writes, state } = setup(
      { '/v/same.md': '---\ntoc: false\n---\n', '/v/bad.md': '---\nkey: [\n---\n', '/v/locked.md': '# L\n', '/v/busy.md': new Error('EIO') },
      { tocSwitches: { '/v/same.md': false, '/v/gone.md': true, '/v/bad.md': false, '/v/locked.md': false, '/v/busy.md': true } },
    )
    await movePageSwitches(store, io)
    expect(writes).toEqual({})
    expect(dropped.sort()).toEqual(['tocSwitches:/v/bad.md', 'tocSwitches:/v/gone.md', 'tocSwitches:/v/same.md'])
    expect(state.folders['/v'].tocSwitches).toEqual({ '/v/locked.md': false, '/v/busy.md': true })
  })
})
