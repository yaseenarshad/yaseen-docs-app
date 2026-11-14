import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadAccount, type VaultAccount } from '../auth/account'
import type { SignInInput } from '../auth/check'
import { chooseFriendsVault, loadFriendsAccount, type FriendsAccount } from '../auth/friends'
import { forgetVaultAndToken, signIn, signInAgain, signOutAndErase, startState, type SignInOutcome } from '../auth/signIn'
import type { FetchLike } from '../github/client'
import type { PageMedia } from '../page/media'
import type { Scanner } from '../scan/scanner'
import { loadVaultList, openVault, openVaultOf, saveVaultList, vaultId, type KeepStorage, type PhoneVault, type TokenStore, type VaultList, type VaultStore } from '../store'
import type { FriendsPort, FriendsSettings } from './friendsPort'
import { navigate, openingTab, type NavAction, type NavState } from './nav'
import { IDLE, type ShellSync, type ShellSyncState } from './syncPort'
import { SAME_WORD, UNIT_WORD_PATH, readUnitWord, type UnitText } from './unitWord'

/**
 * The app's state and its actions: the one layer the screens (4A–4E) plug into. Every service is passed in, so
 * tests run the real sign-in logic (3E) and store (3A) with fakes for GitHub, the sync (3B), Friends (4E) and the
 * camera; `main.tsx` passes the real ones.
 */
export interface AppServices {
  store: VaultStore
  tokens: TokenStore
  /** 3B's engine (`lazySync`), or a fake in tests. */
  sync: ShellSync
  /** 4E's Friends, or `localFriends(store)` until it lands. */
  friends: FriendsPort
  scanner: Scanner
  /**
   * 4C (YAZ-5079): one file's bytes for the reader (a picture, a sound, a PDF). 3D's `MediaAhead` (`mobile/src/media`)
   * when it is wired; absent, the reader reads the store only (`storedMedia`).
   */
  media?: PageMedia
  /** The GitHub calls of the sign-in check. Default: the browser's `fetch`. Tests pass `fakeGithub(…).fetch`. */
  fetch?: FetchLike
  now?: () => number
  keepStorage?: () => Promise<KeepStorage>
}

/**
 * - `loading`: reading the phone's storage. No network call.
 * - `sign-in`: no vault on the phone (row F1).
 * - `sign-in-again`: the open vault has no token (it was cleared, or an earlier sign-in stopped).
 * - `ready`: a vault is open. The shell shows the first download, then the tabs.
 */
export type Phase = 'loading' | 'sign-in' | 'sign-in-again' | 'ready'

export interface AppModel {
  services: AppServices
  phase: Phase
  list: VaultList
  /** The open vault, or null. */
  vault: PhoneVault | null
  /** Its `vaultId`, or null. */
  vaultKey: string | null
  /** What each vault's sign-in check learned, by `vaultId`. */
  accounts: Record<string, VaultAccount | undefined>
  friendsAccount: FriendsAccount
  friendsSettings: FriendsSettings
  /** The open vault's word for "page": `unit('Search pages')` → "Search docs" (round 15, item 5). */
  unit: UnitText
  sync: ShellSyncState
  nav: NavState
  go(action: NavAction): void
  /** The sign-in form (decision 13), typed or scanned. On success, the new vault opens. */
  addVault(input: SignInInput): Promise<SignInOutcome>
  /** A new token for a vault on the phone (row N6, "Replace token"). Its files and waiting answers stay. */
  replaceToken(vault: string, token: string): Promise<SignInOutcome>
  /** Decision 7: a tap switches the open vault. Only the open vault polls. */
  switchVault(vault: string): Promise<void>
  /** The vault, its token and its stored files leave the phone. */
  removeVault(vault: string): Promise<void>
  /** "Reset local copy" (row P5): the files go, the token stays, the vault downloads again. */
  resetCopy(vault: string): Promise<void>
  /** "Sign out and erase this phone" (row N7): every token, then every stored file and state. */
  eraseAll(): Promise<void>
  chooseFriendsVault(vault: string): Promise<void>
  saveFriendsSettings(settings: FriendsSettings): Promise<void>
}

const AppContext = createContext<AppModel | null>(null)

