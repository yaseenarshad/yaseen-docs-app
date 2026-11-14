import { it } from 'vitest'
import { POINTER_FILE } from '@shared/friendGists'
import { runScript, type Ev, type Model } from './model.testing'

const newest = (to: 'A' | 'B' | 'C', from: 'A' | 'B' | 'C') => (m: Model) => m.inbox[to].filter((x) => x.from === from).at(-1)?.id
const first = (to: 'A' | 'B' | 'C', from: 'A' | 'B' | 'C') => (m: Model) => m.inbox[to].find((x) => x.from === from)?.id
const nth = (to: 'A' | 'B' | 'C', from: 'A' | 'B' | 'C', i: number) => (m: Model) => m.inbox[to].filter((x) => x.from === from)[i]?.id

const E = {
  shareAB: (dev = 0): Ev => ({ t: 'share', who: 'A', dev, arg: 2 }),
  shareAC: (dev = 0): Ev => ({ t: 'share', who: 'A', dev, arg: 1 }),
  shareB: (dev = 0): Ev => ({ t: 'share', who: 'B', dev }),
  paste: (who: 'A' | 'B' | 'C', sel: (m: Model) => string | undefined, dev = 0, back = true): Ev => ({ t: 'paste', who, dev, sel, arg: back ? 9 : 8 }),
  rows: (who: 'A' | 'B' | 'C', dev = 0): Ev => ({ t: 'rows', who, dev }),
  removeB: (dev = 0): Ev => ({ t: 'removeB', who: 'A', dev }),
  removeA: (dev = 0): Ev => ({ t: 'removeA', who: 'B', dev }),
  cancel: (dev = 0): Ev => ({ t: 'cancel', who: 'A', dev }),
  budget: (left: number, dev = 0): Ev => ({ t: 'budget', who: 'A', dev, arg: left }),
  offline: (who: 'A' | 'B' | 'C', dev = 0): Ev => ({ t: 'offlineLong', who, dev }),
  online: (who: 'A' | 'B' | 'C', dev = 0): Ev => ({ t: 'online', who, dev }),
  rate: (who: 'A' | 'B' = 'A'): Ev => ({ t: 'ratelimit', who }),
  hour: (): Ev => ({ t: 'time', arg: 61 * 60_000 }),
  crashAt: (who: 'A' | 'B' | 'C', n: number, dev = 0): Ev => ({ t: 'crashAt', who, dev, arg: n }),
  restart: (who: 'A' | 'B' | 'C', dev = 0): Ev => ({ t: 'restart', who, dev }),
  par: (...evs: Ev[]): Ev => ({ t: 'par', par: evs }),
}
/** A and B paired (A shares, B pastes and sends back, A pastes), both rows read. */
const PAIR: Ev[] = [E.shareAB(), E.paste('B', newest('B', 'A')), E.paste('A', newest('A', 'B')), E.rows('A'), E.rows('B')]
const END: Ev[] = [E.online('A'), E.online('A', 1), E.online('A', 2), E.hour(), E.rows('A'), E.rows('A', 1), E.rows('B'), E.rows('C'), E.rows('A'), E.rows('B'), E.rows('C')]

