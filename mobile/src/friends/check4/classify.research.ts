import { it } from 'vitest'
import { readFileSync } from 'node:fs'
import { plan } from './model4.testing'
it('classify', () => {
  const se = JSON.parse(readFileSync(process.env.SEEDSFILE!, 'utf8')) as Record<string, number[]>
  for (const [k, v] of Object.entries(se)) {
    const old = v.filter((s) => plan(s).setup[5])
    console.log(k, 'seeds', v.length, 'with the old app', old.length, 'without', v.filter((s) => !plan(s).setup[5]).slice(0, 10).join(','))
  }
})
