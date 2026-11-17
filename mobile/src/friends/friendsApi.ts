import type { FriendVault } from '@shared/friendStats'
import type { GistsApi } from '@shared/friendGists'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { loadAccount, type VaultAccount } from '../auth/account'
import { loadFriendsAccount } from '../auth/friends'
import { GithubError, githubClient, repoPath, type FetchLike } from '../github/client'
import { loadVaultList, vaultId, type TokenStore, type VaultStore } from '../store'
import { ListError, type RepoPort } from '@shared/friendListStore'
import { listRepo } from './listRepo'
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
  // The vaults where the friends list can live: this phone's vaults on the friends account, the friends
  // vault first. Each one with its OWN token (the one with Contents on that repo, decision 17).
  const repos = async (): Promise<readonly RepoPort[]> => {
    const list = await loadVaultList(store)
    const own = list.vaults.filter((v) => vaultId(v) === chosen.vault)
    const others = list.vaults.filter((v) => vaultId(v) !== chosen.vault)
    const out: RepoPort[] = []
    for (const v of [...own, ...others]) {
      const id = vaultId(v)
      const acc = id === chosen.vault ? account : await loadAccount(store, id)
      if (acc === undefined || acc.login.toLowerCase() !== account.login.toLowerCase()) continue
      if (out.some((p) => p.repo === v.repo.toLowerCase())) continue
      const t = id === chosen.vault ? token : await tokens.read(id)
      if (t === undefined || t === null || t === '') continue
      out.push(listRepo(githubClient(t, { fetch: options.fetch, now: options.now }), v.repo, v.branch))
    }
    return out
  }
  // The repo the note names, also one this phone has not added (the friends token, decision 17 and round 13 item 4:
  // one token with both permissions): on the repo's default branch.
  const repo = async (full: string): Promise<RepoPort> => {
    const own = (await repos()).find((p) => p.repo === full.toLowerCase())
    if (own !== undefined) return own
    const client = githubClient(token, { fetch: options.fetch, now: options.now })
    let branch: string
    try {
      const res = await client.request(repoPath(full))
      const b = (res.data as { default_branch?: unknown } | null)?.default_branch
      branch = typeof b === 'string' && b !== '' ? b : 'main'
    } catch (err) {
      if (err instanceof GithubError && (err.code === 'NOT_FOUND' || err.code === 'NO_ACCESS')) throw new ListError('NO_LIST_ACCESS', 'The token cannot read the vault of the friends list')
      throw err
    }
    return listRepo(client, full, branch)
  }
  return { kind: 'ok', api: gistsApi(githubClient(token, { fetch: options.fetch, now: options.now }), repos, repo), vault: chosen.vault, account }
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
export async function countedVaults(store: VaultStore, repos: readonly string[], held?: (vault: string) => PhoneIndex | null): Promise<FriendVault[] | null> {
  if (repos.length === 0) return null
  const list = await loadVaultList(store)
  const out: FriendVault[] = []
  for (const repo of new Set(repos.map((r) => r.toLowerCase()))) {
    const vault = list.vaults.find((v) => v.repo.toLowerCase() === repo)
    if (vault === undefined) return null
    const id = vaultId(vault)
    // The open vault's index as the sync engine holds it (no read of the store), else the stored one.
    const index = held?.(id) ?? (await store.getState<PhoneIndex>(id, INDEX_STATE))
    if (index === undefined || index === null || typeof index.records !== 'object') return null
    out.push({ pages: Object.values(index.records), settings: await settingsOf(store, id) })
  }
  return out
}
