import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadAccount, type VaultAccount } from '../auth/account'
import type { SignInInput } from '../auth/check'
import { chooseFriendsVault, loadFriendsAccount, type FriendsAccount } from '../auth/friends'
import { forgetVaultAndToken, signIn, signInAgain, signOutAndErase, startState, type SignInOutcome } from '../auth/signIn'
import type { FetchLike } from '../github/client'
import type { VaultMedia } from '../media/ui/vaultMedia'
import { loadVaultList, openVault, openVaultOf, saveVaultList, vaultId, type KeepStorage, type PhoneVault, type TokenStore, type VaultList, type VaultStore } from '../store'
import type { FriendsPort, FriendsSettings } from './friendsPort'
import { browserBack, useBrowserHistory } from './browserHistory'
import { PLAIN_VAULT, navigate, openingTab, tabIn, type NavAction, type NavState, type VaultTabs } from './nav'
import { IDLE, type ShellSync, type ShellSyncState } from './syncPort'
import { SAVE_FAILED, type Help } from './help'
import { CALLBACK_PATH, GITHUB_CHOOSE_REPOS, INSTALLED_PATH } from '../auth/githubAppConfig'
import type { SignInMode } from '../screens/SignIn'
import { SAME_WORD, UNIT_WORD_PATH, readUnitWord, type UnitText } from './unitWord'
import { readVaultTabs, sameTabs } from './vaultTabs'

/**
 * The app's state and its actions: the one layer the screens (4A–4E) plug into. Every service is passed in, so
 * tests run the real sign-in logic (3E) and store (3A) with fakes for GitHub, the sync (3B) and Friends (4E);
 * `main.tsx` passes the real ones.
 */
export interface AppServices {
  store: VaultStore
  tokens: TokenStore
  /** 3B's engine (`lazySync`), or a fake in tests. */
  sync: ShellSync
  /** 4E's Friends: the friends list (`lazyFriends`, `main.tsx`), or a fake in tests. */
  friends: FriendsPort
  /**
   * 4C: one file's bytes for the reader and Review (a picture, a sound, a PDF): 3D's `MediaAhead`, made when
   * the engine loads (`lazyMedia`, `main.tsx`). Absent (tests): the screens read the store only (`storedMedia`).
   */
  media?: VaultMedia
  /** The GitHub calls of the sign-in check. Default: the browser's `fetch`. Tests pass `fakeGithub(…).fetch`. */
  fetch?: FetchLike
  now?: () => number
  keepStorage?: () => Promise<KeepStorage>
  /**
   * Which tabs a vault turns on. Default: its own files (`readVaultTabs`). The screen tests of other features
   * pass one that keeps Review on (`screens/testing.ts`), as their made-up vaults have no IDs.
   */
  vaultTabs?: typeof readVaultTabs
  /**
   * YAZ-5645: the app leaves for GitHub's sign-in page in the same window (`location.assign`). Tests pass a fake, and
   * the address (`location.href` on return) is read once at start: `/auth/callback` and `/auth/installed`.
   */
  goToGithub?: (url: string) => void
  /** The site's origin for the callback address. Default: `location.origin`. */
  origin?: string
}

/**
 * YAZ-5645, "Sign in with GitHub" after the trip to GitHub:
 * - `picking`: signed in as `login`; the sign-in screen shows the repos chosen for the app (`listInstalledRepos`).
 * - `failed`: the words of what went wrong, shown on the sign-in screen with one way forward.
 */
