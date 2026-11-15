import { cardIdOf, cardRecords, formatCardLine, pageCards, parseCardLine, type CardLine } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
import { applyCardOps, applyOps, type CardOp } from './ops'

/**
 * YAZ-5514: the answer and mark fuzz of the writes check (`check-writes`, cards.fuzz), as a normal test. Seeded
 * generators of nasty made-up pages (LF, CRLF and mixed line ends; a BOM; odd front matter; card lines written by
 * hand; duplicate card IDs; tasks in code, HTML and quotes) and random action lists.
 */
export type Rng = () => number
/** mulberry32, seeded through a mix so small seeds spread. */
export function rng(seed: number): Rng {
  let a = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
export const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))
export const chance = (r: Rng, p: number): boolean => r() < p

const WORDS = ['alpha', 'Ünïcode', 'naïve café', '😀 emoji', '日本語', 'tab\there', 'a, b', 'x &#44; y', 'quote "q"', 'back\\slash', 'gt > lt <', 'colon: hash #', '-- dash', 'plain']
export const word = (r: Rng) => pick(r, WORDS)

export const CARD_IDS = ['NC-1', 'NC-2', 'NC-3', 'NC-4', 'nc-5', 'NC-6', 'NC-7', 'NC-8']
export const at = (m: number) => `2026-11-14T${String(6 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}Z`

/** A card line in many hand-made forms. */
export function cardLine(r: Rng, id: string): string {
  const parts: string[] = [id]
  const n = int(r, 0, 5)
  for (let i = 0; i < n; i++) {
    parts.push(
      pick(r, [
        `title "${pick(r, ['Speed of light', 'Ünï 😀', 'a &#44; b', 'with \\"q\\"', 'gt \\> x', 'a, b'])}"`,
        `${at(int(r, 0, 30))} ${pick(r, ['again', 'hard', 'good', 'easy'])}`,
        `${at(int(r, 0, 30))} good ${int(r, 0, 90)}s`,
        'off',
        'next',
        'fix',
        'notitle',
        'tags "a" "b"',
        'ratio 2.50',
        'weird-part',
        'pri 3',
      ]),
    )
  }
  const sep = () => pick(r, [', ', ',', ' , ', ',  ', ',\t'])
  let body = parts[0]
  for (let i = 1; i < parts.length; i++) body += sep() + parts[i]
  const head = pick(r, ['<!-- card: ', '<!--card:', '<!-- card:  ', '<!--\tcard: '])
  const tail = pick(r, [' -->', '-->', '  -->'])
  return head + body + tail
}

