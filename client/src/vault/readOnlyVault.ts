/**
 * READ ONLY FOR THE WHOLE VAULT (YAZ-4939): Settings › This vault › "Read only", Off (default) · On, in
 * `.yaseendocs/read-only.json` through the vault-config door, as "Clicking a link" is (`linkClick.ts`): re-read when
 * the file changes, Off with no file, nothing written until `save`. With On every note, drawing, diagram, code tab,
 * folder page cell and property of the vault opens read only; the setting writes NOTHING into a note or a board (each
 * keeps its own switch, `shared/readOnly.ts`). `Editor` hands the vault's On to every page it draws through
 * `VaultReadOnly`; each page's timed "Allow edits" is its own (`useTimedUnlock`).
 *
 * THE VAULT'S FILE ACTIONS (Rename, Move, Delete, New, Paste, an undo or redo of them) ask "This vault is read only"
 * while it is On (YAZ-4985): **Just this once** (that one action, no allowance), **1 minute**, **10 minutes** or
 * **Cancel**. The two timed choices are ONE allowance for the vault, kept here: the sidebar's lock shows it as an amber
 * countdown with **Lock now**, and grants it too. One timer runs while it does, to lock again at zero (a render, so the
 * lock turns back). Each action reads it with the clock at that moment. The app's own writes (the ID sweep, link
 * rewrites after an allowed rename, the autosave of an unlocked page, sync, reviews) never ask.
 */
import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

export const READ_ONLY_VAULT_FILE = 'read-only.json'
export interface ReadOnlyVaultSettings {
  on: boolean
}
export const DEFAULT_READ_ONLY_VAULT: ReadOnlyVaultSettings = { on: false }

/** The two timed choices of the file-actions ask and of the sidebar's lock (YAZ-4985), as the page chip's. */
export type FileActionsFor = 'minute' | 'ten'
export const FILE_ACTIONS_ALLOW: Readonly<Record<FileActionsFor, number>> = { minute: 60_000, ten: 10 * 60_000 }
/** "10 minutes" of the file-actions ask. */
export const FILE_ACTIONS_ALLOW_MS = FILE_ACTIONS_ALLOW.ten

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
  /** A file action may run now: the vault is not read only, or a timed allowance still runs. Read at each action. */
  fileActionsAllowed: () => boolean
  /** "1 minute" or "10 minutes" (default): the vault's file actions, that long from now. */
  allowFileActions: (choice?: FileActionsFor) => void
  /** "Lock now": the allowance ends at once. */
  lockFileActions: () => void
  /** When the allowance ends (ms since the epoch), or null while none runs. Only the sidebar's lock draws it. */
  allowedUntil: number | null
}

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the default. */
export function useReadOnlyVault(root: string | null): ReadOnlyVaultState {
  const [settings, setSettings] = useState(DEFAULT_READ_ONLY_VAULT)
  const now = useRef(settings)
  now.current = settings
  /** When the file-actions allowance ends: a ref for the actions (read with the clock of the moment), state for the lock. */
  const allowedUntil = useRef(0)
  const [until, setUntil] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lockFileActions = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    allowedUntil.current = 0
    setUntil(null)
  }, [])
  /** Only a change renders: a vault with no file, or one that says what the state says, costs App no render (the editors' memo). */
  const show = useCallback((next: ReadOnlyVaultSettings) => setSettings((prev) => (prev.on === next.on ? prev : next)), [])
  useEffect(() => {
    show(DEFAULT_READ_ONLY_VAULT)
    // A vault that leaves the slot takes its allowance with it.
    lockFileActions()
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
  }, [root, show, lockFileActions])
  useEffect(() => () => clearTimeout(timer.current), [])
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
  const allowFileActions = useCallback((choice: FileActionsFor = 'ten') => {
    const ms = FILE_ACTIONS_ALLOW[choice]
    clearTimeout(timer.current)
    allowedUntil.current = Date.now() + ms
    setUntil(allowedUntil.current)
    // At zero it locks again by itself, and the lock turns back.
    timer.current = setTimeout(lockFileActions, ms)
  }, [lockFileActions])
  return { settings, save, fileActionsAllowed, allowFileActions, lockFileActions, allowedUntil: settings.on ? until : null }
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
