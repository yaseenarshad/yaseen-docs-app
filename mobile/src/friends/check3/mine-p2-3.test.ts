import { expect, it } from 'vitest'
import { range, runSeeds } from './run'

// The builder's own seeds (YAZ-5083 round 3), new to the checker: profile 2, part 3 of 5 (500 seeds). Full runs only.
it('check3 builder seeds, profile 2 part 3', async () => {
  const r = await runSeeds(range(200000 + 100000 + 3 * 500 + 1, 500), 2)
  console.log(JSON.stringify({ profile: 2, part: 3, ...r, bad: r.bad.slice(0, 5) }))
  expect(r.bad).toEqual([])
}, 1_200_000)
