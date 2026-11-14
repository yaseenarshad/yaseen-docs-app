/**
 * The builder's driver for the model checker (YAZ-5083 round 3): runs seeds and returns the violations.
 *
 * The checker's own files (`model.ts`, `orders`, `seeds-*`, `skew`, `show`, `summary`) came from the review. The
 * fast set (`fast.test.ts`) runs in the normal suite. The full runs are slow, so `mobile/vitest.config.ts` keeps them
 * out unless `CHECK3_FULL=1`:
 *
 *   CHECK3_FULL=1 OUT=<folder> npx vitest run --maxWorkers=4 -c mobile/vitest.config.ts mobile/src/friends/check3
 *
 * That runs the checker's 5,000 seeds (`seeds-*`, a summary per part in OUT) and the builder's 5,000 new seeds
 * (`mine-*`, which fail on any violation). One seed: `SEED=<n> PROFILE=<1|2> CHECK3_FULL=1 npx vitest run ... check3/show`.
 */
import { runSeed } from './model.testing'

export interface SeedResult {
  runs: number
  bad: string[]
  /** Seeds with a violation, per invariant (YAZ-5083: I1 to I5 and I7; check3's world has no sends, so no I6). */
  count: Record<'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I7' | 'wrongDelete', number>
  listWrites: number
  doneButListed: number
  lostRemoveSeeds: number
}

/** Runs `seeds` with `profile`; a seed with any I1 to I4 or wrong delete goes in `bad` with its first finding. */
export async function runSeeds(seeds: number[], profile: number): Promise<SeedResult> {
  const out: SeedResult = { runs: 0, bad: [], count: { I1: 0, I2: 0, I3: 0, I4: 0, I5: 0, I7: 0, wrongDelete: 0 }, listWrites: 0, doneButListed: 0, lostRemoveSeeds: 0 }
  for (const s of seeds) {
    const m = await runSeed(s, profile)
    out.runs++
    out.doneButListed += m.st.doneButListed
    if (m.st.lostRemove > 0) out.lostRemoveSeeds++
    out.listWrites += m.st.listWrites
    const by = { I1: m.st.i1, I2: m.st.i2, I3: m.st.i3, I4: m.st.i4, I5: m.st.i5, I7: m.st.i7, wrongDelete: m.st.wrongDeletes }
    for (const [k, v] of Object.entries(by)) if (v.length > 0) out.count[k as keyof SeedResult['count']]++
    const first = Object.values(by).flat()[0]
    if (first !== undefined) out.bad.push(`seed ${s} profile ${profile}: ${first}`)
  }
  return out
}

export const range = (from: number, count: number, step = 1): number[] => Array.from({ length: count }, (_, i) => from + i * step)
