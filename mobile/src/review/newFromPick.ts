import type { VaultStore } from '../store'

/**
 * WHERE NEW CARDS COME FROM, on the phone (the Mac's YAZ-5322). The rule is the Mac's own: the shared hook's
 * `setNewFrom` saves the pick through `saveSettings`, the settings' `newFrom` follows, and `cardPlan` takes today's new
 * cards from those folders (more than one may be picked; a folder takes its subfolders).
 *
 * The Mac saves the pick in the vault's `review.json`. The phone writes no settings file (its answer list holds card
 * actions only), so the phone keeps ITS pick here, for this vault, on this phone. With no pick of its own the phone
 * follows the Mac's (`review.json`). `null`: no pick of its own.
 */
export const NEW_FROM_STATE = 'reviewNewFrom'

export async function readNewFrom(store: VaultStore, vault: string): Promise<string[] | null> {
  const kept = await store.getState<unknown>(vault, NEW_FROM_STATE).catch(() => undefined)
  return Array.isArray(kept) && kept.every((f) => typeof f === 'string') ? kept : null
}

export function saveNewFrom(store: VaultStore, vault: string, folders: readonly string[]): Promise<void> {
  // A write that fails (a full phone) keeps the pick for this session only.
  return store.setState(vault, NEW_FROM_STATE, [...folders]).catch(() => undefined)
}
