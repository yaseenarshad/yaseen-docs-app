import type { FolderPagesSettings } from './types'

/**
 * Settings › Folder pages, as a new install has them (YAZ-4585, D34): what a view reads for each key it does not set.
 * `types.ts` re-exports it. A module of its own (YAZ-5460): the phone's folder page reads it from a lazy chunk.
 */
export const DEFAULT_FOLDER_PAGES: FolderPagesSettings = {
  // Sunday to Saturday (the demo of 2026-11-08); a stored `monday` stays Monday.
  weekStartsOn: 'sunday',
  rowBand: null,
  keepWindowPinned: null,
  rowHeight: 'short',
  rowNumbers: true,
  columnTypeIcons: true,
  // YAZ-4848: the folder icon on, the "N inside" count off ("hide the num of pages by default").
  folderIcons: true,
  folderCounts: false,
  textInCells: 'kind',
  groupIndent: 'medium',
  // YAZ-4798: on, on hover, plain lines (the approved defaults; a view with no key of its own reads them).
  stickyGroups: true,
  groupLines: 'hover',
  groupLineStyle: 'plain',
  showEmptyGroups: true,
  showEmptyColumns: false,
  subfolders: 'pages',
  foldersFirst: true,
  calendarScale: 'month',
  cardTitles: 'clip',
  calendarCardStyle: 'accent',
  calendarCardColor: '',
  hideWeekends: false,
  // YAZ-4878: 1 px lines in the app's line colour (Gray, Medium), the look before the setting existed.
  weekLine: 1,
  dayLine: 1,
  weekLineColor: 'gray',
  dayLineColor: 'gray',
  // YAZ-6331: Rolling alternating month shade (on, Gray Light) and Between months line (Off, Blue Medium).
  monthShade: true,
  monthShadeColor: 'gray light',
  monthLine: 0,
  monthLineColor: 'blue',
  showFolderPageFiles: false,
  askBeforeDelete: true,
  confirmChanges: true,
  showNewButtons: true,
  showOtherFiles: true,
  inheritColumns: true,
  columnMarks: 'icon',
  // YAZ-5582: a plain click on a Calendar or Board card opens its page in a background tab.
  cardClickOpens: 'background',
}
