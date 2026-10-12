/**
 * The table of contents channel (YAZ-2700): what its subscribers hear, and what its commands do
 * with and without an engine bound.
 *
 * The rule under test: a subscriber hears a change ONLY when the list of (level, text) changes or
 * the hidden flag flips. The engine publishes after every scan, and a scan that found the same
 * rows must render nothing. The source (YAZ-2700 D14) is the host's word to the engine and no
 * part of that: a subscriber hears of it only through the list the engine then publishes.
 */
import { describe, expect, it, vi } from 'vitest'
import { createTocChannel, type TocController, type TocRow } from './tocChannel'

const LIST: TocRow[] = [
  { level: 1, text: 'Part 1' },
  { level: 2, text: 'Section A' },
]

describe('publishing', () => {
  it('starts empty and shown', () => {
    expect(createTocChannel().getState()).toEqual({ rows: [], hidden: false })
  })

  it('a new list reaches the subscribers once; the same list again, as a new array, does not', () => {
    const channel = createTocChannel()
    const listener = vi.fn()
    channel.subscribe(listener)
    channel.publish(LIST)
    expect(listener).toHaveBeenCalledTimes(1)
    const first = channel.getState()
    expect(first.rows).toEqual(LIST)

    channel.publish(LIST.map((row) => ({ ...row })))
    expect(listener).toHaveBeenCalledTimes(1)
    // The snapshot keeps its identity, so `useSyncExternalStore` sees no change either.
    expect(channel.getState()).toBe(first)
  })

  it('a changed text, a changed level, one more and one fewer row each reach them', () => {
    const channel = createTocChannel()
    const listener = vi.fn()
    channel.publish(LIST)
    channel.subscribe(listener)
    channel.publish([LIST[0], { level: 2, text: 'Section B' }])
    channel.publish([LIST[0], { level: 3, text: 'Section B' }])
    channel.publish([LIST[0], { level: 3, text: 'Section B' }, { level: 1, text: 'Part 2' }])
    channel.publish([LIST[0]])
    expect(listener).toHaveBeenCalledTimes(4)
    expect(channel.getState().rows).toEqual([LIST[0]])
  })

  it('the hidden flag reaches them when it flips, and only then; the rows stay', () => {
    const channel = createTocChannel()
    const listener = vi.fn()
    channel.publish(LIST)
    channel.subscribe(listener)
    channel.setHidden(false)
    expect(listener).not.toHaveBeenCalled()
    channel.setHidden(true)
    channel.setHidden(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(channel.getState()).toEqual({ rows: LIST, hidden: true })
    channel.setHidden(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('an unsubscribed listener hears nothing more', () => {
    const channel = createTocChannel()
    const listener = vi.fn()
    const unsubscribe = channel.subscribe(listener)
    unsubscribe()
    channel.publish(LIST)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('the source (YAZ-2700 D14)', () => {
  const engine = (): TocController & { rescan: ReturnType<typeof vi.fn> } => ({ jump: vi.fn(), current: vi.fn(() => 0), rescan: vi.fn() })

  it('starts on Auto (null), and keeps what the host sets', () => {
    const channel = createTocChannel()
    expect(channel.getSource()).toBeNull()
    channel.setSource('bullets')
    expect(channel.getSource()).toBe('bullets')
    channel.setSource(null)
    expect(channel.getSource()).toBeNull()
  })

  it('set before an engine is bound, it only waits for the first scan: no scan is asked for, and the engine reads it when it binds', () => {
    const channel = createTocChannel()
    expect(() => channel.setSource('headings')).not.toThrow()
    const bound = engine()
    channel.bind(bound)
    expect(bound.rescan).not.toHaveBeenCalled()
    expect(channel.getSource()).toBe('headings')
  })

  it('a CHANGE asks the bound engine for a scan at once, and the same source again does not', () => {
    const channel = createTocChannel()
    const bound = engine()
    channel.bind(bound)
    channel.setSource(null)
    expect(bound.rescan).not.toHaveBeenCalled()
    channel.setSource('bullets')
    expect(bound.rescan).toHaveBeenCalledTimes(1)
    channel.setSource('bullets')
    expect(bound.rescan).toHaveBeenCalledTimes(1)
    channel.setSource('headings')
    channel.setSource(null)
    expect(bound.rescan).toHaveBeenCalledTimes(3)
  })

  it('the engine reads the NEW source inside that scan', () => {
    const channel = createTocChannel()
    const read: Array<string | null> = []
    channel.bind({ jump: vi.fn(), current: vi.fn(() => 0), rescan: () => void read.push(channel.getSource()) })
    channel.setSource('headings')
    expect(read).toEqual(['headings'])
  })

  it('is no part of the snapshot: the subscribers hear nothing of it, and the snapshot keeps its identity', () => {
    const channel = createTocChannel()
    channel.publish(LIST)
    const listener = vi.fn()
    channel.subscribe(listener)
    const before = channel.getState()
    channel.setSource('bullets')
    expect(listener).not.toHaveBeenCalled()
    expect(channel.getState()).toBe(before)
    expect(channel.getState()).toEqual({ rows: LIST, hidden: false })
  })
})

describe('commands', () => {
  const controller = (): TocController & { jump: ReturnType<typeof vi.fn>; current: ReturnType<typeof vi.fn>; rescan: ReturnType<typeof vi.fn> } => ({ jump: vi.fn(), current: vi.fn(() => 1), rescan: vi.fn() })

  it('unbound, jump is a no-op and current answers −1', () => {
    const channel = createTocChannel()
    expect(() => channel.jump(0)).not.toThrow()
    expect(channel.current([0, 1], document.body)).toBe(-1)
  })

  it('bound, both go to the engine with their arguments', () => {
    const channel = createTocChannel()
    const engine = controller()
    channel.bind(engine)
    channel.jump(3)
    expect(engine.jump).toHaveBeenCalledWith(3)
    expect(channel.current([0, 2], document.body)).toBe(1)
    expect(engine.current).toHaveBeenCalledWith([0, 2], document.body)
  })

  it('an unbind lets go of its own engine only: a newer one stays bound (StrictMode mounts twice)', () => {
    const channel = createTocChannel()
    const first = controller()
    const second = controller()
    const unbindFirst = channel.bind(first)
    const unbindSecond = channel.bind(second)
    unbindFirst()
    channel.jump(0)
    expect(second.jump).toHaveBeenCalledTimes(1)
    unbindSecond()
    channel.jump(0)
    expect(second.jump).toHaveBeenCalledTimes(1)
    expect(first.jump).not.toHaveBeenCalled()
  })
})
