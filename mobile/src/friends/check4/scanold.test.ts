import { it } from 'vitest'
import { plan, runPlan } from './model4.testing'
const real = globalThis.setTimeout
globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => real(fn, ms === 1000 || ms === 2000 ? 0 : ms, ...a)) as typeof setTimeout
it('scan old', async () => {
  const hits: string[] = []
  for (let s = Number(process.env.FROM ?? 7100001); s < Number(process.env.FROM ?? 7100001) + Number(process.env.COUNT ?? 300); s++) {
    const p = plan(s)
    if (!p.setup[5]) continue
    const m = await runPlan(p)
    if (m.st4.oldHeadOverV2 > 0) hits.push(`${s}: over ${m.st4.oldHeadOverV2}, writes ${m.st4.oldWrites}, zoneLost ${m.st4.zoneLost.length}\n    ${m.log.filter((x) => /OLD/.test(x)).slice(0, 12).join('\n    ')}`)
  }
  console.log(hits.join('\n'))
}, 600_000)
