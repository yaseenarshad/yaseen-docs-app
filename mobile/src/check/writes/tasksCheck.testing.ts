import { splitFrontmatter } from '@shared/frontmatter'
import { Marked, type Token, type Tokens } from 'marked'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { applyTask, taskCore, type TaskTick } from '../../comments/taskWrite'
import type { Finding } from './gen.testing'
import { chance, int, page, rng } from './gen.testing'

const marked = new Marked({ gfm: true, breaks: true })

/** The boxes the phone draws with their line (`data-task`), in document order: what a tap can name. */
export function phoneBoxes(body: string): { core: string; checked: boolean }[] {
  const out: { core: string; checked: boolean }[] = []
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === 'list') {
        for (const item of (t as Tokens.List).items) {
          if (item.task) {
            const core = taskCore(item.raw.split('\n')[0]!)
            if (core !== null) out.push({ core, checked: item.checked === true })
          }
          walk(item.tokens)
        }
      } else if ('tokens' in t && Array.isArray((t as { tokens?: Token[] }).tokens)) walk((t as { tokens: Token[] }).tokens)
    }
  }
  walk(marked.lexer(body))
  return out
}

/** The Mac's (remark's) task items: their start line in `body` (1-based). */
export function macTaskLines(body: string): number[] {
  const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const out: number[] = []
  const walk = (n: { type: string; checked?: boolean | null; position?: { start: { line: number } }; children?: unknown[] }) => {
    if (n.type === 'listItem' && typeof n.checked === 'boolean') out.push(n.position!.start.line)
    for (const c of (n.children ?? []) as (typeof n)[]) walk(c)
  }
  walk(tree as never)
  return out
}

export function checkTaskSequence(seed: number): Finding[] {
  const r = rng(seed)
  const { text } = page(r, { cards: int(r, 0, 2), blocks: int(r, 2, 14) })
  const out: Finding[] = []
  const f = (kind: string, detail: string) => out.push({ kind, seed, detail })
  const { frontmatter, body } = splitFrontmatter(text)
  const fmLines = frontmatter === '' ? 0 : frontmatter.split('\n').length - 1
  const boxes = phoneBoxes(body)
  const mac = macTaskLines(body)
  if (boxes.length === 0) return out
  const k = int(r, 0, boxes.length - 1)
  const box = boxes[k]
  const same = boxes.filter((b) => b.core === box.core)
  const tick: TaskTick = { core: box.core, nth: boxes.slice(0, k).filter((b) => b.core === box.core).length, of: same.length, checked: chance(r, 0.85) ? !box.checked : box.checked }
  const res = applyTask(text, tick)
  if (res.kind === 'refused') {
    f('refused-at-tap', JSON.stringify({ core: tick.core, nth: tick.nth, of: tick.of }))
    return out
  }
  if (res.kind === 'already') {
    if (tick.checked !== box.checked) f('already-but-box-differs', '')
    return out
  }
  const after = res.content
  if (after.length !== text.length) f('length-changed', '')
  let diff = 0
  let where = -1
  for (let i = 0; i < text.length; i++)
    if (text[i] !== after[i]) {
      diff++
      where = i
    }
  if (diff !== 1) f('bytes-changed', String(diff))
  const line = text.slice(0, where).split('\n').length // 1-based in the whole text
  const bodyLine = line - fmLines
  // The changed line must be the Mac's task item for the box tapped.
  if (!mac.includes(bodyLine)) f('ticked-a-non-task(code/html/comment)', JSON.stringify({ line: text.split('\n')[line - 1], body }))
  else if (mac.length === boxes.length && mac[k] !== bodyLine) f('ticked-another-task', JSON.stringify({ tapped: k, macLine: mac[k], wrote: bodyLine, body }))
  if (mac.length !== boxes.length) f('note:phone-and-mac-count-differ', '')
  // The phone re-renders the box as wanted.
  const again = phoneBoxes(splitFrontmatter(after).body)
  if (again[k]?.checked !== tick.checked && mac.length === boxes.length) f('rerender-box-wrong', '')
  // Retry is `already`.
  if (applyTask(after, tick).kind !== 'already') f('retry-not-already', '')
  return out
}
