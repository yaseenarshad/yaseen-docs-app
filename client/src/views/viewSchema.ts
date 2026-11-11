import { type Document, isMap, parseDocument } from 'yaml'
import { isRecord } from '@shared/guards'
import { headerRowOwn, type HeaderRowOwn } from '@shared/types'

/**
 * The Obsidian Bases view-schema model — the shape a folder's `views` block round-trips
 * through (`FolderView`). The types mirror Obsidian's schema and
 * are ours too (extended later); unknown keys are typed as `unknown` and must
 * survive a parse → update → serialise cycle untouched, comments included.
 */

export type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] }

export interface SortSpec {
  property: string
  direction: 'ASC' | 'DESC'
  /** `value` (YAZ-3940): a Select column sorts A to Z by its values, not in its option order. Absent = option order. */
  by?: 'value'
}

export interface GroupBySpec {
  property: string
  direction?: 'ASC' | 'DESC'
  /** As on `SortSpec` (YAZ-3940). */
  by?: 'value'
  /** This level's header highlight (YAZ-3742 D5): a highlight colour name — yellow, green, blue, pink, orange, purple, red, gray. */
  highlight?: string
  /** This level's header in the Large size, 14px bold (YAZ-3742 D5). */
  large?: boolean
}

export interface ViewDef {
  /** 'table' | 'cards' | 'list' | 'map' | 'board' (ours) | anything else (unknown, preserved) */
  type: string
  name: string
  filters?: FilterNode
  order?: string[]
  sort?: SortSpec[]
  /** Ordered levels, outer first; only the first five are honoured (YAZ-745, `MAX_GROUP_LEVELS` since YAZ-4531; five since YAZ-3746 13AF). The single-object form stays valid. */
  groupBy?: GroupBySpec | GroupBySpec[]
  showEmptyColumns?: boolean
  limit?: number
  summaries?: Record<string, string>
  columnSize?: Record<string, number>
  /** Wrap or Clip per column (YAZ-4582 D29): `false` under a canonical key clips that column to one line. Absent = Wrap. */
  columnWrap?: Record<string, boolean>
  /** Left, Center or Right per column (YAZ-3746 13Y), under a canonical key. Absent = Auto: numbers right, the rest left (`view/columnAlign.ts`). */
  columnAlign?: Record<string, 'left' | 'center' | 'right'>
  /** A fill per column (YAZ-3746 13AQ), under a canonical key: a colour name or `#rrggbb`; a row's and a cell's fill show over it (`view/columnFill.ts`). */
  columnFill?: Record<string, string>
  frozenColumns?: number
  /** Frozen rows (YAZ-4537, D9b / S4): the count of DATA rows frozen at the top, at most 10; the group headers above them freeze too. */
  frozenRows?: number
  /** The `#` gutter (YAZ-1513). Absent = shown. */
  rowNumbers?: boolean
  /** "Column type icons" (YAZ-4779): each header's type icon before its name. Absent = Settings › Folder pages (on). */
  columnTypeIcons?: boolean
  /** "Folder icon" (YAZ-4848): a subfolder's row shows the folder icon. Absent = Settings › Folder pages (on). */
  folderIcons?: boolean
  /** "Notes inside count" (YAZ-4848): a subfolder's row shows "N inside". Absent = Settings › Folder pages (off). */
  folderCounts?: boolean
  /** The header row's own parts (YAZ-4774): color, strength, weight, text. An absent part = Settings › Tables › Header row. */
  headerRow?: HeaderRowOwn
  rowHeight?: string
  /** Text in cells for the whole view (YAZ-4544 10A, D34): `kind` (chip columns wrap), `wrap` or `clip`. A column's `columnWrap` beats it; absent = Settings. */
  textInCells?: 'kind' | 'wrap' | 'clip'
  /** The step of each nested group level (YAZ-4532 D10): `small` 14px, `medium` 28px, `large` 42px. Absent = medium. */
  groupIndent?: 'small' | 'medium' | 'large'
  /** "Sticky group headers" (YAZ-4798): a grouped table's headers of the groups in view stay under the column header. Absent = Settings › Folder pages (on). */
  stickyGroups?: boolean
  /** "Group lines" (YAZ-4798): `hover` (while the pointer is over the table), `always` or `off`. Absent = Settings › Folder pages (on hover). */
  groupLines?: 'hover' | 'always' | 'off'
  /** "Group line style" (YAZ-4798): `plain` grey lines, or `thread` to the row under the pointer. Absent = Settings › Folder pages (plain). */
  groupLineStyle?: 'plain' | 'thread'
  /**
   * The Folder column (YAZ-4801): absent, the path from this page, the page first; `full` the path from the vault's top;
   * `last` only the note's own folder.
   */
  folderColumn?: 'last' | 'full'
  image?: string
  cardSize?: string | number
  imageFit?: string
  imageAspectRatio?: string | number
  indentProperties?: boolean
  markerStyle?: string
  propertySeparator?: string
  /** Board card styling (YAZ-1206, reshaped by YAZ-1217): per canonical property key — bold/underline the value's row, hide its label, or `join` it onto the row being built instead of starting a new one. */
  cardStyle?: Record<string, { bold?: boolean; underline?: boolean; hideLabel?: boolean; join?: boolean }>
  /** A calendar's "Start date", once "Show by" (YAZ-4540 D4): the canonical date column it places notes on. Absent = the first date column. */
  dateProperty?: string
  /** A calendar's "End date" (YAZ-4858): the canonical date column a card ends on; a later end makes it a bar over its days. Absent = none. */
  endDateProperty?: string
  /** A calendar's scale (YAZ-4558 D22): `week` = 7 tall day columns. Absent = month. */
  calendarScale?: 'month' | 'week'
  /** A calendar's card titles (YAZ-4558 D23): `wrap` = the full title on more lines. Absent = clip, one line with "…". */
  cardTitles?: 'clip' | 'wrap'
  /** A calendar's "Hide weekends" (YAZ-4595 S33): Monday to Friday only. Absent = the Settings › Folder pages default. */
  hideWeekends?: boolean
  /** A calendar's line between weeks (YAZ-4878): whole px, 1–12. Absent = 1. */
  weekLine?: number
  /** A calendar's line between days (YAZ-4878): whole px, 1–12. Absent = 1. */
  dayLine?: number
  /** The lines' colours (YAZ-4878): `gray` / `blue light` (`readColorStrength`). Absent = the Settings › Folder pages default (Gray, Medium). */
  weekLineColor?: string
  dayLineColor?: string
  /** A calendar's "Cross out when" (YAZ-4864): the Filter menu's conditions; a card whose note matches has its name struck through. Absent = none. */
  crossOut?: FilterNode
  /**
   * "Subfolders" (YAZ-4579 D30, replacing YAZ-4564 D25's boolean): `rows` = a row per direct subfolder plus the
   * folder's own notes and shortcuts; `both` = the subfolder rows plus every note below; `hide` = the own notes
   * and shortcuts alone. Absent = "Their notes", every note below and no subfolder row. A stored `false` reads as `hide`.
   * `notes` is written only where Settings › Folder pages says otherwise (YAZ-4585): absent then follows Settings.
   */
  subfolders?: 'notes' | 'rows' | 'both' | 'hide' | false
  /** "Folders first" (YAZ-4579 D33): `false` = the subfolder rows sort among the notes. Absent = folder rows first. */
  foldersFirst?: boolean
  [extra: string]: unknown
}

