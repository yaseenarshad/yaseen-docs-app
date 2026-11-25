import { useSyncExternalStore } from 'react'
import type { RowDates, SortMenuTab } from '@shared/types'
import { storage } from '../lib/storage'

const encode = (d: RowDates): string => `${+d.files}${+d.focus}${+d.favorites}${+d.search}`

/**
 * Per-vault "Show last updated" switches (YAZ-6529), persisted on `FolderState.rowDates` in `yaseendocs.json`.
 * Reads the window's primary vault (`vaults[0]`), falling back to `fallback` (`settings.rowDates`) when that
 * vault has not saved its own yet. Writing updates each vault open in this window independently of other vaults.
 */
export function useVaultRowDates(vaults: readonly { root: string }[], fallback: RowDates): [RowDates, (tab: SortMenuTab, on: boolean) => void] {
  const primary = vaults[0]?.root ?? null
  const key = useSyncExternalStore(storage.subscribe, () => {
    const saved = primary === null ? null : storage.getFolderRowDates(primary)
    return saved === null ? '' : encode(saved)
  })
  const rowDates: RowDates =
    key === '' ? fallback : { files: key[0] === '1', focus: key[1] === '1', favorites: key[2] === '1', search: key[3] === '1' }
  const setTabDate = (tab: SortMenuTab, on: boolean): void => {
    for (const v of vaults) {
      const base = storage.getFolderRowDates(v.root) ?? fallback
      storage.setFolderRowDates(v.root, { ...base, [tab]: on })
    }
  }
  return [rowDates, setTabDate]
}
