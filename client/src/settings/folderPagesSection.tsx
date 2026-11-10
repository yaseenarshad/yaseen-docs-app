/**
 * SETTINGS › FOLDER PAGES (YAZ-4585, D34 of YAZ-4501): the global side of a folder page. Each setting has one home
 * besides Settings, and no setting lives on both the page and a view.
 *
 * - Personal, here only: the week start, the folder views' "Preview on hover" (moved from Files & Links, the same
 *   `hoverPreviewIn.folderViews`), the table row band and the note window's pin. The last two follow the table block's
 *   settings (`folderRowBandOn`, `folderWindowPinned`) until they are set. "Ask before deleting notes" (YAZ-4592 S26)
 *   is the row menu's Delete note…, separate from the sidebar's Confirm before deleting.
 * - View defaults: a view with no key of its own reads these (`views/viewDefaults.tsx`); its menus say "from Settings".
 * - Page defaults: the sidebar's folder page file rows (D37) and the Other files tray (YAZ-4597, D43); a folder's ⚙ beats them.
 *
 * Every row writes one part of `settings.folderPages`. Every default is the look before the page existed.
 */
import { folderRowBandOn, folderWindowPinned, type FolderPagesSettings } from '@shared/types'
import { Segmented } from './controls'
import { ON_OFF_OPTIONS, type Option } from './options'
import type { SettingDef, SettingsCtx, SettingsSection } from './registry'

/** YAZ-4713 C11: the column header's mark. */
const COLUMN_MARKS_OPTIONS: readonly Option<FolderPagesSettings['columnMarks']>[] = [
  { label: 'Icon', value: 'icon' },
  { label: 'Icon and folder name', value: 'name' },
  { label: 'Off', value: 'off' },
]
const WEEK_START_OPTIONS: readonly Option<FolderPagesSettings['weekStartsOn']>[] = [
  { label: 'Sunday', value: 'sunday' },
  { label: 'Monday', value: 'monday' },
]
const ROW_HEIGHT_OPTIONS: readonly Option<FolderPagesSettings['rowHeight']>[] = [
  { label: 'Short', value: 'short' },
  { label: 'Medium', value: 'medium' },
  { label: 'Tall', value: 'tall' },
]
const TEXT_IN_CELLS_OPTIONS: readonly Option<FolderPagesSettings['textInCells']>[] = [
  { label: 'By kind', value: 'kind' },
  { label: 'Wrap', value: 'wrap' },
  { label: 'Clip', value: 'clip' },
]
const GROUP_INDENT_OPTIONS: readonly Option<FolderPagesSettings['groupIndent']>[] = [
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
]
/**
 * YAZ-4798: a grouped table's group lines, the three choices and meaning of Settings › Sidebar › Level lines, in the
 * approved words (Off · On · On hover); and their look, plain lines or the thread to the row under the pointer.
 */
const GROUP_LINES_OPTIONS: readonly Option<FolderPagesSettings['groupLines']>[] = [
  { label: 'On hover', value: 'hover' },
  { label: 'On', value: 'always' },
  { label: 'Off', value: 'off' },
]
const GROUP_LINE_STYLE_OPTIONS: readonly Option<FolderPagesSettings['groupLineStyle']>[] = [
  { label: 'Lines', value: 'plain' },
  { label: 'Thread', value: 'thread' },
]
const SUBFOLDERS_OPTIONS: readonly Option<FolderPagesSettings['subfolders']>[] = [
  { label: 'Their notes', value: 'notes' },
  { label: 'As rows', value: 'rows' },
  { label: 'Both', value: 'both' },
  { label: 'Hide', value: 'hide' },
]
const CALENDAR_SCALE_OPTIONS: readonly Option<FolderPagesSettings['calendarScale']>[] = [
  { label: 'Month', value: 'month' },
  { label: 'Week', value: 'week' },
]
const CARD_TITLES_OPTIONS: readonly Option<FolderPagesSettings['cardTitles']>[] = [
  { label: 'Clip', value: 'clip' },
  { label: 'Wrap', value: 'wrap' },
]

const WORDS = ['folder', 'folder page', 'views', 'table', 'board', 'calendar', 'cards', 'list']

/** One row that writes `folderPages[part]`; `shown` reads what the control shows, for the two that follow another setting. */
function row<K extends keyof FolderPagesSettings>(
  part: K,
  label: string,
  options: readonly Option<NonNullable<FolderPagesSettings[K]>>[],
  more: { hint?: string; keywords?: string[]; shown?: (ctx: SettingsCtx) => NonNullable<FolderPagesSettings[K]> } = {},
): SettingDef {
  return {
    id: `folderPages.${part}`,
    label,
    hint: more.hint,
    keywords: [...WORDS, ...(more.keywords ?? [])],
    render: (ctx) => {
      const { settings, onChange } = ctx
      const value = more.shown?.(ctx) ?? (settings.folderPages[part] as NonNullable<FolderPagesSettings[K]>)
      return <Segmented options={options} value={value} onChange={(next) => onChange({ ...settings, folderPages: { ...settings.folderPages, [part]: next } })} ariaLabel={label} />
    },
  }
}

