import { useCallback, useState } from 'react'

/**
 * A page switch of the cog that is saved with the note: "Section indent" (YAZ-2709 D2, off until
 * the page turns it on) and "Table of contents" (YAZ-2950, on until the page turns it off).
 * `read` and `write` are the pair in `storage` for that switch.
 *
 * Each switch is in the app state, with the note (`folders[root].sectionIndents[path]` and
 * `folders[root].tocSwitches[path]`), on the terms of the table of contents source (`tocSources`).
 * It follows a rename or a move of the note, goes when the note is deleted, and is there after a
 * restart. On AND off are stored: a page the reader turned off is not a page that was never touched.
 *
 * It is read when the editor mounts and not followed after that: an editor that opens the page
 * later starts with the stored switch, and two editors that are open on one page at the same time
 * (a tab and the right panel, or two windows) each keep what they show until they mount again.
 */
export function usePageSwitch(root: string, path: string, read: (root: string, path: string) => boolean, write: (root: string, path: string, on: boolean) => void): [on: boolean, toggle: () => void] {
  const [held, setHeld] = useState(() => ({ root, path, on: read(root, path) }))
  // Another page in the same mount: read its own switch during this render, not one render late.
  const current = held.root === root && held.path === path ? held : { root, path, on: read(root, path) }
  if (current !== held) setHeld(current)
  const toggle = useCallback(() => {
    const on = !current.on
    setHeld({ root, path, on })
    write(root, path, on)
  }, [root, path, current.on, write])
  return [current.on, toggle]
}
