/**
 * The one rule for a timing budget in the `perf` project (YAZ-3328): time a run several times and
 * hold the budget to the MEDIAN. One timed run, or the mean of many, fails on a single GC pause or a
 * stalled CI runner: one save measured 0.5 ms as a median and 29 ms at its worst in the same test,
 * and a 2 ms budget on the mean of 100 failed on `main`. A real regression slows most runs, so the
 * median still catches it. Only a cold first call (nothing cached yet) is timed once, by nature,
 * and it keeps a wide budget.
 */
export const median = (ms: readonly number[]): number => [...ms].sort((a, b) => a - b)[ms.length >> 1]

/**
 * Times `run(0)` … `run(runs - 1)` one by one; `worst` is for the log. The caller warms up first when
 * the first call pays the JIT, and builds each run's input before it when a run must not reuse one.
 */
export function timeMedian<T>(runs: number, run: (i: number) => T): { median: number; worst: number; result: T } {
  const ms: number[] = []
  let result!: T
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    result = run(i)
    ms.push(performance.now() - start)
  }
  return { median: median(ms), worst: Math.max(...ms), result }
}
