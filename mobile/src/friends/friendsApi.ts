import type { FriendVault } from '@shared/friendStats'
import type { GistsApi } from '@shared/friendGists'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { loadAccount, type VaultAccount } from '../auth/account'
import { loadFriendsAccount } from '../auth/friends'
import { githubClient, type FetchLike } from '../github/client'
import { loadVaultList, vaultId, type TokenStore, type VaultStore } from '../store'
import { INDEX_STATE, type PhoneIndex } from '../sync/phoneIndex'
import { gistsApi } from './gistsApi'

/**
 * The friends account on the phone (round 13, item 4; 3E's `friendsAccount`): the first vault whose token has the Gists
 * permission, or the one the person chose. 4E2 and 4E4 read friends with the same `api`.
 * - `no-gists`: no token has the Gists permission (or a write was refused): Friends shows how to add it.
 * - `no-account`: no vault, the Gists check could not run yet, or the token is missing.
 */
export type FriendsApi =
  | { kind: 'ok'; api: GistsApi; vault: string; account: VaultAccount }
  | { kind: 'no-gists' }
  | { kind: 'no-account' }

export async function openFriendsApi(store: VaultStore, tokens: TokenStore, options: { fetch?: FetchLike; now?: () => number } = {}): Promise<FriendsApi> {
  const chosen = await loadFriendsAccount(store)
  if (chosen.kind === 'no-gists') return { kind: 'no-gists' }
  if (chosen.kind !== 'ok' && chosen.kind !== 'two-accounts') return { kind: 'no-account' }
  const token = await tokens.read(chosen.vault)
  const account = await loadAccount(store, chosen.vault)
  if (token === undefined || token === null || token === '' || account === undefined) return { kind: 'no-account' }
  return { kind: 'ok', api: gistsApi(githubClient(token, { fetch: options.fetch, now: options.now })), vault: chosen.vault, account }
}

/** The review settings of a stored vault (`.yaseendocs/review.json`), or the defaults, as the Mac reads them. */
async function settingsOf(store: VaultStore, vault: string): Promise<ReviewSettings> {
  const file = await store.read(vault, `.yaseendocs/${REVIEW_SETTINGS_FILE}`)
  if (file === null) return DEFAULT_REVIEW_SETTINGS
  try {
    const text = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
    return sanitizeReviewSettings(JSON.parse(text))
  } catch {
    return DEFAULT_REVIEW_SETTINGS
  }
}

/**
 * The vaults that count (`FriendsIndex.vaults`, `owner/name` in lower case), from the phone's stored copies: each one's
 * index records (3B's `PhoneIndex`) and its settings. Null when the phone does not hold ALL of them, or the list is
 * empty: then the phone sends nothing (round 12, item 3).
 */
export async function countedVaults(store: VaultStore, repos: readonly string[]): Promise<FriendVault[] | null> {
  if (repos.length === 0) return null
  const list = await loadVaultList(store)
  const out: FriendVault[] = []
  for (const repo of new Set(repos.map((r) => r.toLowerCase()))) {
    const vault = list.vaults.find((v) => v.repo.toLowerCase() === repo)
    if (vault === undefined) return null
    const id = vaultId(vault)
    const index = await store.getState<PhoneIndex>(id, INDEX_STATE)
    if (index === undefined || index === null || typeof index.records !== 'object') return null
    out.push({ pages: Object.values(index.records), settings: await settingsOf(store, id) })
  }
  return out
}
