/**
 * Lightweight context for `FolderPageChips` (YAZ-6008 D3):
 * kept separate from `FolderToolbar.tsx` so `Editor.tsx` does not eagerly import the Folder Views tree.
 */
import { createContext, type ReactNode } from 'react'
import type { PageSettingsProps } from '../editor/PageSettings'
import type { SaveStatus } from '../lib/autosave'
import type { Store } from '../lib/store'

export interface FolderPageTab {
  cog: Omit<PageSettingsProps, 'readOnly' | 'onToggleReadOnly' | 'switches' | 'switchesHeading' | 'rows'>
  save: SaveStatus
  foldAll: ReactNode
}

export interface FolderChipsState {
  save: SaveStatus
  page: FolderPageTab | null
  readOnly: boolean
}

export const FolderPageChips = createContext<Store<FolderChipsState> | null>(null)
