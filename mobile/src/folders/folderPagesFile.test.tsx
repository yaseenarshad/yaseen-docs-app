// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_FILES } from '../dev/folderVault'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import type { Harness } from '../screens/testing'
import { forgetFolderTabs } from './FolderBody'
import { openFolder, waitFor } from './folderTesting'

/**
 * YAZ-5489: the phone's folder page reads the vault's folder page defaults (`.yaseendocs/folder-pages.json`, the Mac's
 * Settings › Folder pages view and page defaults): a view or folder with no key of its own draws as the Mac draws it.
 * No file: the Mac's defaults, as before. Made-up vault.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  forgetFolderTabs()
  document.body.replaceChildren()
})

const opened = async (file: object | null): Promise<Harness> => {
  const x = await openFolder('Projects', file === null ? FOLDER_FILES : { ...FOLDER_FILES, '.yaseendocs/folder-pages.json': JSON.stringify(file) })
  await waitFor(x, () => (x.host.querySelector('.folder-page__text')?.textContent ?? '').includes('Every project'))
  return x
}

describe('YAZ-5489: the folder page reads folder-pages.json', () => {
  const other = (x: Harness) => [...x.host.querySelectorAll('.folder-other__row')].map((r) => r.textContent)

  it('the vault says Show Other files Off: the page moved there is back in the views; a part that does not read is the default', async () => {
    h = await opened({ version: 1, showOtherFiles: false, rowHeight: 'huge' })
    expect(other(h)).toEqual(['Budget sheet.pdfPDF'])
    expect(h.host.querySelector('.folder-view')?.textContent).toContain('Old plan')
  })

  it('no file: the Mac\'s defaults, as before (the moved page in the tray)', async () => {
    h = await opened(null)
    expect(other(h)).toEqual(['Budget sheet.pdfPDF', 'Old planPage'])
  })
})
