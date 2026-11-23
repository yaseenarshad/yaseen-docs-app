import { expect, it } from 'vitest'
import { noRealWaits, report, runPlans } from './run4.testing'

noRealWaits()

// The builder's 5,000 new orders (YAZ-5083), part 2 of 4 (seeds 9302501..9303750), on the round 4 checker's model.
// Full runs only (`CHECK3_FULL=1`).
it('check4 builder orders, part 2', async () => {
  const r = await runPlans(9302501, 1250)
  report('check4-builder-2', r)
  expect(r.bad).toEqual([])
}, 3_600_000)
