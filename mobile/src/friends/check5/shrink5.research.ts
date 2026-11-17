import { it } from 'vitest'
import { noRealWaits } from '../check4/run4.testing'
import { plan5, runPlan5, violations5 } from './model5.testing'

noRealWaits()
const SEED = Number(process.env.C5_SEED)
const KEY = process.env.C5_KEY ?? 'I1done'
const K = { pStale: Number(process.env.C5_STALE ?? 0.05), p502: Number(process.env.C5_502 ?? 0.02), pSecondary: Number(process.env.C5_SEC ?? 0.01), pContents404: 0 }
const fails = async (keep: number[]) => {
  try {
    const m = await runPlan5(SEED, K, undefined, keep)
    return (violations5(m)[KEY] ?? []).length > 0 ? m : null
  } catch {
    return null
  }
}
it('shrink', async () => {
  const n = plan5(SEED).events.length
  let keep = Array.from({ length: n }, (_, i) => i)
  if (!(await fails(keep))) return console.log('SHRINK: does not fail')
  // Drop the tail first, then single events, until no single drop keeps the failure.
  while (keep.length > 1 && (await fails(keep.slice(0, -1)))) keep = keep.slice(0, -1)
  for (let changed = true; changed; ) {
    changed = false
    for (let i = keep.length - 1; i >= 0; i--) {
      const k2 = keep.filter((_, j) => j !== i)
      if (await fails(k2)) {
        keep = k2
        changed = true
      }
    }
  }
  const m = (await fails(keep))!
  console.log(`SHRINK seed ${SEED} ${KEY}: ${keep.length} events kept: ${JSON.stringify(keep.map((i) => plan5(SEED).events[i]))}\n${violations5(m)[KEY][0]}\n${m.log.join('\n')}`)
}, 3_600_000)
