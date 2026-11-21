/**
 * READ ONLY FOR THE WHOLE VAULT (YAZ-4939): Settings › This vault › "Read only", Off (default) · On, in
 * `.yaseendocs/read-only.json` through the vault-config door, as "Clicking a link" is (`linkClick.ts`): re-read when
 * the file changes, Off with no file, nothing written until `save`. With On every page, drawing, diagram, code tab,
 * folder page cell and property of the vault opens read only; the setting writes NOTHING into a page or a board (each
 * keeps its own switch, `shared/readOnly.ts`). `Editor` hands the vault's On to every page it draws through
 * `VaultReadOnly`; each page's timed "Allow edits" is its own (`useTimedUnlock`).
 *
 * THE VAULT'S UNLOCK (YAZ-5581, Option A): ONE allowance for the whole vault, kept here, in memory, per app run — never in
 * `read-only.json`, never synced, so no quit or crash leaves the vault open. The sidebar's lock grants it ("Unlock for 10
 * minutes" · "1 hour" · "Until I lock it") and shows it (an amber countdown and **Lock now**); the "This vault is read
 * only" sheet's timed choices start the same one. While it runs, `locked` is false: every page, card file, drawing,
 * diagram, code tab, Explore layer and folder table of the vault edits without asking, and file actions run. A file's
 * own `readonly: true` stays (each surface keeps its own switch), and so does a page's own "Allow edits?" once the vault
 * locks again. At zero, on Lock now, or on another window's Lock now (one allowance per vault across the app's windows,
 * through `VAULT_UNLOCK_CHANNEL`): each open surface first does what its own relock does (`beforeLock`: a page saves,
 * an Edit card is Done, an Explore layer goes back to reading), THEN the vault locks, in place.
 *
 * File actions (Rename, Move, Delete, New, Paste, an undo or redo of them) ask "This vault is read only" while it is
 * locked (YAZ-4985): **Just this once** (that one action, no allowance), the timed choices, or **Cancel**. The app's own
 * writes (the ID sweep, link rewrites after an allowed rename, autosave, sync, reviews) never ask.
 */
import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

export const READ_ONLY_VAULT_FILE = 'read-only.json'
export interface ReadOnlyVaultSettings {
  on: boolean
}
export const DEFAULT_READ_ONLY_VAULT: ReadOnlyVaultSettings = { on: false }
/** The keys this build's writer owns (YAZ-5483): every other key of the file is kept on a save. */
export const READ_ONLY_VAULT_KEYS: readonly string[] = Object.keys(DEFAULT_READ_ONLY_VAULT)

/** The unlock's choices (YAZ-5581): 10 minutes (the default, first), 1 hour, or until "Lock now" or the app quits. */
export type VaultUnlockFor = 'ten' | 'hour' | 'until'
export const VAULT_UNLOCK_MS: Readonly<Record<VaultUnlockFor, number>> = { ten: 10 * 60_000, hour: 60 * 60_000, until: Infinity }

/**
 * The windows of the app share each vault's unlock (YAZ-5581): one window's unlock or Lock now reaches the others, and a
 * new window asks for a running one. Renderer to renderer, same origin: no main process, nothing on disk.
 */
export const VAULT_UNLOCK_CHANNEL = 'yaseen-docs:vault-unlock'
type UnlockMessage = { root: string; until: number } | { root: string; lock: true } | { root: string; ask: true }

/** What a refused file action says (the sheet's first words; a folder page's create error). */
export const VAULT_READ_ONLY_TIP = 'This vault is read only'

/** What a refused file action says (the sheet's first words; a folder page's create error). */

/** What the file holds, or the default for anything else: only `true` counts, as a page's `readonly` does. */
export function sanitizeReadOnlyVault(raw: unknown): ReadOnlyVaultSettings {
  const on = typeof raw === 'object' && raw !== null ? (raw as { on?: unknown }).on : undefined
  return { on: on === true }
}

export interface ReadOnlyVaultState {
  settings: ReadOnlyVaultSettings
  save: (next: ReadOnlyVaultSettings) => void
  /** The vault locks its surfaces now: Read only is On and no unlock runs. What every page, card, table and code tab reads. */
  locked: boolean
  /** A file action may run now: the vault is not read only, or the unlock still runs. Read at each action. */
  fileActionsAllowed: () => boolean
  /** "Unlock for 10 minutes" (default) · "1 hour" · "Until I lock it": the whole vault, from now. */
  unlock: (choice?: VaultUnlockFor) => void
  /** "Lock now": each open surface saves, then the vault locks. */
  lock: () => void
  /** When the unlock ends (ms since the epoch; Infinity: until Lock now or quit), or null while none runs. The sidebar's lock draws it. */
  unlockedUntil: number | null
  /** A surface's own relock step (save, Done), run before the vault locks again; returns the unregister. Stable. */
  beforeLock: BeforeVaultLock
}

