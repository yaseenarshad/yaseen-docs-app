import { useCallback, useState } from 'react'

/**
 * A page switch of the cog that is saved with the note: "Section indent" (YAZ-2709 D2, off until
 * the page turns it on) and "Table of contents" (YAZ-2950; YAZ-3558 D1: Settings › "Table of contents
 * default" until the page makes its own choice, which then wins, also over Off).
 * `read` and `write` are the pair in `storage` for that switch; `read` gives `undefined` for a page
 * that made no choice, and the switch is then `fallback`.
 *
 * Each switch is in the app state, with the note (`folders[root].sectionIndents[path]` and
 * `folders[root].tocSwitches[path]`), on the terms of the table of contents source (`tocSources`).
 * It follows a rename or a move of the note, goes when the note is deleted, and is there after a
 * restart. On AND off are stored: a page the reader turned off is not a page that was never touched.
 *
 * The choice is read when the editor mounts and not followed after that: an editor that opens the page
 * later starts with the stored switch, and two editors that are open on one page at the same time
 * (a tab and the right panel, or two windows) each keep what they show until they mount again.
 * `fallback` IS followed: a page with no choice changes at once when the setting does.
 */
export function usePageSwitch(root: string, path: string, read: (root: string, path: string) => boolean | undefined, write: (root: string, path: string, on: boolean) => void, fallback = false): [on: boolean, toggle: () => void] {
  const [held, setHeld] = useState(() => ({ root, path, choice: read(root, path) }))
  // Another page in the same mount (in the app, another vault: `CrepeHost` is keyed by the path): read its own switch during this render, not one render late.
  const current = held.root === root && held.path === path ? held : { root, path, choice: read(root, path) }
  if (current !== held) setHeld(current)
  const on = current.choice ?? fallback
  const toggle = useCallback(() => {
    setHeld({ root, path, choice: !on })
    write(root, path, !on)
  }, [root, path, on, write])
  return [on, toggle]
}
