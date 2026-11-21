/**
 * The driver of the round 5 checker's model in the builder's suites (YAZ-5398): its attack with STALE READS of the
 * strict fake (`FakeRepoWorld.stale`), GitHub's 502 and secondary limit, and AutoSync page commits on the same branch.
 *
 * Seeds: the round 5 checker's 10,000 orders are 5500001 to 5510000 (`full5-*`, 5 % stale head reads, as its verdict's
 * "5 % stale reads" row). A fast set runs in the normal suite (`fast5.test.ts`). The full run:
 *
 *   CHECK3_FULL=1 OUT=<folder> npx vitest run --maxWorkers=4 -c mobile/vitest.config.ts src/friends/check3 src/friends/check4 src/friends/check5
 *
 * Every invariant ASSERTS: I1 to I7 (I2 and I4 strict), I8, "I1 on done", wrong deletes, unexpected throws.
 */
import { writeFileSync } from 'node:fs'
import { KEYS5, runPlan5, violations5, type Knobs } from './model5.testing'

/** The checker's "5 % stale reads" set: 5 % of head reads stale, 2 % of repo calls 502, 1 % of POSTs secondary limit. */
export const STALE5: Knobs = { pStale: 0.05, p502: 0.02, pSecondary: 0.01, pContents404: 0 }

export interface Run5 {
  runs: number
  events: number
  crashes: number
  stale: number
  pushes: number
  removesStarted: number
  removesFinished: number
  listWrites: number
  /** Orders that break each invariant. */
  count: Record<(typeof KEYS5)[number], number>
  /** The first finding of each failing order. */
  bad: string[]
}

export async function runPlans5(from: number, count: number, knobs: Knobs = STALE5): Promise<Run5> {
  const out: Run5 = { runs: 0, events: 0, crashes: 0, stale: 0, pushes: 0, removesStarted: 0, removesFinished: 0, listWrites: 0, count: Object.fromEntries(KEYS5.map((k) => [k, 0])) as Run5['count'], bad: [] }
  for (let s = from; s < from + count; s++) {
    let m
    try {
      // I2 strict is the state AFTER the faults stop (every kept pointer names the current numbers): the end phase runs
      // with no stale read, 502 or secondary limit, as the round 4 model's end phase does. I1 to I8 hold at every step.
      m = await runPlan5(s, knobs, undefined, undefined, true)
    } catch (err) {
      out.bad.push(`seed ${s}: the model stopped: ${(err as Error).message}`.slice(0, 300))
      continue
    }
    out.runs++
    out.events += m.st.steps
    out.crashes += m.st.crashes
    out.stale += m.st5.stale
    out.pushes += m.st5.pushes
    out.removesStarted += m.st.removesStarted
    out.removesFinished += m.st.removesFinished
    out.listWrites += m.st.listWrites
    const v = violations5(m)
    let first: string | null = null
    for (const k of KEYS5) {
      if ((v[k] ?? []).length === 0) continue
      out.count[k]++
      first ??= `seed ${s} ${k}: ${v[k][0]}`
    }
    if (first !== null) out.bad.push(first.slice(0, 400))
  }
  return out
}

export function report5(name: string, r: Run5, ms: number): void {
  const line = JSON.stringify({ set: name, ms, ...r, bad: r.bad.slice(0, 5) })
  console.log(line)
  if (process.env.OUT !== undefined) writeFileSync(`${process.env.OUT}/${name.replace(/[^a-z0-9-]+/gi, '-')}.json`, JSON.stringify({ set: name, ms, ...r }, null, 1))
}
