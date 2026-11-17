import { ALL_CARDS_ORDERS, DUE_TODAY_ORDERS, type AllCardsOrder, type DueTodayOrder } from '@shared/reviews'
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

/**
 * The two Order rows on the phone (YAZ-5707: All cards, Due today), the same way: the Mac saves them in `review.json`
 * (`allCardsOrder`, `dueTodayOrder`), which the phone follows; a pick on this phone is kept here and wins on this phone.
 * Each is kept on its own; `null`: no pick of its own.
 */
export const ALL_ORDER_STATE = 'reviewAllCardsOrder'
export const DUE_ORDER_STATE = 'reviewDueTodayOrder'

export interface PhoneOrders {
  all: AllCardsOrder | null
  due: DueTodayOrder | null
}

async function readOne<T extends string>(store: VaultStore, vault: string, key: string, choices: readonly T[]): Promise<T | null> {
  const kept = await store.getState<unknown>(vault, key).catch(() => undefined)
  return (choices as readonly unknown[]).includes(kept) ? (kept as T) : null
}

export async function readOrders(store: VaultStore, vault: string): Promise<PhoneOrders> {
  const [all, due] = await Promise.all([readOne(store, vault, ALL_ORDER_STATE, ALL_CARDS_ORDERS), readOne(store, vault, DUE_ORDER_STATE, DUE_TODAY_ORDERS)])
  return { all, due }
}

export function saveOrder(store: VaultStore, vault: string, which: keyof PhoneOrders, order: AllCardsOrder | DueTodayOrder): Promise<void> {
  return store.setState(vault, which === 'all' ? ALL_ORDER_STATE : DUE_ORDER_STATE, order).catch(() => undefined)
}
