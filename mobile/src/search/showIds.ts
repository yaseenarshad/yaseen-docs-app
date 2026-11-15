import { useEffect, useState } from 'react'
import { SHOW_IDS_FILE, idInFiles, sanitizeShowIds, type IdsInFiles } from '@shared/showIds'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { useApp } from '../app/AppState'
import { readJson, type VaultData } from './vaultData'

/** How a page row shows its ID: the vault's "In the files list" when it is on. */
export type IdsForm = Exclude<IdsInFiles, 'off'>

/** The choice last read for each vault, so a tree drawn again does not first draw without its IDs. */
const held = new Map<string, IdsForm | null>()

/**
 * THE VAULT'S "SHOW IDS IN THE FILES LIST" ON THE PHONE (YAZ-5454): `.yaseendocs/show-ids.json`, read by the Mac's own
 * rule (`sanitizeShowIds`, `@shared/showIds`): Off (the default, and with no file), Number ("#12") or Full ("DEMO-12").
 * Read only. Read again at each sync (`data` is new after each `changed` event), so the Mac's change shows at once.
 * Null: Off.
 */
export function useIdsForm(data: VaultData): IdsForm | null {
  const { services } = useApp()
  const [form, setForm] = useState(() => held.get(data.vault) ?? null)
  useEffect(() => {
    let live = true
    void readJson(services.store, data.vault, `${VAULT_CONFIG_DIR}/${SHOW_IDS_FILE}`).then((raw) => {
      const files = sanitizeShowIds(raw).files
      const next = files === 'off' ? null : files
      held.set(data.vault, next)
      if (live) setForm(next)
    })
    return () => {
      live = false
    }
  }, [services.store, data])
  return form
}

/**
 * The ID at the right end of a row of `path` (the Mac's `tree__id`, `Tree.tsx`), or null: only a page or card file with
 * an ID, as the Mac's files list (`useAllPathIds`: the index records' `id`). Never a folder.
 */
export function rowId(data: VaultData, path: string, form: IdsForm | null): string | null {
  const id = form === null ? undefined : data.byPath[path]?.id
  return id === undefined || form === null ? null : idInFiles(id, form)
}

/** Forgets the choices read (a test starts clean). */
export const forgetIdsForms = (): void => held.clear()
