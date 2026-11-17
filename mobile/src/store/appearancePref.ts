/**
 * YAZ-5565: Settings › Appearance (System, Light, Dark), saved on this phone in `localStorage`: not in a vault, and the
 * Home Screen app and a Safari tab each keep their own. Every read and write is in try/catch: with no storage the app
 * follows the iPhone (System), and a choice holds until the app opens again.
 */
export type Appearance = 'system' | 'light' | 'dark'

export const APPEARANCE_KEY = 'notecard.appearance'

export type AppearanceStorage = Pick<Storage, 'getItem' | 'setItem'>

const local = (): AppearanceStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readAppearance(storage: AppearanceStorage | null = local()): Appearance {
  try {
    const v = storage?.getItem(APPEARANCE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveAppearance(value: Appearance, storage: AppearanceStorage | null = local()): void {
  try {
    storage?.setItem(APPEARANCE_KEY, value)
  } catch {
    // No storage here: the choice holds until the app opens again.
  }
}
