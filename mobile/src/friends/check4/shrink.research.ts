import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { researchOut } from '../researchOut.testing'
import { plan, runPlan, violations, type Plan } from './model4.testing'
const real = globalThis.setTimeout
globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => real(fn, ms === 1000 || ms === 2000 ? 0 : ms, ...a)) as typeof setTimeout

const KEY = process.env.KEY ?? 'I1'
const MATCH = process.env.MATCH ?? ''
async function fails(p: Plan): Promise<string | null> {
  try {
    const m = await runPlan(p)
    const v = (violations(m)[KEY] ?? []).find((x) => x.includes(MATCH))
    return v ?? null
  } catch {
    return null
  }
}
it('check4 shrink', async () => {
  const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number)
  const out: string[] = []
  for (const seed of seeds) {
    let p = plan(seed)
    const first = await fails(p)
    if (first === null) {
      out.push(`seed ${seed}: does not fail on ${KEY}`)
      continue
    }
    // ddmin over the events (the internal randomness stays on the same seed).
    let n = 2
    while (p.events.length >= 2) {
      const size = Math.ceil(p.events.length / n)
      let cut = false
      for (let i = 0; i < p.events.length; i += size) {
        const q = { ...p, events: [...p.events.slice(0, i), ...p.events.slice(i + size)] }
        if ((await fails(q)) !== null) {
          p = q
          n = Math.max(n - 1, 2)
          cut = true
          break
        }
      }
      if (!cut) {
        if (n >= p.events.length) break
        n = Math.min(n * 2, p.events.length)
      }
    }
    // Try smaller setups too.
    for (const s of [[1, 1, 1], [2, 1, 1], [1, 2, 1], [1, 1, 2]] as const) {
      const q = { ...p, setup: [s[0], s[1], s[2], p.setup[3], p.setup[4]] as Plan['setup'] }
      if ((await fails(q)) !== null) {
        p = q
        break
      }
    }
    const m = await runPlan(p)
    out.push(`seed ${seed} ${KEY}: ${p.events.length} events, setup ${JSON.stringify(p.setup)}\n  ${(await fails(p)) ?? ''}\n  events ${JSON.stringify(p.events)}\n  ${m.log.join('\n  ')}`)
  }
  writeFileSync(`${researchOut()}/shrink-${KEY}-${seeds[0] ?? 0}.txt`, out.join('\n\n'))
}, 3_600_000)
