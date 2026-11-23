import { it } from 'vitest'
import { plan, runPlan, violations } from './model4.testing'
const real = globalThis.setTimeout
globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => real(fn, ms === 1000 || ms === 2000 ? 0 : ms, ...a)) as typeof setTimeout
it('check4 one seed', async () => {
  const p = plan(Number(process.env.SEED ?? 7000001))
  const m = await runPlan(p)
  console.log(m.log.join('\n'))
  console.log(JSON.stringify({ v: violations(m), st4: { ...m.st4, i5: m.st4.i5.length, i6: m.st4.i6.length } }, null, 1))
}, 600_000)
