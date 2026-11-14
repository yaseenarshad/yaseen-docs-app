/**
 * YAZ-5086 (round 13, item 7): when the Mac tries a send. A file with cards changed (a review on the Mac, or a pull
 * by GitHub AutoSync), after a quiet moment; a page with no cards never starts one. No timer that runs on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchEvent } from '@shared/types'
import { CARD_CHANGE_QUIET_MS, watchCardFiles } from './cardTrigger'

let listeners: Map<string, (ev: WatchEvent) => void>
let cards: Map<string, Set<string>>
let roots: string[]
let onRoots: (() => void) | null
const fire = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  listeners = new Map()
  cards = new Map([['/v', new Set(['/v/cards.md'])]])
  roots = ['/v']
  onRoots = null
  fire.mockClear()
})
afterEach(() => vi.useRealTimers())

function start() {
  return watchCardFiles({
    roots: () => roots,
    onRootsChange: (cb) => {
      onRoots = cb
      return () => (onRoots = null)
    },
    subscribe: (root, listener) => {
      listeners.set(root, listener)
      return () => listeners.delete(root)
    },
    cardPaths: async (root) => new Set(cards.get(root) ?? []),
    fire,
  })
}
const settle = async () => {
  await vi.advanceTimersByTimeAsync(CARD_CHANGE_QUIET_MS)
  await vi.advanceTimersByTimeAsync(0)
}
const emit = (root: string, ev: WatchEvent) => listeners.get(root)!(ev)

describe('watchCardFiles (YAZ-5086)', () => {
  it('a change of a file with cards: one try after the quiet moment, for a burst of changes', async () => {
    const stop = start()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 10; i++) emit('/v', { type: 'change', path: '/v/cards.md', mtime: i })
    expect(fire).not.toHaveBeenCalled()
    await settle()
    expect(fire).toHaveBeenCalledTimes(1)
    stop()
  })

  it('a page with no cards, a picture, a settings file: no try', async () => {
    const stop = start()
    await vi.advanceTimersByTimeAsync(0)
    emit('/v', { type: 'change', path: '/v/notes.md', mtime: 1 })
    emit('/v', { type: 'add', path: '/v/pic.png', mtime: 1 })
    await settle()
    expect(fire).not.toHaveBeenCalled()
    stop()
  })

  it('a page that gets its first card, and a page that loses its last card: a try each', async () => {
    const stop = start()
    await vi.advanceTimersByTimeAsync(0)
    cards.set('/v', new Set(['/v/cards.md', '/v/new.md']))
    emit('/v', { type: 'change', path: '/v/new.md', mtime: 1 })
    await settle()
    expect(fire).toHaveBeenCalledTimes(1)
    cards.set('/v', new Set(['/v/new.md']))
    emit('/v', { type: 'unlink', path: '/v/cards.md' })
    await settle()
    expect(fire).toHaveBeenCalledTimes(2)
    stop()
  })

  it('follows the open vaults; a closed vault is heard no more; stop leaves no timer', async () => {
    const stop = start()
    roots = ['/v', '/w']
    cards.set('/w', new Set(['/w/c.md']))
    onRoots!()
    expect([...listeners.keys()]).toEqual(['/v', '/w'])
    roots = ['/w']
    onRoots!()
    expect([...listeners.keys()]).toEqual(['/w'])
    emit('/w', { type: 'change', path: '/w/c.md', mtime: 1 })
    stop()
    expect(listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    await settle()
    expect(fire).not.toHaveBeenCalled()
  })

  it('a change each 2 seconds for 20 seconds: one try, 3 seconds after the last change (YAZ-5253)', async () => {
    expect(CARD_CHANGE_QUIET_MS).toBe(3000)
    const stop = start()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i <= 10; i++) {
      emit('/v', { type: 'change', path: '/v/cards.md', mtime: i })
      await vi.advanceTimersByTimeAsync(2000)
    }
    expect(fire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(fire).toHaveBeenCalledTimes(1)
    stop()
  })
})
