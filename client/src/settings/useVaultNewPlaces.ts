import { useCallback, useEffect, useRef, useState } from 'react'
import { isRecord } from '@shared/guards'
import { NEW_PLACES_FILE, NEW_PLACES_SETTINGS_KEYS, sanitizeVaultNewPlaces, vaultNewPlacesFile, type VaultNewPlaces } from '@shared/newPlaces'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * Where new things go in a vault (YAZ-5486): the `newPage` and `newBoard` keys of `.yaseendocs/new-places.json`, beside
 * the New… box's shortcuts (`places`), through the vault-config door; the shape of `useTextFormatting`. Read when the
 * vault opens and again when the file changes; a key the file lacks is the app's value (`vaultNewPlacesFields`). A file
 * that is not valid JSON reads as no keys and refuses a save, with a notice. A save writes only a change, keeps the
 * shortcuts (they are not its keys), and gives a file with no shortcuts the three empty ones an older build needs.
 * `useVaultScope` owns one for each vault.
 */
export interface VaultNewPlacesState {
  /** The file's keys, sanitised; `{}` with no file. Its identity changes only when the file does. */
  value: VaultNewPlaces
  save: (next: VaultNewPlaces) => void
}

export const NO_NEW_PLACES: VaultNewPlaces = Object.freeze({})

export function useVaultNewPlaces(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void): VaultNewPlacesState {
  const [value, setValue] = useState<VaultNewPlaces>(NO_NEW_PLACES)
  const malformed = useRef(false)
  const hasPlaces = useRef(false)
  const held = useRef(value)
  held.current = value

  useEffect(() => {
    setValue(NO_NEW_PLACES)
    malformed.current = false
    hasPlaces.current = false
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, NEW_PLACES_FILE).then(
        (raw) => {
          if (!live) return
          malformed.current = false
          hasPlaces.current = isRecord(raw) && Array.isArray(raw.places)
          const clean = sanitizeVaultNewPlaces(raw)
          setValue((was) => (JSON.stringify(was) === JSON.stringify(clean) ? was : Object.keys(clean).length === 0 ? NO_NEW_PLACES : clean))
        },
        (err: unknown) => {
          if (!live || !(err instanceof BridgeRequestError && err.code === 'INVALID_CONFIG')) return
          malformed.current = true
          setValue(NO_NEW_PLACES)
        },
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === NEW_PLACES_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root])

  const save = useCallback(
    (next: VaultNewPlaces) => {
      if (root === null) return
      if (malformed.current) return onNotice(`Can't save where new things go: ${NEW_PLACES_FILE} is not valid JSON`, 'error')
      const clean = sanitizeVaultNewPlaces(next)
      if (JSON.stringify(clean) === JSON.stringify(held.current)) return
      setValue(clean)
      const withPlaces = !hasPlaces.current
      hasPlaces.current = true
      api.vaultConfig.write(root, NEW_PLACES_FILE, vaultNewPlacesFile(clean, withPlaces), NEW_PLACES_SETTINGS_KEYS).catch(() =>
        api.vaultConfig.read(root, NEW_PLACES_FILE).then(
          (raw) => setValue(sanitizeVaultNewPlaces(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice],
  )

  return { value, save }
}