export type GithubFlow = { kind: 'none' } | { kind: 'picking'; login: string } | { kind: 'failed'; help: Help }

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
  /** What the open vault turns on (`vaultTabs.ts`): the Review and Friends tabs, the Today button. */
  tabs: VaultTabs
  sync: ShellSyncState
  /** Its `tab` is always one the open vault has (`tabIn`): a tab that went away shows Search. */
  nav: NavState
  go(action: NavAction): void
  /** The sign-in form (decision 13). On success, the new vault opens. */
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
  /** YAZ-5645: where "Sign in with GitHub" stands after the trip to GitHub. */
  github: GithubFlow
  /** GitHub App accounts already signed in on this phone (local token store, no network). */
  githubAccounts: readonly string[]
  /** "Sign in with GitHub": keeps the pending sign-in, then goes to GitHub. `another`: GitHub's account picker. */
  signInWithGithub(mode: SignInMode, another?: boolean): Promise<void>
  /** A GitHub account's access token (refreshed first when it ends soon), for the repo list; null: signed out. */
  githubAccess(login: string): Promise<string | null>
  /** The sign-in screen leaves the GitHub step (back to the first choice). */
  endGithub(): void
  /**
   * YAZ-5645 slice 2, "Manage repos on GitHub": keeps where it was tapped (`from`; `login`: the account, else the open
   * vault's), then goes to GitHub's repo page. GitHub sends the person back to `/auth/installed` (the Setup URL).
   */
  manageRepos(from: 'settings' | 'vault', login?: string): Promise<void>
  /**
   * YAZ-5645 slice 2, "Sign out of this account": ends the sign-in on GitHub (decision D7, through the Worker, at most
   * `STOP_WAIT_MS`), then the account's tokens leave the phone. Its vaults and their pages stay; they show Sign in again.
   */
  signOutGithub(login: string): Promise<void>
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

/** How long a removal waits for a running pass to end. The store refuses that pass's later writes anyway,
 *  so the wait only keeps the screen honest; a stuck download must not hold the erase. */
export const STOP_WAIT_MS = 3_000

