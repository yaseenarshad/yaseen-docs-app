import { toDisplay } from '@shared/hotkeyBindings'
import { keyRow, keysOf } from '@shared/keys'
import { storage } from './storage'

/** A key row's first key as it is now, as a menu or a tooltip writes it ('⌘⇧U'); undefined with no key. */
export const hintOf = (rowId: string): string | undefined => {
  const row = keyRow(rowId)
  const key = row === undefined ? undefined : keysOf(row, storage.getSettings()?.hotkeys)[0]
  return key === undefined ? undefined : key.split(' ').map(toDisplay).join(' ')
}
