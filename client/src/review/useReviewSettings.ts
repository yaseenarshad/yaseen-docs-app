import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { isRecord } from '@shared/guards'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * A vault's card review settings as the UI sees them (YAZ-4959 D14): `.yaseendocs/review.json` through the
 * generic vault-config door, sanitised on the way in, re-read whenever that file changes — a write from another
 * window, or one that arrived by sync. A vault with no file has the defaults, and nothing is created until `save`.
 * While the file is not valid JSON the settings stay as they were. Each vault's scope owns ONE of these.
 */
export interface ReviewSettingsState {
  settings: ReviewSettings
  /** Shown at once; a write that fails falls back to what the file holds. Refused, with a notice, over a file that is not valid JSON. */
  save: (next: ReviewSettings) => void
  /** The vault's file has been read (or found missing): `settings` are the vault's, not the defaults shown while it loads (YAZ-5120). */
  ready?: boolean
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

/**
 * `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the defaults. `idsOff`
 * (YAZ-5154): the vault's index says it gives no IDs. Cards need IDs, so the settings PUBLISHED for the card features
 * (search, the Card type, Move to its own file, a card file's Inbox tools, the folder tables' Due) say off; the file
 * and `settings` stay as they are, so turning IDs back on brings Cards back.
 */
export function useReviewSettings(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void, idsOff = false): ReviewSettingsState {
  const [settings, setSettings] = useState(DEFAULT_REVIEW_SETTINGS)
  // Which vault's file was last read: the settings are that vault's from then on (`ready`).
  const [readRoot, setReadRoot] = useState<string | null>(null)
  const live = useRef(settings)
  live.current = settings
  const malformed = useRef(false)
  // The file as last read: a key this build does not know is written back as it was.
  const held = useRef<Record<string, unknown>>({})

  useEffect(() => {
    if (root === null) return
    publish(root, idsOff && settings.enabled ? { ...settings, enabled: false } : settings)
    return () => publish(root, null)
  }, [root, settings, idsOff])

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
          setReadRoot(root)
        },
        (err: unknown) => {
          if (!live) return
          malformed.current = err instanceof BridgeRequestError && err.code === 'INVALID_CONFIG'
          setReadRoot(root)
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
      // Only what changed goes into the file, over the file as read: a field never set keeps following the defaults.
      const before = live.current
      const changed = Object.fromEntries(Object.entries(clean).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof ReviewSettings])))
      setSettings(clean)
      held.current = { ...held.current, ...changed }
      api.vaultConfig.write(root, REVIEW_SETTINGS_FILE, held.current).catch(() =>
        api.vaultConfig.read(root, REVIEW_SETTINGS_FILE).then(
          (raw) => setSettings(sanitizeReviewSettings(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice],
  )

  return { settings, save, ready: root !== null && readRoot === root }
}

/**
 * Is the vault at `root`'s Review on (`review.json` `enabled`, Settings › Review)? Every card feature — New card, the
 * Cards type in search, the Card type, the Inbox — shows only while it is (YAZ-5037). A card file still opens without it.
 */
export const useReviewOn = (root: string | null | undefined): boolean => useVaultReviewSettings(root)?.enabled === true

/**
 * The roots of `roots` whose Review is on (YAZ-5037): the search of a window of many vaults lists the cards of these.
 * The same Set while the answer stays, so a list built from it is not built again.
 */
export function useReviewOnRoots(roots: readonly string[]): ReadonlySet<string> {
  const on = useSyncExternalStore(subscribe, () => roots.filter((root) => published.get(root)?.enabled === true).join('\n'))
  return useMemo(() => new Set(on === '' ? [] : on.split('\n')), [on])
}
