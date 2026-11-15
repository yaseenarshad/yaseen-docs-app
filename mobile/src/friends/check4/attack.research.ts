import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { researchOut } from '../researchOut.testing'
import { plan, runPlan, violations } from './model4.testing'

// The 409 retry of gistsApi waits 1 s and 2 s of real time: no wait in this model (the fake clock is the model's).
const real = globalThis.setTimeout
globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => real(fn, ms === 1000 || ms === 2000 ? 0 : ms, ...a)) as typeof setTimeout

const FROM = Number(process.env.FROM ?? 7000001)
const COUNT = Number(process.env.COUNT ?? 20)
it(`check4 attack seeds ${FROM}..${FROM + COUNT - 1}`, async () => {
  const sum: Record<string, number> = {}
  const seeds: Record<string, number[]> = {}
  const first: Record<string, string[]> = {}
  const t: Record<string, number> = { runs: 0, events: 0, crashes: 0, c409: 0, c422: 0, sends: 0, sendsSent: 0, oldRuns: 0, oldOps: 0, oldWrites: 0, oldBlocked: 0, oldHeadOverV2: 0, removesStarted: 0, removesFinished: 0, groupRuns: 0, zoneLost: 0, i6parked: 0, maxListFiles: 0, maxTombs: 0, cutRuns: 0 }
  for (let s = FROM; s < FROM + COUNT; s++) {
    const p = plan(s)
    let m
    try {
      m = await runPlan(p)
    } catch (err) {
      ;(seeds.harness ??= []).push(s)
      ;(first.harness ??= []).push(`seed ${s}: ${(err as Error).message}`.slice(0, 300))
      continue
    }
    t.runs++
    t.events += m.st.steps
    t.crashes += m.st.crashes
    t.c409 += m.st4.c409
    t.c422 += m.st4.c422
    t.sends += m.st4.sends
    t.sendsSent += m.st4.sendsSent
    if (m.oldDev) t.oldRuns++
    t.oldOps += m.st4.oldOps
    t.oldWrites += m.st4.oldWrites
    t.oldBlocked += m.st4.oldBlocked
    t.oldHeadOverV2 += m.st4.oldHeadOverV2
    t.removesStarted += m.st.removesStarted
    t.removesFinished += m.st.removesFinished
    if (m.group) t.groupRuns++
    t.zoneLost += m.st4.zoneLost.length
    t.i6parked += m.st4.i6parked
    t.maxListFiles = Math.max(t.maxListFiles, m.st4.maxListFiles)
    t.maxTombs = Math.max(t.maxTombs, m.st4.maxTombs)
    for (const [k, v] of Object.entries(violations(m))) {
      if (v.length === 0) continue
      sum[k] = (sum[k] ?? 0) + v.length
      ;(seeds[k] ??= []).push(s)
      if ((first[k] ??= []).length < 6) first[k].push(v[0])
    }
    if (m.st4.zoneLost.length > 0) {
      ;(seeds.zoneLost ??= []).push(s)
      if ((first.zoneLost ??= []).length < 4) first.zoneLost.push(m.st4.zoneLost[0])
    }
  }
  writeFileSync(`${researchOut()}/check4-${FROM}.json`, JSON.stringify({ from: FROM, count: COUNT, totals: t, violations: sum, seeds, first }, null, 1))
}, 3_600_000)
