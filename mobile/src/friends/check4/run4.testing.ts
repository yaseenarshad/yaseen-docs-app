/**
 * The driver of the round 4 checker's model (YAZ-5083): runs plans by seed and counts the violations per invariant.
 *
 * Seeds: the round 4 checker's own 10,000 orders are 7200001 to 7210000 (`full4-*`); the builder's 5,000 new ones are
 * 9300001 to 9305000 (`mine4-*`). A fast set runs in the normal suite (`fast4.test.ts`). The full runs:
 *
 *   CHECK3_FULL=1 OUT=<folder> npx vitest run --maxWorkers=4 -c mobile/vitest.config.ts src/friends/check3 src/friends/check4
 *
 * Every invariant ASSERTS. `OUT` (optional) gets one JSON summary per part.
 */
import { writeFileSync } from 'node:fs'
import { plan, runPlan, violations } from './model4.testing'

/** The checks of the round 4 checker (I2 strict, I4 strict, I5, I6) and of YAZ-5083 (I7), plus unexpected throws. */
export const KEYS = ['I1', 'I2', 'I2strict', 'I3', 'I4', 'I4strict', 'I5', 'I6', 'I7', 'wrongDelete', 'throws'] as const

export interface Run4 {
  runs: number
  events: number
  crashes: number
  c409: number
  c422: number
  sends: number
  sendsSent: number
  removesStarted: number
  removesFinished: number
  oldRuns: number
  oldBlocked: number
  listWrites: number
  maxRecords: number
  /** Orders where the OLD app wrote its old gist after the move, over a change it had not read (not the list). */
  oldGistAfterMove: number
  /** Orders that break each invariant. */
  count: Record<(typeof KEYS)[number], number>
  /** The first finding of each failing order. */
  bad: string[]
}

/** Runs seeds `from` .. `from + count - 1` of the round 4 plan generator. */
export async function runPlans(from: number, count: number): Promise<Run4> {
  const out: Run4 = { runs: 0, events: 0, crashes: 0, c409: 0, c422: 0, sends: 0, sendsSent: 0, removesStarted: 0, removesFinished: 0, oldRuns: 0, oldBlocked: 0, listWrites: 0, maxRecords: 0, oldGistAfterMove: 0, count: Object.fromEntries(KEYS.map((k) => [k, 0])) as Run4['count'], bad: [] }
  for (let s = from; s < from + count; s++) {
    let m
    try {
      m = await runPlan(plan(s))
    } catch (err) {
      out.bad.push(`seed ${s}: the model stopped: ${(err as Error).message}`.slice(0, 300))
      continue
    }
    out.runs++
    out.events += m.st.steps
    out.crashes += m.st.crashes
    out.c409 += m.world.refused.filter((r) => r.status === 409).length + m.st4.c409
    out.c422 += m.world.refused.filter((r) => r.status === 422).length
    out.sends += m.st4.sends
    out.sendsSent += m.st4.sendsSent
    out.removesStarted += m.st.removesStarted
    out.removesFinished += m.st.removesFinished
    if (m.oldDev) out.oldRuns++
    out.oldBlocked += m.st4.oldBlocked
    out.listWrites += m.st.listWrites
    out.maxRecords = Math.max(out.maxRecords, m.st4.maxListFiles)
    const v = violations(m)
    if (v.oldGistAfterMove.length > 0) out.oldGistAfterMove++
    let first: string | null = null
    for (const k of KEYS) {
      if ((v[k] ?? []).length === 0) continue
      out.count[k]++
      first ??= `seed ${s} ${k}: ${v[k][0]}`
    }
    if (first !== null) out.bad.push(first.slice(0, 400))
  }
  return out
}

/** The 409 retry of the phone's gist calls waits 1 s and 2 s of real time: no wait in this model (its clock is fake). */
export function noRealWaits(): void {
  const real = globalThis.setTimeout
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => real(fn, ms === 1000 || ms === 2000 ? 0 : ms, ...a)) as typeof setTimeout
}

export function report(name: string, r: Run4): void {
  const line = JSON.stringify({ set: name, ...r, bad: r.bad.slice(0, 5) })
  console.log(line)
  if (process.env.OUT !== undefined) writeFileSync(`${process.env.OUT}/${name.replace(/[^a-z0-9-]+/gi, '-')}.json`, JSON.stringify({ set: name, ...r }, null, 1))
}
