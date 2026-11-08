/**
 * The folder page's top-right toolbar (YAZ-3746 D35): the note page's chips (`StatusChips`) with the folder's own cog.
 *
 *  - THE COG: a "This folder page" group — "Read only" (D36, `readonly: true` in `.folder.md`), "Show folder page
 *    file" (D37, `show_page_file` in `.folder.md`: On, Off, or Settings — no key, which follows Settings › Folder pages),
 *    "Preview on hover" (YAZ-4601 D51, `hover_preview` in `.folder.md`) and "Show Other files" (YAZ-4597 D43,
 *    `show_other_files`), each with the same three choices.
 *    On the Page tab, the note's page switches follow it (`FolderPageTab`).
 *  - ZOOM: per app tab and never stored, as a note's. The host keeps it.
 *  - SAVED / SAVING: the folder's own writes — its settings writes, and the Page body's saves (`FolderPageTab.save`).
 *
 * The parts that change often (the save state, the Page tab's part) live in a small store, so a save re-renders this
 * toolbar alone, never the views.
 */
import { createContext, useSyncExternalStore } from 'react'
import type { GithubSyncStatus } from '@shared/types'
import { PageSettings, type PageSettingsProps, type PageSwitch } from '../editor/PageSettings'
import { StatusChips } from '../editor/StatusChips'
import type { SaveStatus } from '../lib/autosave'
import type { Store } from '../lib/store'

/**
 * THE HOOK FOR THE PAGE TAB (YAZ-3746 10D, D35): what the Page tab hands the folder page's toolbar while it shows.
 * The Page tab reads the store from `FolderPageChips` and calls `store.set({ page })` while it shows — again when
 * a switch or its save state moves — and `store.set({ page: null })` when it goes.
 */
export interface FolderPageTab {
  /**
   * The note's page switches, as a note's `Editor` hands its own cog: every `PageSettings` prop but the folder's
   * own rows. They show after the "This folder page" group: Line numbers, Section indent, …, the counts.
   */
  cog: Omit<PageSettingsProps, 'readOnly' | 'onToggleReadOnly' | 'switches' | 'switchesHeading' | 'rows'>
  /** The Page body's save state: the save chip shows it with the settings writes' (the worse of the two). */
  save: SaveStatus
}

export interface FolderChipsState {
  /** The folder's own settings writes: 'saving' while one is in flight, 'error' when the last batch had a failure. */
  save: SaveStatus
  /** The Page tab's part; null while another view tab shows. */
  page: FolderPageTab | null
  /** The folder page is read only (D36): the Page tab keeps its body read only while this is true. */
  readOnly: boolean
}

/** The folder page's chips store, for the Page tab (see `FolderPageTab`). Null outside a folder page. */
export const FolderPageChips = createContext<Store<FolderChipsState> | null>(null)

/** The refusal of a settings write while the folder page is read only (D36), as the views' banner says it. */
export const FOLDER_READ_ONLY_TIP = 'This folder page is read only'

/** The worse of two save states: an error, then a save in flight, then an unsaved edit. */
const SAVE_RANK: Record<SaveStatus, number> = { saved: 0, unsaved: 1, saving: 2, error: 3 }
const worse = (a: SaveStatus, b: SaveStatus): SaveStatus => (SAVE_RANK[a] >= SAVE_RANK[b] ? a : b)

export function FolderToolbar({ store, zoom, onZoom, readOnly, onToggleReadOnly, asking, onAsk, onAllow, onCancel, showPageFile, onChangeShowPageFile, hoverPreview, onChangeHoverPreview, showOtherFiles, onChangeShowOtherFiles, sync, onSyncNow }: {
  store: Store<FolderChipsState>
  zoom: number
  onZoom: (zoom: number) => void
  readOnly: boolean
  /** Off → the host turns it on; on → the host opens the chip's "Allow edits?" box, as a note's cog does. */
  onToggleReadOnly: () => void
  asking: boolean
  onAsk: () => void
  onAllow: () => void
  onCancel: () => void
  /** The folder's own choice: `undefined` follows Settings. */
  showPageFile: boolean | undefined
  onChangeShowPageFile: (next: boolean | undefined) => void
  /** The folder's own "Preview on hover" (YAZ-4601 D51): `undefined` follows Settings. */
  hoverPreview: boolean | undefined
  onChangeHoverPreview: (next: boolean | undefined) => void
  /** The folder's own "Show Other files" (YAZ-4597): `undefined` follows Settings. */
  showOtherFiles: boolean | undefined
  onChangeShowOtherFiles: (next: boolean | undefined) => void
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
}) {
  const save = useSyncExternalStore(store.subscribe, () => store.getState().save)
  const page = useSyncExternalStore(store.subscribe, () => store.getState().page)
  // "Settings" first: the absence of a choice stands first, as the cog's "TOC made from: Auto" does.
  const choiceRow = (label: string, value: boolean | undefined, onChange: (next: boolean | undefined) => void): PageSwitch => ({
    label,
    choices: [
      { label: 'Settings', on: value === undefined, onPick: () => onChange(undefined), title: 'Follow Settings › Folder pages' },
      { label: 'On', on: value === true, onPick: () => onChange(true) },
      { label: 'Off', on: value === false, onPick: () => onChange(false) },
    ],
  })
  const switches = [choiceRow('Show folder page file', showPageFile, onChangeShowPageFile), choiceRow('Preview on hover', hoverPreview, onChangeHoverPreview), choiceRow('Show Other files', showOtherFiles, onChangeShowOtherFiles)]
  return (
    <StatusChips zoom={zoom} onZoom={onZoom} readOnly={readOnly ? { asking, onAsk, onAllow, onCancel } : null} sync={sync} onSyncNow={onSyncNow} save={page === null ? save : worse(save, page.save)}>
      <PageSettings {...page?.cog} readOnly={readOnly} onToggleReadOnly={onToggleReadOnly} switches={switches} switchesHeading="This folder page" />
    </StatusChips>
  )
}