/** A view's "Subfolders" switch (YAZ-4579 D30): `notes` (absent, or a value the app does not know) is "Their notes". */
export type SubfoldersMode = 'notes' | 'rows' | 'both' | 'hide'

export const subfoldersOf = (view: ViewDef): SubfoldersMode =>
  view.subfolders === false || view.subfolders === 'hide' ? 'hide' : view.subfolders === 'rows' || view.subfolders === 'both' ? view.subfolders : 'notes'

/** Whether the view shows a row per direct subfolder (YAZ-4579 D31). */
export const showsFolderRows = (view: ViewDef): boolean => subfoldersOf(view) === 'rows' || subfoldersOf(view) === 'both'

/** Whether the view keeps only the notes directly in the folder and its shortcuts (YAZ-4564 D25): the notes in subfolders are hidden. */
export const hidesSubfolderNotes = (view: ViewDef): boolean => subfoldersOf(view) === 'rows' || subfoldersOf(view) === 'hide'

/** A view's grouping levels, outer first, whichever form `groupBy` is written in. */
export const groupByLevels = (view: ViewDef): GroupBySpec[] =>
  Array.isArray(view.groupBy) ? view.groupBy : view.groupBy ? [view.groupBy] : []

/** The most group levels a view honours (YAZ-4531); `groupBy` entries past it are ignored. */
export const MAX_GROUP_LEVELS = 5

/**
 * A view's own header row parts (YAZ-4774): `headerRow`, else the first build's `shadedHeader` (`false` Off, `true`
 * Light), which the next header pick replaces. None: Settings.
 */
export const headerRowOfView = (view: ViewDef): HeaderRowOwn =>
  view.headerRow !== undefined ? headerRowOwn(view.headerRow) : typeof view.shadedHeader === 'boolean' ? { strength: view.shadedHeader ? 'light' : 'off' } : {}

/** The levels the engine groups by: those with a property name, the first `MAX_GROUP_LEVELS` of them. */
export const shownGroupLevels = (view: ViewDef): GroupBySpec[] =>
  groupByLevels(view).filter(g => g && typeof g.property === 'string').slice(0, MAX_GROUP_LEVELS)

/** The group indent steps in px (YAZ-4532 D10); `medium` is the 28px step tables had before. */
export const GROUP_INDENTS = { small: 14, medium: 28, large: 42 } as const

/** A view's group indent in px. An absent or unknown `groupIndent` gives the medium step. */
export const groupIndentOf = (view: ViewDef): number =>
  typeof view.groupIndent === 'string' && Object.hasOwn(GROUP_INDENTS, view.groupIndent) ? GROUP_INDENTS[view.groupIndent] : GROUP_INDENTS.medium

