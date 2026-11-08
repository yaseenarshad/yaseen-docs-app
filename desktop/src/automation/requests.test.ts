import { describe, expect, it, vi } from 'vitest'
import { AUTOMATION_LIMITS, AUTOMATION_VERSION, type AutomationRequest } from '@shared/automation'
import { CLOSE_WAIT_MS, RequestQueue } from './requests'

const request = (id: string, issuedAt = 100_000): AutomationRequest => ({ version: AUTOMATION_VERSION, session: 'test', token: 'test', id, issuedAt, command: 'file.patch', args: {} })
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('bounded requests', () => {
  it('runs four readers, queues 64, refuses overflow without running it, and drains before closing', async () => {
    const queue = new RequestQueue(() => 100_000)
    const gate = deferred()
    let calls = 0
    const work = Array.from({ length: 68 }, (_, i) => queue.submit(request(String(i)), () => ({ writes: [], run: () => { calls++; return gate.promise } })))
    await tick()
    expect(calls).toBe(4)
    expect(queue.receipt('67').state).toBe('queued')
    expect(() => queue.submit(request('overflow'), () => ({ writes: [], run: async () => calls++ }))).toThrow('queue is full')
    const closing = queue.close()
    expect(() => queue.submit(request('closed'), () => ({ writes: [], run: async () => null }))).toThrow('stopping')
    gate.resolve('done')
    await Promise.all(work); await closing
    expect(calls).toBe(68)
  })

  it('serializes overlapping resources while unrelated work proceeds', async () => {
    const queue = new RequestQueue(() => 100_000), gate = deferred(), order: string[] = []
    const first = queue.submit(request('a'), () => ({ writes: ['a'], run: async () => { order.push('first'); return gate.promise } }))
    const second = queue.submit(request('b'), () => ({ writes: ['a', 'b'], run: async () => { order.push('second') } }))
    const third = queue.submit(request('c'), () => ({ writes: ['b'], run: async () => { order.push('third') } }))
    const other = queue.submit(request('d'), () => ({ writes: ['c'], run: async () => { order.push('other') } }))
    await other
    expect(order).toEqual(['first', 'other'])
    gate.resolve(null); await Promise.all([first, second, third])
    expect(order).toEqual(['first', 'other', 'second', 'third'])
  })

  it('deduplicates active and completed requests and refuses altered payloads', async () => {
    const queue = new RequestQueue(() => 100_000), gate = deferred()
    let calls = 0
    const prepare = () => ({ writes: [], run: () => { calls++; return gate.promise } })
    const first = queue.submit(request('same'), prepare)
    const again = queue.submit(request('same'), prepare)
    expect(again).toBe(first)
    expect(() => queue.submit({ ...request('same'), args: { root: '/other' } }, prepare)).toThrow('different input')
    gate.resolve({ saved: true }); await first
    expect(await queue.submit(request('same'), prepare)).toEqual({ ok: true, value: { saved: true } })
    expect(calls).toBe(1)
  })

  it('bounds receipts, keeps no large result, and never replays expired or evicted writes', async () => {
    let now = 100_000
    const queue = new RequestQueue(() => now)
    const big = await queue.submit(request('big', now), () => ({ writes: [], run: async () => 'x'.repeat(5000) }))
    expect(big.ok).toBe(true)
    expect(queue.receipt('big')).toMatchObject({ state: 'completed', resultRetained: false })
    for (let i = 0; i < AUTOMATION_LIMITS.receipts; i++) {
      now++
      await queue.submit(request(`small-${i}`, now), () => ({ writes: [], run: async () => i }))
    }
    expect(queue.receipt('big').state).toBe('unknown')
    expect(() => queue.submit(request('big'), () => ({ writes: [], run: async () => null }))).toThrow('receipt may have expired')
    now += AUTOMATION_LIMITS.receiptMs
    expect(queue.receipt('small-255').state).toBe('unknown')
    expect(() => queue.submit(request('small-255'), () => ({ writes: [], run: async () => null }))).toThrow('outside the receipt window')
  })
  it('reports an invalid result and drains after it', async () => {
    const queue = new RequestQueue(() => 100_000)
    const circular: Record<string, unknown> = {}; circular.self = circular
    expect(await queue.submit(request('invalid'), () => ({ writes: ['file'], run: async () => circular }))).toMatchObject({ ok: false, error: { code: 'INVALID_RESULT' } })
    expect(await queue.submit(request('after'), () => ({ writes: ['file'], run: async () => 'later' }))).toEqual({ ok: true, value: 'later' })
    await queue.close()
  })

  it('lets a bare key cover its family and a vault key cover the vaults inside it', async () => {
    const queue = new RequestQueue(() => 100_000), gate = deferred(), order: string[] = []
    const submit = (id: string, writes: string[], wait?: Promise<unknown>) => queue.submit(request(id), () => ({ writes, run: async () => { order.push(id); return wait } }))
    const first = submit('vault', ['documents:/v'], gate.promise)
    await Promise.all([submit('other', ['documents:/w']), submit('sibling', ['documents:/vault']), submit('window', ['window:w1'])])
    const later = [submit('inner', ['documents:/v/inner']), submit('every', ['documents'])]
    await tick()
    expect(order).toEqual(['vault', 'other', 'sibling', 'window'])
    gate.resolve(null); await Promise.all([first, ...later])
    expect(order.slice(4)).toEqual(['inner', 'every'])
  })

  it('refuses new work at once on close and stops waiting for unfinished work after the close limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const queue = new RequestQueue(() => 100_000)
      void queue.submit(request('endless'), () => ({ writes: ['icon-packs'], run: () => new Promise(() => {}) }))
      let closed = false
      const closing = queue.close().then(() => { closed = true })
      expect(() => queue.submit(request('late'), () => ({ writes: [], run: async () => null }))).toThrow('stopping')
      await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS - 1)
      expect(closed).toBe(false)
      await vi.advanceTimersByTimeAsync(1); await closing
      expect(closed).toBe(true)
    } finally { vi.useRealTimers() }
  })
})
