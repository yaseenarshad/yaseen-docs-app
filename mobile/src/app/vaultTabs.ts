import { VAULT_CONFIG_DIR } from '@shared/types'
import type { VaultStore } from '../store'
import type { PhoneIndex } from '../sync/phoneIndex'
import { PLAIN_VAULT, type VaultTabs } from './nav'

/**
 * WHICH TABS THE OPEN VAULT TURNS ON (YAZ-5476), from its own files on the phone, read as the Mac reads them. Small
 * reads with no parser of their own, because the first load carries this file.
 *
 * - Review (the Review and Friends tabs): the Mac's `useReviewOn`. `.yaseendocs/review.json` `enabled` (the
 *   `sanitizeReviewSettings` rule: on when the file or the field is absent), AND the vault gives IDs (YAZ-5154: cards
 *   need IDs; `.yaseendocs/ids.json` `enabled`, else some page or card has an ID, as `vaultData.ts` and the Mac's index
 *   say). A plain vault (no IDs) has Review off.
 * - Daily pages (the Today button): `.yaseendocs/daily-pages.json` `enabled: true` (`shared/dailyPagesFile.ts`), the
 *   file the Mac writes for the vault that holds its daily pages folder.
 */
export const REVIEW_FILE = `${VAULT_CONFIG_DIR}/review.json`
export const IDS_FILE = `${VAULT_CONFIG_DIR}/ids.json`
export const DAILY_FILE = `${VAULT_CONFIG_DIR}/daily-pages.json`
/** 3B's name of the stored index (`INDEX_STATE` in `sync/phoneIndex.ts`); `vaultTabs.test.ts` checks the two agree. */
export const INDEX_NAME = 'index'

/** The settings files whose change can change the tabs. */
export const TAB_FILES: readonly string[] = [REVIEW_FILE, IDS_FILE, DAILY_FILE]

async function json(store: Pick<VaultStore, 'read'>, vault: string, path: string): Promise<Record<string, unknown> | null> {
  try {
    const file = await store.read(vault, path)
    if (file === null) return null
    const value: unknown = JSON.parse(typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Some page or card of the index has an ID. */
const anyId = (index: PhoneIndex | null | undefined): boolean =>
  Object.values(index?.records ?? {}).some((r) => r.id !== undefined || r.cards?.some((c) => c.id !== null) === true)

/** The open vault's tabs. `index`: the index the caller has (3B's event); else the stored one, read only when `ids.json` gives no answer. */
export async function readVaultTabs(store: Pick<VaultStore, 'read' | 'getState'>, vault: string | null, index?: PhoneIndex): Promise<VaultTabs> {
  if (vault === null) return PLAIN_VAULT
  const [review, ids, daily] = await Promise.all([json(store, vault, REVIEW_FILE), json(store, vault, IDS_FILE), json(store, vault, DAILY_FILE)])
  const reviewOn = typeof review?.enabled === 'boolean' ? review.enabled : true
  const idsOn =
    typeof ids?.enabled === 'boolean' ? ids.enabled : reviewOn && anyId(index ?? (await store.getState<PhoneIndex>(vault, INDEX_NAME).catch(() => null)))
  return { review: reviewOn && idsOn, daily: daily?.enabled === true }
}

export const sameTabs = (a: VaultTabs, b: VaultTabs): boolean => a.review === b.review && a.daily === b.daily