interface Order {
  name: string
  setup?: [number, number, number, boolean]
  evs: Ev[]
}
const ORDERS: Order[] = [
  { name: '1 R2 path 1: both share first, both paste, A removes B while both say Waiting', evs: [E.shareAB(), E.shareB(), E.paste('A', newest('A', 'B'), 0, false), E.paste('B', newest('B', 'A'), 0, false), E.removeB(), E.rows('B'), ...END] },
  { name: '2 R2 path 2: B heals, B removes A first, A removes B later', evs: [E.shareAB(), E.shareB(), E.paste('A', newest('A', 'B')), E.paste('B', first('B', 'A'), 0, false), E.paste('B', newest('B', 'A'), 0, false), E.removeA(), E.rows('A'), E.removeB(), ...END] },
  { name: '3 a link sent and never pasted; A removes (cancels) it; B pastes later', evs: [E.shareAB(), E.shareAC(), E.removeB(), E.paste('B', newest('B', 'A')), ...END] },
  { name: '4 NEW: A cancels a link, the hour runs out mid re-key, B (kept) reads, A removes B', setup: [1, 1, 1, true], evs: [...PAIR, E.shareAC(), E.budget(5), E.cancel(), E.rows('B'), E.removeB(), ...END] },
  { name: '5 YAZ-5275: remove queued offline, B shares a NEW link, A pastes it', evs: [...PAIR, E.offline('A'), E.removeB(), E.online('A'), E.shareB(), E.paste('A', newest('A', 'B')), E.rows('A'), ...END] },
  { name: '6 YAZ-5275: remove queued offline, A pastes B`s OLD link', evs: [...PAIR, E.offline('A'), E.removeB(), E.online('A'), E.paste('A', first('A', 'B')), E.rows('A'), ...END] },
  { name: '7 YAZ-5275: remove half done (budget: pointer deleted, no new gist), A pastes B`s OLD link', evs: [...PAIR, E.budget(1), E.removeB(), E.paste('A', first('A', 'B')), E.rows('B'), ...END] },
  { name: '8 YAZ-5275: remove half done, B shares a NEW link, A pastes it', evs: [...PAIR, E.budget(1), E.removeB(), E.shareB(), E.paste('A', newest('A', 'B')), E.rows('B'), E.paste('B', newest('B', 'A')), ...END] },
  { name: '9 YAZ-5275: remove done, A pastes B`s OLD link (re-add)', evs: [...PAIR, E.removeB(), E.paste('A', first('A', 'B')), E.paste('B', newest('B', 'A')), ...END] },
  { name: '10 YAZ-5275: remove queued, A pastes B`s new link while still offline', evs: [...PAIR, E.offline('A'), E.removeB(), E.shareB(), E.paste('A', newest('A', 'B')), ...END] },
  { name: '11 YAZ-5275: remove queued, app restarted, A pastes B`s new link', evs: [...PAIR, E.offline('A'), E.removeB(), E.online('A'), E.restart('A'), E.shareB(), E.paste('A', newest('A', 'B')), E.rows('A'), ...END] },
  { name: '12 both remove at once (A removes B || B removes A)', evs: [...PAIR, E.par(E.removeB(), E.removeA()), ...END] },
  { name: '13 two A devices finish one waiting remove at once', setup: [2, 1, 1, false], evs: [...PAIR, E.offline('A'), E.removeB(), E.online('A'), E.par(E.rows('A', 0), E.rows('A', 1)), ...END] },
  { name: '14 three A devices finish one remove at once, clock skew', setup: [3, 1, 1, false], evs: [...PAIR, E.budget(1), E.removeB(), E.hour(), E.par(E.rows('A', 0), E.rows('A', 1), E.rows('A', 2)), ...END] },
  { name: '15 NEW: C (paired) pastes a new link of A; A removes B before A`s rows run', evs: [...PAIR, E.shareAC(), E.paste('C', newest('C', 'A')), E.removeB(), ...END] },
  { name: '16 NEW: A removes B offline (queued); C pastes a new link of A; A opens the rows (drain first)', evs: [...PAIR, E.offline('A'), E.removeB(), E.shareAC(1), E.paste('C', newest('C', 'A')), E.online('A'), E.rows('A'), ...END], setup: [2, 1, 1, false] },
  { name: '17 C re-pastes its FIRST (stale) A link; A removes B', evs: [...PAIR, E.paste('C', first('C', 'A')), E.removeB(), ...END] },
  { name: '18 stopped link, B re-shares, A re-adds, A removes B again, B pastes every old link', evs: [E.shareAB(), E.paste('B', newest('B', 'A')), E.shareAC(), E.removeB(), E.rows('B'), E.shareB(), E.paste('A', newest('A', 'B')), E.paste('B', newest('B', 'A')), E.rows('A'), E.removeB(), E.paste('B', nth('B', 'A', 0)), E.paste('B', nth('B', 'A', 1)), E.paste('B', nth('B', 'A', 2)), ...END] },
  { name: '19 GitHub refuses the first write (rate limit): queued; B reads; then done', evs: [...PAIR, E.rate(), E.removeB(), E.rows('B'), E.rows('A'), ...END] },
  { name: '20 A pastes B`s link twice on two devices at once, then removes B', setup: [2, 1, 1, false], evs: [E.shareAB(), E.paste('B', newest('B', 'A')), E.par(E.paste('A', newest('A', 'B'), 0), E.paste('A', newest('A', 'B'), 1)), E.rows('A'), E.rows('B'), E.removeB(), ...END] },
]

function finalState(m: Model): string {
  const l = m.listOf('A')!
  const b = m.bEntries()
  const cur = l.index.stats
  const bState = b.length === 0 ? 'B removed' : b.map((e) => `B listed (mine ${e.mine.slice(0, 6)} ${m.gist(e.mine) ? ((JSON.parse(m.gist(e.mine)!.files[POINTER_FILE]) as { stats: string }).stats === cur ? 'names CURRENT' : 'names OLD') : 'GONE'})`).join(';')
  const nNumbers = m.world.owned('ali').filter((g) => 'notecards-stats.json' in g.files && !m.foreign.includes(g.id)).length
  return `${bState}; A numbers gists: ${nNumbers}; rekey: ${l.raw.rekey ? 'waiting' : 'none'}`
}

