import { askToKeepStorage, type KeepStorage } from '../store/persist'
import type { TokenStore } from '../store/tokenStore'
import type { VaultStore } from '../store/vaultStore'
import { addVault, forgetVault, loadVaultList, openVaultOf, saveVaultList, vaultId, type PhoneVault, type VaultList } from '../store/vaults'
import { saveAccount, type VaultAccount } from './account'
import { checkSignIn, type CheckDeps, type SignInError, type SignInInput } from './check'

/** The sign-in logic for the screens (4A): what to show at start, add a vault, sign in again, sign out. */

export interface SignInDeps extends CheckDeps {
  store: VaultStore
  tokens: TokenStore
  /** Asks the browser to keep the storage (3A's `askToKeepStorage`); tests pass a fake. */
  keepStorage?: () => Promise<KeepStorage>
}

export type SignInOutcome = { ok: true; vault: string; account: VaultAccount } | { ok: false; error: SignInError }

export type StartState =
  /** Row F1: no vault. Show sign-in; download nothing. */
  | { kind: 'sign-in' }
  /** The open vault has no token (it was cleared, or an earlier sign-in stopped). "Sign in again". */
  | { kind: 'sign-in-again'; vault: string }
  | { kind: 'ready'; vault: string }

/** What the app shows at start. No network call. */
export async function startState(store: VaultStore, tokens: TokenStore): Promise<StartState> {
  const open = openVaultOf(await loadVaultList(store))
  if (open === null) return { kind: 'sign-in' }
  const id = vaultId(open)
  return (await tokens.read(id)) === null ? { kind: 'sign-in-again', vault: id } : { kind: 'ready', vault: id }
}

/**
 * Adds a vault: the check on save, then the token, the account and the vault list (the list last). When the check
 * fails, nothing is stored (row F3). Typed in, or from "Scan a code" (`parseScanCode` gives the same input).
 */
export async function signIn(input: SignInInput, deps: SignInDeps): Promise<SignInOutcome> {
  const checked = await checkSignIn(input, deps)
  if (!checked.ok) return checked
  const { repo, branch, account } = checked.vault
  const id = vaultId({ repo, branch })
  // Read the list after the check: another sign-in may have finished meanwhile.
  const list = await loadVaultList(deps.store)
  if (list.vaults.some((v) => vaultId(v) === id)) return { ok: false, error: { kind: 'already-added', repo, branch } }

  const now = deps.now ?? Date.now
  await deps.tokens.write(id, checked.token)
  try {
    await saveAccount(deps.store, id, account)
    await saveVaultList(deps.store, addVault(list, { repo, branch, addedAt: now() } as PhoneVault))
  } catch (error) {
    // No token is left behind for a vault that is not on the list.
    await deps.tokens.clear(id).catch(() => undefined)
    throw error
  }
  // The first sign-in is the moment to ask the browser to keep the vaults (3A: `askToKeepStorage`).
  await (deps.keepStorage ?? askToKeepStorage)()
  return { ok: true, vault: id, account }
}

/**
 * Row N6: the vault's token stopped working (`UNAUTHORIZED`, red status). A new token is checked against the same
 * repo and branch, then replaces the old one. The local copy, the checkpoint and the waiting answers stay. When the
 * check fails, nothing changes.
 */
export async function signInAgain(vault: string, token: string, deps: SignInDeps): Promise<SignInOutcome> {
  const known = (await loadVaultList(deps.store)).vaults.find((v) => vaultId(v) === vault)
  if (known === undefined) throw new Error(`${vault} is not on this phone`)
  const checked = await checkSignIn({ repo: known.repo, branch: known.branch, token }, deps)
  if (!checked.ok) return checked
  await deps.tokens.write(vault, checked.token)
  await saveAccount(deps.store, vault, checked.vault.account)
  return { ok: true, vault, account: checked.vault.account }
}

/** One vault leaves the phone: its token first, then its files, its state and its place in the list. */
export async function forgetVaultAndToken(store: VaultStore, tokens: TokenStore, list: VaultList, vault: string): Promise<VaultList> {
  await tokens.clear(vault)
  return forgetVault(store, list, vault)
}

/**
 * "Sign out and erase this phone" (row N7, round 10 item 19): every token, then every stored file and state.
 * The tokens go first, so an erase that stops halfway leaves no token behind.
 */
export async function signOutAndErase(store: VaultStore, tokens: TokenStore): Promise<void> {
  await tokens.clearAll()
  await store.eraseAll()
}
