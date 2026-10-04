import type { ViewSet, ViewDef, FilterNode } from './viewSchema'
import { type Expr, compile } from './expr'

/**
 * The toolbar's "New" (5D, GRO-2144): a note pre-filled so it satisfies the current view.
 * `deriveSeed` is pure over the filter ASTs (def + view): equality filters `note.x == <literal>`
 * seed `x` with the literal's YAML type, and `file.hasTag("t")` seeds `tags: [t]`. Only
 * and-reachable rules count — seeding an `or`/`not` branch would not (or would anti-) satisfy the
 * view. Non-equality rules are ignored by design (locked kickoff decision on the issue).
 */

export interface NewNoteSeed {
  /** Bare frontmatter keys → raw YAML values. */
  properties: Record<string, unknown>
  /** The folder of the group whose "+" was pressed, when the view is grouped by Folder: root-relative. */
  folder?: string
}

const SCOPE_IDENTS = new Set(['note', 'file', 'formula', 'this'])

/** Bare frontmatter key of a `note.x` / `note["x"]` / bare-`x` accessor; null for anything else. */
function noteKeyOf(e: Expr): string | null {
  if (e.type === 'member' && e.object.type === 'ident' && e.object.name === 'note') return e.name
  if (e.type === 'index' && e.object.type === 'ident' && e.object.name === 'note' && e.index.type === 'str') return e.index.value
  if (e.type === 'ident' && !SCOPE_IDENTS.has(e.name)) return e.name
  return null
}

/** The YAML value of a literal operand (string / number / boolean, negatives included); undefined otherwise. */
function literalOf(e: Expr): string | number | boolean | undefined {
  if (e.type === 'str' || e.type === 'num' || e.type === 'bool') return e.value
  if (e.type === 'unary' && e.op === '-' && e.operand.type === 'num') return -e.operand.value
  return undefined
}

/** And-reachable leaf expressions of a filter tree (`or`/`not` subtrees skipped entirely). */
function andLeaves(node: FilterNode | undefined, out: string[]): void {
  if (node === undefined || node === null) return
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if ('and' in node && Array.isArray(node.and)) for (const child of node.and) andLeaves(child, out)
}

/** Seed properties for one view (see module doc). */
export function deriveSeed(def: ViewSet, view: ViewDef): NewNoteSeed {
  const leaves: string[] = []
  andLeaves(def.filters, leaves)
  andLeaves(view.filters, leaves)

  const properties: Record<string, unknown> = {}
  const tags: string[] = []

  for (const src of leaves) {
    const e = compile(src).expr
    if (e === undefined) continue
    if (e.type === 'binary' && e.op === '==') {
      const key = noteKeyOf(e.left)
      const value = literalOf(e.right)
      if (key !== null && value !== undefined) properties[key] = value
    } else if (e.type === 'method' && e.object.type === 'ident' && e.object.name === 'file' && e.name === 'hasTag' && e.args.length === 1 && e.args[0].type === 'str') {
      tags.push(e.args[0].value)
    }
  }

  if (tags.length > 0) {
    const existing = properties.tags
    if (Array.isArray(existing)) properties.tags = [...existing, ...tags.filter((t) => !existing.includes(t))]
    else if (existing === undefined) properties.tags = tags
  }

  return { properties }
}

/** First free name in the locked scheme: `base`, `base 2`, `base 3`… (`taken` = basenames in the folder). */
export function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

