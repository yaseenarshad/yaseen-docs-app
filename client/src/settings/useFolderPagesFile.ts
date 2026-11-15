import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FOLDER_PAGES_FILE, FOLDER_PAGES_KEYS, folderPagesFile, folderPagesOf, folderPagesVault, sanitizeFolderPagesFile, type FolderPagesFile, type FolderPagesVault } from '@shared/folderPages'
import type { FolderPagesSettings } from '@shared/types'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * A vault's folder page defaults as the UI sees them (YAZ-5489, which replaces YAZ-4585 D34): `.yaseendocs/folder-pages.json`
 * through the generic vault-config door, sanitised on the way in, read again whenever that file changes (another
 * window, a sync). The pattern of `useCardLook` (YAZ-5484). `file` is null while the vault has NO file: the app's
 * Settings › Folder pages then feed its views (the fallback), and nothing is created until `save`. A file that is not
 * valid JSON shows the defaults (`{}`), and a save does not write over it. `useVaultScope` owns one for each vault.
 */
export interface FolderPagesFileState {
  /** The file's parts (only what differs from the defaults), or null with no file. Its identity changes only when the file does. */
  file: FolderPagesFile | null
  /** The 27 parts the file gives (each one it leaves out the default), or null with no file. Same identity as long as `file`'s. */
  vault: FolderPagesVault | null
  /** The folder pages settings (the personal parts are left out): written at once (only the 27 parts that differ from the defaults). */
  save: (next: Partial<FolderPagesSettings>) => void
}

/** A file with nothing but its version: one object, so a reload of the same file hands out the same parts. */
const EMPTY: FolderPagesFile = Object.freeze({})
const settled = (raw: unknown): FolderPagesFile => {
  const clean = sanitizeFolderPagesFile(raw)
  return Object.keys(clean).length === 0 ? EMPTY : clean
}
const same = (a: FolderPagesFile | null, b: FolderPagesFile | null): boolean => a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))

/** `root` is nullable because the scope hooks cannot be conditional: no vault, no bridge call, no file. */
export function useFolderPagesFile(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void): FolderPagesFileState {
  const [file, setFile] = useState<FolderPagesFile | null>(null)
  const malformed = useRef(false)
  const keep = useCallback((next: FolderPagesFile | null) => setFile((prev) => (same(prev, next) ? prev : next)), [])

  useEffect(() => {
    setFile(null)
    malformed.current = false
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, FOLDER_PAGES_FILE).then(
        (raw) => {
          if (!live) return
          malformed.current = false
          keep(raw === null || raw === undefined ? null : settled(raw))
        },
        (err: unknown) => {
          if (!live || !(err instanceof BridgeRequestError && err.code === 'INVALID_CONFIG')) return
          malformed.current = true
          keep(EMPTY)
        },
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === FOLDER_PAGES_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root, keep])

  const save = useCallback(
    (next: Partial<FolderPagesSettings>) => {
      if (root === null) return
      if (malformed.current) return onNotice(`Can't save the folder page defaults: ${FOLDER_PAGES_FILE} is not valid JSON`, 'error')
      const clean = settled(folderPagesOf(next))
      keep(clean)
      api.vaultConfig.write(root, FOLDER_PAGES_FILE, folderPagesFile(clean), FOLDER_PAGES_KEYS).catch(() =>
        api.vaultConfig.read(root, FOLDER_PAGES_FILE).then(
          (raw) => keep(raw === null || raw === undefined ? null : settled(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice, keep],
  )

  const vault = useMemo(() => (file === null ? null : folderPagesVault(file)), [file])
  return { file, vault, save }
}
