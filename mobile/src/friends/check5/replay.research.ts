import { it } from 'vitest'
import { noRealWaits } from '../check4/run4.testing'
import { KEYS5, runPlan5, violations5 } from './model5.testing'

noRealWaits()
const SEEDS = (process.env.C5_SEEDS ?? '').split(/[ ,]+/).filter(Boolean).map(Number)
const K = { pStale: Number(process.env.C5_STALE ?? 0.35), p502: Number(process.env.C5_502 ?? 0.02), pSecondary: Number(process.env.C5_SEC ?? 0.01), pContents404: Number(process.env.C5_C404 ?? 0) }
it('replay', async () => {
  const rows: string[] = []
  for (const s of SEEDS) {
    const m = await runPlan5(s, K, process.env.C5_CUT ? Number(process.env.C5_CUT) : undefined)
    const v = violations5(m)
    const hit = KEYS5.filter((k) => (v[k] ?? []).length > 0)
    rows.push(`${s}: ${hit.join(',') || 'clean'}${hit.length ? ' | ' + v[hit[0]][0].slice(0, 220) : ''}`)
    if (process.env.C5_LOG) console.log(m.log.join('\n'))
  }
  console.log('REPLAY ' + JSON.stringify(K) + '\n' + rows.join('\n'))
}, 3_600_000)
