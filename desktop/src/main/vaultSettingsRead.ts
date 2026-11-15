import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NEW_PLACES_FILE, sanitizeVaultNewPlaces, vaultNewPlacesFields, type NewPlacesFields } from '@shared/newPlaces'
import { VAULT_CONFIG_DIR } from '@shared/types'

/**
 * A vault settings file read for one action of main or the CLI (YAZ-5491, YAZ-5486): plain fs, not `vaultConfig.ts`,
 * so the CLI (which has no watcher) shares it. Undefined when the vault has no such file; a file that is not valid JSON
 * is refused (the action says why) rather than read as defaults.
 */
export async function readVaultSettingsFile(root: string, name: string): Promise<unknown> {
  const file = path.join(root, VAULT_CONFIG_DIR, name)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw err
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${file} is not valid JSON`)
  }
}

/** Where new things go in the vault at `root` (YAZ-5486): its `new-places.json` keys over the app's values. */
export async function vaultNewPlacesSettings<T extends NewPlacesFields>(root: string, app: T): Promise<T> {
  return vaultNewPlacesFields(app, sanitizeVaultNewPlaces(await readVaultSettingsFile(root, NEW_PLACES_FILE)))
}
