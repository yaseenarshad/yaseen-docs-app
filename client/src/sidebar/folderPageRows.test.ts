import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type IndexRecord } from '@shared/types'
import { folderPageRows, showFolderPageFiles } from './folderPageRows'

/** A folder's `.folder.md` record, as the index lists it in `folders`: its `folder` names the folder it configures. */
const folderRecord = (folder: string, properties: Record<string, unknown> = {}): IndexRecord => ({
  path: `/v/${folder === '' ? '' : `${folder}/`}.folder.md`,
  name: '.folder.md',
  basename: '.folder',
  title: folder,
  folder,
  ext: 'md',
  size: 1,
  ctime: 1,
  mtime: 1,
  properties,
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
})

describe('folderPageRows: which folders show their page file row (YAZ-4587, D37)', () => {
  const folders = [folderRecord('Areas'), folderRecord('Projects'), folderRecord('Projects/Alpha'), folderRecord('Projects/Alpha/Notes')]

  it('global off: no rows', () => {
    expect([...folderPageRows('/v', folders, false)]).toEqual([])
  })

  it('global on: a row for every folder with a page file, by its absolute path; the vault root has none; a trailing slash on the root changes nothing', () => {
    for (const root of ['/v', '/v/']) expect([...folderPageRows(root, [folderRecord(''), ...folders], true)]).toEqual(['/v/Areas', '/v/Projects', '/v/Projects/Alpha', '/v/Projects/Alpha/Notes'])
  })

  it("a folder's override on covers that folder and every folder below it, with the global off", () => {
    const on = [folderRecord('Areas'), folderRecord('Projects', { show_page_file: true }), folderRecord('Projects/Alpha'), folderRecord('Projects/Alpha/Notes')]
    expect([...folderPageRows('/v', on, false)]).toEqual(['/v/Projects', '/v/Projects/Alpha', '/v/Projects/Alpha/Notes'])
  })

  it('a nested override off wins inside it: the nearest rule wins', () => {
    const mixed = [folderRecord('Areas'), folderRecord('Projects', { show_page_file: true }), folderRecord('Projects/Alpha', { show_page_file: false }), folderRecord('Projects/Alpha/Notes')]
    expect([...folderPageRows('/v', mixed, false)]).toEqual(['/v/Projects'])
    // And on again below an off.
    const back = [...mixed.slice(0, 3), folderRecord('Projects/Alpha/Notes', { show_page_file: true })]
    expect([...folderPageRows('/v', back, false)]).toEqual(['/v/Projects', '/v/Projects/Alpha/Notes'])
  })

  it("an override off covers a folder with the global on; the root's own override covers the whole vault", () => {
    expect([...folderPageRows('/v', [folderRecord('Areas', { show_page_file: false }), folderRecord('Projects')], true)]).toEqual(['/v/Projects'])
    expect([...folderPageRows('/v', [folderRecord('', { show_page_file: true }), ...folders], false)]).toHaveLength(4)
  })

  it('a value that is not true or false is no override: the folder follows the rule above it', () => {
    const odd = [folderRecord('Projects', { show_page_file: 'yes' }), folderRecord('Projects/Alpha', { show_page_file: null })]
    expect([...folderPageRows('/v', odd, false)]).toEqual([])
    expect([...folderPageRows('/v', odd, true)]).toEqual(['/v/Projects', '/v/Projects/Alpha'])
  })
})

describe('showFolderPageFiles: the global switch (YAZ-4587, D37)', () => {
  it('off by default; on only when Settings › Folder pages says so', () => {
    expect(showFolderPageFiles(DEFAULT_SETTINGS)).toBe(false)
    expect(showFolderPageFiles({ ...DEFAULT_SETTINGS, folderPages: { ...DEFAULT_SETTINGS.folderPages, showFolderPageFiles: true } })).toBe(true)
  })
})