/**
 * A grouped table's Group lines (YAZ-4798) as the table draws them: `hover`, `always` or `off`. A value the app does
 * not know reads `off`, the look before; a view with no key has Settings' value filled in already (`withDefaults`).
 */
export const groupLinesOf = (view: ViewDef): 'hover' | 'always' | 'off' => (view.groupLines === 'hover' || view.groupLines === 'always' ? view.groupLines : 'off')

/** A grouped table's Group line style (YAZ-4798): `thread` only when the view says so; anything else is plain lines. */
export const groupLineStyleOf = (view: ViewDef): 'plain' | 'thread' => (view.groupLineStyle === 'thread' ? 'thread' : 'plain')
/** The Folder column's look (YAZ-4801): the path from the page (default), or the last folder only. */
export const folderColumnOf = (view: ViewDef): 'path' | 'full' | 'last' => (view.folderColumn === 'last' || view.folderColumn === 'full' ? view.folderColumn : 'path')

export interface ViewSet {
  filters?: FilterNode
  formulas?: Record<string, string>
  properties?: Record<string, { displayName?: string; [extra: string]: unknown }>
  summaries?: Record<string, string>
  views: ViewDef[]
  /** The saved START (YAZ-1104), a view NAME — in the def since YAZ-1471 so rename/delete keep it honest in the same write. */
  defaultView?: string
  [extra: string]: unknown
}

/**
 * The ONE config-write door every menu is handed: `ViewsPane`'s `update`, which re-parses and
 * calls `onChange` (the folder host turns it into exactly one `folder_settings`
 * write). It lived in `view/FilterMenu.tsx` until YAZ-846 deleted that menu. `undo` (YAZ-4594 S29): the toast's
 * text when the gesture takes something away — a hidden column, an unfreeze, a cleared fill — whose Undo writes the
 * settings back as they were, in one write; `after` runs once that Undo wrote. With `onHistory` (YAZ-3746 13N: a
 * fill, a cleared fill, ⌘\) the gesture is a step of the page's ⌘Z history too, so ⌘Z and ⇧⌘Z undo and redo it as
 * they do a typed value, and the toast's Undo is that step.
 */
export type Mutate = (mutate: (def: ViewSet) => void, undo?: string, after?: () => void, onHistory?: boolean) => void

export class ViewParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly col?: number,
  ) {
    super(message)
    this.name = 'ViewParseError'
  }
}

export interface ParsedViews {
  def: ViewSet
  /** The yaml Document: keeps comments, blank lines, flow/block style and unknown keys. */
  doc: Document
}

export function parseViews(text: string): ParsedViews {
  const doc = parseDocument(text, { keepSourceTokens: true })
  const err = doc.errors[0]
  if (err) {
    const pos = err.linePos?.[0]
    throw new ViewParseError(err.message, pos?.line, pos?.col)
  }
  if (doc.contents === null) throw new ViewParseError('View schema is empty: missing views')
  if (!isMap(doc.contents)) throw new ViewParseError('View schema root must be a map with a views list')
  const js: unknown = doc.toJS()
  if (!isRecord(js)) throw new ViewParseError('View schema root must be a map with a views list')
  if (!Array.isArray(js.views)) throw new ViewParseError('views must be a list of views')
  js.views.forEach((v: unknown, i) => {
    if (!isRecord(v) || typeof v.type !== 'string' || typeof v.name !== 'string') {
      throw new ViewParseError(`views[${i}] must be a map with string type and name`)
    }
  })
  return { def: js as ViewSet, doc }
}

/**
 * `lineWidth: 0` disables folding so long scalars come back exactly as written;
 * `flowCollectionPadding: false` keeps `[1, 2]` as written instead of `[ 1, 2 ]`.
 */
export function serializeViews(parsed: ParsedViews): string {
  return parsed.doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

/**
 * Apply `mutate` to a clone of `def`, then write only the changed paths back
 * into a clone of `doc` so comments and untouched keys keep their original text.
 * `parsed` itself is untouched (YAZ-4644 E2): a write the host refuses leaves nothing behind in its copy.
 */
export function updateViews(parsed: ParsedViews, mutate: (def: ViewSet) => void): ParsedViews {
  const next = structuredClone(parsed.def)
  mutate(next)
  const doc = parsed.doc.clone()
  writeChanges(doc, [], parsed.def, next)
  return { def: next, doc }
}

function writeChanges(doc: Document, path: (string | number)[], prev: unknown, next: unknown): void {
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) {
      doc.setIn(path, next)
      return
    }
    next.forEach((v, i) => writeChanges(doc, [...path, i], prev[i], v))
    return
  }
  if (isRecord(prev) && isRecord(next)) {
    for (const k of Object.keys(prev)) if (!(k in next)) doc.deleteIn([...path, k])
    for (const k of Object.keys(next)) writeChanges(doc, [...path, k], prev[k], next[k])
    return
  }
  if (prev !== next) doc.setIn(path, next)
}
