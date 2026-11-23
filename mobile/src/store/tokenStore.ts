import type { Backend } from './backend'

/**
 * The GitHub token of each vault (decision 7: each vault has its own token; October design rule 1). A small
 * interface, so a real app can swap this browser one for the Keychain. Only the sign-in logic (`src/auth/`) and the
 * GitHub client's callers read it. The token is never logged and never put in an address.
 *
 * YAZ-5645 "Sign in with GitHub": a vault can instead USE the token pair of a GitHub account (decision D5: one sign-in
 * for each account, shared by its vaults). `read(vault)` then gives that account's access token, refreshed first when
 * it ends within `RENEW_EARLY_MS` (GitHub's tokens last 8 hours; the refresh token 6 months, and GitHub takes each
 * one once). One tab refreshes at a time (the Web Lock `LOCK`); the others read the new pair after it. Pasted tokens
 * (`write`) work as before (decision D4): each vault knows its kind.
 */
export interface TokenStore {
  /** The vault's token, or null when it has none (row F1, after "Sign out", or GitHub signed the account out). */
  read(vault: string): Promise<string | null>
  /** Whether the vault has a token (or a signed-in GitHub account), with no refresh and no network call. */
  has(vault: string): Promise<boolean>
  /** Keeps the token, in place of an older one (row N6: sign in again). Resolves when it is committed. */
  write(vault: string, token: string): Promise<void>
  clear(vault: string): Promise<void>
  /** Every token on the phone (row N7, "Sign out and erase this phone"), the GitHub pairs too. */
  clearAll(): Promise<void>
  /** YAZ-5645: the vault uses the GitHub sign-in of `login` (in place of a pasted token). */
  link(vault: string, login: string): Promise<void>
  /** The GitHub account a vault uses, or null (a pasted token, or no token). */
  githubOf(vault: string): Promise<string | null>
  /** Keeps a GitHub account's pair (after "Sign in with GitHub", or a refresh). */
  savePair(pair: GithubPair): Promise<void>
  /** The account's access token, refreshed first when it ends soon; null when the account is signed out. */
  accessFor(login: string): Promise<string | null>
  /** The accounts signed in with GitHub on this phone. */
  githubAccounts(): Promise<string[]>
  /** The account's pair leaves the phone (Sign out of GitHub, or GitHub ended it). Its vaults then read null. */
  forgetAccount(login: string): Promise<void>
  /**
   * After GitHub answered 401 with the vault's token: a GitHub vault refreshes now (once), so the next call can retry.
   * True when a new token came. A pasted token: false.
   */
  renew(vault: string): Promise<boolean>
  /** The sign-in that went to GitHub, kept for 10 minutes and taken once (`auth/githubApp.ts`). */
  savePending(pending: PendingSignIn): Promise<void>
  takePending(): Promise<PendingSignIn | null>
  /**
   * YAZ-5645 slice 2: "Manage repos on GitHub" went to GitHub's repo page from `from` for `login`. GitHub's way back
   * (`/auth/installed`, the Setup URL) carries nothing the app can trust (edge case 17), so the app keeps where it was.
   * Taken once; older than `MANAGING_MS` counts as none.
   */
  saveManaging(managing: Managing): Promise<void>
  takeManaging(): Promise<Managing | null>
}

/** Where "Manage repos on GitHub" / "Choose repos on GitHub" was tapped. */
export interface Managing {
  login: string | null
  from: 'settings' | 'vault' | 'picker'
  startedAt: number
}

/** A GitHub account's tokens (GitHub App user tokens). Times are this phone's clock when the answer came. */
export interface GithubPair {
  login: string
  access: string
  /** ms since 1970, or null: the token does not end (the app's "expire tokens" is off). */
  accessEndsAt: number | null
  refresh: string | null
  refreshEndsAt: number | null
}

/** What the app keeps while the person is on GitHub: PKCE and state (one use), and what to do on return. */
export interface PendingSignIn {
  state: string
  verifier: string
  redirectUri: string
  startedAt: number
  /** `again`: the vault that asked to sign in again. */
  purpose: { kind: 'first' } | { kind: 'add' } | { kind: 'again'; vault: string }
}

