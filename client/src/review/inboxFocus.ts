/** The Inbox's focus mode (YAZ-5375), remembered in localStorage (every window); off by default and never written off. */
const KEY = 'inbox:focus'

export function readInboxFocus(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function saveInboxFocus(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // No storage: the choice lasts the run.
  }
}
