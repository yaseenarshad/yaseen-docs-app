import type { VaultStore } from '../store/vaultStore'

/** Whether the token may write gists (decision 17). `unknown`: the check could not run (no network at sign-in). */
export type GistsAccess = 'yes' | 'no' | 'unknown'

/**
 * What the sign-in check learned about a vault's token, kept with the vault as phone-only state. It holds no
 * token: the token is `TokenStore`'s.
 */
export interface VaultAccount {
  /** From `GET /user`. */
  login: string
  /** Can be null on GitHub. */
  name: string | null
  /** On `avatars.githubusercontent.com` (round 12, item 13 lets the page load it). */
  avatarUrl: string
  gists: GistsAccess
  /** The token's end date (ISO), or null when it has none or the phone cannot know it (`expiry.ts`). */
  expiresAt: string | null
  /** When the check ran (ms since 1970). */
  checkedAt: number
}

const ACCOUNT = 'account'

export function loadAccount(store: VaultStore, vault: string): Promise<VaultAccount | undefined> {
  return store.getState<VaultAccount>(vault, ACCOUNT)
}

export function saveAccount(store: VaultStore, vault: string, account: VaultAccount): Promise<void> {
  return store.setState(vault, ACCOUNT, account)
}