/** The app's channel between its tabs (one Home Screen app has one window; Safari can have more). */
const TABS_CHANNEL = 'notecards-tabs'
type TabMessage = { type: 'erased' }
const channelOf = (): BroadcastChannel | null => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(TABS_CHANNEL) : null)
function tellOtherTabs(message: TabMessage) {
  const channel = channelOf()
  channel?.postMessage(message)
  channel?.close()
}
function hearOtherTabs(listener: (message: TabMessage) => void): () => void {
  const channel = channelOf()
  if (channel === null) return () => undefined
  channel.onmessage = (event: MessageEvent<TabMessage>) => listener(event.data)
  return () => channel.close()
}

/** How long a removal waits for a running pass to end. The store refuses that pass's later writes anyway (YAZ-5175),
 *  so the wait only keeps the screen honest; a stuck download must not hold the erase. */
export const STOP_WAIT_MS = 3_000

/** Closes the vault in the sync, then waits (at most `STOP_WAIT_MS`) for its pass to end (YAZ-5175). */
async function stopSync(sync: ShellSync): Promise<void> {
  await sync.open(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([sync.idle(), new Promise<void>((r) => (timer = setTimeout(r, STOP_WAIT_MS)))])
  clearTimeout(timer)
}

/** The app's state, for any screen under `AppProvider`. */
export function useApp(): AppModel {
  const app = useContext(AppContext)
  if (app === null) throw new Error('useApp() needs <AppProvider>')
  return app
}

interface Loaded {
  phase: Phase
  list: VaultList
  accounts: Record<string, VaultAccount | undefined>
  friendsAccount: FriendsAccount
  friendsSettings: FriendsSettings
  unit: UnitText
}

const EMPTY: Loaded = {
  phase: 'loading',
  list: { vaults: [], open: null },
  accounts: {},
  friendsAccount: { kind: 'no-vaults' },
  friendsSettings: { vaults: null, nickname: null },
  unit: SAME_WORD,
}

export function AppProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const { store, tokens, sync, friends } = services
  const [loaded, setLoaded] = useState<Loaded>(EMPTY)
  const [nav, setNav] = useState<NavState>({ tab: 'review', stack: [] })
  const [syncState, setSyncState] = useState<ShellSyncState>(() => sync.state() ?? IDLE)
  const openKey = useRef<string | null>(null)

  /** Reads everything the screens show from the phone. No network call. `opening`: open the vault in the sync too. */
  const load = useCallback(
    async (opening: boolean): Promise<Loaded> => {
      const start = await startState(store, tokens)
      const list = await loadVaultList(store)
      const accounts: Record<string, VaultAccount | undefined> = {}
      for (const v of list.vaults) accounts[vaultId(v)] = await loadAccount(store, vaultId(v))
      const open = openVaultOf(list)
      const key = open === null ? null : vaultId(open)
      const next: Loaded = {
        phase: start.kind === 'ready' ? 'ready' : start.kind,
        list,
        accounts,
        friendsAccount: await loadFriendsAccount(store),
        friendsSettings: await friends.settings(),
        unit: key === null ? SAME_WORD : await readUnitWord(store, key),
      }
      openKey.current = key
      const syncing = opening ? (start.kind === 'ready' ? open : null) : undefined
      // Closing waits (nothing may poll a vault that leaves). Opening does not hold the screen: the sync's state
      // tells the shell when the vault is ready (3B's engine loads as a chunk of its own, `lazySync`).
      if (syncing === null) await sync.open(null)
      setLoaded(next)
      if (syncing) void sync.open(syncing).catch(() => undefined)
      return next
    },
    [store, tokens, sync, friends],
  )

  useEffect(() => {
    let live = true
    void (async () => {
      const first = await load(true)
      if (live && first.phase === 'ready') {
        const hasFriends = await friends.hasFriends()
        if (live) setNav({ tab: openingTab(hasFriends), stack: [] })
      }
    })()
    return () => {
      live = false
    }
  }, [load, friends])

  useEffect(
    () =>
      sync.subscribe((event) => {
        if (event.type === 'state') setSyncState(event.state)
        // Round 15, item 5: a new `.yaseendocs/unit-word.json` from the Mac changes the words at once.
        else if (event.vault === openKey.current && event.settings.includes(UNIT_WORD_PATH))
          void readUnitWord(store, event.vault).then((unit) => setLoaded((l) => ({ ...l, unit })))
      }),
    [sync, store],
  )

  const go = useCallback((action: NavAction) => setNav((n) => navigate(n, action)), [])

  const deps = useMemo(
    () => ({ store, tokens, fetch: services.fetch, now: services.now, keepStorage: services.keepStorage }),
    [store, tokens, services.fetch, services.now, services.keepStorage],
  )

  const addVault = useCallback(
    async (input: SignInInput) => {
      const outcome = await signIn(input, deps)
      if (outcome.ok) {
        const first = loaded.list.vaults.length === 0
        await saveVaultList(store, openVault(await loadVaultList(store), outcome.vault))
        await load(true)
        // The first vault: the app opens as at start (decision 21). One more vault: back to the tabs, on the new vault.
        if (first) setNav({ tab: openingTab(await friends.hasFriends()), stack: [] })
        else setNav((n) => navigate(n, { type: 'home' }))
      }
      return outcome
    },
    [deps, store, load, friends, loaded.list.vaults.length],
  )

  const replaceToken = useCallback(
    async (vault: string, token: string) => {
      const outcome = await signInAgain(vault, token, deps)
      if (outcome.ok) {
        const wasWaiting = loaded.phase === 'sign-in-again'
        await load(true)
        if (wasWaiting) setNav({ tab: openingTab(await friends.hasFriends()), stack: [] })
        else setNav((n) => navigate(n, { type: 'back' }))
      }
      return outcome
    },
    [deps, load, loaded.phase, friends],
  )

  const switchVault = useCallback(
    async (vault: string) => {
      await saveVaultList(store, openVault(await loadVaultList(store), vault))
      await load(true)
      setNav((n) => navigate(n, { type: 'home' }))
    },
    [store, load],
  )

  const removeVault = useCallback(
    async (vault: string) => {
      const wasOpen = openKey.current === vault
      if (wasOpen) await stopSync(sync)
      await forgetVaultAndToken(store, tokens, await loadVaultList(store), vault)
      const next = await load(wasOpen)
      if (next.phase !== 'ready') setNav({ tab: 'review', stack: [] })
    },
    [store, tokens, sync, load],
  )

  const resetCopy = useCallback(
    async (vault: string) => {
      const wasOpen = openKey.current === vault
      if (wasOpen) await stopSync(sync)
      await store.resetCopy(vault)
      await load(wasOpen)
      if (wasOpen) setNav((n) => navigate(n, { type: 'home' }))
    },
    [store, sync, load],
  )

  const eraseAll = useCallback(async () => {
    await stopSync(sync)
    await signOutAndErase(store, tokens)
    // YAZ-5194: the other tabs of the app stop too and show the first-run screen. The store already refuses their
    // writes (the erase count is in the database); this makes their screens follow.
    tellOtherTabs({ type: 'erased' })
    await load(false)
    setNav({ tab: 'review', stack: [] })
  }, [store, tokens, sync, load])

  // Another tab erased the phone: stop the sync here and show the sign-in (YAZ-5194).
  useEffect(
    () =>
      hearOtherTabs((message) => {
        if (message.type !== 'erased') return
        void stopSync(sync).then(async () => {
          await load(false)
          setNav({ tab: 'review', stack: [] })
        })
      }),
    [sync, load],
  )

  const chooseFriends = useCallback(
    async (vault: string) => {
      await chooseFriendsVault(store, vault)
      const friendsAccount = await loadFriendsAccount(store)
      setLoaded((l) => ({ ...l, friendsAccount }))
    },
    [store],
  )

  const saveFriendsSettings = useCallback(
    async (settings: FriendsSettings) => {
      await friends.saveSettings(settings)
      setLoaded((l) => ({ ...l, friendsSettings: settings }))
    },
    [friends],
  )

  const vault = openVaultOf(loaded.list)
  const model: AppModel = {
    services,
    ...loaded,
    vault,
    vaultKey: vault === null ? null : vaultId(vault),
    sync: syncState,
    nav,
    go,
    addVault,
    replaceToken,
    switchVault,
    removeVault,
    resetCopy,
    eraseAll,
    chooseFriendsVault: chooseFriends,
    saveFriendsSettings,
  }
  return <AppContext.Provider value={model}>{children}</AppContext.Provider>
}
