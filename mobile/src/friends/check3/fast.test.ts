import { expect, it } from 'vitest'
import { range, runSeeds } from './run'

// The fast set of the model checker in the normal suite: 100 of the checker's seeds, spread over both profiles.
// The full 5,000 + the builder's 5,000: see `run.ts`.
it.each([1, 2])('check3 fast set, profile %i: no I1, I2, I3, I4 or wrong delete', async (profile) => {
  const r = await runSeeds(range((profile - 1) * 100000 + 1, 50, 50), profile)
  expect(r.bad).toEqual([])
}, 120_000)
