import { describe, expect, it } from 'vitest'
import type { Finding } from './gen.testing'
import { checkCommentSequence } from './commentsCheck.testing'
/** YAZ-5512 C1 and S1: random comments on random pages (BOM, empty blocks, CRLF, …). `npm test` runs 500; the check 4,000. */
const RUNS = Number(process.env.CHECK_WRITES_RUNS ?? 500)

describe('check-writes: page and card file comments (applyComment), random pages', () => {
  it(`${RUNS} random sequences`, () => {
    const all: Finding[] = []
    for (let seed = 1; seed <= RUNS; seed++) all.push(...checkCommentSequence(seed))
    const byKind = new Map<string, Finding[]>()
    for (const x of all) byKind.set(x.kind, [...(byKind.get(x.kind) ?? []), x])
    const summary = [...byKind].map(([k, v]) => `${k}: ${v.length} (seed ${v[0].seed}) ${v[0].detail.slice(0, 300)}`)
    console.log(`comments: ${RUNS} runs\n` + summary.join('\n'))
    // Refused by design: a flow-style or an indented block (the splice never lays a block out again). Nothing else.
    expect.soft(summary.filter((s) => !/^refused:layout:(\{|  )/.test(s))).toEqual([])
  }, 600000)
})
