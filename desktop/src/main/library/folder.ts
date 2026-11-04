/**
 * THE LIBRARY FOLDER (🔒 YAZ-1775 D5): the one folder every vault shares, holding `media.json`
 * (`mediaStore.ts`) and `components/` (`componentStore.ts`).
 *
 * WHERE IT IS (YAZ-4364, round 3 decision 1): the folder the user picked; else, with a settings folder set
 * (YAZ-3276), `<settings folder>/library`, so the favorites and components sync with the settings; else
 * `<userData>/library`. `libraryFolder` stays a setting of this Mac (`LOCAL_SETTINGS`). A change of the
 * answer copies the library across (`copyLibrary.ts`).
 *
 * Only the main process knows where userData is, so only main can resolve
 * `SettingsState.libraryFolder` — which is why the Settings row asks through
 * `drawing:library-folder`. Electron-free on purpose (userData comes in as an argument).
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Store } from '../store'

/** The folder's name under the settings folder, or under userData, when the setting is null. */
export const DEFAULT_LIBRARY_DIR = 'library'

export function resolveLibraryFolder(setting: string | null, userData: string, settingsFolder: string | null = null): string {
  return setting ?? join(settingsFolder ?? userData, DEFAULT_LIBRARY_DIR)
}

/**
 * Keeps a library store on the setting: answers the folder to open it on now, then hands `moved`
 * each other folder the setting comes to name — a re-point, which the caller also announces as a
 * change of the library, since what a window can offer is different now.
 */
export function followLibraryFolder(store: Pick<Store, 'get' | 'onChange'>, userData: string, moved: (folder: string) => void): string {
  const { settings, settingsFolder } = store.get()
  let folder = resolveLibraryFolder(settings.libraryFolder, userData, settingsFolder)
  store.onChange((state) => {
    const next = resolveLibraryFolder(state.settings.libraryFolder, userData, state.settingsFolder)
    if (next === folder) return
    folder = next
    moved(next)
  })
  return folder
}

/**
 * Resolve and `mkdir -p`. A folder that cannot be made is still the ANSWER rather than a throw:
 * the Settings row's job is to say where the library should be, and a launch must not fail
 * because a path the user picked has since gone read-only or been unplugged.
 */
export async function ensureLibraryFolder(setting: string | null, userData: string, settingsFolder: string | null = null): Promise<string> {
  const folder = resolveLibraryFolder(setting, userData, settingsFolder)
  await mkdir(folder, { recursive: true }).catch((err: unknown) => console.warn('[library] could not create', folder, err))
  return folder
}
