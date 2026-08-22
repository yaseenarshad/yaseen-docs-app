import { setFrontmatterProperty } from '@shared/frontmatter'
import { api } from '../api'
import type { BaseDefinition, BaseView, FilterNode } from './baseFile'
import { type Expr, compile } from './expr'

/**
 * The toolbar's "New" (5D, GRO-2144): a note pre-filled so it satisfies the current view.
 * `deriveSeed` is pure over the filter ASTs (def + view): equality filters `note.x == <literal>`
 * seed `x` with the literal's YAML type, `file.hasTag("t")` seeds `tags: [t]`, and a single
 * `file.inFolder("…")` names the root-relative target folder. Only and-reachable rules count —
 * seeding an `or`/`not` branch would not (or would anti-) satisfy the view. Non-equality rules
 * are ignored by design (locked kickoff decision on the issue).
 */

export interface NewNoteSeed {
  /** Bare frontmatter keys → raw YAML values. */
  properties: Record<string, unknown>
  /** Root-relative folder named by the single `file.inFolder` rule; null → the base file's folder. */
  folder: string | null
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

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '')

/** And-reachable leaf expressions of a filter tree (`or`/`not` subtrees skipped entirely). Shared with 5E's pinned-type detection (`relation.ts`). */
export function andLeaves(node: FilterNode | undefined, out: string[]): void {
  if (node === undefined || node === null) return
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if ('and' in node && Array.isArray(node.and)) for (const child of node.and) andLeaves(child, out)
}

/** Seed properties + target folder for one view (see module doc). */
export function deriveSeed(def: BaseDefinition, view: BaseView): NewNoteSeed {
  const leaves: string[] = []
  andLeaves(def.filters, leaves)
  andLeaves(view.filters, leaves)

  const properties: Record<string, unknown> = {}
  const tags: string[] = []
  const folders: string[] = []

  for (const src of leaves) {
    const e = compile(src).expr
    if (e === undefined) continue
    if (e.type === 'binary' && e.op === '==') {
      const key = noteKeyOf(e.left)
      const value = literalOf(e.right)
      if (key !== null && value !== undefined) properties[key] = value
    } else if (e.type === 'method' && e.object.type === 'ident' && e.object.name === 'file' && e.args.length === 1 && e.args[0].type === 'str') {
      if (e.name === 'hasTag') tags.push(e.args[0].value)
      else if (e.name === 'inFolder') folders.push(trimSlashes(e.args[0].value))
    }
  }

  if (tags.length > 0) {
    const existing = properties.tags
    if (Array.isArray(existing)) properties.tags = [...existing, ...tags.filter((t) => !existing.includes(t))]
    else if (existing === undefined) properties.tags = tags
  }

  return { properties, folder: folders.length === 1 ? folders[0] : null }
}

/** First free name in the locked scheme: `Untitled`, `Untitled 2`, `Untitled 3`… (`taken` = basenames in the folder). */
export function untitledName(taken: ReadonlySet<string>): string {
  if (!taken.has('Untitled')) return 'Untitled'
  for (let n = 2; ; n++) if (!taken.has(`Untitled ${n}`)) return `Untitled ${n}`
}

/** Absolute folder the note goes in: the inFolder seed under the root, else the base file's folder, else the root; null when nothing is known. */
export function targetFolder(seedFolder: string | null, root: string | null, thisFile: string | null): string | null {
  if (seedFolder !== null && root !== null) return seedFolder === '' ? root : `${root}/${seedFolder}`
  if (thisFile !== null) return thisFile.slice(0, thisFile.lastIndexOf('/'))
  return root
}

/** The created file's whole content: one frontmatter block carrying the seed, no body; '' for an empty seed. */
export function seedContent(properties: Record<string, unknown>): string {
  return Object.entries(properties).reduce((content, [key, value]) => setFrontmatterProperty(content, key, value), '')
}

/**
 * Create the note over the bridge, then write the seed frontmatter through the 5A write path
 * (`createFile` takes only a path — markdown is created empty — so the seed rides one
 * `writeFile` keyed to the created mtime). Failures propagate; the caller opens nothing.
 */
export async function createNewNote(path: string, properties: Record<string, unknown>): Promise<void> {
  const created = await api.createFile(path)
  const content = seedContent(properties)
  if (content !== '') await api.writeFile({ path, content, expectedMtime: created.mtime })
}
