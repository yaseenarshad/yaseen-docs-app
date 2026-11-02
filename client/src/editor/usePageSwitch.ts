import { useCallback, useState } from 'react'

/**
 * A page switch of the cog that is kept in the app state: a code file's "Table of contents" (YAZ-2950,
 * YAZ-3506; YAZ-3558 D1: Settings › "Table of contents default" until the file makes its own choice, which
 * then wins, also over Off). A code file has no frontmatter; a note's switches are IN the note (YAZ-4094 G4,
 * `shared/pageSwitches.ts`). `read` and `write` are the pair in `storage` for that switch; `read` gives
 * `undefined` for a file that made no choice, and the switch is then `fallback`.
 *
 * The switch is in the app state, with the file (`folders[root].tocSwitches[path]`). It follows a rename
 * or a move of the file, goes when the file is deleted, and is there after a restart. On AND off are
 * stored: a file the reader turned off is not a file that was never touched.
 *
 * The choice is read when the editor mounts and not followed after that: two editors that are open on one
 * file at the same time each keep what they show until they mount again. `fallback` IS followed: a file
 * with no choice changes at once when the setting does.
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