export type BeforeVaultLock = (step: () => Promise<unknown> | void) => () => void

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the default. */
export function useReadOnlyVault(root: string | null): ReadOnlyVaultState {
  const [settings, setSettings] = useState(DEFAULT_READ_ONLY_VAULT)
  const now = useRef(settings)
  now.current = settings
  /** When the unlock ends: a ref for the actions (read with the clock of the moment), state for the renders. */
  const unlockedUntil = useRef(0)
  const [until, setUntil] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Each unlock is a run; a relock lands only for the run it belongs to (an unlock during the saves wins). */
  const run = useRef(0)
  const steps = useRef(new Set<() => Promise<unknown> | void>())
  const channel = useRef<BroadcastChannel | null>(null)
  const rootRef = useRef(root)
  rootRef.current = root
  const tell = useCallback((message: UnlockMessage) => {
    try {
      channel.current?.postMessage(message)
    } catch {
      // A closed channel: this window alone.
    }
  }, [])
  /** Ends the unlock here: every surface's own step first, then the lock (the state, so each surface locks in place). */
  const relock = useCallback((): Promise<void> => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (unlockedUntil.current === 0) return Promise.resolve()
    const own = ++run.current
    const saves = [...steps.current].map((step) => {
      try {
        return Promise.resolve(step())
      } catch {
        return Promise.resolve()
      }
    })
    return Promise.allSettled(saves).then(() => {
      if (run.current !== own) return
      unlockedUntil.current = 0
      setUntil(null)
    })
  }, [])
  /** Starts (or moves) the unlock to `end` here; at zero it locks again by itself. */
  const open = useCallback((end: number) => {
    clearTimeout(timer.current)
    timer.current = undefined
    run.current++
    unlockedUntil.current = end
    setUntil(end)
    if (end !== Infinity) timer.current = setTimeout(() => void relock(), Math.max(0, end - Date.now()))
  }, [relock])
  /** Only a change renders: a vault with no file, or one that says what the state says, costs App no render (the editors' memo). */
  const show = useCallback((next: ReadOnlyVaultSettings) => setSettings((prev) => (prev.on === next.on ? prev : next)), [])
  useEffect(() => {
    show(DEFAULT_READ_ONLY_VAULT)
    // A vault that leaves the slot takes its unlock with it (here only: its other windows keep theirs).
    clearTimeout(timer.current)
    timer.current = undefined
    run.current++
    unlockedUntil.current = 0
    setUntil(null)
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
    const bc = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(VAULT_UNLOCK_CHANNEL)
    channel.current = bc
    if (bc !== null) {
      bc.onmessage = (event: MessageEvent<UnlockMessage>) => {
        const m = event.data
        if (!live || typeof m !== 'object' || m === null || m.root !== root) return
        if ('ask' in m) {
          if (unlockedUntil.current > Date.now()) bc.postMessage({ root, until: unlockedUntil.current } satisfies UnlockMessage)
        } else if ('lock' in m) void relock()
        else if (typeof m.until === 'number' && m.until > Date.now() && m.until !== unlockedUntil.current) open(m.until)
      }
      // A new window: is this vault unlocked in another one?
      bc.postMessage({ root, ask: true } satisfies UnlockMessage)
    }
    return () => {
      live = false
      unsubscribe()
      bc?.close()
      if (channel.current === bc) channel.current = null
    }
  }, [root, show, relock, open])
  useEffect(() => () => clearTimeout(timer.current), [])
  // YAZ-5649 item 4: a page's timers stop while the Mac sleeps, the clock does not. Back from sleep (the window shows
  // or takes focus) an unlock past its end relocks as the timer does: each surface's save step, then the lock.
  useEffect(() => {
    const check = (): void => {
      if (unlockedUntil.current !== 0 && Date.now() >= unlockedUntil.current) void relock()
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [relock])
  const save = useCallback(
    (next: ReadOnlyVaultSettings) => {
      if (root === null) return
      const clean = sanitizeReadOnlyVault(next)
      show(clean)
      api.vaultConfig.write(root, READ_ONLY_VAULT_FILE, clean, READ_ONLY_VAULT_KEYS).catch(() => api.vaultConfig.read(root, READ_ONLY_VAULT_FILE).then((raw) => show(sanitizeReadOnlyVault(raw)), () => undefined))
    },
    [root, show],
  )
  const fileActionsAllowed = useCallback(() => !now.current.on || Date.now() < unlockedUntil.current, [])
  const unlock = useCallback(
    (choice: VaultUnlockFor = 'ten') => {
      const end = Date.now() + VAULT_UNLOCK_MS[choice]
      open(end)
      if (rootRef.current !== null) tell({ root: rootRef.current, until: end })
    },
    [open, tell],
  )
  const lock = useCallback(() => {
    if (rootRef.current !== null) tell({ root: rootRef.current, lock: true })
    void relock()
  }, [relock, tell])
  const beforeLock = useCallback<BeforeVaultLock>((step) => {
    steps.current.add(step)
    return () => void steps.current.delete(step)
  }, [])
  const unlocked = settings.on ? until : null
  return { settings, save, locked: settings.on && unlocked === null, fileActionsAllowed, unlock, lock, unlockedUntil: unlocked, beforeLock }
}

/**
 * What a page reads of its vault (YAZ-4939): the vault's Read only, and the door a file action asks through ("This vault
 * is read only" › Allow for 10 minutes · Cancel; true = go on). `Editor` provides it; the default is a vault with no lock.
 */
export interface VaultReadOnlyScope {
  /** The vault locks this surface now (`ReadOnlyVaultState.locked`): false while the vault's unlock runs. */
  on: boolean
  allowFileAction: (root: string) => Promise<boolean>
  /** The vault's relock asks this surface's own relock step first (`useTimedUnlock` registers it). Absent: no unlock to end. */
  beforeLock?: BeforeVaultLock
}

export const NO_BEFORE_LOCK: BeforeVaultLock = () => () => undefined
export const NO_VAULT_READ_ONLY: VaultReadOnlyScope = { on: false, allowFileAction: () => Promise.resolve(true), beforeLock: NO_BEFORE_LOCK }

export const VaultReadOnly = createContext<VaultReadOnlyScope>(NO_VAULT_READ_ONLY)
