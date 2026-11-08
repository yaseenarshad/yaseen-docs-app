import { chooseSettingsFolder } from '../settingsFolder'
import { requireDir } from '../fs/fsUtils'
import type { Store } from '../store'
import type { AutomationServices } from './services'
import { absolute } from './resources'

export async function settingsFolderCommand(store: Store, services: AutomationServices, command: string, args: Record<string, unknown>) {
  if (command === 'settingsFolder.get') return { folder: store.get().settingsFolder, missing: services.settingsFolder.missing() }
  const folder = args.folder === null ? null : absolute(args.folder as string)
  if (folder !== null) await requireDir(folder)
  const syncSettled = await chooseSettingsFolder(store, services.settingsFolder, folder)
  await store.flush()
  return { folder: store.get().settingsFolder, missing: services.settingsFolder.missing(), syncSettled, diskSaved: true }
}
