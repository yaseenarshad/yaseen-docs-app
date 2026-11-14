import { it } from 'vitest'
import { Model, type Ev } from './model.testing'
it('skew', async () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const m = new Model(seed)
    m.skew = { A0: -7 * 60_000, A1: 0, A2: 9 * 60_000 }
    await m.setup(3, 1, 1, false)
    const newest = (to: 'A' | 'B', from: 'A' | 'B') => (mm: Model) => mm.inbox[to].filter((x) => x.from === from).at(-1)?.id
    const evs: Ev[] = [
      { t: 'share', who: 'A', arg: 2 }, { t: 'paste', who: 'B', sel: newest('B', 'A'), arg: 9 }, { t: 'paste', who: 'A', sel: newest('A', 'B'), arg: 9 },
      { t: 'budget', who: 'A', arg: 1 }, { t: 'removeB', who: 'A' }, { t: 'time', arg: 61 * 60_000 },
      { t: 'par', par: [{ t: 'rows', who: 'A', dev: 0 }, { t: 'rows', who: 'A', dev: 1 }, { t: 'rows', who: 'A', dev: 2 }] },
      { t: 'rows', who: 'C' }, { t: 'rows', who: 'A' },
    ]
    for (const e of evs) await m.run(e)
    const l = m.listOf('A')!
    const nums = m.world.owned('ali').filter((g) => 'notecards-stats.json' in g.files && !m.foreign.includes(g.id)).map((g) => g.id)
    const kept = l.index.friends.map((f) => JSON.parse(m.gist(f.mine)!.files['notecards-pointer.json']).stats)
    console.log(seed, 'numbers gists', nums.length, 'list names it', nums[0] === l.index.stats, 'kept pointers on it', kept.every((s) => s === l.index.stats), 'I1', m.st.i1.length, 'I2', m.st.i2.length, 'wrong deletes', m.st.wrongDeletes.length, 'rekey', !!l.raw.rekey)
  }
}, 600000)
