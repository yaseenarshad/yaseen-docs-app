import { createContext } from 'react'

/**
 * A folder page's shortcut doors (YAZ-4797 demo: "the ↗ says nothing on hover", and shortcuts could only be made or
 * removed from the sidebar). `FolderView` provides them; the row menu (`PageContextMenu`) and a title's ↗ read them.
 * Null outside a folder page, or in a vault with no IDs: a shortcut names a folder by its id (`also_in`).
 */
export interface ShortcutDoors {
  /** This folder page's name: "Remove shortcut from Party menu". */
  pageName: string
  /** Where a row that is a shortcut on this page lives (its folder and that folder's name); null for a row that lives here or below. */
  homeOf: (path: string) => { dir: string; name: string } | null
  /** "Go to where it lives": that folder's page. */
  goHome: (dir: string) => void
  /** Take the note's shortcut off this page (the note stays where it lives). A toast offers Undo. */
  remove: (path: string) => void
  /** Add a shortcut to the note in folder `dir`. A toast offers Undo. */
  add: (path: string, dir: string) => void
  /** The folders a shortcut can go to, for "Add shortcut to ›": each folder of the vault, its name and its path. */
  folders: () => { dir: string; name: string; path: string }[]
  /**
   * The folders (absolute) a note already shows in (checker 8A): where it lives and each folder its `also_in` names.
   * "Add shortcut to ›" leaves them out, so a pick never adds what is there (and its Undo never removes it).
   */
  holders: (path: string) => ReadonlySet<string>
  /** A note no write may touch (read-only): no shortcut items. */
  locked: (path: string) => boolean
}

export const ShortcutActions = createContext<ShortcutDoors | null>(null)
