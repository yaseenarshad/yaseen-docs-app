/**
 * The folder page's top-right toolbar (YAZ-3746 D35): the page page's chips (`StatusChips`) with the folder's own cog.
 *
 *  - THE COG: a "This folder page" group — "Read only" (D36, `readonly: true` in `.folder.md`), "Show folder page
 *    file" (D37, `show_page_file` in `.folder.md`: On, Off, or Settings — no key, which follows Settings › Folder pages),
 *    "Preview rows on hover" and "Preview links on hover" (YAZ-4601 D51, split by demo 13D: `hover_rows` and
 *    `hover_links` in `.folder.md`, the old `hover_preview` read where a new key is absent) and "Show Other files"
 *    (YAZ-4597 D43, `show_other_files`), each with the same three choices.
 *    On the Page tab, the page's page switches follow it, and the page's fold-all button stands left of it (`FolderPageTab`).
 *  - ZOOM: per app tab and never stored, as a page's. The host keeps it.
 *  - SAVED / SAVING: the folder's own writes — its settings writes, and the Page body's saves (`FolderPageTab.save`).
 *
 * The parts that change often (the save state, the Page tab's part) live in a small store, so a save re-renders this
 * toolbar alone, never the views.
 */
import { createContext, useSyncExternalStore, type ReactNode } from 'react'
import { ViewTypeIcon } from './view/icons'
import type { FolderPagesSettings, GithubSyncStatus } from '@shared/types'
import { type Hint, PageSettings, type PageSettingsProps, type PageSwitch } from '../editor/PageSettings'
import { MarkGlyph } from './view/ColumnMark'
import { StatusChips } from '../editor/StatusChips'
import type { SaveStatus } from '../lib/autosave'
import type { Store } from '../lib/store'
import type { AllowFor } from '../editor/useTimedUnlock'

/**
 * THE HOOK FOR THE PAGE TAB (YAZ-3746 10D, D35): what the Page tab hands the folder page's toolbar while it shows.
 * The Page tab reads the store from `FolderPageChips` and calls `store.set({ page })` while it shows — again when
 * a switch or its save state moves — and `store.set({ page: null })` when it goes.
 */