/** GitHub's answer to a refresh, through the Worker. `ended`: the refresh token is dead (sign in again). */
export type Renewed = { ok: true; pair: Omit<GithubPair, 'login'> } | { ok: false; reason: 'ended' | 'offline' }

export interface TokenStoreOptions {
  /** Swaps a refresh token for a new pair (`auth/githubWorker.ts`). None (tests, fixtures): no refresh. */
  renew?: (refreshToken: string) => Promise<Renewed>
  now?: () => number
  /** One refresh at a time in every tab. Default: the browser's Web Locks, where it has them. */
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
}

/**
 * The name of the token's row among a vault's phone-only state. `VaultStore`'s state calls refuse it, so only
 * `TokenStore` reads or writes the token. It lives there so that the rules of the vault apply to it as one unit:
 * "Reset local copy" (P5) and a format change (P3) keep it, removing the vault removes it, and `eraseAll` (N7)
 * removes it.
 */
export const TOKEN_STATE = '#github-token'
/** The scope of a GitHub account's pair (logins ignore case). `clearAll` and `eraseAll` remove it with the tokens. */
export const accountScope = (login: string) => `#github:${login.toLowerCase()}`
const PENDING: [string, string] = ['#github-sign-in', TOKEN_STATE]
const MANAGING: [string, string] = ['#github-manage', TOKEN_STATE]
/** A trip to GitHub's repo page counts for this long. */
export const MANAGING_MS = 30 * 60_000
/** Refresh this long before the token ends (the scope: 5 minutes). */
export const RENEW_EARLY_MS = 5 * 60_000
/** A sign-in that went to GitHub counts for this long (GitHub's code lasts 10 minutes). */
export const PENDING_MS = 10 * 60_000
const LOCK = 'notecards-github-refresh'

type Locks = { request<T>(name: string, fn: () => Promise<T>): Promise<T> }
const fallbackLocks = new Map<string, Promise<unknown>>()
const webLocks = <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  const locks = (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks
  if (locks !== undefined) return locks.request(name, fn)
  const prev = fallbackLocks.get(name) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  const settled = next.finally(() => {
    if (fallbackLocks.get(name) === settled) fallbackLocks.delete(name)
  })
  fallbackLocks.set(name, settled)
  return next
}

const isPair = (v: unknown): v is GithubPair => v !== null && typeof v === 'object' && typeof (v as GithubPair).access === 'string' && typeof (v as GithubPair).login === 'string'
const linkOf = (v: unknown): string | null => (v !== null && typeof v === 'object' && typeof (v as { github?: unknown }).github === 'string' ? (v as { github: string }).github : null)

/**
 * The browser `TokenStore`: in the installed app's IndexedDB (decision 13: the token is pasted inside the
 * installed app, as Safari and the app do not share storage), on the same backend as the vault store.
 */
