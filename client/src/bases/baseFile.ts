import { type Document, isMap, parseDocument } from 'yaml'

/**
 * The Obsidian Bases view-schema model — the shape a folder page's `views` block round-trips
 * through (`FolderPageContents`). The types mirror Obsidian's schema and
 * are ours too (extended later); unknown keys are typed as `unknown` and must
 * survive a parse → update → serialise cycle untouched, comments included.
 */

export type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] }

export interface SortSpec {
  property: string
  direction: 'ASC' | 'DESC'
}

export interface GroupBySpec {
  property: string
  direction?: 'ASC' | 'DESC'
}

export interface BaseView {
  /** 'table' | 'cards' | 'list' | 'map' | 'board' (ours) | anything else (unknown, preserved) */
  type: string
  name: string
  filters?: FilterNode
  order?: string[]
  sort?: SortSpec[]
  groupBy?: GroupBySpec
  limit?: number
  summaries?: Record<string, string>
  columnSize?: Record<string, number>
  rowHeight?: string
  image?: string
  cardSize?: string | number
  imageFit?: string
  imageAspectRatio?: string | number
  indentProperties?: boolean
  markerStyle?: string
  propertySeparator?: string
  [extra: string]: unknown
}

export interface BaseDefinition {
  filters?: FilterNode
  formulas?: Record<string, string>
  properties?: Record<string, { displayName?: string; [extra: string]: unknown }>
  summaries?: Record<string, string>
  views: BaseView[]
  [extra: string]: unknown
}

export class BaseParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly col?: number,
  ) {
    super(message)
    this.name = 'BaseParseError'
  }
}

export interface ParsedBase {
  def: BaseDefinition
  /** The yaml Document: keeps comments, blank lines, flow/block style and unknown keys. */
  doc: Document
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseBase(text: string): ParsedBase {
  const doc = parseDocument(text, { keepSourceTokens: true })
  const err = doc.errors[0]
  if (err) {
    const pos = err.linePos?.[0]
    throw new BaseParseError(err.message, pos?.line, pos?.col)
  }
  if (doc.contents === null) throw new BaseParseError('Base file is empty: missing views')
  if (!isMap(doc.contents)) throw new BaseParseError('Base file root must be a map with a views list')
  const js: unknown = doc.toJS()
  if (!isRecord(js)) throw new BaseParseError('Base file root must be a map with a views list')
  if (!Array.isArray(js.views)) throw new BaseParseError('views must be a list of views')
  js.views.forEach((v: unknown, i) => {
    if (!isRecord(v) || typeof v.type !== 'string' || typeof v.name !== 'string') {
      throw new BaseParseError(`views[${i}] must be a map with string type and name`)
    }
  })
  return { def: js as BaseDefinition, doc }
}

/**
 * `lineWidth: 0` disables folding so long scalars come back exactly as written;
 * `flowCollectionPadding: false` keeps `[1, 2]` as written instead of `[ 1, 2 ]`.
 */
export function serializeBase(parsed: ParsedBase): string {
  return parsed.doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

/**
 * Apply `mutate` to a clone of `def`, then write only the changed paths back
 * into `doc` so comments and untouched keys keep their original text.
 */
export function updateBase(parsed: ParsedBase, mutate: (def: BaseDefinition) => void): ParsedBase {
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
