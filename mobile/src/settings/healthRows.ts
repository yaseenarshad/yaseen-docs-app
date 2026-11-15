import { VAULT_CONFIG_DIR } from '@shared/types'
import { VAULT_SETTINGS_FILES } from '@shared/vaultSettingsFiles'
import type { VaultStore } from '../store'

/**
 * Settings › Vault health (YAZ-5559), READ ONLY: which settings files of `.yaseendocs/` the open vault has (in the
 * phone's copy, which downloads the whole folder), and which settings use the Mac's defaults because the file is
 * missing or is not valid JSON. The list of files is the shared one (`@shared/vaultSettingsFiles`), never a second one.
 */
export type HealthState = 'here' | 'missing' | 'unreadable'

export interface HealthRow {
  file: string
  label: string
  state: HealthState
}

export async function readVaultHealth(store: VaultStore, vault: string): Promise<HealthRow[]> {
  return Promise.all(
    VAULT_SETTINGS_FILES.map(async ({ file, label }): Promise<HealthRow> => {
      const stored = await store.read(vault, `${VAULT_CONFIG_DIR}/${file}`).catch(() => null)
      if (stored === null) return { file, label, state: 'missing' }
      try {
        JSON.parse(typeof stored.content === 'string' ? stored.content : new TextDecoder().decode(stored.content))
        return { file, label, state: 'here' }
      } catch {
        return { file, label, state: 'unreadable' }
      }
    }),
  )
}

/** The one line: "Using defaults: table look, icons" (at most 3 names, then "and 2 more"). */
export function healthLine(rows: readonly HealthRow[]): string {
  const defaults = rows.filter((r) => r.state !== 'here').map((r) => r.label)
  if (defaults.length === 0) return 'Every settings file is here'
  if (defaults.length === rows.length) return 'Using defaults: all settings (no settings files)'
  const shown = defaults.slice(0, 3)
  const more = defaults.length - shown.length
  return `Using defaults: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
}

/** A row of the list, in plain words. */
export const STATE_WORDS: Record<HealthState, string> = { here: 'In the vault', missing: 'Mac defaults', unreadable: 'Not valid JSON: Mac defaults' }
