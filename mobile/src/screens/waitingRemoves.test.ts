import { describe, expect, it } from 'vitest'
import { deviceZone as friendsDeviceZone, isTimeZone as friendsIsTimeZone } from '@shared/friendStats'
import { deviceZone, isTimeZone } from '@shared/timeZone'
import { enqueueRemove, loadQueue, REMOVE_QUEUE } from '../friends/removeQueue'
import { memoryBackend, openVaultStore, PHONE } from '../store'
import { WAITING_REMOVES } from '../friends/list'
import { REMOVE_QUEUE_KEY, WAITING_REMOVES_KEY, waitingRemoves } from './waitingRemoves'

/**
 * YAZ-5362, YAZ-5377: Settings (in the first load) reads two small things that the friends code owns, with no import of
 * the friends code. These tests hold the two copies together: if the friends code changes its queue or its zone helpers,
 * a test here fails.
 */
describe('the erase ask counts the waiting removes with no friends code (YAZ-5362)', () => {
  it('reads the same key and the same count as the friends queue', async () => {
    expect(REMOVE_QUEUE_KEY).toBe(REMOVE_QUEUE)
    const store = await openVaultStore(memoryBackend())
    expect(await waitingRemoves(store)).toBe(0)
    await enqueueRemove(store, { mine: 'a', at: 1 })
    await enqueueRemove(store, { mine: 'b', drop: ['g'], at: 2 })
    expect(await waitingRemoves(store)).toBe((await loadQueue(store)).length)
    expect(await waitingRemoves(store)).toBe(2)
  })

  it('a broken queue counts 0, as loadQueue reads it', async () => {
    const store = await openVaultStore(memoryBackend())
    await store.setState(PHONE, REMOVE_QUEUE_KEY, { not: 'a list' })
    expect(await waitingRemoves(store)).toBe(0)
    expect(await loadQueue(store)).toEqual([])
  })
})

describe('YAZ-5361: the erase ask also counts a remove that waits in the list on GitHub (the saga state)', () => {
  it('reads the count that the friends list keeps (same key), and adds the queue', async () => {
    expect(WAITING_REMOVES_KEY).toBe(WAITING_REMOVES)
    const store = await openVaultStore(memoryBackend())
    await store.setState(PHONE, WAITING_REMOVES_KEY, 1)
    expect(await waitingRemoves(store)).toBe(1)
    await enqueueRemove(store, { mine: 'a', at: 1 })
    expect(await waitingRemoves(store)).toBe(2)
    await store.setState(PHONE, WAITING_REMOVES_KEY, 'x')
    expect(await waitingRemoves(store)).toBe(1)
  })
})

describe('the time zone helpers of Settings equal the friends stats helpers (YAZ-5377)', () => {
  it('give the same answers', () => {
    expect(deviceZone()).toBe(friendsDeviceZone())
    for (const z of ['Europe/London', 'America/Denver', 'UTC', 'Not/AZone', '', 'x'.repeat(65), 5, null, undefined]) {
      expect(isTimeZone(z)).toBe(friendsIsTimeZone(z))
    }
  })
})
