import { expect, it, vi } from 'vitest'
import { fakeGistWorld } from '@shared/friendGistsFake'
import { githubClient } from '../../github/client'
import { gistsApi } from '../gistsApi'
import { gistsFetch } from '../testing'

// CHECKER round 9 (YAZ-5055 friends). Made-up data, the strict fake; no real GitHub call.
const TOKEN = 'github_pat_11FRIENDSTEST_0000000000000000000000000000000000000000000000000000000000000'
const G1 = '1'.repeat(32) // an older generation (a stale read on phone Y)
const G2 = '2'.repeat(32) // the newest generation (phone X's remove just made it)

it('R9-1 (seed 9302825, the mechanism): two phones PATCH one pointer at the same moment; the LOSER of the 409 resends its stale body 1 s later and wins: the pointer names the OLDER generation', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  try {
    const world = fakeGistWorld({ accounts: { [TOKEN]: { login: 'ali' } }, start: Date.parse('2026-11-15T06:00:00Z') })
    const http = gistsFetch(world)
    const phone = () => gistsApi(githubClient(TOKEN, { fetch: http.fetch, now: world.now }))
    const ptr = world.seed('ali', { 'notecards-pointer.json': JSON.stringify({ v: 1, stats: G1 }) })
    const [x, y] = [phone(), phone()]
    // X moves the pointer to the newest generation; Y (a settle from an older read) writes the older one at the same moment.
    const wx = x.update(ptr, { 'notecards-pointer.json': JSON.stringify({ v: 1, stats: G2 }) })
    const wy = y.update(ptr, { 'notecards-pointer.json': JSON.stringify({ v: 1, stats: G1 }) })
    await vi.runAllTimersAsync()
    await Promise.all([wx, wy])
    const final = JSON.parse(world.text(ptr, 'notecards-pointer.json')!)
    console.log('R9-1', JSON.stringify({ refused: world.refused.length, final: final.stats === G2 ? 'newest' : 'older' }))
    expect(world.refused.length).toBeGreaterThan(0)
    // The requirement: a write that lost a race is never sent again blind over a newer one.
    expect(final.stats).toBe(G2)
  } finally {
    vi.useRealTimers()
  }
})
