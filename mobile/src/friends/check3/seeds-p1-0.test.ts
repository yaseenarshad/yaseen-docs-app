import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { runSeed, type Model } from './model.testing'
import { summarize } from './summary'
it('model profile 1 part 0', async () => {
  const ms: Model[] = []
  const base = (1 - 1) * 100000 + 0 * 500
  for (let s = base + 1; s <= base + 500; s++) {
    const m = await runSeed(s, 1)
    m.log = []
    ms.push({ seed: m.seed, st: m.st, group: m.group } as Model)
  }
  writeFileSync((process.env.OUT ?? '.') + '/p1-0.json', JSON.stringify(summarize(ms), null, 1))
}, 1200000)
