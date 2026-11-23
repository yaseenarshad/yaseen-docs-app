/**
 * The disk half of reading the settings folder (YAZ-3276), apart from its watcher so that `yaseendocs` can read it
 * without loading one (YAZ-4269 D3). The rules are `@shared/settingsSync`.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseSettingsFile, SETTINGS_FILE_RE, settingsFileName, type SettingsFile } from '@shared/settingsSync'

/**
 * The settings files of the OTHER Macs in the settings folder `dir`, never `macId`'s own: what the app pulls, and what
 * `yaseendocs` reads to use the settings the app would use now. A file that can't be read or parsed (half-synced) is
 * skipped; its next change reads it again.
 */
export async function otherMacFiles(dir: string, macId: string): Promise<SettingsFile[]> {
  const own = settingsFileName(macId)
  const names = (await readdir(dir)).filter((name) => SETTINGS_FILE_RE.test(name) && name !== own)
  const files = await Promise.all(names.map((name) => readFile(path.join(dir, name), 'utf8').then(parseSettingsFile, () => null)))
  return files.filter((file): file is SettingsFile => file !== null)
}
