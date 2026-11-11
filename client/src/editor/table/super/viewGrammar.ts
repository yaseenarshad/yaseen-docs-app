/**
 * A Super table's views in the table comment (YAZ-4869 S1, YAZ-4872; CONTRACTS rule 41a): the grammar of one `view`
 * part, and the column keys a table's header row gives. No editor imports, on purpose: `tableComment.ts` reads and
 * writes these parts, and the line-number worker reads that file (rule 34).
 *
 * ONE view is ONE part: `view <name>`, then clauses, each started by its keyword, so a view part holds no comma
 * between its clauses (the comment splits its parts at commas):
 *
 *     view "By layer" group Layer highlight blue sort Piece desc filter Status is Done summary Pieces sum
 *
 * - `group <column> [asc|desc] [highlight <colour>] [large]`: up to `MAX_LEVELS` levels, outer first. No `asc` or
 *   `desc` is the order of first appearance in the table.
 * - `sort <column> [desc]`: any number of levels, first wins.
 * - `filter <column> <operator> [<value>]`: every filter must match. The operators are the folder pages' (`filterRows.ts`).
 * - `summary <column> count|sum|average`: the summary row.
 * - `lines always|off` (on hover by default) and `thread`: the group lines.
 *
 * A word that is not one plain word (letters, digits, `_ . - + % # : /`), or that is a keyword, is written in double
 * quotes: inside them `\"` is a quote and `\\` a backslash, and any other `\x` is `x` (the writer puts `--\>` for
 * `-->`, so no name can end the comment). A comma inside quotes is a comma: `tableComment.ts` splits at commas outside
 * quotes only. A part the reader cannot read is `null`, and the comment keeps it as its text.
 */
import { HIGHLIGHT_HEX } from '../../marks/highlightColours'
import type { OperatorId } from '../../../views/view/filterRows'

/** The filter operators a view may hold, each with whether it takes a value (the folder pages' names, `filterRows.ts`). */
export const VIEW_OPS = {
  is: true,
  isNot: true,
  contains: true,
  notContains: true,
  startsWith: true,
  endsWith: true,
  isEmpty: false,
  isNotEmpty: false,
  eq: true,
  ne: true,
  lt: true,
  gt: true,
  le: true,
  ge: true,
  dateIs: true,
  dateBefore: true,
  dateAfter: true,
  checked: false,
  unchecked: false,
} as const satisfies Partial<Record<OperatorId, boolean>>
export type ViewOp = keyof typeof VIEW_OPS

export const SUMMARY_KINDS = ['count', 'sum', 'average'] as const
export type SummaryKind = (typeof SUMMARY_KINDS)[number]

/** The most group levels a view holds: the folder pages' (`MAX_GROUP_LEVELS`). */
export const MAX_LEVELS = 5

export interface ViewGroup {
  column: string
  /** None: first appearance in the table. */
  order?: 'asc' | 'desc'
  /** A highlight colour name (the folder pages' group header look). */
  highlight?: string
  large?: true
}

export interface ViewSort {
  column: string
  desc?: true
}

export interface ViewFilter {
  column: string
  op: ViewOp
  /** Only for an operator that takes one. */
  value?: string
}

/** One view of a Super table. Columns are named by their key (`columnKeys`). */
export interface TableViewDef {
  name: string
  group?: ViewGroup[]
  sort?: ViewSort[]
  filter?: ViewFilter[]
  summary?: { column: string; kind: SummaryKind }[]
  /** The group lines: on hover by default. */
  lines?: 'always' | 'off'
  /** The group lines lead to the row under the pointer. */
  thread?: true
}

const KEYWORDS = new Set(['view', 'group', 'sort', 'filter', 'summary', 'lines', 'thread', 'asc', 'desc', 'highlight', 'large'])
const PLAIN = /^[\p{L}\p{N}_.+%#:/-]+$/u

/** One word as the comment writes it: bare when plain and no keyword, else quoted. */
export function formatWord(text: string): string {
  if (PLAIN.test(text) && !KEYWORDS.has(text.toLowerCase())) return text
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/-->/g, '--\\>')}"`
}

