import { splitFrontmatter } from '@shared/frontmatter'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { describe, expect, it } from 'vitest'
import { applyTask } from '../comments/taskWrite'
import { pieceHtml } from './pageRender'
import { tickOfBox } from './taskTicks'

/**
 * YAZ-5513: RANDOM TAPS, from the check of everything the phone writes (`.claude/check5-tests-keep/check-writes`,
 * `tasks.fuzz`), made a normal test. Each run makes a page of nasty made-up blocks (tasks in code fences, closing
 * fences with an info string, fences opened on a list line, indented code, HTML blocks and comments, `$$` blocks, card
 * blocks, lazy ordered items, CRLF, mixed line ends, a BOM, front matter), draws it with THE READER (`renderPiece`),
 * taps one of the boxes it drew as the tap does (`tickOfBox`), and writes the tick (`applyTask`). It checks:
 *  - the boxes are the Mac's tasks: the lines the Mac's parser (remark: micromark, GFM) reads as tasks, no more (T3);
 *  - a tap on a page that did not change is never refused (T2);
 *  - the tick changes ONE byte, on the line of the box tapped, which is a task for the Mac (T1);
 *  - the reader draws that box in its new state, and a retry writes nothing (`already`).
 * `TASK_FUZZ_RUNS` sets how many runs (4,000 by default).
 */

const RUNS = Number(process.env.TASK_FUZZ_RUNS ?? 4000)

type Rng = () => number
/** mulberry32, seeded through a mix so small seeds spread. */
function rng(seed: number): Rng {
  let a = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))
const chance = (r: Rng, p: number): boolean => r() < p

const WORDS = ['alpha', 'Ünïcode', 'naïve café', '😀 emoji', '日本語', 'tab\there', 'a, b', 'x &#44; y', 'quote "q"', 'back\\slash', 'gt > lt <', 'plain']
const word = (r: Rng) => pick(r, WORDS)
const CORES = ['Buy milk', 'Call 😀 mum', 'Ünï task', 'x, y: z', 'Buy milk']
const task = (r: Rng) => `${pick(r, ['- ', '* ', '+ ', '1. ', '2) ', '-   ', '3. '])}${pick(r, ['[ ]', '[x]', '[X]'])} ${pick(r, CORES)}`

function cardBlock(r: Rng, id: string): string {
  const fence = pick(r, ['```card', '~~~card', '````card', '``` card'])
  const close = fence.startsWith('~') ? '~~~' : fence.startsWith('````') ? '````' : '```'
  const inner = pick(r, [`What is ${word(r)}?`, '- [ ] Task in card\n- [x] Done in card', `Q\n---\nA ${word(r)}`])
  return [fence, inner, close, `<!-- card: ${id}, title "${word(r)}" -->`].join('\n')
}

/** One block of a page's body. */
function block(r: Rng, ids: string[]): string {
  switch (int(r, 0, 24)) {
    case 0:
      return `# ${word(r)}`
    case 1:
      return `Some text ${word(r)}`
    case 2:
    case 3:
      return Array.from({ length: int(r, 1, 3) }, () => task(r)).join('\n')
    case 4:
      return `- parent\n  ${task(r)}\n    ${task(r)}`
    case 5:
      return `> ${task(r)}\n> ${task(r)}`
    case 6:
      return '```\n' + task(r) + '\n```'
    case 7:
      return '~~~md\n' + task(r) + '\n~~~'
    case 8:
      return '````\n```\n' + task(r) + '\n```\n````'
    case 9:
      return '<!--\n' + task(r) + '\n-->'
    case 10:
      return `    ${task(r).replace(/^\d+[.)] /, '- ')}`
    case 11:
      return `Paragraph\n2. [ ] Buy milk`
    case 12:
    case 13:
      return ids.length > 0 ? cardBlock(r, ids.shift()!) : 'text'
    case 14:
      return '<div>\n' + task(r) + '\n</div>'
    // T1: a closing line with an info string does not close a fence (N4).
    case 15:
      return '```\n' + task(r) + '\n```js\n' + task(r) + '\n```'
    // T1: a fence opened on a list item line (N5).
    case 16:
      return '- ```md\n  ' + task(r) + '\n  ```'
    // T1: a 4-space indented "```" is code, not a fence (N6).
    case 17:
      return '    ```\n' + task(r)
    case 18:
      return '$$\n' + task(r) + '\n$$'
    // T3: lazy ordered items, and an ordered list after indented code.
    case 19:
      return `- parent\n  2) [ ] ${pick(r, CORES)}\n  3) [x] ${pick(r, CORES)}`
    case 20:
      return `    code\n\n${pick(r, ['2) ', '3. ', '1. ', '> 2) '])}[ ] ${pick(r, CORES)}`
    case 21:
      return `${word(r)}\n> 2) [ ] ${pick(r, CORES)}`
    case 22:
      return `- ${task(r)}\n- ${task(r)}`
    case 23:
      return `1. ${word(r)}\n\n   ${task(r)}`
    default:
      return `${word(r)} <!-- card: NC-99 --> inline`
  }
}

const FMS = ['', '---\n---\n', '---\ntitle: Plan\n---\n', '---\ntitle:   Plan\ntags: [a,b]\n---\n', '---\ntitle: Plan\n...\n', '---\ntitle: "Ünï 😀"\nkind: card\n---\n']