/** Closes the vault in the sync, then waits (at most `STOP_WAIT_MS`) for its pass to end. */
async function stopSync(sync: ShellSync): Promise<void> {
  await sync.open(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([sync.idle(), new Promise<void>((r) => (timer = setTimeout(r, STOP_WAIT_MS)))])
  clearTimeout(timer)
}

/** Ends every GitHub sign-in of this phone (or `only` that account's) on GitHub (best effort, at most `STOP_WAIT_MS`). */
async function revokeGithub(tokens: TokenStore, fetch: FetchLike | undefined, origin: string | undefined, only?: string): Promise<void> {
  const logins = only !== undefined ? [only] : await tokens.githubAccounts().catch(() => [])
  if (logins.length === 0) return
  const { revokeAtWorker } = await import('../auth/githubWorker')
  const all = Promise.all(logins.map(async (login) => {
    const access = await tokens.accessFor(login).catch(() => null)
    if (access !== null) await revokeAtWorker(access, fetch, origin)
  }))
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([all, new Promise<void>((r) => (timer = setTimeout(r, STOP_WAIT_MS)))])
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
  githubAccounts: readonly string[]
  friendsAccount: FriendsAccount
  friendsSettings: FriendsSettings
  unit: UnitText
  tabs: VaultTabs
}

const EMPTY: Loaded = {
  phase: 'loading',
  list: { vaults: [], open: null },
  accounts: {},
  githubAccounts: [],
  friendsAccount: { kind: 'no-vaults' },
  friendsSettings: { vaults: null, nickname: null },
  unit: SAME_WORD,
  tabs: PLAIN_VAULT,
}

/**
 * YAZ-5645: the address GitHub sent the person back to, read ONCE at start, and taken out of the address bar at once
 * (the code must not stay in the history). Null: an ordinary start.
 */
function takeGithubReturn(): URL | null {
  if (typeof location === 'undefined') return null
  const url = new URL(location.href)
  if (url.pathname !== CALLBACK_PATH && url.pathname !== INSTALLED_PATH) return null
  history.replaceState(history.state, '', '/')
  return url
}

export function AppProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const { store, tokens, sync, friends } = services
  const [githubReturn] = useState(takeGithubReturn)
  const [github, setGithub] = useState<GithubFlow>({ kind: 'none' })
  const tabsOfVault = services.vaultTabs ?? readVaultTabs
  const [loaded, setLoaded] = useState<Loaded>(EMPTY)
  const [nav, setNav] = useState<NavState>({ tab: 'review', stack: [] })
  // The browser's history follows the screens, so Safari's own back swipe (in a tab) goes back too.
  const shownStack = useRef(nav.stack)
  shownStack.current = nav.stack
  const showStack = useCallback((stack: NavState['stack']) => setNav((n) => ({ ...n, stack })), [])
  useBrowserHistory(nav.stack, showStack)
  const [syncState, setSyncState] = useState<ShellSyncState>(() => sync.state() ?? IDLE)
  const openKey = useRef<string | null>(null)
  /** The vault's tabs changed (Review turned off, another vault): a tab it no longer has goes to Search, and stays there. */
  const keepTab = useCallback((tabs: VaultTabs) => setNav((n) => (tabIn(n.tab, tabs) === n.tab ? n : { ...n, tab: tabIn(n.tab, tabs) })), [])

  /** Reads everything the screens show from the phone. No network call. `opening`: open the vault in the sync too. */
  const load = useCallback(
    async (opening: boolean, beforeShow?: (next: Loaded) => Promise<void>): Promise<Loaded> => {
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
        githubAccounts: await tokens.githubAccounts().catch(() => []),
        friendsAccount: await loadFriendsAccount(store),
        friendsSettings: await friends.settings(),
        unit: key === null ? SAME_WORD : await readUnitWord(store, key),
        tabs: await tabsOfVault(store, key),
      }
      openKey.current = key
      const syncing = opening ? (start.kind === 'ready' ? open : null) : undefined
      // Closing waits (nothing may poll a vault that leaves). Opening does not hold the screen: the sync's state
      // tells the shell when the vault is ready (3B's engine loads as a chunk of its own, `lazySync`).
      if (syncing === null) await sync.open(null)
      // The opening tab is set BEFORE the tabs show, so the first screen is the right one (no jump).
      await beforeShow?.(next)
      setLoaded(next)
      keepTab(next.tabs)
      if (syncing) void sync.open(syncing).catch(() => undefined)
      return next
    },
    [store, tokens, sync, friends, tabsOfVault, keepTab],
  )

  useEffect(() => {
    let live = true
    void (async () => {
      // Decision 21: Friends with a friend, else Review. Asked while the phone loads; the tabs wait for the answer.
      const asked = friends.hasFriends().catch(() => false)
      await load(true, async (next) => {
        if (next.phase !== 'ready') return
        const hasFriends = await asked
        if (live) setNav({ tab: openingTab(hasFriends, next.tabs), stack: [] })
      })
    })()
    return () => {
      live = false
    }
  }, [load, friends])

  // YAZ-5645: back from GitHub. Runs once, after the first load (the screens need the phase).
  const githubDone = useRef(false)
  useEffect(() => {
    if (githubReturn === null || loaded.phase === 'loading' || githubDone.current) return
    githubDone.current = true
    void (async () => {
      const { finishGithubSignIn, githubHelp, githubSignInMessage } = await import('../auth/githubApp')
      const ready = loaded.phase === 'ready'
      // A screen over the tabs: the one the sign-in started from (Add a vault, Sign in again).
      const show = (mode: SignInMode | null) => {
        if (!ready || mode === null || mode.kind === 'first') return
        setNav((n) => ({ ...n, stack: [mode.kind === 'add' ? { kind: 'add-vault' } : { kind: 'replace-token', vault: mode.vault }] }))
      }
      if (githubReturn.pathname === INSTALLED_PATH) {
        // Slice 2: back from "Manage repos on GitHub". From Settings: Settings again. From the vault's notice: the vault,
        // which this start already syncs again.
        const managing = await tokens.takeManaging().catch(() => null)
        if (managing !== null && ready) {
          if (managing.from === 'settings') setNav((n) => ({ ...n, stack: [{ kind: 'settings' }] }))
          return
        }
        // Back from "choose repos" (the Setup URL): the account signed in last lists its repos again.
        const login = (await tokens.githubAccounts()).at(-1)
        if (login === undefined) return
        setGithub({ kind: 'picking', login })
        return show({ kind: 'add' })
      }
      const back = await finishGithubSignIn(githubReturn, { tokens, fetch: services.fetch, now: services.now, origin: services.origin })
      if (!back.ok) {
        setGithub({ kind: 'failed', help: { message: githubSignInMessage(back.error), forward: 'sign-in-github' } })
        return show(back.purpose)
      }
      const mode = back.purpose
      if (mode.kind !== 'again') {
        setGithub({ kind: 'picking', login: back.login })
        return show(mode)
      }
      // Sign in again: the same vault, now with the GitHub sign-in.
      const token = await tokens.accessFor(back.login)
      const outcome = token === null ? null : await signInAgain(mode.vault, token, deps, back.login).catch(() => null)
      if (outcome?.ok) {
        const next = await load(true)
        if (!ready) setNav({ tab: openingTab(await friends.hasFriends(), next.tabs), stack: [] })
        return
      }
      setGithub({ kind: 'failed', help: outcome === null ? SAVE_FAILED : githubHelp(outcome.error) })
      show(mode)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubReturn, loaded.phase])

  useEffect(
    () =>
      sync.subscribe((event) => {
        if (event.type === 'state') return setSyncState(event.state)
        if (event.vault !== openKey.current) return
        const vault = event.vault
        // Round 15, item 5: a new `.yaseendocs/unit-word.json` from the Mac changes the words at once.
        if (event.settings.includes(UNIT_WORD_PATH)) void readUnitWord(store, vault).then((unit) => setLoaded((l) => ({ ...l, unit })))
        // The vault's settings (or its first IDs) can bring a tab or take one away, at once.
        void tabsOfVault(store, vault, event.index).then((tabs) => {
          if (openKey.current !== vault) return
          setLoaded((l) => (sameTabs(l.tabs, tabs) ? l : { ...l, tabs }))
          keepTab(tabs)
        })
      }),
    [sync, store, tabsOfVault, keepTab],
  )

  const go = useCallback(
    (action: NavAction) => {
      // A page or card opened (or swapped in by the arrows) goes to this phone's Recent (its own lazy chunk; it records only those two).
      const vault = openKey.current
      if ('route' in action) void import('../search/recent').then((m) => m.remember(store, vault, action.route))
      // Back steps the browser back when the entry under is the screen under: its `popstate` shows it (one Back only).
      if (action.type === 'back' && browserBack(shownStack.current)) return
      setNav((n) => navigate(n, action))
    },
    [store],
  )

  const deps = useMemo(
    () => ({ store, tokens, fetch: services.fetch, now: services.now, keepStorage: services.keepStorage }),
    [store, tokens, services.fetch, services.now, services.keepStorage],
  )

  const addVault = useCallback(
    async (input: SignInInput) => {
      const outcome = await signIn(input, deps)
      if (outcome.ok) {
        setGithub({ kind: 'none' })
        const first = loaded.list.vaults.length === 0
        await saveVaultList(store, openVault(await loadVaultList(store), outcome.vault))
        const next = await load(true)
        // The first vault: the app opens as at start (decision 21). One more vault: back to the tabs, on the new vault.
        if (first) setNav({ tab: openingTab(await friends.hasFriends(), next.tabs), stack: [] })
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
        setGithub({ kind: 'none' })
        const wasWaiting = loaded.phase === 'sign-in-again'
        const next = await load(true)
        if (wasWaiting) setNav({ tab: openingTab(await friends.hasFriends(), next.tabs), stack: [] })
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
    // The friends sender, list and marks stop first; nothing of theirs is stored after the erase.
    await friends.stop?.()
    await stopSync(sync)
    // YAZ-5645 (decision D7): each GitHub sign-in ends on GitHub too, through the Worker (at most 3 s; offline: the
    // phone forgets it anyway).
    await revokeGithub(tokens, services.fetch, services.origin)
    await signOutAndErase(store, tokens)
    // The other tabs of the app stop too and show the first-run screen. The store already refuses their
    // writes (the erase count is in the database); this makes their screens follow.
    tellOtherTabs({ type: 'erased' })
    await load(false)
    setNav({ tab: 'review', stack: [] })
  }, [store, tokens, sync, load, friends, services.fetch, services.origin])

  // Another tab erased the phone: stop the sync here and show the sign-in.
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

  const signInWithGithub = useCallback(
    async (mode: SignInMode, another = false) => {
      const { startGithubSignIn } = await import('../auth/githubApp')
      const purpose = mode.kind === 'again' ? { kind: 'again' as const, vault: mode.vault } : { kind: mode.kind }
      const url = await startGithubSignIn(purpose, { tokens, now: services.now, origin: services.origin }, another)
      ;(services.goToGithub ?? ((to: string) => location.assign(to)))(url)
    },
    [tokens, services.now, services.origin, services.goToGithub],
  )
  const githubAccess = useCallback((login: string) => tokens.accessFor(login), [tokens])
  const endGithub = useCallback(() => setGithub({ kind: 'none' }), [])
  const manageRepos = useCallback(
    async (from: 'settings' | 'vault', login?: string) => {
      const who = login ?? (openKey.current === null ? null : await tokens.githubOf(openKey.current).catch(() => null))
      await tokens.saveManaging({ login: who, from, startedAt: (services.now ?? Date.now)() })
      ;(services.goToGithub ?? ((to: string) => location.assign(to)))(GITHUB_CHOOSE_REPOS)
    },
    [tokens, services.now, services.goToGithub],
  )
  const signOutGithub = useCallback(
    async (login: string) => {
      const open = openKey.current
      const wasOpen = open !== null && (await tokens.githubOf(open))?.toLowerCase() === login.toLowerCase()
      if (wasOpen) await stopSync(sync)
      await revokeGithub(tokens, services.fetch, services.origin, login)
      await tokens.forgetAccount(login)
      const next = await load(wasOpen)
      if (next.phase !== 'ready') setNav({ tab: 'review', stack: [] })
    },
    [tokens, sync, load, services.fetch, services.origin],
  )

  // A tab the open vault does not have shows Search (`keepTab` makes it stay Search when the tabs change).
  const tab = tabIn(nav.tab, loaded.tabs)
  const shownNav = useMemo(() => (tab === nav.tab ? nav : { ...nav, tab }), [nav, tab])

  const vault = openVaultOf(loaded.list)
  const vaultKey = vault === null ? null : vaultId(vault)
  const model: AppModel = useMemo(
    () => ({
      services,
      ...loaded,
      vault,
      vaultKey,
      sync: syncState,
      nav: shownNav,
      go,
      addVault,
      replaceToken,
      switchVault,
      removeVault,
      resetCopy,
      eraseAll,
      chooseFriendsVault: chooseFriends,
      saveFriendsSettings,
      github,
      signInWithGithub,
      githubAccess,
      endGithub,
      manageRepos,
      signOutGithub,
    }),
    [
      services,
      loaded,
      vault,
      vaultKey,
      syncState,
      shownNav,
      go,
      addVault,
      replaceToken,
      switchVault,
      removeVault,
      resetCopy,
      eraseAll,
      chooseFriends,
      saveFriendsSettings,
      github,
      signInWithGithub,
      githubAccess,
      endGithub,
      manageRepos,
      signOutGithub,
    ],
  )
  return <AppContext.Provider value={model}>{children}</AppContext.Provider>
}
