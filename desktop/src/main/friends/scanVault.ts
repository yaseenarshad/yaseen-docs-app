/**
 * A closed vault's cards, read from its files (YAZ-5252). It runs IN THE COUNT WORKER (`countWorker.ts`), never on the
 * main thread. The same reading as the live index: `walk` and `scanFile` (the shared `indexRecord`), only the pages
 * that this vault owns for IDs (`idsOwnedBy`, as `live.ts`), and no cards when the vault does not give IDs (YAZ-4946
 * D8, `plain()` in `live.ts`). The review settings come from `.yaseendocs/review.json`. Symlinked folders are not
 * walked (`walk` takes real folders only).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { FriendVault } from '@shared/friendStats'
import { REVIEW_SETTINGS_FILE, sanitizeReviewSettings } from '@shared/reviews'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { answersIds, idsOwnedBy, ownOnly, scanFile, walk } from '../vaultIndex/scan'

export async function scanVaultForCount(root: string): Promise<FriendVault> {
  const settings = sanitizeReviewSettings(await readFile(path.join(root, VAULT_CONFIG_DIR, REVIEW_SETTINGS_FILE), 'utf8').then((t) => JSON.parse(t) as unknown, () => null))
  if (!(await answersIds(root))) return { pages: [], settings }
  const files: string[] = []
  await walk(root, files)
  const own = await ownOnly(files, idsOwnedBy(root))
  const pages = []
  for (const file of own.sort()) {
    const record = await scanFile(root, file).catch(() => null)
    if (record?.cards !== undefined && record.cards.length > 0) pages.push({ cards: record.cards })
  }
  return { pages, settings }
}
