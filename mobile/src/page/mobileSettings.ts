import { useEffect, useState } from 'react'
import type { MobileSettingKey, MobileSettings } from '@shared/mobileSettings'
import { useApp } from '../app/AppState'
import type { CommentsPort } from '../comments/bridge'
import { MOBILE_SETTINGS_PATH, isVaultSetting, readMobileText } from '../comments/mobileWrite'
import type { WaitingComment } from '../comments/outbox'
import type { VaultStore } from '../store'
import type { VaultData } from '../search/vaultData'

/**
 * THE VAULT'S MOBILE SETTINGS ON THE PHONE (YAZ-5592): `.yaseendocs/mobile.json` from the phone's copy of the vault
 * (the vault-config door's folder, `shared/mobileSettings.ts`), WITH the changes this phone made that GitHub does not
 * hold yet (the comments' list, `mobileWrite.ts`), so a change shows at once, and stays shown until the file says it.
 * Read again at each sync (the vault's data is new) and each change of the list.
 *
 * A page's own setting wins (`pageOwnSwitch`): `effectiveSwitch`.
 */

/** The last settings read for each vault, so a page drawn again does not first draw with the defaults. */
const held = new Map<string, MobileSettings>()

/** `file` with the waiting changes on it, in the order they were made (a refused one changes nothing). */
export function withWaiting(file: MobileSettings, waiting: readonly WaitingComment[]): MobileSettings {
  const out = { ...file }
  for (const c of waiting) if (c.refused === undefined && isVaultSetting(c.setting)) out[c.setting.key] = c.setting.on
  return out
}

/** The settings the phone shows: the stored file with the waiting changes. */
export async function readMobileSettings(store: VaultStore, vault: string, port: CommentsPort | null): Promise<MobileSettings> {
  // The list first: an entry that settles meanwhile was in the stored file before it left the list (the send's pass).
  const waiting = port?.waiting(MOBILE_SETTINGS_PATH) ?? []
  let text: string | null = null
  try {
    const file = await store.read(vault, MOBILE_SETTINGS_PATH)
    text = file === null ? null : typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
  } catch {
    text = null
  }
  return withWaiting(readMobileText(text), waiting)
}

/** A page's own choice wins; none: the vault's. */
export const effectiveSwitch = (own: boolean | undefined, vault: boolean): boolean => own ?? vault

export interface MobileSettingsHandle {
  /** Undefined until first read (none held for the vault). */
  settings: MobileSettings | undefined
  /** Null: the phone has no write path for this vault. */
  set: ((key: MobileSettingKey, on: boolean) => Promise<void>) | null
}

/**
 * The open vault's mobile settings, and their change (on the comments' safe path). `data`: the vault's data (read again
 * at each new version, a sync); `port`: the comments' list (`useCommentsPort`), null with no write path.
 */
export function useMobileSettings(data: VaultData | null, port: CommentsPort | null): MobileSettingsHandle {
  const app = useApp()
  const { store } = app.services
  const vault = app.vaultKey
  const [settings, setSettings] = useState<{ vault: string; value: MobileSettings } | null>(() => (vault !== null && held.has(vault) ? { vault, value: held.get(vault)! } : null))
  const [reads, setReads] = useState(0)
  useEffect(() => (port === null ? undefined : port.subscribe(() => setReads((n) => n + 1))), [port])
  useEffect(() => {
    if (vault === null) return
    let live = true
    void readMobileSettings(store, vault, port).then((value) => {
      held.set(vault, value)
      if (live) setSettings((now) => (now !== null && now.vault === vault && sameSettings(now.value, value) ? now : { vault, value }))
    })
    return () => {
      live = false
    }
  }, [store, vault, port, data, reads])
  const value = settings !== null && settings.vault === vault ? settings.value : vault !== null ? held.get(vault) : undefined
  const set =
    port === null
      ? null
      : async (key: MobileSettingKey, on: boolean) => {
          await port.add({ path: MOBILE_SETTINGS_PATH, body: '', setting: { file: 'mobile', key, on } })
          setReads((n) => n + 1)
        }
  return { settings: value, set }
}

const sameSettings = (a: MobileSettings, b: MobileSettings) => a.folding === b.folding && a.stickyHeadings === b.stickyHeadings && a.fitTables === b.fitTables && a.titleRoom === b.titleRoom

/**
 * YAZ-5591: the settings read ahead with the reader (`warmPage`), so the first page or panel of a session draws with the
 * file's values; a page never waits for them (none read yet: both on, then the arrows and the stuck headings switch).
 */
export async function primeMobileSettings(store: VaultStore, vault: string): Promise<void> {
  if (held.has(vault)) return
  const value = await readMobileSettings(store, vault, null)
  if (!held.has(vault)) held.set(vault, value)
}

/** Forgets the settings read (a test starts clean). */
export const forgetMobileSettings = (): void => held.clear()
