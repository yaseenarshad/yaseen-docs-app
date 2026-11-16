import { it } from 'vitest'
import { runSeed } from './model.testing'
it('show', async () => {
  const m = await runSeed(Number(process.env.SEED), Number(process.env.PROFILE ?? 1))
  console.log(m.log.join('\n'))
  console.log(JSON.stringify({ i1: m.st.i1, i2: m.st.i2.slice(0, 2), i3: m.st.i3.slice(0, 2), i4: m.st.i4.slice(0, 4) }, null, 1))
}, 600000)