export function tokenStoreOn(backend: Backend, options: TokenStoreOptions = {}): TokenStore {
  const now = options.now ?? Date.now
  const lock = options.lock ?? webLocks
  const pairOf = async (login: string): Promise<GithubPair | null> => {
    const v = await backend.get('state', [accountScope(login), TOKEN_STATE])
    return isPair(v) ? v : null
  }
  const savePair = (pair: GithubPair) => backend.apply([{ put: 'state', key: [accountScope(pair.login), TOKEN_STATE], value: pair }])
  const forgetAccount = (login: string) => backend.apply([{ del: 'state', key: [accountScope(login), TOKEN_STATE] }])

  /** Refreshes under the lock. `force`: refresh even when the token is not near its end (after a 401 with `seen`). */
  const refresh = async (login: string, force: string | null): Promise<string | null> =>
    lock(`${LOCK}:${login.toLowerCase()}`, async () => {
      // Read again inside the lock: another tab may have refreshed while this one waited.
      const pair = await pairOf(login)
      if (pair === null) return null
      const due = force !== null ? pair.access === force : pair.accessEndsAt !== null && pair.accessEndsAt - now() <= RENEW_EARLY_MS
      if (!due) return pair.access
      if (pair.refresh === null || options.renew === undefined || (pair.refreshEndsAt !== null && pair.refreshEndsAt <= now())) {
        // No way to refresh: a token that has not ended still works; an ended one is a sign-in again.
        if (pair.accessEndsAt !== null && pair.accessEndsAt <= now()) return (await forgetAccount(login), null)
        return force !== null ? null : pair.access
      }
      const got = await options.renew(pair.refresh)
      if (!got.ok) {
        // The refresh token is dead (revoked, 6 months unused, or a lost answer took it): GitHub signed this account out.
        if (got.reason === 'ended') return (await forgetAccount(login), null)
        // Offline: the old token may still work; the next read tries again.
        return force !== null ? null : pair.access
      }
      await savePair({ ...got.pair, login: pair.login })
      return got.pair.access
    })

  const accessFor = async (login: string): Promise<string | null> => {
    const pair = await pairOf(login)
    if (pair === null) return null
    if (pair.accessEndsAt === null || pair.accessEndsAt - now() > RENEW_EARLY_MS) return pair.access
    return refresh(login, null)
  }

  return {
    async read(vault) {
      const token = await backend.get('state', [vault, TOKEN_STATE])
      if (typeof token === 'string') return token
      const login = linkOf(token)
      return login === null ? null : accessFor(login)
    },
    async has(vault) {
      const token = await backend.get('state', [vault, TOKEN_STATE])
      if (typeof token === 'string') return true
      const login = linkOf(token)
      return login !== null && (await pairOf(login)) !== null
    },
    write: (vault, token) => backend.apply([{ put: 'state', key: [vault, TOKEN_STATE], value: token }]),
    clear: (vault) => backend.apply([{ del: 'state', key: [vault, TOKEN_STATE] }]),
    async clearAll() {
      // The state table has no index by name, so find the rows of every vault scope first.
      const scopes = await tokenScopes(backend)
      if (scopes.length > 0) await backend.apply(scopes.map((vault) => ({ del: 'state' as const, key: [vault, TOKEN_STATE] as [string, string] })))
    },
    link: (vault, login) => backend.apply([{ put: 'state', key: [vault, TOKEN_STATE], value: { github: login } }]),
    async githubOf(vault) {
      return linkOf(await backend.get('state', [vault, TOKEN_STATE]))
    },
    savePair,
    accessFor,
    async githubAccounts() {
      const logins: string[] = []
      for (const scope of await tokenScopes(backend)) {
        if (!scope.startsWith('#github:')) continue
        const pair = await backend.get('state', [scope, TOKEN_STATE])
        if (isPair(pair)) logins.push(pair.login)
      }
      return logins
    },
    forgetAccount,
    async renew(vault) {
      const login = linkOf(await backend.get('state', [vault, TOKEN_STATE]))
      if (login === null) return false
      const seen = (await pairOf(login))?.access ?? null
      if (seen === null) return false
      const fresh = await refresh(login, seen)
      return fresh !== null && fresh !== seen
    },
    savePending: (pending) => backend.apply([{ put: 'state', key: PENDING, value: pending }]),
    async takePending() {
      const v = (await backend.get('state', PENDING)) as PendingSignIn | undefined
      if (v === undefined || v === null) return null
      await backend.apply([{ del: 'state', key: PENDING }])
      return typeof v.state === 'string' && typeof v.verifier === 'string' ? v : null
    },
    saveManaging: (managing) => backend.apply([{ put: 'state', key: MANAGING, value: managing }]),
    async takeManaging() {
      const v = (await backend.get('state', MANAGING)) as Managing | undefined | null
      if (v === undefined || v === null) return null
      await backend.apply([{ del: 'state', key: MANAGING }])
      const fresh = typeof v.startedAt === 'number' && now() - v.startedAt <= MANAGING_MS && v.startedAt <= now()
      return fresh && (v.from === 'settings' || v.from === 'vault') ? v : null
    },
  }
}

/** The scopes that may hold a token: every scope in the state table (vaults, GitHub accounts, a pending sign-in). */
async function tokenScopes(backend: Backend): Promise<string[]> {
  const keys = await backend.keys('state')
  return [...new Set(keys.filter((k): k is [string, string] => Array.isArray(k) && k[1] === TOKEN_STATE).map((k) => k[0]))]
}
