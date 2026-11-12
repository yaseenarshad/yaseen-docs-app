import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { isRecord } from '@shared/guards'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * A vault's note card review settings as the UI sees them (YAZ-4959 D14): `.yaseendocs/review.json` through the
 * generic vault-config door, sanitised on the way in, re-read whenever that file changes — a write from another
 * window, or one that arrived by sync. A vault with no file has the defaults, and nothing is created until `save`.
 * While the file is not valid JSON the settings stay as they were. Each vault's scope owns ONE of these.
 */
export interface ReviewSettingsState {
  settings: ReviewSettings
  /** Shown at once; a write that fails falls back to what the file holds. Refused, with a notice, over a file that is not valid JSON. */
  save: (next: ReviewSettings) => void
}

/**
 * Each open vault's settings, by root (YAZ-4967): the folder tables' "Due" column reads them with the root it has
 * (`useVaultReviewSettings`), so no prop goes through the editor. `useReviewSettings` publishes; the same object
 * until the settings change, so the count cache (`cardDueAt`) keeps its entries.
 */
const published = new Map<string, ReviewSettings>()
const listeners = new Set<() => void>()
function publish(root: string, settings: ReviewSettings | null): void {
  if (settings === null) published.delete(root)
  else published.set(root, settings)
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The settings of the vault at `root`, as its scope last read them; undefined for a vault no scope has open. */
export function useVaultReviewSettings(root: string | null | undefined): ReviewSettings | undefined {
  return useSyncExternalStore(subscribe, () => (root == null ? undefined : published.get(root)))
}

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the defaults. */
export function useReviewSettings(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void): ReviewSettingsState {
  const [settings, setSettings] = useState(DEFAULT_REVIEW_SETTINGS)
  const malformed = useRef(false)
  // The file as last read: a key this build does not know is written back as it was.
  const held = useRef<Record<string, unknown>>({})

  useEffect(() => {
    if (root === null) return
    publish(root, settings)
    return () => publish(root, null)
  }, [root, settings])

  useEffect(() => {
    setSettings(DEFAULT_REVIEW_SETTINGS)
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
          setSettings(sanitizeReviewSettings(raw))
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
    (next: ReviewSettings) => {
      if (root === null) return
      if (malformed.current) return onNotice(`Can't save the review settings: ${REVIEW_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = sanitizeReviewSettings(next)
      setSettings(clean)
      api.vaultConfig.write(root, REVIEW_SETTINGS_FILE, { ...held.current, ...clean }).catch(() =>
        api.vaultConfig.read(root, REVIEW_SETTINGS_FILE).then(
          (raw) => setSettings(sanitizeReviewSettings(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice],
  )

  return { settings, save }
}