export function cardBlock(r: Rng, id: string, indent = ''): string {
  const fence = pick(r, ['```card', '~~~card', '````card', '``` card'])
  const close = fence.startsWith('~') ? '~~~' : fence.startsWith('````') ? '````' : '```'
  const inner = pick(r, [`What is ${word(r)}?`, `- [ ] Task in card\n- [x] Done in card`, `Q\n---\nA ${word(r)}`, '```\nnested?\n```'.replace(/```/g, close === '````' ? '```' : '~~~')])
  return [indent + fence, ...inner.split('\n').map((l) => indent + l), indent + close, indent + cardLine(r, id)].join('\n')
}

export const TASK_CORES = ['Buy milk', 'Call 😀 mum', 'Ünï task', 'x, y: z', 'Buy milk']
export function taskLineText(r: Rng): string {
  const marker = pick(r, ['- ', '* ', '+ ', '1. ', '2) ', '-   '])
  const box = pick(r, ['[ ]', '[x]', '[X]'])
  return `${marker}${box} ${pick(r, TASK_CORES)}`
}

/** One block of body text. */
export function block(r: Rng, ids: string[]): string {
  const k = int(r, 0, 15)
  switch (k) {
    case 0:
      return `# ${word(r)}`
    case 1:
      return `Some text ${word(r)}`
    case 2:
    case 3:
      return Array.from({ length: int(r, 1, 3) }, () => taskLineText(r)).join('\n')
    case 4:
      return `- parent\n  ${taskLineText(r)}\n    ${taskLineText(r)}`
    case 5:
      return `> ${taskLineText(r)}\n> ${taskLineText(r)}`
    case 6:
      return '```\n' + taskLineText(r) + '\n```'
    case 7:
      return '~~~md\n' + taskLineText(r) + '\n~~~'
    case 8:
      return '````\n```\n' + taskLineText(r) + '\n```\n````'
    case 9:
      return '<!--\n' + taskLineText(r) + '\n-->'
    case 10:
      return `${'    '}${taskLineText(r).replace(/^\d+[.)] /, '- ')}`
    case 11:
      return `Paragraph\n2. [ ] Buy milk`
    case 12:
    case 13:
      return ids.length > 0 ? cardBlock(r, ids.shift()!, chance(r, 0.1) ? '  ' : '') : 'text'
    case 14:
      return '<div>\n' + taskLineText(r) + '\n</div>'
    default:
      return `${word(r)} <!-- card: NC-99 --> inline`
  }
}

export interface PageShape {
  eol: '\n' | '\r\n' | 'mixed'
  bom: boolean
  fm: string
}

const FMS = [
  '',
  '---\n---\n',
  '---\ntitle: Plan\n---\n',
  '---\ntitle:   Plan\ntags: [a,b]\n---\n',
  '---\ntitle: Plan\n...\n',
  '---\n{title: Plan, tags: [a, b]}\n---\n',
  '---\ntitle: "Ünï 😀"\n# a yaml comment\nkind: card\n---\n',
  '---\ntitle: Plan\ncomments:\n  - id: aaaa1111\n    n: 1\n    at: 2026-11-14T06:00:00Z\n    by: Mac\n    body: first\n---\n',
  '---\ntitle: Plan\ncomments: []\n---\n',
  '---\ncomments:\n- id: bbbb2222\n  n: 1\n  body: "has: colon # hash"\ntitle: After\n---\n',
  '---\ntitle:\tTabbed\n---\n',
  '---\nid: NC-1\ntitle: x\n---\n\n',
  '---\ntitle: Plan\ncomments: [{id: cccc3333, n: 1, body: flow}]\n---\n',
  '---\n  title: indented\n  tags: a\n---\n',
  '---\ntitle: Plan\ncomments:\n  - by: agent\n    body: hand-written\n---\n',
  '---\ntitle: Plan\nnotes: |\n  multi\n  line\n---\n',
]

export function page(r: Rng, opts: { cards?: number; blocks?: number } = {}): { text: string; shape: PageShape; ids: string[] } {
  const eol = pick(r, ['\n', '\n', '\r\n', 'mixed'] as const)
  const bom = chance(r, 0.08)
  const fm = pick(r, FMS)
  const pool = [...CARD_IDS].sort(() => r() - 0.5).slice(0, opts.cards ?? int(r, 0, 5))
  if (chance(r, 0.1) && pool.length > 0) pool.push(pool[0]) // duplicate card ID
  const ids = [...pool]
  const blocks: string[] = []
  const nBlocks = opts.blocks ?? int(r, 1, 12)
  for (let i = 0; i < nBlocks; i++) blocks.push(block(r, pool))
  while (pool.length > 0) blocks.push(cardBlock(r, pool.shift()!))
  let text = fm + blocks.join(pick(r, ['\n\n', '\n\n\n'])) + (chance(r, 0.8) ? '\n' : '')
  if (eol === '\r\n') text = text.replace(/\n/g, '\r\n')
  else if (eol === 'mixed') text = text.replace(/\n/g, () => (chance(r, 0.5) ? '\r\n' : '\n'))
  if (bom) text = '﻿' + text
  return { text, shape: { eol, bom, fm }, ids }
}

/** Line-level diff: indexes of lines (split on \n, \r kept) that differ, when the line counts match; null otherwise. */
export function changedLines(a: string, b: string): number[] | null {
  const x = a.split('\n')
  const y = b.split('\n')
  if (x.length !== y.length) return null
  const out: number[] = []
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) out.push(i)
  return out
}

const MARKS = ['off', 'next', 'fix', 'notitle'] as const

function randomOp(r: Rng, ids: string[]): CardOp {
  const id = chance(r, 0.08) ? 'NC-404' : pick(r, ids.length > 0 ? ids : ['NC-404'])
  const idc = chance(r, 0.2) ? id.toLowerCase() : id
  switch (int(r, 0, 6)) {
    case 0:
    case 1:
      return { kind: 'review', id: idc, review: { at: at(int(r, 0, 30)), rating: pick(r, ['again', 'hard', 'good', 'easy'] as const) }, ...(chance(r, 0.2) && { nth: 2 }) }
    case 2:
      return { kind: 'unreview', id: idc, at: at(int(r, 0, 30)), rating: 'good' }
    case 3:
      return { kind: 'off', id: idc, on: chance(r, 0.5) }
    case 4:
      return { kind: 'next', id: idc, on: chance(r, 0.5), ...(chance(r, 0.3) && { at: int(r, 0, 4) }) }
    case 5:
      return { kind: 'fix', id: idc, on: chance(r, 0.5) }
    default:
      return { kind: 'notitle', id: idc, on: chance(r, 0.5) }
  }
}

/** What a card line MEANS: its marks, and its other parts (reviews among them) in their order. A mark's place is the writer's. */
function meaning(line: CardLine): string {
  const marks = MARKS.filter((m) => line.parts.some((p) => p.kind === m))
  return `${marks.join(' ')} | ${formatCardLine({ parts: line.parts.filter((p) => !(MARKS as readonly string[]).includes(p.kind)) })}`
}

/** The parts of a card line's body as written, split as the shared reader splits (a comma in quotes stays). */
function pieces(line: string): string[] {
  const m = /^<!--[ \t]*card:[ \t]*(.*?)[ \t]*-->$/.exec(line.trim())
  if (m === null) return []
  const out: string[] = []
  let start = 0
  let q = false
  const body = m[1]
  for (let i = 0; i < body.length; i++) {
    if (q && body[i] === '\\') i++
    else if (body[i] === '"') q = !q
    else if (body[i] === ',' && !q) {
      out.push(body.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(body.slice(start).trim())
  return out.filter((p) => p !== '')
}

export interface Finding {
  kind: string
  seed: number
  detail: string
}

/**
 * One random page and action list through `applyOps`. Findings (empty: safe):
 *  - only the changed cards' lines change, each keeping its own line end (YAZ-5514 W1), and the line count stays;
 *  - each changed line means what the card's actions, one after another, make of it (`applyCardOps`: `applyOp` each,
 *    a review taken out and put back keeping its place, YAZ-5520), and reads back;
 *  - every part the actions did not touch keeps its bytes (YAZ-5409);
 *  - the same list applied to the result changes nothing (a resend);
 *  - the BOM stays, the IDs stay, the Mac's reader reads the page.
 */
export function checkCardSequence(seed: number): Finding[] {
  const r = rng(seed)
  const { text, ids, shape } = page(r)
  // An `nth: 2` review follows its first copy, as `opsBetween` makes them.
  const ops = Array.from({ length: int(r, 1, 6) }, () => randomOp(r, ids)).flatMap((op) => (op.kind === 'review' && op.nth === 2 ? [{ ...op, nth: undefined }, op] : [op]))
  const out: Finding[] = []
  const f = (kind: string, detail: string) => out.push({ kind, seed, detail })
  let content: string
  try {
    content = applyOps(text, ops).content
  } catch (e) {
    f('throws', String(e))
    return out
  }
  if (shape.bom && !content.startsWith('\ufeff')) f('bom-lost', '')
  // Expected: each card (the first that holds the ID) with the actions applied one after another.
  const cards = pageCards(text)
  const first = new Map<string, number>()
  cards.forEach((c, n) => {
    const id = cardIdOf(c.line)
    if (id !== null && !first.has(id.toLowerCase())) first.set(id.toLowerCase(), n)
  })
  const byCard = new Map<number, CardOp[]>()
  for (const op of ops) {
    const n = first.get(op.id.toLowerCase())
    if (n !== undefined) byCard.set(n, [...(byCard.get(n) ?? []), op])
  }
  const want = new Map<number, CardLine>([...byCard].map(([n, list]) => [n, applyCardOps(cards[n].line, list)]))
  const diff = changedLines(text, content)
  if (diff === null) {
    f('line-count-changed', JSON.stringify({ text, ops }))
    return out
  }
  const { frontmatter } = splitFrontmatter(text)
  const fmCount = frontmatter === '' ? 0 : frontmatter.split('\n').length - 1
  const rowOf = (n: number) => cards[n].lineAt! + fmCount
  const allowed = new Set([...want.keys()].map(rowOf))
  const extra = diff.filter((i) => !allowed.has(i))
  const a = text.split('\n')
  const b = content.split('\n')
  if (extra.length > 0) f(`other-line-changed:${shape.eol}${shape.bom ? ':bom' : ''}`, extra.slice(0, 3).map((i) => `${JSON.stringify(a[i])} -> ${JSON.stringify(b[i])}`).join(' | '))
  const after = pageCards(content)
  if (after.map((c) => cardIdOf(c.line)).join() !== cards.map((c) => cardIdOf(c.line)).join()) f('ids-changed', '')
  for (const [n, line] of want) {
    const got = after[n]?.line
    if (got === undefined || meaning(got) !== meaning(line)) f('wrong-fold', `${formatCardLine(cards[n].line)} => got ${got && formatCardLine(got)} want ${formatCardLine(line)}`)
    const row = b[rowOf(n)]
    if (row.endsWith('\r') !== a[rowOf(n)].endsWith('\r')) f('line-end-of-card-line-changed', JSON.stringify(row))
    if (parseCardLine(row) === null) f('card-line-unreadable', row)
    const newRow = row.replace(/\r$/, '')
    for (const piece of pieces(a[rowOf(n)].replace(/\r$/, ''))) {
      const kind = parseCardLine(`<!-- card: ${piece} -->`)?.parts[0]?.kind
      if (kind === 'review' || (MARKS as readonly string[]).includes(kind ?? '')) continue
      if (!newRow.includes(piece)) f('kept-part-rewritten', `${JSON.stringify(piece)} in ${a[rowOf(n)]} -> ${newRow}`)
    }
  }
  if (applyOps(content, ops).content !== content) f('not-idempotent', JSON.stringify({ text: content, ops }))
  try {
    cardRecords(content)
  } catch (e) {
    f('mac-reader-throws', String(e))
  }
  return out
}
