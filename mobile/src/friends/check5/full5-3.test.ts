import { expect, it } from 'vitest'
import { noRealWaits } from '../check4/run4.testing'
import { report5, runPlans5 } from './run5.testing'

noRealWaits()

// The round 5 checker's 10,000 orders with 5 % STALE READS (YAZ-5398), part 3 of 4 (seeds 5507501..5510000).
// Full runs only (`CHECK3_FULL=1`). Every invariant asserts: 0 violations.
it('check5 orders at 5 % stale reads, part 3', async () => {
  const t0 = Date.now()
  const r = await runPlans5(5507501, 2500)
  report5('check5-stale5-3', r, Date.now() - t0)
  expect(r.count).toEqual(Object.fromEntries(Object.keys(r.count).map((k) => [k, 0])))
  expect(r.bad).toEqual([])
}, 7_200_000)
