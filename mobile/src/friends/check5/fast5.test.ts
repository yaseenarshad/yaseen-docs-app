import { expect, it } from 'vitest'
import { noRealWaits } from '../check4/run4.testing'
import { report5, runPlans5 } from './run5.testing'

noRealWaits()

// The round 5 checker's attack in the normal suite (YAZ-5398): 30 of its orders with 5 % stale reads of the strict fake,
// and 15 with 35 % stale head reads and 5 % `contents` 404s ("No commit found"). Every invariant asserts.
it.each([
  ['check5 orders 5500001..5500030 at 5 % stale reads', 5500001, 30, { pStale: 0.05, p502: 0.02, pSecondary: 0.01, pContents404: 0 }],
  ['check5 orders 5600001..5600015 at 35 % stale reads', 5600001, 15, { pStale: 0.35, p502: 0.02, pSecondary: 0.01, pContents404: 0.05 }],
] as const)('%s: no violation', async (name, from, count, knobs) => {
  const t0 = Date.now()
  const r = await runPlans5(from, count, { ...knobs })
  report5(name, r, Date.now() - t0)
  expect(r.bad).toEqual([])
}, 300_000)