export const FOLDER_PAGES_SECTION: SettingsSection = {
  id: 'folderPages',
  title: 'Folder pages',
  keywords: WORDS,
  groups: [
    {
      title: 'Personal',
      items: [
        row('weekStartsOn', 'Week starts on', WEEK_START_OPTIONS, { hint: 'The first day of the calendar view.', keywords: ['week', 'monday', 'sunday'] }),
        {
          // Moved from Files & Links › Preview on hover (D34), the same key: that page's master switch still turns every place off.
          // Two switches since demo 13D (YAZ-4601): the rows' keeps the old key; the links' is `folderLinks`.
          id: 'hoverPreviewIn.folderViews',
          label: 'Preview rows on hover',
          hint: 'Rest the mouse on a row, a card or a line of Other files to see the file. The main Preview on hover switch turns every place off.',
          keywords: [...WORDS, 'hover', 'preview', 'mouse', 'rows', 'cards'],
          render: ({ settings, onChange }) => (
            <Segmented options={ON_OFF_OPTIONS} value={settings.hoverPreviewIn.folderViews} onChange={(on) => onChange({ ...settings, hoverPreviewIn: { ...settings.hoverPreviewIn, folderViews: on } })} ariaLabel="Preview rows on hover: Folder pages" />
          ),
        },
        {
          id: 'hoverPreviewIn.folderLinks',
          label: 'Preview links on hover',
          hint: 'Rest the mouse on a link pill in a cell to see the linked note. The main Preview on hover switch turns every place off.',
          keywords: [...WORDS, 'hover', 'preview', 'mouse', 'links', 'pill'],
          render: ({ settings, onChange }) => (
            <Segmented options={ON_OFF_OPTIONS} value={settings.hoverPreviewIn.folderLinks} onChange={(on) => onChange({ ...settings, hoverPreviewIn: { ...settings.hoverPreviewIn, folderLinks: on } })} ariaLabel="Preview links on hover: Folder pages" />
          ),
        },
        // The hints' "›" stays with the word after it: a no-break space, so the arrow never ends a line (YAZ-4643 S7).
        row('rowBand', 'Row band on hover', ON_OFF_OPTIONS, { hint: 'A band on the table row under the mouse. Until you set it, it follows Tables ›\u00a0All tables ›\u00a0Row band.', keywords: ['band', 'highlight', 'hover', 'row'], shown: ({ settings }) => folderRowBandOn(settings) }),
        row('keepWindowPinned', 'Keep the mini window pinned', ON_OFF_OPTIONS, { hint: 'The mini window of a row stays open on a click outside it. Until you set it, it follows Tables ›\u00a0Cell notes ›\u00a0Keep cell notes open.', keywords: ['mini window', 'note window', 'pin', 'pinned'], shown: ({ settings }) => folderWindowPinned(settings) }),
        // Its own switch (YAZ-4592 S26): the sidebar's Confirm before deleting does not turn it off.
        row('askBeforeDelete', 'Ask before deleting notes', ON_OFF_OPTIONS, { hint: 'Delete note… in a row’s menu asks first. The note moves to the Trash. The sidebar’s Confirm before deleting does not change this.', keywords: ['delete', 'confirm', 'trash', 'ask'] }),
        // YAZ-3746 13AN: on by default, so a stray key in a cell never changes a note unasked.
        row('confirmChanges', 'Confirm changes', ON_OFF_OPTIONS, { hint: 'A change to a note from a folder page (a typed cell, Delete, Paste, a drag to another group or day, a rename) asks first. The ask can pause for a few minutes. A folder’s ⚙ can say otherwise.', keywords: ['confirm', 'changes', 'ask', 'edit', 'lock', 'accident', 'safe', 'double'] }),
      ],
    },
    {
      title: 'View defaults',
      hint: 'A view with no choice of its own uses these. Its menus then say "from Settings", and Reset goes back to them.',
      items: [
        row('rowHeight', 'Row height', ROW_HEIGHT_OPTIONS, { keywords: ['row', 'height', 'short', 'tall'] }),
        row('rowNumbers', 'Row numbers', ON_OFF_OPTIONS, { keywords: ['row numbers', 'gutter', '#'] }),
        row('columnTypeIcons', 'Column type icons', ON_OFF_OPTIONS, { hint: "A table header shows each column's type icon before its name. A table's View settings can say otherwise.", keywords: ['icon', 'type', 'column', 'header', 'kind'] }),
        // YAZ-3746 13BL: off leaves the right-click doors (New row below, New note in this group) and the group header "+".
        row('showNewButtons', 'Show New buttons', ON_OFF_OPTIONS, { hint: 'The + New at the top right, the + New rows, + New card, and the + on group headers. Off: right-click a row for New row below, or a group header for New note in this group. An empty view still shows + New. A folder’s ⚙ can say otherwise.', keywords: ['new', 'add', 'plus', 'button', 'row', 'card', 'hide'] }),
        row('textInCells', 'Text in cells', TEXT_IN_CELLS_OPTIONS, { hint: 'By kind: lists, links and selects wrap; text, numbers and dates are one line. A column can say otherwise.', keywords: ['wrap', 'clip', 'cells', 'text'] }),
        row('groupIndent', 'Group indent', GROUP_INDENT_OPTIONS, { keywords: ['group', 'indent', 'nested'] }),
        // YAZ-4798: where you are in a long grouped table, as the sidebar shows it (sticky folders, level lines, thread).
        row('stickyGroups', 'Sticky group headers', ON_OFF_OPTIONS, { hint: "In a grouped table, the headers of the groups you are in stay at the top under the column header while the rows scroll. A click on one goes back to its group's top. A table's View settings can say otherwise.", keywords: ['sticky', 'group', 'header', 'pin', 'scroll', 'nested'] }),
        row('groupLines', 'Group lines', GROUP_LINES_OPTIONS, { hint: "In a grouped table, a thin line from each open group's header down to its last row. On hover shows them while the mouse is over the table.", keywords: ['group', 'lines', 'guide', 'indent', 'nested', 'hover', 'tree'] }),
        row('groupLineStyle', 'Group line style', GROUP_LINE_STYLE_OPTIONS, { hint: 'Thread colours the lines and the headers of the groups that hold the row under the mouse, as the sidebar’s Thread to the row.', keywords: ['group', 'thread', 'bullet threading', 'path', 'lines'] }),
        // Two switches, not one (YAZ-4608 C2): a Table's empty groups and a Board's empty columns are separate things.
        row('showEmptyGroups', 'Show empty groups', ON_OFF_OPTIONS, { hint: 'In a table: the options of the grouping column that no note has yet.', keywords: ['empty', 'groups', 'table'] }),
        row('showEmptyColumns', 'Show empty columns', ON_OFF_OPTIONS, { hint: 'On a board: a column for each option that no note has yet.', keywords: ['empty', 'columns', 'board'] }),
        row('subfolders', 'Subfolders', SUBFOLDERS_OPTIONS, { keywords: ['subfolders', 'rows', 'hide'] }),
        row('foldersFirst', 'Folders first', ON_OFF_OPTIONS, { hint: 'Subfolder rows before the notes.', keywords: ['folders', 'first', 'sort'] }),
        row('calendarScale', 'Calendar opens in', CALENDAR_SCALE_OPTIONS, { keywords: ['calendar', 'month', 'week'] }),
        row('cardTitles', 'Calendar card titles', CARD_TITLES_OPTIONS, { keywords: ['calendar', 'card', 'titles', 'wrap', 'clip'] }),
        row('hideWeekends', 'Calendar hides weekends', ON_OFF_OPTIONS, { hint: 'Monday to Friday only. A weekend note shows on the Friday before.', keywords: ['calendar', 'weekends', 'saturday', 'sunday', 'hide'] }),
      ],
    },
    {
      title: 'Page',
      items: [
        row('showFolderPageFiles', 'Show folder page files', ON_OFF_OPTIONS, { hint: "Each folder's page file in the sidebar, first under its folder. A folder's ⚙ can say otherwise.", keywords: ['sidebar', 'page file', '.folder.md'] }),
        row('showOtherFiles', 'Show Other files', ON_OFF_OPTIONS, { hint: "A tray at the foot of each folder page: the folder's files that are not notes, and the notes moved out of its views. A folder's ⚙ can say otherwise.", keywords: ['other files', 'tray', 'pdf', 'image', 'drawing'] }),
        row('inheritColumns', "Show parent folders' columns", ON_OFF_OPTIONS, { hint: "A folder page shows the columns of the folders above it too. A folder's ⚙ can say otherwise.", keywords: ['columns', 'parent', 'inherit', 'properties', 'schema'] }),
        row('columnMarks', 'Show where columns come from', COLUMN_MARKS_OPTIONS, { hint: "A tiny mark after a column's name: ↳ when a parent folder defines it, ↑ when a subfolder does, a lock when the folder keeps its own value, ◌ when it is only a field in the notes. A folder's ⚙ can say otherwise.", keywords: ['columns', 'icon', 'parent', 'subfolder', 'inherit', 'lock', 'separate'] }),
      ],
    },
  ],
}
