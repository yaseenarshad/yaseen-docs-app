import { expect, it } from 'vitest'
import { noRealWaits, report, runPlans } from './run4.testing'

noRealWaits()

// The builder's 5,000 new orders (YAZ-5083), part 1 of 4 (seeds 9301251..9302500), on the round 4 checker's model.
// Full runs only (`CHECK3_FULL=1`).
it('check4 builder orders, part 1', async () => {
  const r = await runPlans(9301251, 1250)
  report('check4-builder-1', r)
  expect(r.bad).toEqual([])
}, 3_600_000)
