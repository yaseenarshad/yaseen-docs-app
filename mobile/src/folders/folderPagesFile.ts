import { useEffect, useState } from 'react'
import { DEFAULT_FOLDER_PAGES } from '@shared/folderPagesDefault'
import { FOLDER_PAGES_FILE, folderPagesFor, folderPagesVault, sanitizeFolderPagesFile } from '@shared/folderPages'
import { VAULT_CONFIG_DIR, type FolderPagesSettings } from '@shared/types'
import type { VaultStore } from '../store'
import type { VaultData } from '../search/vaultData'

/**
 * THE VAULT'S FOLDER PAGE DEFAULTS ON THE PHONE: the Mac's 27 view and page defaults of Settings › Folder
 * pages live in the vault's `.yaseendocs/folder-pages.json` (`shared/folderPages.ts`); a folder page here reads them
 * from the phone's copy, so a view with no key of its own draws as the Mac draws it. The personal parts (week start,
 * row band, keep pinned, ask before delete) are each Mac's: the phone keeps the Mac's defaults. No file, or one that is
 * not JSON: the Mac's defaults (`DEFAULT_FOLDER_PAGES`), as before. Read once for each version of the vault's data, in
 * the folder page's chunk. The phone never writes the file.
 */
const read = new WeakMap<VaultData, Promise<FolderPagesSettings>>()

export function loadFolderPages(store: VaultStore, data: VaultData): Promise<FolderPagesSettings> {
  let held = read.get(data)
  if (held === undefined) {
    held = (async () => {
      const file = await store.read(data.vault, `${VAULT_CONFIG_DIR}/${FOLDER_PAGES_FILE}`)
      if (file === null) return DEFAULT_FOLDER_PAGES
      const raw: unknown = JSON.parse(typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content))
      return folderPagesFor(DEFAULT_FOLDER_PAGES, folderPagesVault(sanitizeFolderPagesFile(raw)))
    })().catch(() => DEFAULT_FOLDER_PAGES)
    read.set(data, held)
  }
  return held
}

/** The vault's folder page defaults; undefined until first read (the page waits for them, a few ms, so its views draw once). */
export function useFolderPages(store: VaultStore, data: VaultData | null): FolderPagesSettings | undefined {
  const [held, setHeld] = useState<{ data: VaultData; pages: FolderPagesSettings } | null>(null)
  useEffect(() => {
    if (data === null) return
    let live = true
    void loadFolderPages(store, data).then((pages) => live && setHeld({ data, pages }))
    return () => {
      live = false
    }
  }, [store, data])
  // A new version of the data keeps the defaults it had until its own are read.
  return data === null ? undefined : held?.pages
}
