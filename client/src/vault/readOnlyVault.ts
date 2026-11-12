/**
 * READ ONLY FOR THE WHOLE VAULT (YAZ-4939): Settings › This vault › "Read only", Off (default) · On, in
 * `.yaseendocs/read-only.json` through the vault-config door, as "Clicking a link" is (`linkClick.ts`): re-read when
 * the file changes, Off with no file, nothing written until `save`. With On every note, drawing, diagram, code tab,
 * folder page cell and property of the vault opens read only; the setting writes NOTHING into a note or a board (each
 * keeps its own switch, `shared/readOnly.ts`). `Editor` hands the vault's On to every page it draws through
 * `VaultReadOnly`; each page's timed "Allow edits" is its own (`useTimedUnlock`).
 *
 * THE VAULT'S FILE ACTIONS (Rename, Move, Delete, New, Paste) ask "This vault is read only" while it is On, with "Allow
 * for 10 minutes": one allowance for the vault, kept here as a time, read at each action and never rendered, so it costs
 * no timer and no render. The app's own writes (the ID sweep, link rewrites after an allowed rename, the autosave of an
 * unlocked page) never ask.
 */
import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

export const READ_ONLY_VAULT_FILE = 'read-only.json'
export interface ReadOnlyVaultSettings {
  on: boolean
}
export const DEFAULT_READ_ONLY_VAULT: ReadOnlyVaultSettings = { on: false }

/** "Allow for 10 minutes" of the file-actions sheet. */
export const FILE_ACTIONS_ALLOW_MS = 10 * 60_000

/** What a refused file action says (the sheet's first words; a folder page's create error). */
export const VAULT_READ_ONLY_TIP = 'This vault is read only'

/** What the file holds, or the default for anything else: only `true` counts, as a note's `readonly` does. */
export function sanitizeReadOnlyVault(raw: unknown): ReadOnlyVaultSettings {
  const on = typeof raw === 'object' && raw !== null ? (raw as { on?: unknown }).on : undefined
  return { on: on === true }
}

export interface ReadOnlyVaultState {
  settings: ReadOnlyVaultSettings
  save: (next: ReadOnlyVaultSettings) => void
  /** A file action may run now: the vault is not read only, or "Allow for 10 minutes" still runs. Read at each action. */
  fileActionsAllowed: () => boolean
  /** "Allow for 10 minutes": the vault's file actions, that long from now. */
  allowFileActions: () => void
}

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the default. */
export function useReadOnlyVault(root: string | null): ReadOnlyVaultState {
  const [settings, setSettings] = useState(DEFAULT_READ_ONLY_VAULT)
  const now = useRef(settings)
  now.current = settings
  /** When the file-actions allowance ends; nothing to render, so a ref. A vault that leaves the slot takes it with it. */
  const allowedUntil = useRef(0)
  /** Only a change renders: a vault with no file, or one that says what the state says, costs App no render (the editors' memo). */
  const show = useCallback((next: ReadOnlyVaultSettings) => setSettings((prev) => (prev.on === next.on ? prev : next)), [])
  useEffect(() => {
    show(DEFAULT_READ_ONLY_VAULT)
    allowedUntil.current = 0
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, READ_ONLY_VAULT_FILE).then(
        (raw) => live && show(sanitizeReadOnlyVault(raw)),
        () => undefined,
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === READ_ONLY_VAULT_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root, show])
  const save = useCallback(
    (next: ReadOnlyVaultSettings) => {
      if (root === null) return
      const clean = sanitizeReadOnlyVault(next)
      show(clean)
      api.vaultConfig.write(root, READ_ONLY_VAULT_FILE, clean).catch(() => api.vaultConfig.read(root, READ_ONLY_VAULT_FILE).then((raw) => show(sanitizeReadOnlyVault(raw)), () => undefined))
    },
    [root, show],
  )
  const fileActionsAllowed = useCallback(() => !now.current.on || Date.now() < allowedUntil.current, [])
  const allowFileActions = useCallback(() => {
    allowedUntil.current = Date.now() + FILE_ACTIONS_ALLOW_MS
  }, [])
  return { settings, save, fileActionsAllowed, allowFileActions }
}

/**
 * What a page reads of its vault (YAZ-4939): the vault's Read only, and the door a file action asks through ("This vault
 * is read only" › Allow for 10 minutes · Cancel; true = go on). `Editor` provides it; the default is a vault with no lock.
 */
export interface VaultReadOnlyScope {
  on: boolean
  allowFileAction: (root: string) => Promise<boolean>
}

export const NO_VAULT_READ_ONLY: VaultReadOnlyScope = { on: false, allowFileAction: () => Promise.resolve(true) }

export const VaultReadOnly = createContext<VaultReadOnlyScope>(NO_VAULT_READ_ONLY)
