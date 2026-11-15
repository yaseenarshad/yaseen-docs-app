import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TABLE_LOOK_FILE, TABLE_LOOK_KEYS, sanitizeTableLook, tableLookFile, tableLookOf, tableLookSettings, type TableLook, type TableLookSettings } from '@shared/tableLook'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * A vault's table look and new-table defaults as the UI sees them (YAZ-5487): `.yaseendocs/table-look.json` through the
 * generic vault-config door, sanitised on the way in, read again whenever that file changes (another window, a sync).
 * The pattern of `useCardLook` (YAZ-5484) and `useTextFormatting`. `look` is null while the vault has NO file: the app's
 * settings then draw its tables (the fallback), and nothing is created until `save`. A file that is not valid JSON
 * shows the defaults (`{}`), and a save does not write over it. `useVaultScope` owns one for each vault.
 */
export interface TableLookState {
  /** The file's look (only what differs from the defaults), or null with no file. Its identity changes only when the look does. */
  look: TableLook | null
  /** The 21 settings the file gives (each one it leaves out the default), or null with no file. Same identity as long as `look`'s. */
  settings: TableLookSettings | null
  /** The 21 settings: written at once (only what differs from the defaults); a write that fails reads the file again. */
  save: (next: TableLookSettings) => void
}

/** A file with nothing but its version: one object, so a reload of the same file hands out the same look. */
const EMPTY: TableLook = Object.freeze({})
const settled = (raw: unknown): TableLook => {
  const clean = sanitizeTableLook(raw)
  return Object.keys(clean).length === 0 ? EMPTY : clean
}
const same = (a: TableLook | null, b: TableLook | null): boolean => a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))

/** `root` is nullable because the scope hooks cannot be conditional: no vault, no bridge call, no file. */
export function useTableLook(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void): TableLookState {
  const [look, setLook] = useState<TableLook | null>(null)
  const malformed = useRef(false)
  const keep = useCallback((next: TableLook | null) => setLook((prev) => (same(prev, next) ? prev : next)), [])

  useEffect(() => {
    setLook(null)
    malformed.current = false
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, TABLE_LOOK_FILE).then(
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
      if (c.root === root && c.name === TABLE_LOOK_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root, keep])

  const save = useCallback(
    (next: TableLookSettings) => {
      if (root === null) return
      if (malformed.current) return onNotice(`Can't save the table look: ${TABLE_LOOK_FILE} is not valid JSON`, 'error')
      const clean = settled(tableLookOf(next))
      keep(clean)
      api.vaultConfig.write(root, TABLE_LOOK_FILE, tableLookFile(clean), TABLE_LOOK_KEYS).catch(() =>
        api.vaultConfig.read(root, TABLE_LOOK_FILE).then(
          (raw) => keep(raw === null || raw === undefined ? null : settled(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice, keep],
  )

  const settings = useMemo(() => (look === null ? null : tableLookSettings(look)), [look])
  return { look, settings, save }
}
