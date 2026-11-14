import { PHONE, type VaultStore } from '../store/vaultStore'
import { loadVaultList, vaultId } from '../store/vaults'
import { loadAccount, type VaultAccount } from './account'

/**
 * Which account acts for friends (round 13, item 4). Friends belong to a GitHub account, not to a vault. The app
 * uses the first vault whose token has the Gists permission; the person can choose another one (4A: "Friends use
 * @login"). The supported setup is one account and one token with both permissions. The app does not work around
 * another setup: it says what is wrong.
 */
export type FriendsAccount =
  | { kind: 'no-vaults' }
  | { kind: 'ok'; vault: string; login: string }
  /** Friends work with `login`, but the vaults are on more than one account: "Friends use @login." */
  | { kind: 'two-accounts'; vault: string; login: string; logins: string[] }
  /** No token has the Gists permission. Review works; the Friends tab tells how to add it (4E). */
  | { kind: 'no-gists'; logins: string[] }
  /** Not known yet: the Gists check could not run. The app checks again at the next sign-in check. */
  | { kind: 'unchecked' }

const CHOICE = 'friendsVault'

/** Pure: from the vaults in list order, with what their check learned, and the person's choice (a vault id). */
export function friendsAccount(vaults: readonly { vault: string; account: VaultAccount | undefined }[], chosen: string | null): FriendsAccount {
  if (vaults.length === 0) return { kind: 'no-vaults' }
  const withGists = vaults.filter((v) => v.account?.gists === 'yes')
  const logins: string[] = []
  for (const v of vaults) {
    const login = v.account?.login
    if (login !== undefined && !logins.some((l) => l.toLowerCase() === login.toLowerCase())) logins.push(login)
  }
  const use = withGists.find((v) => v.vault === chosen) ?? withGists[0]
  if (use === undefined) {
    const unknown = vaults.some((v) => v.account === undefined || v.account.gists === 'unknown')
    return unknown ? { kind: 'unchecked' } : { kind: 'no-gists', logins }
  }
  const login = use.account!.login
  return logins.length > 1 ? { kind: 'two-accounts', vault: use.vault, login, logins } : { kind: 'ok', vault: use.vault, login }
}

/** The alert to show, or null when all is as the guide says. The steps to add the permission are the screen's (4E). */
export function friendsMessage(state: FriendsAccount): string | null {
  switch (state.kind) {
    case 'no-gists':
      return 'Friends needs the Gists permission on your token.'
    case 'two-accounts':
      return `Your vaults are on two GitHub accounts. Friends use @${state.login}.`
    default:
      return null
  }
}

export async function loadFriendsAccount(store: VaultStore): Promise<FriendsAccount> {
  const list = await loadVaultList(store)
  const vaults = await Promise.all(list.vaults.map(async (v) => ({ vault: vaultId(v), account: await loadAccount(store, vaultId(v)) })))
  return friendsAccount(vaults, (await store.getState<string>(PHONE, CHOICE)) ?? null)
}

/** "Friends use @login" › change (4A). Only a vault whose token has the Gists permission can be chosen. */
export async function chooseFriendsVault(store: VaultStore, vault: string): Promise<void> {
  if ((await loadAccount(store, vault))?.gists !== 'yes') throw new Error('Only a vault whose token has the Gists permission can act for friends')
  await store.setState(PHONE, CHOICE, vault)
}