interface Token {
  text: string
  quoted: boolean
}

/** The words of a part, quotes read; `null` when a quote does not close. */
function tokenize(part: string): Token[] | null {
  const out: Token[] = []
  let i = 0
  while (i < part.length) {
    if (/\s/.test(part[i]!)) {
      i++
      continue
    }
    if (part[i] === '"') {
      let text = ''
      let j = i + 1
      for (; j < part.length && part[j] !== '"'; j++) {
        if (part[j] === '\\' && j + 1 < part.length) j++
        text += part[j]
      }
      if (j >= part.length) return null
      out.push({ text, quoted: true })
      i = j + 1
      continue
    }
    let j = i
    while (j < part.length && !/\s/.test(part[j]!) && part[j] !== '"') j++
    out.push({ text: part.slice(i, j), quoted: false })
    i = j
  }
  return out
}

/**
 * The comment split into its parts at commas, each trimmed. Inside a `view` part a comma between quotes is no split; any
 * other part splits at every comma, as before, so a stray quote in a part this build does not know moves no split.
 */
const VIEW_AT = /\s*view\s/y
const viewAt = (body: string, at: number): boolean => {
  VIEW_AT.lastIndex = at
  return VIEW_AT.test(body)
}

export function splitParts(body: string): string[] {
  const out: string[] = []
  let start = 0
  let view = viewAt(body, 0)
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted && ch === '\\') i++
    else if (view && ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      out.push(body.slice(start, i).trim())
      start = i + 1
      view = viewAt(body, start)
    }
  }
  out.push(body.slice(start).trim())
  return out
}

const isKeyword = (token: Token | undefined, word: string): boolean => token !== undefined && !token.quoted && token.text === word

/** A value a column or a name can hold: not empty, no keyword left bare. */
const nameOf = (token: Token | undefined): string | null =>
  token === undefined || token.text === '' || (!token.quoted && KEYWORDS.has(token.text.toLowerCase())) ? null : token.text

/** One `view …` part, or `null` when the reader cannot read it. */
export function readView(part: string): TableViewDef | null {
  const tokens = tokenize(part)
  if (tokens === null || !isKeyword(tokens[0], 'view')) return null
  const name = nameOf(tokens[1])
  if (name === null) return null
  const view: TableViewDef = { name }
  let i = 2
  while (i < tokens.length) {
    const word = tokens[i]!
    if (word.quoted) return null
    const column = nameOf(tokens[i + 1])
    switch (word.text) {
      case 'group': {
        if (column === null || (view.group?.length ?? 0) >= MAX_LEVELS) return null
        const level: ViewGroup = { column }
        i += 2
        if (isKeyword(tokens[i], 'asc') || isKeyword(tokens[i], 'desc')) level.order = tokens[i++]!.text as 'asc' | 'desc'
        if (isKeyword(tokens[i], 'highlight')) {
          const colour = tokens[i + 1]?.text
          if (colour === undefined || !Object.hasOwn(HIGHLIGHT_HEX, colour)) return null
          level.highlight = colour
          i += 2
        }
        if (isKeyword(tokens[i], 'large')) {
          level.large = true
          i++
        }
        ;(view.group ??= []).push(level)
        break
      }
      case 'sort': {
        if (column === null) return null
        const sort: ViewSort = { column }
        i += 2
        if (isKeyword(tokens[i], 'desc')) {
          sort.desc = true
          i++
        } else if (isKeyword(tokens[i], 'asc')) i++
        ;(view.sort ??= []).push(sort)
        break
      }
      case 'filter': {
        const op = tokens[i + 2]
        if (column === null || op === undefined || op.quoted || !Object.hasOwn(VIEW_OPS, op.text)) return null
        const filter: ViewFilter = { column, op: op.text as ViewOp }
        i += 3
        if (VIEW_OPS[filter.op]) {
          const value = tokens[i]
          if (value === undefined || (!value.quoted && KEYWORDS.has(value.text.toLowerCase()))) return null
          filter.value = value.text
          i++
        }
        ;(view.filter ??= []).push(filter)
        break
      }
      case 'summary': {
        const kind = tokens[i + 2]
        if (column === null || kind === undefined || kind.quoted || !(SUMMARY_KINDS as readonly string[]).includes(kind.text)) return null
        ;(view.summary ??= []).push({ column, kind: kind.text as SummaryKind })
        i += 3
        break
      }
      case 'lines': {
        const value = tokens[i + 1]
        if (value === undefined || value.quoted || (value.text !== 'always' && value.text !== 'off')) return null
        view.lines = value.text
        i += 2
        break
      }
      case 'thread':
        view.thread = true
        i++
        break
      default:
        return null
    }
  }
  return view
}

