import { type Document, isMap, parseDocument } from 'yaml'
import { isRecord } from '@shared/guards'

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
  /** 🔒 D2 (YAZ-867): an outline view's whole document — ONE markdown bullet list (`views/outlineDoc.ts`). */
  outline?: string
  sort?: SortSpec[]
  /** Ordered levels, outer first; only the first three are honoured (YAZ-745, `MAX_GROUP_LEVELS` since YAZ-4531). The single-object form stays valid. */
  groupBy?: GroupBySpec | GroupBySpec[]
  showEmptyColumns?: boolean
  limit?: number
  summaries?: Record<string, string>
  columnSize?: Record<string, number>
  /** Wrap or Clip per column (YAZ-4582 D29): `false` under a canonical key clips that column to one line. Absent = Wrap. */
  columnWrap?: Record<string, boolean>
  frozenColumns?: number
  /** Frozen rows (YAZ-4537, D9b / S4): the count of DATA rows frozen at the top, at most 10; the group headers above them freeze too. */
  frozenRows?: number
  /** The `#` gutter (YAZ-1513). Absent = shown. */
  rowNumbers?: boolean
  rowHeight?: string
  /** The step of each nested group level (YAZ-4532 D10): `small` 14px, `medium` 28px, `large` 42px. Absent = medium. */
  groupIndent?: 'small' | 'medium' | 'large'
  image?: string
  cardSize?: string | number
  imageFit?: string
  imageAspectRatio?: string | number
  indentProperties?: boolean
  markerStyle?: string
  propertySeparator?: string
  /** Board card styling (YAZ-1206, reshaped by YAZ-1217): per canonical property key — bold/underline the value's row, hide its label, or `join` it onto the row being built instead of starting a new one. */
  cardStyle?: Record<string, { bold?: boolean; underline?: boolean; hideLabel?: boolean; join?: boolean }>
  /** A calendar's "Show by" (YAZ-4540 D4): the canonical date column it places notes on. Absent = the first date column. */
  dateProperty?: string
  /** A calendar's scale (YAZ-4558 D22): `week` = 7 tall day columns. Absent = month. */
  calendarScale?: 'month' | 'week'
  /** A calendar's card titles (YAZ-4558 D23): `wrap` = the full title on more lines. Absent = clip, one line with "…". */
  cardTitles?: 'clip' | 'wrap'
  /**
   * "Subfolders" (YAZ-4579 D30, replacing YAZ-4564 D25's boolean): `rows` = a row per direct subfolder plus the
   * folder's own notes and shortcuts; `both` = the subfolder rows plus every note below; `hide` = the own notes
   * and shortcuts alone. Absent = "Their notes", every note below and no subfolder row. A stored `false` reads as `hide`.
   */
  subfolders?: 'rows' | 'both' | 'hide' | false
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
export const MAX_GROUP_LEVELS = 3

/** The levels the engine groups by: those with a property name, the first `MAX_GROUP_LEVELS` of them. */
export const shownGroupLevels = (view: ViewDef): GroupBySpec[] =>
  groupByLevels(view).filter(g => g && typeof g.property === 'string').slice(0, MAX_GROUP_LEVELS)

/** The group indent steps in px (YAZ-4532 D10); `medium` is the 28px step tables had before. */
export const GROUP_INDENTS = { small: 14, medium: 28, large: 42 } as const

/** A view's group indent in px. An absent or unknown `groupIndent` gives the medium step. */
export const groupIndentOf = (view: ViewDef): number =>
  typeof view.groupIndent === 'string' && Object.hasOwn(GROUP_INDENTS, view.groupIndent) ? GROUP_INDENTS[view.groupIndent] : GROUP_INDENTS.medium

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
 * write). It lived in `view/FilterMenu.tsx` until YAZ-846 deleted that menu.
 */
export type Mutate = (mutate: (def: ViewSet) => void) => void

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
 * into `doc` so comments and untouched keys keep their original text.
 */
export function updateViews(parsed: ParsedViews, mutate: (def: ViewSet) => void): ParsedViews {
  const next = structuredClone(parsed.def)
  mutate(next)
  writeChanges(parsed.doc, [], parsed.def, next)
  return { def: next, doc: parsed.doc }
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
