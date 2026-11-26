import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { NEW_PLACES_FILE, sanitizeVaultNewPlaces, vaultNewPlacesFields, type NewPlacesFields } from '@shared/newPlaces'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { LEGACY_SECTION_MAP, readVaultSection, VAULT_SETTINGS_FILE, type LegacySettingsFile } from '@shared/vaultSettings'

async function readJsonFile(file: string): Promise<unknown> {
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

/**
 * A vault settings file read for one action of main or the CLI (YAZ-5491, YAZ-5486, unified in YAZ-6546): plain fs,
 * not `vaultConfig.ts`, so the CLI (which has no watcher) shares it. When `name` is one of the 12 consolidated legacy
 * files, checks `<root>/.yaseendocs/settings.json`'s nested section FIRST, falling back to `<root>/.yaseendocs/<name>`
 * when absent. Undefined when neither has it; a file that is not valid JSON is refused rather than read as defaults.
 */
export async function readVaultSettingsFile(root: string, name: string): Promise<unknown> {
  if (Object.hasOwn(LEGACY_SECTION_MAP, name)) {
    const unified = await readJsonFile(path.join(root, VAULT_CONFIG_DIR, VAULT_SETTINGS_FILE))
    if (unified !== undefined) {
      const section = readVaultSection(unified, LEGACY_SECTION_MAP[name as LegacySettingsFile])
      if (section !== null) return section
    }
  }
  return readJsonFile(path.join(root, VAULT_CONFIG_DIR, name))
}

/** Where new things go in the vault at `root` (YAZ-5486): its `new-places.json` keys over the app's values. */
export async function vaultNewPlacesSettings<T extends NewPlacesFields>(root: string, app: T): Promise<T> {
  return vaultNewPlacesFields(app, sanitizeVaultNewPlaces(await readVaultSettingsFile(root, NEW_PLACES_FILE)))
}

/** The vault that holds `dir` for the CLI (YAZ-5490): the nearest folder, `dir` itself first, with a `.yaseendocs` folder; null with none. */
export async function vaultRootOf(dir: string): Promise<string | null> {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    if ((await stat(path.join(at, VAULT_CONFIG_DIR)).catch(() => null))?.isDirectory() === true) return at
    if (path.dirname(at) === at) return null
  }
}
