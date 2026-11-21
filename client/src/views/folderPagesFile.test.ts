/**
 * folder-pages.json (YAZ-5489, which replaces YAZ-4585 D34): the vault's 27 folder page view and page defaults
 * (`shared/folderPages.ts`); the personal parts stay the Mac's. Made-up values.
 */
import { describe, expect, it } from 'vitest'
import { FOLDER_PAGES_CHOICES, FOLDER_PAGES_LINE_MAX, FOLDER_PAGES_PERSONAL, FOLDER_PAGES_VAULT_PARTS, folderPagesFile, folderPagesFor, folderPagesOf, folderPagesVault, sanitizeFolderPagesFile } from '@shared/folderPages'
import { DEFAULT_FOLDER_PAGES, FOLDER_PAGE_CHOICES, MAX_CAL_LINE } from '@shared/types'

describe('folder-pages.json (shared/folderPages.ts)', () => {
  it('the 27 vault parts and the 5 personal ones are every Settings › Folder pages part, once', () => {
    expect(FOLDER_PAGES_VAULT_PARTS).toHaveLength(27)
    expect([...FOLDER_PAGES_VAULT_PARTS, ...FOLDER_PAGES_PERSONAL].sort()).toEqual(Object.keys(DEFAULT_FOLDER_PAGES).sort())
    // The choices and the line width, written out for the phone's first load, are types.ts'.
    const { weekStartsOn: _personal, cardClickOpens: _click, ...vaultChoices } = FOLDER_PAGE_CHOICES
    expect(FOLDER_PAGES_CHOICES).toEqual(vaultChoices)
    expect(FOLDER_PAGES_LINE_MAX).toBe(MAX_CAL_LINE)
  })

  it('the sanitiser keeps each part that reads and drops each one that does not, alone; never a personal part', () => {
    expect(sanitizeFolderPagesFile({ version: 1, rowHeight: 'tall', rowNumbers: 'no', weekLine: 3, dayLine: 99, weekLineColor: 'blue light', dayLineColor: 'sparkly', columnMarks: 'name', weekStartsOn: 'monday', askBeforeDelete: false, later: 1 })).toEqual({ rowHeight: 'tall', weekLine: 3, weekLineColor: 'blue light', columnMarks: 'name' })
    expect(sanitizeFolderPagesFile('nope')).toEqual({})
  })

  it('the file holds only what differs from the defaults; the key-by-key resolve puts the vault\'s parts over the app\'s, the personal ones the app\'s', () => {
    const app = { ...DEFAULT_FOLDER_PAGES, subfolders: 'rows' as const, hideWeekends: true, weekStartsOn: 'monday' as const, rowBand: false }
    const file = folderPagesOf(app)
    expect(file).toEqual({ subfolders: 'rows', hideWeekends: true })
    expect(folderPagesFile(file)).toEqual({ version: 1, subfolders: 'rows', hideWeekends: true })
    expect(folderPagesOf(DEFAULT_FOLDER_PAGES)).toEqual({})
    const vault = folderPagesVault({ rowHeight: 'medium' })
    // A vault with a file: its parts (each it leaves out the default, not the app's), the app's personal parts.
    expect(folderPagesFor(app, vault)).toEqual({ ...DEFAULT_FOLDER_PAGES, rowHeight: 'medium', weekStartsOn: 'monday', rowBand: false })
    // No file: the app's, whole.
    expect(folderPagesFor(app, null)).toBe(app)
  })
})
