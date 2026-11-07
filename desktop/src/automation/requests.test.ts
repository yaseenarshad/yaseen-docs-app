import { describe, expect, it } from 'vitest'
import { AUTOMATION_LIMITS, AUTOMATION_VERSION, type AutomationRequest } from '@shared/automation'
import { RequestQueue } from './requests'

const request = (id: string, issuedAt = 100_000): AutomationRequest => ({ version: AUTOMATION_VERSION, session: 'test', token: 'test', id, issuedAt, command: 'file.patch', args: {} })
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('bounded requests', () => {
  it('runs four readers, queues 64, refuses overflow without running it, and drains before closing', async () => {
    const queue = new RequestQueue(() => 100_000)
    const gate = deferred()
    let calls = 0
    const work = Array.from({ length: 68 }, (_, i) => queue.submit(request(String(i)), Buffer.alloc(0), () => ({ writes: [], run: () => { calls++; return gate.promise } })))
    await tick()
    expect(calls).toBe(4)
    expect(queue.receipt('67').state).toBe('queued')
    expect(() => queue.submit(request('overflow'), Buffer.alloc(0), () => ({ writes: [], run: async () => calls++ }))).toThrow('queue is full')
    const closing = queue.close()
    expect(() => queue.submit(request('closed'), Buffer.alloc(0), () => ({ writes: [], run: async () => null }))).toThrow('stopping')
    gate.resolve('done')
    await Promise.all(work); await closing
    expect(calls).toBe(68)
  })

  it('serializes overlapping resources while unrelated work proceeds', async () => {
    const queue = new RequestQueue(() => 100_000), gate = deferred(), order: string[] = []
    const first = queue.submit(request('a'), Buffer.alloc(0), () => ({ writes: ['a'], run: async () => { order.push('first'); return gate.promise } }))
    const second = queue.submit(request('b'), Buffer.alloc(0), () => ({ writes: ['a', 'b'], run: async () => { order.push('second') } }))
    const third = queue.submit(request('c'), Buffer.alloc(0), () => ({ writes: ['b'], run: async () => { order.push('third') } }))
    const other = queue.submit(request('d'), Buffer.alloc(0), () => ({ writes: ['c'], run: async () => { order.push('other') } }))
    await other
    expect(order).toEqual(['first', 'other'])
    gate.resolve(null); await Promise.all([first, second, third])
    expect(order).toEqual(['first', 'other', 'second', 'third'])
  })

  it('deduplicates active and completed requests and refuses altered payloads', async () => {
    const queue = new RequestQueue(() => 100_000), gate = deferred()
    let calls = 0
    const prepare = () => ({ writes: [], run: () => { calls++; return gate.promise } })
    const first = queue.submit(request('same'), Buffer.from('body'), prepare)
    const again = queue.submit(request('same'), Buffer.from('body'), prepare)
    expect(again).toBe(first)
    expect(() => queue.submit(request('same'), Buffer.from('other'), prepare)).toThrow('different input')
    gate.resolve({ saved: true }); await first
    expect(await queue.submit(request('same'), Buffer.from('body'), prepare)).toEqual({ ok: true, value: { saved: true } })
    expect(calls).toBe(1)
  })

  it('bounds receipts, discards large results, and never replays expired or evicted writes', async () => {
    let now = 100_000
    const queue = new RequestQueue(() => now)
    const big = await queue.submit(request('big', now), Buffer.alloc(0), () => ({ writes: [], run: async () => 'x'.repeat(5000) }))
    expect(big.ok).toBe(true)
    expect(queue.receipt('big')).toMatchObject({ state: 'completed', resultRetained: false })
    for (let i = 0; i < AUTOMATION_LIMITS.receipts; i++) {
      now++
      await queue.submit(request(`small-${i}`, now), Buffer.alloc(0), () => ({ writes: [], run: async () => i }))
    }
    expect(queue.receipt('big').state).toBe('unknown')
    expect(() => queue.submit(request('big'), Buffer.alloc(0), () => ({ writes: [], run: async () => null }))).toThrow('receipt may have expired')
    now += AUTOMATION_LIMITS.receiptMs
    expect(queue.receipt('small-255').state).toBe('unknown')
    expect(() => queue.submit(request('small-255'), Buffer.alloc(0), () => ({ writes: [], run: async () => null }))).toThrow('outside the receipt window')
  })
})
