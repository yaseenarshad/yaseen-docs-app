import { expect, it } from 'vitest'
import { noRealWaits } from '../check4/run4.testing'
import { report6, runPlans6 } from './run6.testing'

noRealWaits()

// YAZ-5492 (round 8 builder): the sample with the TWO-VAULT race (two A phones' way outs at the same moment into two
// other vaults, in about a third of the orders with two or more A phones), part 0 of 4: orders 8920001..8920500
// at 5 % stale reads, 1 % `contents` 404. Full runs only (`CHECK3_FULL=1`). Every invariant asserts (I1..I11): 0 violations.
it('check8 sample part 0', async () => {
  const t0 = Date.now()
  const r = await runPlans6(8920001, 500)
  report6('check8-sample-0', r, Date.now() - t0)
  expect(r.count).toEqual(Object.fromEntries(Object.keys(r.count).map((k) => [k, 0])))
  expect(r.bad).toEqual([])
}, 7_200_000)
