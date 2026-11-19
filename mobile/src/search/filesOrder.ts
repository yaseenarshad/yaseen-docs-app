import { useEffect, useState } from 'react'
import { filesOrderFiles, filesOrderOf } from '@shared/filesOrder'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { pickNewest } from '@shared/vaultLists'
import type { VaultStore } from '../store'
import { readJson, type VaultData } from './vaultData'
import type { TreeView } from './vaultTree'

/**
 * THE MAC'S MANUAL FILES ORDER ON THE PHONE (YAZ-5916 D4): the newest valid `.yaseendocs/files-order.<mac id>.json`
 * of the vault, by the Mac's own rule (`@shared/filesOrder`, `pickNewest`). The file carries that Mac's Files sort (Q4):
 * the tree sorts as it says — Manual by the saved order, Name or Last updated as that. No valid file: Name, A to Z, as
 * before. Read only: the phone does not reorder.
 */
const CONFIG = `${VAULT_CONFIG_DIR}/`

const read = new WeakMap<VaultData, Promise<TreeView | null>>()

export function loadFilesOrder(store: VaultStore, data: VaultData): Promise<TreeView | null> {
  let held = read.get(data)
  if (held === undefined) {
    const names = data.files.flatMap((f) => (f.startsWith(CONFIG) && !f.includes('/', CONFIG.length) ? [f.slice(CONFIG.length)] : []))
    held = Promise.all(filesOrderFiles(names).map((name) => readJson(store, data.vault, `${CONFIG}${name}`).catch(() => undefined)))
      .then((values) => {
        const newest = pickNewest(values, filesOrderOf)
        return newest === null ? null : { sort: newest.sort, folders: newest.folders }
      })
      .catch(() => null)
    read.set(data, held)
  }
  return held
}

/** The vault's Files sort and order once read; null while it is read, and when the vault has no valid file. */
export function useFilesOrder(store: VaultStore, data: VaultData): TreeView | null {
  const [order, setOrder] = useState<{ data: VaultData; order: TreeView | null } | null>(null)
  useEffect(() => {
    let live = true
    void loadFilesOrder(store, data).then((next) => live && setOrder({ data, order: next }))
    return () => {
      live = false
    }
  }, [store, data])
  return order?.order ?? null
}