function makePage(r: Rng): string {
  const eol = pick(r, ['\n', '\n', '\r\n', 'mixed'] as const)
  const ids = ['NC-1', 'NC-2', 'NC-3'].slice(0, int(r, 0, 2))
  const blocks = Array.from({ length: int(r, 2, 14) }, () => block(r, ids))
  let text = pick(r, FMS) + blocks.join(pick(r, ['\n\n', '\n\n\n'])) + (chance(r, 0.8) ? '\n' : '')
  if (eol === '\r\n') text = text.replace(/\n/g, '\r\n')
  else if (eol === 'mixed') text = text.replace(/\n/g, () => (chance(r, 0.5) ? '\r\n' : '\n'))
  return chance(r, 0.08) ? `﻿${text}` : text
}

/** The Mac's (remark's) task items: their start line in `body` (1-based). */
function macTaskLines(body: string): number[] {
  const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const out: number[] = []
  const walk = (n: { type: string; checked?: boolean | null; position?: { start: { line: number } }; children?: unknown[] }) => {
    if (n.type === 'listItem' && typeof n.checked === 'boolean') out.push(n.position!.start.line)
    for (const c of (n.children ?? []) as (typeof n)[]) walk(c)
  }
  walk(tree as never)
  return out
}

/**
 * The boxes the reader draws for `body`, from its HTML before the cleaner (`pieceHtml`; the cleaner keeps a box's data
 * marks, `taskTicks.test.tsx`). No DOM: the cleaner on jsdom keeps memory it never gives back, too much for 4,000 runs.
 */
const boxesOf = (body: string): HTMLElement[] =>
  [...pieceHtml(body).html.matchAll(/<span class="page-task"[^>]*>/g)].map(([span]) => {
    const mark = (name: string) => {
      const m = new RegExp(`[\\w-]*${name}="([^"]*)"`).exec(span)
      return m === null ? undefined : m[1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    }
    return { dataset: { task: mark('-task'), taskLine: mark('-task-line'), checked: mark('-checked') } } as unknown as HTMLElement
  })

/** One random page and tap: what went wrong (empty: safe). */
function run(seed: number): string[] {
  const r = rng(seed)
  const text = makePage(r)
  const out: string[] = []
  const { frontmatter, body } = splitFrontmatter(text)
  const fmLines = frontmatter === '' ? 0 : frontmatter.split('\n').length - 1
  const boxes = boxesOf(body)
  const mac = macTaskLines(body)
  const drawn = boxes.map((b) => (b.dataset.taskLine === undefined ? -1 : Number(b.dataset.taskLine) + 1))
  const lines = body.split(/\r\n|\r|\n/)
  for (const l of drawn) if (!mac.includes(l)) out.push(`a-box-the-mac-does-not-draw: line ${l} ${JSON.stringify(lines.slice(Math.max(0, l - 4), l))}`)
  for (const l of mac) if (!drawn.includes(l)) out.push(`note: a task the phone draws no box for: line ${l} ${JSON.stringify(lines.slice(Math.max(0, l - 4), l))}`)
  if (boxes.length === 0) return out
  const k = int(r, 0, boxes.length - 1)
  const box = boxes[k]!
  const was = box.dataset.checked === 'true'
  const checked = chance(r, 0.85) ? !was : was
  const tick = tickOfBox(text, box, checked)
  if (tick === null) return [...out, 'refused-at-tap']
  const res = applyTask(text, tick)
  if (res.kind === 'refused') return [...out, 'refused-at-write']
  if (res.kind === 'already') return checked === was ? out : [...out, 'already-but-the-box-differs']
  if (checked === was) out.push('ticked-but-the-box-was-so')
  const after = res.content
  if (after.length !== text.length) out.push('length-changed')
  const diffs: number[] = []
  for (let i = 0; i < text.length; i++) if (text[i] !== after[i]) diffs.push(i)
  if (diffs.length !== 1) out.push(`bytes-changed: ${diffs.length}`)
  const line = text.slice(0, diffs[0]).split(/\r\n|\r|\n/).length // 1-based, in the whole text
  const bodyLine = line - fmLines
  if (bodyLine !== Number(box.dataset.taskLine) + 1) out.push(`wrote-another-line: tapped ${Number(box.dataset.taskLine) + 1}, wrote ${bodyLine}`)
  if (!mac.includes(bodyLine)) out.push(`wrote-a-non-task: ${JSON.stringify(text.split(/\r\n|\r|\n/)[line - 1])}`)
  if (boxesOf(splitFrontmatter(after).body)[k]?.dataset.checked !== String(checked)) out.push('redrawn-box-wrong')
  if (applyTask(after, tick).kind !== 'already') out.push('retry-not-already')
  return out
}

describe('random taps on random pages: the box tapped is the line written (YAZ-5513)', () => {
  it(`${RUNS} random taps: the boxes are the Mac's tasks, no tap is refused, each writes one byte on its own line`, () => {
    const found = new Map<string, { n: number; seed: number; detail: string }>()
    const verbose = process.env.TASK_FUZZ_VERBOSE !== undefined
    let notes = 0
    for (let seed = 1; seed <= RUNS; seed++)
      for (const f of run(seed)) {
        if (verbose) console.log(seed, f)
        if (process.env.TASK_FUZZ_SEED === String(seed)) console.log(JSON.stringify(splitFrontmatter(makePage(rng(seed))).body))
        const kind = f.split(':')[0]!
        if (kind === 'note') notes++
        const at = found.get(kind) ?? { n: 0, seed, detail: f }
        at.n++
        found.set(kind, at)
      }
    console.log(`[YAZ-5513] ${RUNS} random taps; ${notes} Mac tasks with no box on the phone (a box it does not draw, never a wrong write)`)
    expect([...found].filter(([kind]) => kind !== 'note').map(([kind, f]) => `${kind}: ${f.n} (seed ${f.seed}) ${f.detail.slice(0, 300)}`)).toEqual([])
  }, 600_000)
})
