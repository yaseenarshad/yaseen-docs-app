import { it } from 'vitest'
import { plan, runPlan, violations } from './model4.testing'
const real = globalThis.setTimeout
globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => real(fn, ms === 1000 || ms === 2000 ? 0 : ms, ...a)) as typeof setTimeout
it('msgs', async () => {
  for (const s of (process.env.SEEDS ?? '').split(',').map(Number)) {
    const m = await runPlan(plan(s))
    const v = violations(m)[process.env.KEY ?? 'I2strict']
    console.log(`SEED ${s} :: ${[...new Set(v.map((x) => x.replace(/seed \d+ (step \d+|end): /, '').replace(/[0-9a-f]{6}/g, 'X')))].join(' | ')}`)
  }
}, 600_000)
