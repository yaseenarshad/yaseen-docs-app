import { writeFileSync } from 'node:fs'
import { researchOut } from '../researchOut.testing'
import { it } from 'vitest'
import { noRealWaits } from '../check4/run4.testing'
import { KEYS5, runPlan5, violations5, type Knobs } from './model5.testing'

noRealWaits()

const FROM = Number(process.env.C5_FROM ?? 5500001)
const COUNT = Number(process.env.C5_COUNT ?? 20)
const KN: Knobs = { pStale: Number(process.env.C5_STALE ?? 0.35), p502: Number(process.env.C5_502 ?? 0.02), pSecondary: Number(process.env.C5_SEC ?? 0.01), pContents404: Number(process.env.C5_C404 ?? 0) }

it(`check5 orders ${FROM}..${FROM + COUNT - 1}`, async () => {
  const count: Record<string, number> = Object.fromEntries(KEYS5.map((k) => [k, 0]))
  const bad: string[] = []
  const tot = { doneEarly: 0, runs: 0, events: 0, crashes: 0, stale: 0, r502: 0, secondary: 0, c404: 0, pushes: 0, removesStarted: 0, removesFinished: 0, listWrites: 0, sendsSent: 0 }
  for (let s = FROM; s < FROM + COUNT; s++) {
    let m
    try {
      m = await runPlan5(s, KN)
    } catch (err) {
      bad.push(`seed ${s}: model stopped: ${(err as Error).message}`.slice(0, 300))
      continue
    }
    tot.runs++
    tot.events += m.st.steps
    tot.crashes += m.st.crashes
    tot.stale += m.st5.stale
    tot.doneEarly += m.st5.doneEarly
    tot.r502 += m.st5.r502
    tot.secondary += m.st5.secondary
    tot.c404 += m.st5.c404
    tot.pushes += m.st5.pushes
    tot.removesStarted += m.st.removesStarted
    tot.removesFinished += m.st.removesFinished
    tot.listWrites += m.st.listWrites
    tot.sendsSent += m.st4.sendsSent
    const v = violations5(m)
    for (const k of KEYS5) {
      if ((v[k] ?? []).length === 0) continue
      count[k]++
      bad.push(`seed ${s} ${k}: ${v[k][0]}`.slice(0, 400))
    }
  }
  const out = { from: FROM, count: COUNT, knobs: KN, ...tot, violations: count, bad }
  if (process.env.OUT) writeFileSync(`${researchOut()}/check5-${FROM}-${COUNT}-${process.env.C5_TAG ?? 'x'}.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify({ ...out, bad: bad.slice(0, 8) }))
}, 7_200_000)
