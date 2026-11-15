import { expect, it } from 'vitest'
import { noRealWaits } from '../check4/run4.testing'
import { report6, runPlans6 } from './run6.testing'

noRealWaits()

// The round 6 builder's model (YAZ-5444), sample part 1 of 4: orders 6450501..6451000 at 5 % stale reads, 1 % `contents`
// 404. Full runs only (`CHECK3_FULL=1`). Every invariant asserts: 0 violations.
it('check6 sample part 1', async () => {
  const t0 = Date.now()
  const r = await runPlans6(6450501, 500)
  report6('check6-sample-1', r, Date.now() - t0)
  expect(r.count).toEqual(Object.fromEntries(Object.keys(r.count).map((k) => [k, 0])))
  expect(r.bad).toEqual([])
}, 7_200_000)
