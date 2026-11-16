/**
 * The install hint's "Not now" (`screens/InstallHint.tsx`): one flag for this browser in `localStorage`. Not the
 * vault's data: a Home Screen app and a Safari tab each keep their own. Every read and write is in try/catch: Private
 * Browsing or a full phone gives no flag, and the hint shows again at the next load.
 */
export const HINT_KEY = 'notecard.homeScreenHint'

export type HintStorage = Pick<Storage, 'getItem' | 'setItem'>

const local = (): HintStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function hintHidden(storage: HintStorage | null = local()): boolean {
  try {
    return storage?.getItem(HINT_KEY) === 'hidden'
  } catch {
    return false
  }
}

export function hideHint(storage: HintStorage | null = local()): void {
  try {
    storage?.setItem(HINT_KEY, 'hidden')
  } catch {
    // No storage here: the hint hides until the page loads again.
  }
}
