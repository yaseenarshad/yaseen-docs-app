import { describe, expect, it } from 'vitest'
import { checkCardSequence, type Finding } from './cardsFuzz.testing'

/** 4,000 by default (well under a second); `CARD_FUZZ_RUNS` and `CARD_FUZZ_FROM` run other seeds. */
const RUNS = Number(process.env.CARD_FUZZ_RUNS ?? 4000)
const FROM = Number(process.env.CARD_FUZZ_FROM ?? 1)

describe('YAZ-5514: card answers and marks (applyOps) on random pages with random actions', () => {
  it(`${RUNS} random sequences: only the card lines change, each keeps its line end and its untouched parts, a resend changes nothing`, () => {
    const all: Finding[] = []
    for (let seed = FROM; seed < FROM + RUNS; seed++) all.push(...checkCardSequence(seed))
    const byKind = new Map<string, Finding[]>()
    for (const x of all) byKind.set(x.kind, [...(byKind.get(x.kind) ?? []), x])
    expect([...byKind].map(([k, v]) => `${k}: ${v.length} (seed ${v[0].seed}) ${v[0].detail.slice(0, 300)}`)).toEqual([])
  })
  // YAZ-5520: a list with an unreview and a review of the same review, applied twice, moved the review.
  it('seeds 17250 and 32795 (a review taken out and put back by one list): a resend changes nothing', () => {
    expect([17250, 32795].flatMap(checkCardSequence)).toEqual([])
  })
})