/** One view as its `view …` part. */
export function formatView(view: TableViewDef): string {
  const words = ['view', formatWord(view.name)]
  for (const g of view.group ?? []) {
    words.push('group', formatWord(g.column))
    if (g.order !== undefined) words.push(g.order)
    if (g.highlight !== undefined) words.push('highlight', g.highlight)
    if (g.large === true) words.push('large')
  }
  for (const s of view.sort ?? []) words.push('sort', formatWord(s.column), ...(s.desc === true ? ['desc'] : []))
  for (const f of view.filter ?? []) words.push('filter', formatWord(f.column), f.op, ...(VIEW_OPS[f.op] ? [formatWord(f.value ?? '')] : []))
  for (const s of view.summary ?? []) words.push('summary', formatWord(s.column), s.kind)
  if (view.lines !== undefined) words.push('lines', view.lines)
  if (view.thread === true) words.push('thread')
  return words.join(' ')
}

/** A view from anywhere (a node attribute, a paste), checked by a write and a read back; `null` when it is none. */
export function checkedView(value: unknown): TableViewDef | null {
  if (typeof value !== 'object' || value === null || typeof (value as TableViewDef).name !== 'string') return null
  try {
    return readView(formatView(value as TableViewDef))
  } catch {
    return null
  }
}

/**
 * The column keys of a header row (YAZ-4869 item 16): each header's text, its spaces made one; an empty header, or one
 * equal to a header before it (capitals aside), is "Column <n>", its 1-based place. Views name columns by these keys.
 */
export function columnKeys(headers: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  headers.forEach((header, i) => {
    const text = header.trim().replace(/\s+/g, ' ')
    let key = text === '' || seen.has(text.toLowerCase()) ? `Column ${i + 1}` : text
    for (let n = 2; seen.has(key.toLowerCase()); n++) key = `Column ${i + 1} (${n})`
    seen.add(key.toLowerCase())
    out.push(key)
  })
  return out
}

/**
 * The views with each renamed column's new key (YAZ-4869 item 15): `before` and `after` are the header keys of the same
 * columns, so only a header row of the same width renames. `null` when no view names a renamed column.
 */
export function renameColumns(views: readonly TableViewDef[], before: readonly string[], after: readonly string[]): TableViewDef[] | null {
  if (before.length !== after.length) return null
  const renamed = new Map<string, string>()
  before.forEach((key, i) => {
    if (key !== after[i]) renamed.set(key, after[i]!)
  })
  if (renamed.size === 0) return null
  let changed = false
  const to = (column: string): string => {
    const next = renamed.get(column)
    if (next === undefined) return column
    changed = true
    return next
  }
  const next = views.map((view) => ({
    ...view,
    ...(view.group && { group: view.group.map((g) => ({ ...g, column: to(g.column) })) }),
    ...(view.sort && { sort: view.sort.map((s) => ({ ...s, column: to(s.column) })) }),
    ...(view.filter && { filter: view.filter.map((f) => ({ ...f, column: to(f.column) })) }),
    ...(view.summary && { summary: view.summary.map((s) => ({ ...s, column: to(s.column) })) }),
  }))
  return changed ? next : null
}
