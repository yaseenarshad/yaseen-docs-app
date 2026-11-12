import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_UPKEEP_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeUpkeepSettings, type UpkeepSettings } from './upkeepLegacy'
import { isRecord } from '@shared/guards'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * A vault's review settings as the UI sees them (YAZ-2322 🔒 D7): `.yaseendocs/review.json`
 * through the generic vault-config door, sanitised on the way in, re-read whenever that file
 * changes — a write from another window, or one that arrived by sync. A vault with no file has the
 * defaults — upkeep off — and nothing is created until `save`. While the file is not valid JSON
 * the settings stay as they were. App owns ONE of these.
 */
export interface ReviewSettingsState {
  settings: UpkeepSettings
  /** Shown at once; a write that fails falls back to what the file holds. Refused, with a notice, over a file that is not valid JSON. */
  save: (next: UpkeepSettings) => void
}

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the defaults. */
export function useReviewSettings(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void): ReviewSettingsState {
  const [settings, setSettings] = useState(DEFAULT_UPKEEP_SETTINGS)
  const malformed = useRef(false)
  // The file as last read (YAZ-4959 shim): `review.json` now holds the note card settings too, and a save keeps them.
  const held = useRef<Record<string, unknown>>({})

  useEffect(() => {
    setSettings(DEFAULT_UPKEEP_SETTINGS)
    malformed.current = false
    held.current = {}
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, REVIEW_SETTINGS_FILE).then(
        (raw) => {
          if (!live) return
          malformed.current = false
          held.current = isRecord(raw) ? raw : {}
          setSettings(sanitizeUpkeepSettings(raw))
        },
        (err: unknown) => {
          if (live) malformed.current = err instanceof BridgeRequestError && err.code === 'INVALID_CONFIG'
        },
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === REVIEW_SETTINGS_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root])

  const save = useCallback(
    (next: UpkeepSettings) => {
      if (root === null) return
      if (malformed.current) return onNotice(`Can't save the review settings: ${REVIEW_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = sanitizeUpkeepSettings(next) // one field's edit can make another invalid: a first wait raised past the longest
      setSettings(clean)
      api.vaultConfig.write(root, REVIEW_SETTINGS_FILE, { ...held.current, ...clean }).catch(() =>
        api.vaultConfig.read(root, REVIEW_SETTINGS_FILE).then(
          (raw) => setSettings(sanitizeUpkeepSettings(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice],
  )

  return { settings, save }
}