export interface FolderPageTab {
  /**
   * The page's page switches, as a page's `Editor` hands its own cog: every `PageSettings` prop but the folder's
   * own rows. They show after the "This folder page" group: Line numbers, Section indent, …, the counts.
   */
  cog: Omit<PageSettingsProps, 'readOnly' | 'onToggleReadOnly' | 'switches' | 'switchesHeading' | 'rows'>
  /** The Page body's save state: the save chip shows it with the settings writes' (the worse of the two). */
  save: SaveStatus
  /** The page's fold-all button (YAZ-3746 10D): it stands left of the cog, as on a page page. Null while Folding is off. */
  foldAll: ReactNode
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

export function FolderToolbar({ store, zoom, onZoom, readOnly, onToggleReadOnly, asking, onAsk, onAllow, onCancel, onTurnOff, editingUntil = null, onLock, showPageFile, onChangeShowPageFile, hoverRows, onChangeHoverRows, hoverLinks, onChangeHoverLinks, showOtherFiles, onChangeShowOtherFiles, inheritColumns, onChangeInheritColumns, columnMarks, onChangeColumnMarks, confirmChanges, onChangeConfirmChanges, showNewButtons, onChangeShowNewButtons, views, defaultView, onChangeDefaultView, name, sync, onSyncNow }: {
  store: Store<FolderChipsState>
  zoom: number
  onZoom: (zoom: number) => void
  /** The folder page is under Read only: its own switch, or the vault's (YAZ-4939). The chip shows while it is. */
  readOnly: boolean
  /** Off → the host turns it on; on → the host opens the chip's "Allow edits?" box, as a page's cog does; on while a timed unlock runs → "Lock now". */
  onToggleReadOnly: () => void
  asking: boolean
  onAsk: () => void
  /** A time choice (YAZ-4939): the host unlocks this tab for that long. */
  onAllow: (choice: AllowFor) => void
  onCancel: () => void
  /** "Turn Read only off": the folder page's own switch, in `.folder.md`. Absent while the vault's lock would keep it locked anyway. */
  onTurnOff?: () => void
  /** A timed unlock runs: when it ends, or Infinity until the tab closes; null = locked. */
  editingUntil?: number | null
  onLock?: () => void
  /** The folder's own choice: `undefined` follows Settings. */
  showPageFile: boolean | undefined
  onChangeShowPageFile: (next: boolean | undefined) => void
  /** The folder's own "Preview rows on hover" (YAZ-4601 D51, split by demo 13D): `undefined` follows Settings. */
  hoverRows: boolean | undefined
  /** "Confirm changes" (YAZ-3746 13AN): the page's own choice; `undefined` follows Settings. */
  confirmChanges?: boolean | undefined
  onChangeConfirmChanges?: (next: boolean | undefined) => void
  /** The folder's name: the ⚙'s heading says "Launch Kit (folder page)" (YAZ-3746 13BP CL6), as the menus say "(folder)". */
  name: string
  /** "Show New buttons" (YAZ-3746 13BL): the page's own choice; `undefined` follows Settings. Absent: no row. */
  showNewButtons?: boolean | undefined
  onChangeShowNewButtons?: (next: boolean | undefined) => void
  onChangeHoverRows: (next: boolean | undefined) => void
  /** The folder's own "Preview links on hover" (demo 13D): `undefined` follows Settings. */
  hoverLinks: boolean | undefined
  onChangeHoverLinks: (next: boolean | undefined) => void
  /** The folder's own "Show Other files" (YAZ-4597): `undefined` follows Settings. */
  showOtherFiles: boolean | undefined
  onChangeShowOtherFiles: (next: boolean | undefined) => void
  /** The folder's own "Show parent folders' columns" (YAZ-4713 C12): `undefined` follows Settings. */
  inheritColumns: boolean | undefined
  onChangeInheritColumns: (next: boolean | undefined) => void
  /** The folder's own "Show where columns come from" (YAZ-4713 C11): `undefined` follows Settings. Absent: no row. */
  columnMarks?: FolderPagesSettings['columnMarks'] | undefined
  onChangeColumnMarks?: (next: FolderPagesSettings['columnMarks'] | undefined) => void
  /** "Default view" (YAZ-4909, from the View tab since YAZ-1104): the page's views (name and type), the saved START (`defaultView`, a name, else the first view) and its ONE writer. Absent: no Views section. */
  views?: readonly { name: string; type: string }[]
  defaultView?: string
  onChangeDefaultView?: (next: string | undefined) => void
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
}) {
  const save = useSyncExternalStore(store.subscribe, () => store.getState().save)
  const page = useSyncExternalStore(store.subscribe, () => store.getState().page)
  // "Settings" first: the absence of a choice stands first, as the cog's "TOC made from: Auto" does. One line each, an (i)
  // with Settings › Folder pages' hint, under three headings (YAZ-3746 13BP): the heading says the rest of the old label.
  const choiceRow = (label: string, hint: Hint, value: boolean | undefined, onChange: (next: boolean | undefined) => void): PageSwitch => ({
    label,
    hint,
    inline: true,
    choices: [
      { label: 'Settings', on: value === undefined, onPick: () => onChange(undefined), title: 'Follow Settings › Folder pages' },
      { label: 'On', on: value === true, onPick: () => onChange(true) },
      { label: 'Off', on: value === false, onPick: () => onChange(false) },
    ],
  })
  /** C11's three marks, with Settings first as every row here: four choices, so the row keeps its own line for them. */
  const marksRow = (value: FolderPagesSettings['columnMarks'] | undefined, onChange: (next: FolderPagesSettings['columnMarks'] | undefined) => void): PageSwitch => ({
    label: 'Where columns come from',
    // A list, each mark at the left as the header draws it (13BP, demo: "reads like a list rather than a paragraph").
    hint: {
      lead: "A mark after a column's name says where it comes from:",
      rows: [
        [<MarkGlyph key="parent" icon="parent" />, 'From a parent folder'],
        [<MarkGlyph key="copy" icon="copy" />, "This folder's own settings for a parent's column"],
        [<MarkGlyph key="below" icon="below" />, 'From a subfolder'],
        [<MarkGlyph key="lock" icon="lock" />, 'This folder keeps its own value'],
        [<MarkGlyph key="loose" icon="loose" />, 'Only in the pages: no column'],
        ['None', "This folder's own column"],
      ],
    },
    choices: [
      { label: 'Settings', on: value === undefined, onPick: () => onChange(undefined), title: 'Follow Settings › Folder pages' },
      { label: 'Icon', on: value === 'icon', onPick: () => onChange('icon') },
      { label: 'Icon and folder name', on: value === 'name', onPick: () => onChange('name') },
      { label: 'Off', on: value === 'off', onPick: () => onChange('off') },
    ],
  })
  const section = (heading: string, rows: PageSwitch[], first = false): PageSwitch[] => rows.map((row, i) => (i === 0 ? { ...row, heading, divider: !first } : row))
  const switches = [
    ...section(
      'Show',
      [
        choiceRow('Page file in the sidebar', "This folder's page file in the sidebar, first under its folder.", showPageFile, onChangeShowPageFile),
        choiceRow('Other files', "A tray at the foot of this page: the folder's files that are not pages, and the pages moved out of its views.", showOtherFiles, onChangeShowOtherFiles),
        ...(onChangeShowNewButtons === undefined ? [] : [choiceRow('New buttons', { lead: 'Shows or hides:', rows: [['+ New', 'At the top right'], ['+ New', 'At the end of a table and of each group'], ['+ New card', 'At the end of each board column'], ['+', 'On each group header']], foot: 'Off: right-click a row or a group header to add a page.' }, showNewButtons, onChangeShowNewButtons)]),
        choiceRow("Parent folders' columns", { lead: 'This page shows the columns of the folders above it too.', rows: [['Here', 'For every view of this page'], ['One view', 'Columns › From <parent folder> › Hide all']] }, inheritColumns, onChangeInheritColumns),
        ...(onChangeColumnMarks === undefined ? [] : [marksRow(columnMarks, onChangeColumnMarks)]),
      ],
      true,
    ),
    // YAZ-4909 (Yaseen: "doesn't this option belong on the folder page level and not in an individual view?"): the folder's
    // saved START, First view or a view by name, as ONE dropdown line whatever the number of views (Yaseen: "as the number
    // of views increases this menu is just going to get wider and wider").
    ...(views === undefined || onChangeDefaultView === undefined
      ? []
      : section('Views', [
          {
            label: 'Default view',
            hint: 'The view this page opens on. A view renamed or deleted keeps or clears it.',
            menu: {
              value: defaultView !== undefined && views.some((v) => v.name === defaultView) ? defaultView : '',
              options: [{ value: '', label: 'First view' }, ...views.map((v) => ({ value: v.name, label: v.name, icon: <ViewTypeIcon type={v.type} /> }))],
              onPick: (value) => onChangeDefaultView(value === '' ? undefined : value),
            },
          },
        ])),
    ...section('Preview on hover', [
      choiceRow('Rows', 'Rest the mouse on a row, a card or a line of Other files to see the file.', hoverRows, onChangeHoverRows),
      choiceRow('Links', 'Rest the mouse on a link pill in a cell to see the linked page.', hoverLinks, onChangeHoverLinks),
    ]),
    ...section('Safety', [
      { label: 'Read only', readOnlySlot: true, inline: true, hint: "Locks this folder page: its title, its columns and its settings. Sort, filter and the other view changes still work. Each page keeps its own Read only." },
      ...(onChangeConfirmChanges === undefined ? [] : [choiceRow('Confirm changes', 'A change to a page from this page (a typed cell, Delete, Paste, a drag to another group or day, a rename) asks first.', confirmChanges, onChangeConfirmChanges)]),
    ]),
  ]
  return (
    <StatusChips zoom={zoom} onZoom={onZoom} readOnly={readOnly ? { asking, onAsk, onAllow, onCancel, onTurnOff, editingUntil, onLock } : null} sync={sync} onSyncNow={onSyncNow} save={page === null ? save : worse(save, page.save)}>
      {page?.foldAll}
      {/* The folder page's own settings only (YAZ-3746 13BM PS2): the Page tab's text settings are on its toolbar (`Toolbar`). */}
      <PageSettings readOnly={readOnly} onToggleReadOnly={onToggleReadOnly} switches={switches} switchesHeading={`${name} (folder page)`} />
    </StatusChips>
  )
}
