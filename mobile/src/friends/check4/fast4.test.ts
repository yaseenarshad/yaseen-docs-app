import { expect, it } from 'vitest'
import { noRealWaits, report, runPlans } from './run4.testing'

noRealWaits()

// The round 4 checker's model in the normal suite (YAZ-5083): 30 of its own orders and 10 of the builder's, with the
// strict fake GitHub. Every invariant asserts (I1 to I7, I2 and I4 strict, wrong deletes, unexpected throws).
it.each([
  ['check4 checker orders 7200001..7200030', 7200001, 30],
  ['check4 builder orders 9300001..9300010', 9300001, 10],
])('%s: no violation', async (name, from, count) => {
  const r = await runPlans(from, count)
  report(name, r)
  expect(r.bad).toEqual([])
}, 300_000)
