import { cardIdOf, cardReviewKey, cardReviewsOf, pageCards, rewritePageCards, withCardReview } from '@shared/cardLine'
import { addComment, readComments } from '@shared/comments'
import { describe, expect, it } from 'vitest'
import { applyOps } from '../../answers/ops'
import { applyComment } from '../../comments/write'
import { applyTask } from '../../comments/taskWrite'
import { splitFrontmatter } from '@shared/frontmatter'
import type { Finding } from './gen.testing'
import { chance, int, page, pick, rng } from './gen.testing'
import { mergeLinesApart } from '@shared/lineMerge'
import { macMerge } from './macMerge.testing'
import { phoneBoxes } from './tasksCheck.testing'

/**
 * YAZ-5512 X1, YAZ-5515 X2: one phone write and one Mac edit of the same page, merged as the Mac merges them. No merge
 * throws, nothing is lost, and only the SAME line changed two ways may make a conflict copy. `npm test` runs 300 merges;
 * the check runs `CHECK_WRITES_MERGES=3000` (each merge spawns `git merge-file`).
 */
const RUNS = Number(process.env.CHECK_WRITES_MERGES ?? 300)

/** One phone write and one Mac edit from the same base; the Mac merges (its rebase, then resolve.ts's settle). */
function one(seed: number): Finding[] {
  const r = rng(seed)
  const out: Finding[] = []
  const f = (kind: string, detail: string) => out.push({ kind, seed, detail })
  let { text: base, shape } = page(r, { cards: int(r, 1, 3) })
  if (shape.bom || shape.eol === 'mixed') return out
  // The phone's write.
  let phone = base
  let check: (t: string) => boolean = () => true
  /** The phone's target (its card, its task) is still there for a reader of `t`. */
  let target: (t: string) => boolean = () => true
  const k = int(r, 0, 2)
  if (k === 0) {
    const ids = pageCards(base).map((c) => cardIdOf(c.line)).filter((x): x is string => x !== null)
    if (ids.length === 0) return out
    const id = pick(r, ids)
    const review = { at: '2026-11-14T09:59:00.000Z', rating: 'easy' as const }
    phone = applyOps(base, [{ kind: 'review', id, review }]).content
    check = (t) => pageCards(t).some((c) => cardIdOf(c.line)?.toUpperCase() === id.toUpperCase() && cardReviewsOf(c.line).some((x) => cardReviewKey(x) === cardReviewKey(review)))
    target = (t) => pageCards(t).some((c) => cardIdOf(c.line)?.toUpperCase() === id.toUpperCase())
  } else if (k === 1) {
    const res = applyComment(base, { id: 'pho00001', at: '2026-11-14T06:00:00Z', by: 'y', body: 'from phone' })
    if (res.kind !== 'added') return out
    phone = res.content
    check = (t) => readComments(t).some((c) => c.id === 'pho00001')
  } else {
    const body = splitFrontmatter(base).body
    const boxes = phoneBoxes(body)
    if (boxes.length === 0) return out
    const i = int(r, 0, boxes.length - 1)
    const b = boxes[i]
    const tick = { core: b.core, nth: boxes.slice(0, i).filter((x) => x.core === b.core).length, of: boxes.filter((x) => x.core === b.core).length, checked: !b.checked }
    const res = applyTask(base, tick)
    if (res.kind !== 'ticked') return out
    phone = res.content
    check = (t) => applyTask(t, tick).kind === 'already'
    target = (t) => ['ticked', 'already'].includes(applyTask(t, tick).kind)
  }
  if (phone === base) return out
  // The Mac's edit: a line of the body changed or added, a comment, or its own answer.
  let mac = base
  const marker = `MAC-EDIT-${seed}`
  const m = int(r, 0, 3)
  const lines = base.split('\n')
  const fmLines = splitFrontmatter(base).frontmatter.split('\n').length - 1
  if (m <= 1) {
    const at = int(r, fmLines, lines.length - 1)
    if (m === 0) lines.splice(at, 0, marker + (base.includes('\r\n') ? '\r' : ''))
    else lines[at] = lines[at].replace(/(\r?)$/, ` ${marker}$1`)
    mac = lines.join('\n')
  } else if (m === 2) {
    try {
      mac = addComment(base, marker, { id: 'mac00001', at: '2026-11-14T05:00:00Z', by: 'mac' })
    } catch {
      return out
    }
  } else {
    mac = rewritePageCards(base, (c) => (cardIdOf(c.line) !== null ? withCardReview(c.line, { at: '2026-11-13T01:00:00.000Z', rating: 'hard' }) : undefined))
    if (mac === base) return out
  }
  let res: ReturnType<typeof macMerge>
  try {
    res = macMerge(base, phone, mac)
  } catch (e) {
    f(`mac-merge-throws:${['answer', 'comment', 'tick'][k]}`, `${String(e).slice(0, 80)} base=${JSON.stringify(base.slice(0, 120))}`)
    return out
  }
  const macThere = (t: string) => (m === 3 ? pageCards(t).some((c) => cardReviewsOf(c.line).some((x) => x.at === '2026-11-13T01:00:00.000Z')) : t.includes(marker))
  // The Mac's own edit can break the target itself (a card fence's info string, a task's marker): then the phone's
  // line is checked by its bytes instead, since no reader finds the card or the task in the Mac's page either.
  const phoneLine = phone.split('\n').find((l, i) => l !== base.split('\n')[i])
  const broken = !target(mac)
  if (broken ? !(phoneLine !== undefined && res.text.split('\n').includes(phoneLine)) : !check(res.text)) f(`phone-write-not-in-page:${['answer', 'comment', 'tick'][k]}`, `${res.how} ${JSON.stringify(res.text).slice(0, 200)}`)
  if (!macThere(res.text) && !(res.copy !== undefined && macThere(res.copy))) f('mac-edit-lost', res.how)
  // Only the SAME line changed two ways (or two inserts at one place) may keep both (YAZ-5515 X2).
  if (res.copy !== undefined) f(`conflict-copy${mergeLinesApart(base, phone, mac) === null ? '-same-line' : ''}:${['answer', 'comment', 'tick'][k]}+${['mac-line-added', 'mac-line-edited', 'mac-comment', 'mac-answer'][m]}`, `${res.how}`)
  if (res.how === 'keep-both') f('keep-both', '')
  if (chance(r, 0)) void 0
  return out
}

describe('check-writes: the Mac merges each phone write with a random Mac edit', () => {
  it(`${RUNS} random merges`, () => {
    const all: Finding[] = []
    for (let seed = 1; seed <= RUNS; seed++) all.push(...one(seed))
    const byKind = new Map<string, Finding[]>()
    for (const x of all) byKind.set(x.kind, [...(byKind.get(x.kind) ?? []), x])
    const summary = [...byKind].sort().map(([k, v]) => `${k}: ${v.length} (seeds ${v.slice(0, 5).map((x) => x.seed).join(',')}) ${v[0].detail.slice(0, 200)}`)
    console.log(`merges: ${RUNS} runs\n` + summary.join('\n'))
    expect.soft(summary.filter((s) => !s.startsWith('conflict-copy-same-line'))).toEqual([])
  }, 600000)
})
