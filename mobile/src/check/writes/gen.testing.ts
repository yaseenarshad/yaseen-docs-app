/**
 * check-writes: seeded generators of nasty vault files (made-up data only) for the phone's write checks.
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

/** One thing a check found (empty list: safe). */
export interface Finding {
  kind: string
  seed: number
  detail: string
}
