import { dailyPageDate, dailyPageName } from '@shared/dailyPage'
import { DAILY_PAGES_FILE, sanitizeDailyPages, type VaultDailyPages } from '@shared/dailyPagesFile'
import { dailyPages, findDailyPage } from '@shared/pageBirth'
import { FOLDER_SETTINGS_FILE, type IndexRecord } from '@shared/types'
import { readVaultSectionOrLegacy } from '../settings/readVaultSettings'
import type { VaultStore } from '../store'
import type { PhoneIndex } from '../sync/phoneIndex'
import { INDEX_STATE_NAME } from '../search/vaultData'

/**
 * THE TODAY BUTTON'S PAGE, a chunk of its own: the first load holds only the button (`TodayTab.tsx`).
 * Read only: the phone never makes a daily page.
 *
 * Today's page by the Mac's own rules (`dailyPageName` on the phone's local day, `findDailyPage`: by its TITLE, flat or
 * in its day folder). With none yet, the latest daily page before today: the newest by the date in its name
 * (`dailyPageDate`), never by the file's time. Null: the vault has no daily page at all.
 */
export function todayOrLatest(records: readonly IndexRecord[], daily: VaultDailyPages, now: Date): { path: string; today: boolean } | null {
  const today = findDailyPage(records, daily.folder, dailyPageName(daily.format, now).trim(), daily.dayFolder)
  if (today !== null) return { path: today, today: true }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let best: { path: string; at: number } | null = null
  for (const r of records) {
    const at = dailyPageDate(daily.format, r.title, now)?.getTime()
    if (at === undefined || at >= start) continue
    // Where the Mac would find that day's page (`dailyPages`): the daily pages folder, or that day's own folder in it
    // (D9). Never a page elsewhere whose name is like a date.
    if (dailyPages([r], daily.folder, r.title, daily.dayFolder).length === 0) continue
    if (best === null || at > best.at || (at === best.at && r.path < best.path)) best = { path: r.path, at }
  }
  return best === null ? null : { path: best.path, today: false }
}

/** The vault's daily pages settings (`settings.json` › `dailyPages`, fallback `.yaseendocs/daily-pages.json`), or null when off. */
export async function dailyPagesOf(store: VaultStore, vault: string): Promise<VaultDailyPages | null> {
  return sanitizeDailyPages(await readVaultSectionOrLegacy(store, vault, 'dailyPages', DAILY_PAGES_FILE))
}

/**
 * The page the Today button opens in the stored vault, or null when there is none (or Daily pages are off). `held`:
 * the index the sync engine holds (YAZ-5596: no read of the stored one), else the stored one is read.
 */
export async function findToday(store: VaultStore, vault: string, now: Date, held?: PhoneIndex | null): Promise<{ path: string; today: boolean } | null> {
  const daily = await dailyPagesOf(store, vault)
  if (daily === null) return null
  const index = held ?? (await store.getState<PhoneIndex>(vault, INDEX_STATE_NAME))
  const records = Object.values(index?.records ?? {}).filter((r) => r.name !== FOLDER_SETTINGS_FILE)
  return todayOrLatest(records, daily, now)
}
