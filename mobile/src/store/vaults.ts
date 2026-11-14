import { PHONE, type VaultStore } from './vaultStore'

/** One vault on the phone: one GitHub repo and branch, with its own token and its own stored files. */
export interface PhoneVault {
  /** `owner/name` on GitHub. */
  repo: string
  branch: string
  /** As decision 7 names it. Stored as given; no rule reads it yet (open: see YAZ-5071). */
  folder: string
  addedAt: number
}

/** The vaults, and the one that is open. Only the open vault polls GitHub. */
export interface VaultList {
  vaults: PhoneVault[]
  /** The `vaultId` of the open vault. */
  open: string | null
}

const LIST = 'vaults'

/** The id that splits the storage: the repo (in lower case, as GitHub ignores its case) and the branch. */
export function vaultId(vault: Pick<PhoneVault, 'repo' | 'branch'>): string {
  return `${vault.repo.toLowerCase()}@${vault.branch}`
}

/** Adds a vault. The first vault on the phone opens; with one open already, it stays open. */
export function addVault(list: VaultList, vault: PhoneVault): VaultList {
  const id = vaultId(vault)
  if (list.vaults.some((v) => vaultId(v) === id)) throw new Error(`${vault.repo} (${vault.branch}) is already on this phone`)
  return { vaults: [...list.vaults, vault], open: list.open ?? id }
}

export function openVault(list: VaultList, id: string): VaultList {
  if (!list.vaults.some((v) => vaultId(v) === id)) throw new Error(`${id} is not on this phone`)
  return { ...list, open: id }
}

/** Takes the vault off the list. When it was open, the first vault left opens, or none. */
export function removeVault(list: VaultList, id: string): VaultList {
  const vaults = list.vaults.filter((v) => vaultId(v) !== id)
  const open = list.open === id ? (vaults[0] ? vaultId(vaults[0]) : null) : list.open
  return { vaults, open }
}

export function openVaultOf(list: VaultList): PhoneVault | null {
  return list.vaults.find((v) => vaultId(v) === list.open) ?? null
}

/** The one vault that polls GitHub (decision 7): the open one. The others wait until they open. */
export const pollingVault = openVaultOf

export async function loadVaultList(store: VaultStore): Promise<VaultList> {
  return (await store.getState<VaultList>(PHONE, LIST)) ?? { vaults: [], open: null }
}

export function saveVaultList(store: VaultStore, list: VaultList): Promise<void> {
  return store.setState(PHONE, LIST, list)
}

/**
 * Removes a vault from the phone. Its stored files go first, then the list changes: if the app stops between the
 * two, the vault is still listed with no files, and it downloads again. It never leaves files that no list names.
 */
export async function forgetVault(store: VaultStore, list: VaultList, id: string): Promise<VaultList> {
  await store.removeVault(id)
  const left = removeVault(list, id)
  await saveVaultList(store, left)
  return left
}
