import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { api } from '../api'

/**
 * A vault's review settings as the UI sees them (YAZ-2322 🔒 D7): `.yaseendocs/review.json`
 * through the generic vault-config door, sanitised on the way in, re-read whenever that file
 * changes — a write from another window, or one that arrived by sync. A vault with no file has the
 * defaults, and nothing is created until `save`. App owns ONE of these.
 */
export interface ReviewSettingsState {
  settings: ReviewSettings
  /** Shown at once; a write that fails falls back to what the file holds. */
  save: (next: ReviewSettings) => void
}

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the defaults. */
export function useReviewSettings(root: string | null): ReviewSettingsState {
  const [settings, setSettings] = useState(DEFAULT_REVIEW_SETTINGS)

  useEffect(() => {
    setSettings(DEFAULT_REVIEW_SETTINGS)
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, REVIEW_SETTINGS_FILE).then(
        (raw) => live && setSettings(sanitizeReviewSettings(raw)),
        () => undefined,
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
    (next: ReviewSettings) => {
      if (root === null) return
      const clean = sanitizeReviewSettings(next) // one field's edit can make another invalid: a first wait raised past the longest
      setSettings(clean)
      api.vaultConfig.write(root, REVIEW_SETTINGS_FILE, clean).catch(() =>
        api.vaultConfig.read(root, REVIEW_SETTINGS_FILE).then(
          (raw) => setSettings(sanitizeReviewSettings(raw)),
          () => undefined,
        ),
      )
    },
    [root],
  )

  return { settings, save }
}
