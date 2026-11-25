import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { isCardKind } from '@shared/cardFileFormat'
import { cardCreatedOf, cardTime, rewritePageCards, withCardCreated } from '@shared/cardLine'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import type { BackfillCreatedResult } from '@shared/ipc'
import { CREATED_KEY } from '@shared/pageCreated'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES } from '@shared/types'
import { withSuppressedEdit } from '../fs/externalEditSuppress'
import { atomicWrite } from '../fs/fsUtils'
import { idsOwnedBy, ownOnly, walk } from './scan'

/**
 * Opt-in backfill of permanent created dates (YAZ-6150, YAZ-6168): walks markdown pages and card
 * files owned by `root` (skipping hidden/skipped entries, `.folder.md`, and nested ID sub-vaults
 * via `idsOwnedBy`). Stamps `created: <cardTime(birthtimeMs)>` on unstamped pages and
 * `created <cardTime(birthtimeMs)>` on unstamped card files, skipping files that already have a
 * created stamp or have frontmatter parse errors. Each write is atomic (`atomicWrite`).
 */
export async function backfillCreated(root: string): Promise<BackfillCreatedResult> {
  const all: string[] = []
  await walk(root, all)
  const owned = await ownOnly(
    all.filter((f) => path.basename(f) !== FOLDER_SETTINGS_FILE).sort(),
    idsOwnedBy(root),
  )
  let written = 0
  let skipped = 0
  for (const file of owned) {
    try {
      const st = await stat(file)
      if (st.size > MAX_FILE_BYTES) {
        skipped += 1
        continue
      }
      const birthMs = st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs
      if (!Number.isFinite(birthMs) || birthMs <= 0) {
        skipped += 1
        continue
      }
      const iso = cardTime(birthMs)
      const text = await readFile(file, 'utf8')
      const { frontmatter } = splitFrontmatter(text)
      const { properties, error } = parseFrontmatter(frontmatter)
      if (error !== undefined) {
        skipped += 1
        continue
      }
      if (isCardKind(properties)) {
        const next = rewritePageCards(text, (card) => (cardCreatedOf(card.line) !== null ? undefined : withCardCreated(card.line, iso)))
        if (next === text) {
          skipped += 1
          continue
        }
        await withSuppressedEdit(file, () => atomicWrite(file, next))
        written += 1
      } else {
        if (Object.prototype.hasOwnProperty.call(properties, CREATED_KEY)) {
          skipped += 1
          continue
        }
        const next = setFrontmatterProperty(text, CREATED_KEY, iso)
        await withSuppressedEdit(file, () => atomicWrite(file, next))
        written += 1
      }
    } catch {
      skipped += 1
    }
  }
  return { written, skipped }
}
