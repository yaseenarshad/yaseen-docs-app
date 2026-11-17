// rename-note-to-page: skip-file (these cases hold the old names on purpose)
/**
 * YAZ-5036: the names that said "note" in a vault's `.folder.md` and in the window's remembered boxes move to "page"
 * once (`shared/legacyNames.ts`): the old file reads with every value kept, and a write holds only the new names.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { folderSettingsLinks, mapFolderSettingsLinks } from '@shared/folderSettingsLinks'
import { movedHotkeyId, movedKindExpr, movedStorageItem, movedView } from '@shared/legacyNames'
import type { IndexRecord } from '@shared/types'
import { savedLayerBox } from '../explore/layers'
import { runView } from './engine'
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

describe('a saved Type filter or formula on `note` (`file.kind` says `page` since YAZ-5036)', () => {
  const row = (path: string, name: string): IndexRecord =>
    ({ path, name, basename: name.replace(/\.md$/, ''), title: name, folder: 'Team', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }) as unknown as IndexRecord
  const RECORDS = [row('/v/Team/Plan.md', 'Plan.md'), row('/v/Team/Sub/.folder.md', '.folder.md')]
  /** A Type filter as the Filter menu wrote it before the rename, and the folder's formula that tested the same. */
  const OLD = {
    formulas: { isPage: 'if(file.kind == "note", "yes", "no")' },
    views: [
      { type: 'table', name: 'Pages', subfolders: 'rows', filters: 'file.kind == "note"' },
      { type: 'table', name: 'Folders', subfolders: 'rows', filters: { and: ["file.kind != 'note'", { not: ['["note"].contains(file.kind)'] }] } },
      { type: 'table', name: 'Either', subfolders: 'rows', filters: { or: ['"note" == file.kind', 'file.kind == "folder"'] } },
    ],
  }
  const settings = folderSettings(rec({ folder_settings: OLD }), true)
  const titles = (i: number) => runView({ views: settings.views, formulas: settings.formulas }, settings.views[i], RECORDS).rows.map((r) => r.record.title)

  it('reads as `page`: == and != with either quote, either side, an Is any of list, inside and / or / not', () => {
    expect(settings.views.map((v) => v.filters)).toEqual([
      'file.kind == "page"',
      { and: ["file.kind != 'page'", { not: ['["page"].contains(file.kind)'] }] },
      { or: ['"page" == file.kind', 'file.kind == "folder"'] },
    ])
    expect(settings.formulas).toEqual({ isPage: 'if(file.kind == "page", "yes", "no")' })
  })

  it('the rows match as before the rename: the page alone, the folder alone, both', () => {
    expect(titles(0)).toEqual(['Plan.md'])
    expect(titles(1)).toEqual(['.folder.md'])
    expect(titles(2)).toHaveLength(2)
  })

  it('leaves every other "note" alone: a property, another field, a word in a string', () => {
    for (const expr of ['note.kind == "note"', 'file.name == "note"', 'file.kind == "notes"', 'note.status == "note"', 'file.kind == "page"']) expect(movedKindExpr(expr)).toBe(expr)
    const view = { type: 'table', name: 'T', filters: { and: ['file.kind == "page"'] } }
    expect(movedView(view)).toBe(view)
  })
})

describe('a view with an invalid `outline` still moves (the checker`s finding 3)', () => {
  it('its fills and Subfolders read as `page`; the bad outline is dropped with a problem', () => {
    const settings = folderSettings(rec({ folder_settings: { views: [{ ...OLD_BLOCK.views[0], outline: 7 }] } }), true)
    expect(settings.problems).toHaveLength(1)
    expect(settings.views[0]).not.toHaveProperty('outline')
    expect(settings.views[0]).toMatchObject({ subfolders: 'pages', fills: [{ page: '[[Plan]]', fill: 'red' }, { page: '[[Goal]]', column: 'status', fill: 'blue' }] })
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
