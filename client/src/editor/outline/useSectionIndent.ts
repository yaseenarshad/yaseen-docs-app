import { useCallback, useState } from 'react'
import { storage } from '../../lib/storage'

/**
 * A page's own "Section indent" switch (YAZ-2709 D2): off until the page turns it on, and
 * remembered for that page.
 *
 * The switch is in the app state, with the note: `folders[root].sectionIndents[path]`, read and
 * written through `storage` — the record YAZ-2700 keeps for a note's table of contents source
 * (`tocSources`), on the same terms. It follows a rename or a move of the note, goes when the note
 * is deleted, and is there after a restart. On AND off are stored (D2): a page the reader turned
 * off is not a page that was never touched.
 *
 * Like the table of contents source, it is read when the editor mounts and not followed after
 * that: an editor that opens the page later starts with the stored switch, and two editors that
 * are open on one page at the same time (a tab and the right panel, or two windows) each keep
 * what they show until they mount again.
 */
export function useSectionIndent(root: string, path: string): [on: boolean, toggle: () => void] {
  const [held, setHeld] = useState(() => ({ root, path, on: storage.getSectionIndent(root, path) }))
  // Another page in the same mount: read its own switch during this render, not one render late.
  const current = held.root === root && held.path === path ? held : { root, path, on: storage.getSectionIndent(root, path) }
  if (current !== held) setHeld(current)
  const toggle = useCallback(() => {
    const on = !current.on
    setHeld({ root, path, on })
    storage.setSectionIndent(root, path, on)
  }, [root, path, current.on])
  return [current.on, toggle]
}
