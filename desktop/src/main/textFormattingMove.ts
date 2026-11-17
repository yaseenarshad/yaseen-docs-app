import { stat } from 'node:fs/promises'
import { TEXT_FORMATTING_FILE, TEXT_FORMATTING_VERSION, sanitizeSpacing, textFormattingFile } from '@shared/textFormatting'
import { placeVaults, type SettingsState } from '@shared/types'
import type { Store } from './store'
import { readConfigDetailed, writeConfig } from './vaultConfig'
import { seedVaultPart, type MoveStep } from './vaultSettingsMove'

/**
 * The 1.0.15 heading styles move once into the vaults (YAZ-3066, decision D11 on YAZ-3048). 1.0.15
 * saved them app-wide in `yaseendocs.json`; 1.0.16 keeps them in each vault's
 * `.yaseendocs/text-formatting.json` (D10). At the first start of 1.0.16 the main process copies
 * the old map into each vault of each window that the state holds and that has no file yet. The
 * store hands the map out once, and its next write drops the old key, so nothing moves twice.
 * Electron-free, like `store.ts` and `vaultConfig.ts`.
 *
 * - A vault that has the file (any content, also one that is not valid JSON) is never written.
 * - `{}` (nothing set in 1.0.15) writes nothing.
 * - A root that is not a folder now (a drive that is not connected) is skipped: `writeConfig`
 *   would make the folder again.
 * - One vault that fails is logged; the others still get their copy.
 */
export async function moveLegacyHeadingStyles(store: Pick<Store, 'get' | 'takeLegacyHeadingStyles'>): Promise<void> {
  const legacy = store.takeLegacyHeadingStyles()
  if (Object.keys(legacy).length === 0) return
  const state = store.get()
  const roots = [...new Set(state.windows.flatMap((w) => placeVaults(state.folders, w.roots)))]
  await Promise.all(
    roots.map(async (root) => {
      try {
        if (!(await stat(root)).isDirectory()) throw new Error('not a folder')
        if ((await readConfigDetailed(root, TEXT_FORMATTING_FILE)).state !== 'absent') return
        await writeConfig(root, TEXT_FORMATTING_FILE, textFormattingFile(legacy))
      } catch (err) {
        console.error(`[textFormatting] could not move the 1.0.15 heading styles into ${root}: ${String(err)}`)
      }
    }),
  )
}

/**
 * YAZ-5485: the page spacing (`lineSpacing`, `blockGap`, `pageBulletIndent`, `pageBulletGap`) moves once into the
 * `spacing` key of each open vault's text-formatting.json (version 2), by the vault settings rules (`seedVaultPart`):
 * every vault of every window, as the 1.0.15 heading styles moved (it was the look of every vault); the key is added to
 * a file that has other keys; a file that has `spacing`, or is not valid JSON, is left; the defaults move nothing.
 */
export function pageSpacingPart(s: Pick<SettingsState, 'lineSpacing' | 'blockGap' | 'pageBulletIndent' | 'pageBulletGap'>): Record<string, unknown> | null {
  const spacing = sanitizeSpacing({ line: s.lineSpacing, blockGap: s.blockGap, bulletIndent: s.pageBulletIndent, bulletGap: s.pageBulletGap })
  return spacing === null || Object.keys(spacing).length === 0 ? null : { version: TEXT_FORMATTING_VERSION, spacing }
}

export const PAGE_SPACING_MOVE: MoveStep = {
  name: 'the page spacing',
  key: (s) => pageSpacingPart(s),
  run: async (roots, s, store, canSeed) => {
    const part = pageSpacingPart(s)
    for (const root of roots) await seedVaultPart(root, TEXT_FORMATTING_FILE, part, ['spacing'], store, canSeed, `${TEXT_FORMATTING_FILE}#spacing`)
  },
}
