/**
 * THE OUTLINE'S TREE IN ONE BUFFER (YAZ-3501): the TS worker packs it (`packTree`), the page unpacks it
 * (`unpackTree`). Monaco's worker proxy posts the answer with no transfer list, so the buffer is COPIED
 * once — but a copy of one flat buffer is a single memory copy, not a walk of an object graph — and the
 * page makes no object for each symbol: the number arrays are views on the buffer, and each name is a
 * slice of one long string. For `big-5mb.ts` (260 000 symbols) the page's part is a few milliseconds; a
 * structured copy of the same tree as objects was hundreds.
 *
 * Layout, 4-byte aligned: a header of `HEADER` Int32s (a version, the counts, the names left out), then the Int32
 * columns, the depths (Uint16), the kinds (Uint8), then three strings as UTF-16 code units — every
 * name, every lower-case name, every key — each with an Int32 length per node.
 */
import type { OutlineTree } from './outlineModel'

const VERSION = 2
/** version, size, the code unit counts of the three strings, then `localsLeftOut` (YAZ-3507). */
const HEADER = 6
/** The Int32 columns, in this order. `lengths` of the three strings follow them. */
const INT_COLUMNS = ['parent', 'end', 'startLine', 'startColumn', 'endLine', 'endColumn', 'nameLine', 'nameColumn'] as const

const NO_CHILDREN: readonly number[] = []

const align4 = (n: number): number => (n + 3) & ~3

function layout(size: number, units: readonly number[]) {
  let at = HEADER * 4
  const ints = INT_COLUMNS.length + units.length // + one length column per string
  const intsAt = at
  at += ints * size * 4
  const depthAt = at
  at = align4(at + size * 2)
  const kindAt = at
  at = align4(at + size)
  const stringsAt: number[] = []
  for (const n of units) {
    stringsAt.push(at)
    at = align4(at + n * 2)
  }
  return { intsAt, depthAt, kindAt, stringsAt, bytes: at }
}

/** `tree` as one buffer: the worker's half. */
export function packTree(tree: OutlineTree): ArrayBuffer {
  const strings = [tree.name, tree.lower, tree.key].map((list) => list.join(''))
  const units = strings.map((s) => s.length)
  const { size } = tree
  const at = layout(size, units)
  const buffer = new ArrayBuffer(at.bytes)
  new Int32Array(buffer, 0, HEADER).set([VERSION, size, ...units, tree.localsLeftOut])
  INT_COLUMNS.forEach((column, c) => new Int32Array(buffer, at.intsAt + c * size * 4, size).set(tree[column]))
  ;[tree.name, tree.lower, tree.key].forEach((list, s) => {
    const lengths = new Int32Array(buffer, at.intsAt + (INT_COLUMNS.length + s) * size * 4, size)
    for (let i = 0; i < size; i++) lengths[i] = list[i].length
  })
  new Uint16Array(buffer, at.depthAt, size).set(tree.depth)
  new Uint8Array(buffer, at.kindAt, size).set(tree.kind)
  strings.forEach((text, s) => {
    const units16 = new Uint16Array(buffer, at.stringsAt[s], text.length)
    for (let i = 0; i < text.length; i++) units16[i] = text.charCodeAt(i)
  })
  return buffer
}

/** UTF-16 code units back to a string, in chunks (a spread of 2.6 million arguments would overflow the stack). */
function decode(units: Uint16Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-16le').decode(units)
  let out = ''
  for (let i = 0; i < units.length; i += 8192) out += String.fromCharCode(...units.subarray(i, i + 8192))
  return out
}

/** The tree back from `buffer`: the page's half. Null when the buffer is not one of `packTree`'s. */
export function unpackTree(buffer: ArrayBuffer): OutlineTree | null {
  if (buffer.byteLength < HEADER * 4) return null
  const [version, size, nameUnits, lowerUnits, keyUnits, localsLeftOut] = new Int32Array(buffer, 0, HEADER)
  if (version !== VERSION) return null
  const units = [nameUnits, lowerUnits, keyUnits]
  const at = layout(size, units)
  if (at.bytes !== buffer.byteLength) return null
  const column = (c: number) => new Int32Array(buffer, at.intsAt + c * size * 4, size)
  const [parent, end, startLine, startColumn, endLine, endColumn, nameLine, nameColumn] = INT_COLUMNS.map((_, c) => column(c))
  const [name, lower, key] = units.map((n, s) => {
    const text = decode(new Uint16Array(buffer, at.stringsAt[s], n))
    const lengths = column(INT_COLUMNS.length + s)
    const list = new Array<string>(size)
    let from = 0
    for (let i = 0; i < size; i++) {
      list[i] = text.slice(from, from + lengths[i])
      from += lengths[i]
    }
    return list
  })
  // The children of each node and the roots, in document order: from the parents.
  const lists: number[][] = []
  const roots: number[] = []
  for (let i = 0; i < size; i++) {
    const p = parent[i]
    if (p === -1) roots.push(i)
    else (lists[p] ??= []).push(i)
  }
  const children = new Array<readonly number[]>(size)
  for (let i = 0; i < size; i++) children[i] = lists[i] ?? NO_CHILDREN
  return {
    size,
    name,
    lower,
    kind: new Uint8Array(buffer, at.kindAt, size),
    depth: new Uint16Array(buffer, at.depthAt, size),
    parent,
    end,
    startLine,
    startColumn,
    endLine,
    endColumn,
    nameLine,
    nameColumn,
    children,
    roots,
    key,
    localsLeftOut,
  }
}
