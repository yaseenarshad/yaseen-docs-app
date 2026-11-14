// rename-note-to-page: skip-file (these cases hold the old names on purpose)
/**
 * YAZ-5036: the names that said "note" in a vault's `.folder.md` and in the window's remembered boxes move to "page"
 * once (`shared/legacyNames.ts`): the old file reads with every value kept, and a write holds only the new names.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { folderSettingsLinks, mapFolderSettingsLinks } from '@shared/folderSettingsLinks'
import { movedHotkeyId, movedStorageItem, movedView } from '@shared/legacyNames'
import type { IndexRecord } from '@shared/types'
import { savedLayerBox } from '../explore/layers'
import { folderSettings } from './folderSettings'
import { savedPageWindowBox } from './view/PageWindow'
import { subfoldersOf } from './viewSchema'

const rec = (properties: Record<string, unknown>): IndexRecord =>
  ({ path: '/v/Team/.folder.md', title: 'Team', basename: '.folder', folder: 'Team', properties, links: [], tags: [], aliases: [], mtime: 1, size: 1 }) as unknown as IndexRecord

/** A `.folder.md` block as a build before YAZ-5036 wrote it. */
const OLD_BLOCK = {
  views: [{ type: 'table', name: 'T', subfolders: 'notes', fills: [{ note: '[[Plan]]', fill: 'red' }, { note: '[[Goal]]', column: 'status', fill: 'blue' }] }],
  other_files_keep_notes: ['[[Archive]]'],
}

describe('a folder page`s `.folder.md` from before the rename', () => {
  it('reads with every value: Subfolders "Their pages", each fill on its page, the "Move the folder only" list', () => {
    const settings = folderSettings(rec({ folder_settings: OLD_BLOCK }), true)
    expect(settings.problems).toEqual([])
    expect(settings.views[0]).toMatchObject({ subfolders: 'pages', fills: [{ page: '[[Plan]]', fill: 'red' }, { page: '[[Goal]]', column: 'status', fill: 'blue' }] })
    expect(JSON.stringify(settings.views)).not.toContain('"note"')
    expect(subfoldersOf(settings.views[0])).toBe('pages')
    expect(settings.otherFilesKeepPages).toEqual(['[[Archive]]'])
  })

  it('a new key that is there already wins over its old key', () => {
    const settings = folderSettings(rec({ folder_settings: { ...OLD_BLOCK, other_files_keep_pages: ['[[New]]'] } }), true)
    expect(settings.otherFilesKeepPages).toEqual(['[[New]]'])
    expect(movedView({ type: 'table', name: 'T', fills: [{ note: '[[A]]', page: '[[B]]', fill: 'red' }] }).fills).toEqual([{ page: '[[B]]', fill: 'red' }])
  })

  it('a file rename finds the links under the old names, and its write holds only the new names', () => {
    expect(folderSettingsLinks({ folder_settings: OLD_BLOCK })).toEqual(['[[Plan]]', '[[Goal]]', '[[Archive]]'])
    const moved = mapFolderSettingsLinks({ folder_settings: OLD_BLOCK }, (link) => (link === '[[Plan]]' ? '[[Plans]]' : link === '[[Archive]]' ? '[[Old]]' : undefined))
    const value = moved?.value as Record<string, unknown>
    expect(value.other_files_keep_pages).toEqual(['[[Old]]'])
    expect(value).not.toHaveProperty('other_files_keep_notes')
    expect((value.views as { fills: unknown[] }[])[0].fills).toEqual([{ page: '[[Plans]]', fill: 'red' }, { page: '[[Goal]]', column: 'status', fill: 'blue' }])
  })

  it('a current file is the same object: nothing to move', () => {
    const view = { type: 'table', name: 'T', subfolders: 'rows', fills: [{ page: '[[A]]', fill: 'red' }] }
    expect(movedView(view)).toBe(view)
  })
})

describe('the hotkey IDs', () => {
  it('note.<x> → page.<x>, dailyNote → dailyPage, an aside keeps its place; any other ID as it is', () => {
    expect(['note.bold', 'dailyNote', 'app.dailyNote', 'app.dailyNote@code', 'diagram.insertNote', 'app.search'].map(movedHotkeyId)).toEqual(['page.bold', 'dailyPage', 'app.dailyPage', 'app.dailyPage@code', 'diagram.insertNote', 'app.search'])
  })
})

describe('the remembered boxes (localStorage)', () => {
  afterEach(() => localStorage.clear())

  it("a folder page's mini window box under `noteWindow:<folder>` moves to the new key once", () => {
    localStorage.setItem('noteWindow:/v/Team', JSON.stringify({ placed: { x: 10, y: 20 }, width: 500, height: 300 }))
    expect(savedPageWindowBox('/v/Team')).toEqual({ placed: { x: 10, y: 20 }, width: 500, height: 300 })
    expect(localStorage.getItem('noteWindow:/v/Team')).toBeNull()
    expect(localStorage.getItem('pageWindow:/v/Team')).not.toBeNull()
    expect(savedPageWindowBox('/v/Team')).toEqual({ placed: { x: 10, y: 20 }, width: 500, height: 300 })
  })

  it("the explore stack's page box under `explore:box:note` moves to `explore:box:page` once", () => {
    localStorage.setItem('explore:box:note', JSON.stringify({ x: 1, y: 2, width: 300, height: null }))
    expect(savedLayerBox('page')).toEqual({ x: 1, y: 2, width: 300, height: null })
    expect(localStorage.getItem('explore:box:note')).toBeNull()
    expect(localStorage.getItem('explore:box:page')).not.toBeNull()
  })

  it('a new key wins; neither key: null', () => {
    const store = new Map<string, string>([['a', 'new'], ['b', 'old']])
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    expect(movedStorageItem(s, 'a', 'b')).toBe('new')
    expect(store.get('b')).toBe('old')
    expect(movedStorageItem(s, 'c', 'd')).toBeNull()
  })
})
