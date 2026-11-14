// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { saveAccount } from '../../auth/account'
import { mount, newPhone, NOW, type Harness } from '../../screens/testing'
import { saveVaultList, vaultId } from '../../store'
import { boardRows, PERIODS, vsBoard, type BoardEntry } from './board'
import { demoBoard, demoFriend, demoGroup, demoMe, fakeService, fakeServices } from './demo'

/**
 * YAZ-5085: 30 friends and 5 groups, each friend with 90 days. The screens' own work (the rules of `board.ts` for each
 * period and "You vs") must stay far under one long task (50 ms). It is timed by itself, not as the wall clock of the
 * whole test run (the machine can be under load).
 */
const days = (seed: number): [number, { cards: number; seconds: number; done: boolean; newCards: number; remembered: number; forgot: number }][] =>
  Array.from({ length: 90 }, (_, i) => [
    -i,
    { cards: (seed * 7 + i * 3) % 60, seconds: ((seed + i) % 50) * 60, done: (seed + i) % 3 !== 0, newCards: i % 5, remembered: 20, forgot: 2 },
  ])
const BIG = (() => {
  const friends = Array.from({ length: 30 }, (_, i) => demoFriend(NOW, `Friend ${i + 1}`, { days: days(i) }))
  const groups = Array.from({ length: 5 }, (_, g) => {
    const v = demoGroup(NOW, { group: String(g + 1).repeat(32), name: `Group ${g + 1}` })
    return {
      ...v,
      members: [
        ...v.members,
        ...friends
          .slice(0, 6)
          .map((f, k) => ({
            ...v.members[1],
            login: `m${k}`,
            name: f.name,
            pointer: `${g}${k}`.padEnd(32, 'f'),
            read: { kind: 'ok' as const, stats: f.stats!, pointer: { v: 1 as const, stats: 'a'.repeat(32) }, updatedAt: NOW },
          })),
      ],
    }
  })
  return demoBoard(NOW, { friends, groups })
})()

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
})

describe('30 friends and 5 groups', () => {
  it('the rules of one screen take far less than 50 ms', () => {
    const entries: BoardEntry[] = [
      { key: 'me', name: 'You', you: true, stats: demoMe(NOW).stats },
      ...BIG.friends.map((f) => ({ key: f.theirs, name: f.name, you: false, stats: f.stats })),
    ]
    let worst = 0
    for (let run = 0; run < 20; run++) {
      const t = performance.now()
      for (const p of PERIODS) boardRows(entries, p.id, NOW)
      for (const f of BIG.friends) vsBoard(BIG.me.stats, f.stats, NOW)
      worst = Math.max(worst, performance.now() - t)
    }
    console.info(`[perf] 4 periods x 31 rows + 30 "You vs": worst ${worst.toFixed(2)} ms of 20 runs`)
    expect(worst).toBeLessThan(50)
  })

  it('draws them all; a change of period redraws without a long task of our own', async () => {
    const p = await newPhone()
    const v = { repo: 'demo/vault', branch: 'main', addedAt: 1 }
    await p.tokens.write(vaultId(v), 'github_pat_11PERF0' + 'f'.repeat(76))
    await saveAccount(p.store, vaultId(v), { login: 'demo', name: 'Demo', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 })
    await saveVaultList(p.store, { vaults: [v], open: vaultId(v) })
    const s = fakeService(BIG)
    h = await mount({ phone: p, friends: (store) => fakeServices(store, s) })
    for (let i = 0; i < 50 && h.host.querySelector('section[aria-label="Friends"]:not([aria-busy])') === null; i++) await h.settle()
    expect(h.host.querySelectorAll('.fr-row')).toHaveLength(31)
    expect(h.host.querySelectorAll('.fr-pill')).toHaveLength(7)
    const times: number[] = []
    for (const name of ['Yesterday', 'Week', 'Month', 'Today']) {
      const button = h.button(name)!
      const t = performance.now()
      await act(async () => button.click())
      times.push(performance.now() - t)
    }
    console.info(`[perf] period change, 31 rows, jsdom: ${times.map((t) => t.toFixed(1)).join(', ')} ms`)
    // jsdom is many times slower than Safari; this bound only catches a gross regression.
    expect(Math.min(...times)).toBeLessThan(250)
    await h.click('Group 1')
    expect(h.host.querySelectorAll('.fr-row')).toHaveLength(9)
  })
})
