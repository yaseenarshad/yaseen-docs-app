/**
 * The driver of the round 6 builder's model (`model6.testing.ts`, YAZ-5444: the list FILE gone from a home vault that
 * answers). A fast set runs in the normal suite (`fast6.test.ts`); the sample of 2,000 orders (`sample6-*.test.ts`) only
 * with CHECK3_FULL=1:
 *
 *   CHECK3_FULL=1 OUT=<folder> npx vitest run --maxWorkers=4 -c mobile/vitest.config.ts src/friends/check6
 */
import { writeFileSync } from 'node:fs'
import { STALE5 } from '../check5/run5.testing'
import type { Knobs } from '../check5/model5.testing'
import { KEYS6, runPlan6, violations6 } from './model6.testing'

export interface Run6 {
  runs: number
  events: number
  crashes: number
  stale: number
  removesStarted: number
  fileGone: number
  wayOut: number
  refusedWhileThere: number
  /** How the list file went (round 7: `empty` is the vault made again with no commit, YAZ-5464). */
  how: { deleted: number; remade: number; empty: number }
  /** Way outs that stopped after their new list and were finished by the next open of the list (YAZ-5462). */
  finishedByOpen: number
  /** I2 findings for C after the way out (set apart: the way out removed C by design). */
  i2AfterWayOut: number
  count: Record<(typeof KEYS6)[number], number>
  bad: string[]
}

export async function runPlans6(from: number, count: number, knobs: Knobs = { ...STALE5, pContents404: 0.01 }): Promise<Run6> {
  const out: Run6 = { runs: 0, events: 0, crashes: 0, stale: 0, removesStarted: 0, fileGone: 0, wayOut: 0, refusedWhileThere: 0, how: { deleted: 0, remade: 0, empty: 0 }, finishedByOpen: 0, i2AfterWayOut: 0, count: Object.fromEntries(KEYS6.map((k) => [k, 0])) as Run6['count'], bad: [] }
  for (let s = from; s < from + count; s++) {
    let m
    try {
      m = await runPlan6(s, knobs)
    } catch (err) {
      out.bad.push(`seed ${s}: the model stopped: ${(err as Error).message}`.slice(0, 300))
      continue
    }
    out.runs++
    out.events += m.st.steps
    out.crashes += m.st.crashes
    out.stale += m.st5.stale
    out.removesStarted += m.st.removesStarted
    out.fileGone += m.st6.fileGone
    out.wayOut += m.st6.wayOut
    out.refusedWhileThere += m.st6.refusedWhileThere
    for (const k of ['deleted', 'remade', 'empty'] as const) out.how[k] += m.st6.how[k]
    out.finishedByOpen += m.st6.finishedByOpen
    out.i2AfterWayOut += m.i2AfterWayOut
    const v = violations6(m)
    let first: string | null = null
    for (const k of KEYS6) {
      if ((v[k] ?? []).length === 0) continue
      out.count[k]++
      first ??= `seed ${s} ${k}: ${v[k][0]}`
    }
    if (first !== null) out.bad.push(first.slice(0, 400))
  }
  return out
}

export function report6(name: string, r: Run6, ms: number): void {
  console.log(JSON.stringify({ set: name, ms, ...r, bad: r.bad.slice(0, 5) }))
  if (process.env.OUT !== undefined) writeFileSync(`${process.env.OUT}/${name.replace(/[^a-z0-9-]+/gi, '-')}.json`, JSON.stringify({ set: name, ms, ...r }, null, 1))
}
