import { posix, win32 } from 'node:path'

/** The app's name. Electron names the user-data folder after it (`app.setName` in `index.ts`), and so does `userDataDir`. */
export const APP_NAME = 'Yaseen Docs'
/** The one user-global state file (D9, GRO-2159), in the user-data folder. */
export const STATE_FILE = 'yaseendocs.json'

export interface UserDataPathOwner {
  setPath(name: 'userData', path: string): void
}

/** `YASEEN_DOCS_USER_DATA_DIR` as a path: trimmed, and absent or blank is no override. */
const overridePath = (value: string | undefined): string | null => value?.trim() || null

/** Opt-in demo/test isolation; absent in normal launches, so the production profile is untouched. */
export function applyUserDataOverride(app: UserDataPathOwner, value: string | undefined): void {
  const path = overridePath(value)
  if (path !== null) app.setPath('userData', path)
}

/**
 * The app's user-data folder WITHOUT Electron (YAZ-2556 D2), for the `yaseendocs` command: what
 * `app.getPath('userData')` answers in `index.ts`. The override when it is set, else where
 * Electron puts an app of this name — `~/Library/Application Support/Yaseen Docs` on macOS,
 * `%APPDATA%\Yaseen Docs` on Windows, the two systems the app ships for.
 */
export function userDataDir(env: Record<string, string | undefined>, platform: NodeJS.Platform, home: string): string {
  const override = overridePath(env.YASEEN_DOCS_USER_DATA_DIR)
  if (override !== null) return override
  if (platform === 'win32') return win32.join(env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'), APP_NAME)
  return posix.join(home, 'Library', 'Application Support', APP_NAME)
}
