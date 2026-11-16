import type { Backend } from './backend'

/**
 * The GitHub token of each vault (decision 7: each vault has its own token; October design rule 1). A small
 * interface, so a real app can swap this browser one for the Keychain. Only the sign-in logic (`src/auth/`) and the
 * GitHub client's callers read it. The token is never logged and never put in an address.
 */
export interface TokenStore {
  /** The vault's token, or null when it has none (row F1, or after "Sign out"). */
  read(vault: string): Promise<string | null>
  /** Keeps the token, in place of an older one (row N6: sign in again). Resolves when it is committed. */
  write(vault: string, token: string): Promise<void>
  clear(vault: string): Promise<void>
  /** Every token on the phone (row N7, "Sign out and erase this phone"). */
  clearAll(): Promise<void>
}

/**
 * The name of the token's row among a vault's phone-only state. `VaultStore`'s state calls refuse it, so only
 * `TokenStore` reads or writes the token. It lives there so that the rules of the vault apply to it as one unit:
 * "Reset local copy" (P5) and a format change (P3) keep it, removing the vault removes it, and `eraseAll` (N7)
 * removes it.
 */
export const TOKEN_STATE = '#github-token'

/**
 * The browser `TokenStore`: in the installed app's IndexedDB (decision 13: the token is pasted inside the
 * installed app, as Safari and the app do not share storage), on the same backend as the vault store.
 */
export function tokenStoreOn(backend: Backend): TokenStore {
  return {
    async read(vault) {
      const token = await backend.get('state', [vault, TOKEN_STATE])
      return typeof token === 'string' ? token : null
    },
    write: (vault, token) => backend.apply([{ put: 'state', key: [vault, TOKEN_STATE], value: token }]),
    clear: (vault) => backend.apply([{ del: 'state', key: [vault, TOKEN_STATE] }]),
    async clearAll() {
      // The state table has no index by name, so find the rows of every vault scope first.
      const scopes = await vaultScopes(backend)
      if (scopes.length > 0) await backend.apply(scopes.map((vault) => ({ del: 'state' as const, key: [vault, TOKEN_STATE] as [string, string] })))
    },
  }
}

/** The scopes that may hold a token: every scope in the state table. */
async function vaultScopes(backend: Backend): Promise<string[]> {
  const keys = await backend.keys('state')
  return [...new Set(keys.filter((k): k is [string, string] => Array.isArray(k) && k[1] === TOKEN_STATE).map((k) => k[0]))]
}