it('check3: the 20 nastiest orders, then a crash at every call of a remove and of a paste-back', async () => {
  const out: string[] = []
  for (const o of ORDERS) {
    const m = await runScript(7, o.setup ?? [1, 1, 1, false], o.evs)
    const pastes = m.log.filter((x) => / paste A/.test(x)).map((x) => x.replace(/^\s*\d+ paste /, '')).join(' | ')
    out.push(`${o.name}\n   I1 ${m.st.i1.length}  I2 ${m.st.i2.length}  I3 ${m.st.i3.length}  I4 ${m.st.i4.length}  done-but-listed ${m.st.doneButListed}  | end: ${finalState(m)}${pastes ? `\n   A pastes: ${pastes}` : ''}${m.st.i1[0] ? `\n   ${m.st.i1[0]}` : ''}${m.st.i2[0] ? `\n   ${m.st.i2[0]}` : ''}`)
  }
  // A crash (app closed) at each call of the remove, and at each call of a paste-back during a half-done remove.
  const crashes: Record<string, number[]> = { i1: [], i2: [], i3: [], notRemoved: [], twoNumbers: [] }
  for (let k = 1; k <= 45; k++) {
    for (const after of [false, true]) {
      const m = await runScript(100 + k * 2 + (after ? 1 : 0), [1, 1, 1, true], [...PAIR, E.shareAC(), E.crashAt('A', k), E.removeB(), E.removeB(), ...END])
      if (m.st.i1.length) crashes.i1.push(k)
      if (m.st.i2.length) crashes.i2.push(k)
      if (m.st.i3.length) crashes.i3.push(k)
      if (m.bEntries().length > 0) crashes.notRemoved.push(k)
      if (m.world.owned('ali').filter((g) => 'notecards-stats.json' in g.files && !m.foreign.includes(g.id)).length !== 1) crashes.twoNumbers.push(k)
    }
  }
  const pb: Record<string, number[]> = { i1: [], i2: [], oldForever: [] }
  for (let k = 1; k <= 30; k++) {
    const m = await runScript(500 + k, [1, 1, 1, false], [...PAIR, E.budget(1), E.removeB(), E.shareB(), E.crashAt('A', k), E.paste('A', newest('A', 'B')), ...END])
    if (m.st.i1.length) pb.i1.push(k)
    if (m.st.i2.length) pb.i2.push(k)
    if (finalState(m).includes('names OLD') || finalState(m).includes('GONE')) pb.oldForever.push(k)
  }
  console.log(out.join('\n') + `\nCRASH IN REMOVE (k = call number, 90 runs): ${JSON.stringify(crashes)}\nCRASH IN PASTE-BACK (30 runs): ${JSON.stringify(pb)}`)
}, 600000)

it('check3: YAZ-5275 matrix: [queued | half done | done] x [old link | new link] x [online | offline | restarted]', async () => {
  const lines: string[] = []
  const stage: Record<string, Ev[]> = {
    queued: [E.offline('A'), E.removeB(), E.online('A')],
    half: [E.budget(1), E.removeB()],
    done: [E.removeB()],
  }
  for (const [sn, st] of Object.entries(stage))
    for (const link of ['old', 'new'])
      for (const net of ['online', 'offline', 'restarted']) {
        const pre: Ev[] = net === 'offline' ? [E.offline('A')] : net === 'restarted' ? [E.restart('A')] : []
        const m = await runScript(900, [1, 1, 1, false], [...PAIR, ...st, E.shareB(), ...pre, E.paste('A', link === 'old' ? first('A', 'B') : newest('A', 'B')), E.rows('A'), ...END])
        const paste = m.log.filter((x) => / paste A/.test(x)).at(-1)?.replace(/^\s*\d+ paste /, '') ?? ''
        const end = finalState(m)
        const ok = end.startsWith('B removed') ? !/-> (added|already)/.test(paste) : !end.includes('OLD') && !end.includes('GONE')
        lines.push(`${ok ? 'ok ' : 'BAD'} ${sn.padEnd(6)} ${link} ${net.padEnd(9)} paste: ${paste.padEnd(40)} end: ${end}  I1 ${m.st.i1.length}`)
      }
  console.log(lines.join('\n'))
}, 600000)
