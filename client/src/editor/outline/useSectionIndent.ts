import { useCallback, useState } from 'react'

/**
 * A page's own "Section indent" switch (YAZ-2709): off until the page turns it on, and remembered
 * for that page.
 *
 * DEMO FIXTURE. The store behind this hook is `localStorage`, one key for each root + page, so the
 * demo needs no change in the main process and no new bridge call. The real feature keeps the
 * switch in the folder-state record (`FolderState` in shared/types.ts, written through
 * `storage`), the pattern YAZ-2700 uses for `tocSources`: it then follows a rename, goes when the
 * page is deleted, and reaches every window. The fixture does none of the three, and two editors
 * on one page (a tab and the right panel) each keep their own copy until they mount again.
 * Callers see only `[on, toggle]`, so the real record replaces this file and nothing else.
 */
const KEY_PREFIX = 'mdapp.sectionIndent:'

const read = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    // No storage (a locked-down profile): the switch still works, and lasts as long as the tab.
    return false
  }
}

const write = (key: string, on: boolean): void => {
  try {
    if (on) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    // Not remembered; the state below still holds it for this mount.
  }
}

export function useSectionIndent(root: string, path: string): [on: boolean, toggle: () => void] {
  const key = `${KEY_PREFIX}${root}\n${path}`
  const [held, setHeld] = useState(() => ({ key, on: read(key) }))
  // Another page in the same mount: read its own switch during this render, not one render late.
  const current = held.key === key ? held : { key, on: read(key) }
  if (current !== held) setHeld(current)
  const toggle = useCallback(() => {
    setHeld((before) => {
      const on = !(before.key === key ? before.on : read(key))
      write(key, on)
      return { key, on }
    })
  }, [key])
  return [current.on, toggle]
}
