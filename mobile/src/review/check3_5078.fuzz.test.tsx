// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEEN_MS, useTapGuard } from './tapGuard'

// Checker round 3 (YAZ-5078): the REAL `useTapGuard` hook (its reducer and its own timer) under a fake clock, driven
// by a small model of the Review screen and of the review hook (its `busy` drops a second write). Made-up data only.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Api = ReturnType<typeof useTapGuard>
let api: Api
function Probe() {
  api = useTapGuard()
  return null
}

/** A seeded random (mulberry32), so a failing order can be run again. */
function rnd(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Ev = 'tap' | 'save-ok' | 'save-fail' | 'undo' | 'undo-any' | 'hide' | 'show' | 'hide-any' | 'show-any' | 'wait' | 'sync-same' | 'remount'

interface World {
  now: number
  card: number | null // the card on the screen (an index); null: Inbox complete
  cards: number // how many cards the session holds
  shownAt: number // when the card on the screen came
  lookedAgain: boolean // an Undo or a hide/show since it came (the person looked at it again)
  busy: boolean // the review hook's `busy` (one write at a time)
  pending: { settle: (ok: boolean) => void } | null
  done: number[] // answered cards, in order (an Undo takes the last)
  accepted: number
  attempted: number // accepted taps that reached a write (`busy` was false)
  droppedByBusy: number
  unseen: string[] // an accepted tap on a card that came < SEEN_MS before, with no look again
  log: string[]
}

async function flush() {
  for (let i = 0; i < 4; i++) await act(async () => void (await Promise.resolve()))
}

async function run(seed: number, length: number, events: Ev[], root: ReturnType<typeof createRoot>, keyRef: { k: number }) {
  const r = rnd(seed)
  const w: World = { now: 0, card: 0, cards: 6 + Math.floor(r() * 4), shownAt: 0, lookedAgain: true, busy: false, pending: null, done: [], accepted: 0, attempted: 0, droppedByBusy: 0, unseen: [], log: [] }
  keyRef.k++
  await act(async () => root.render(createElement(Probe, { key: keyRef.k })))
  const advance = async (ms: number) => {
    await act(async () => void vi.advanceTimersByTime(ms))
    w.now += ms
    await flush()
  }
  const setCard = (c: number | null) => {
    if (c !== w.card) {
      w.card = c
      w.shownAt = w.now
      w.lookedAgain = false
    }
  }
  for (let i = 0; i < length; i++) {
    const ev = events[Math.floor(r() * events.length)]
    w.log.push(`${w.now}ms ${ev} [${api.state.kind}]`)
    switch (ev) {
      case 'tap': {
        if (w.card === null || !api.taps) break
        w.accepted++
        if (w.now - w.shownAt < SEEN_MS && !w.lookedAgain) w.unseen.push(`card ${w.card} at ${w.now - w.shownAt} ms`)
        const from = w.card
        void api.answer(
          async () => {
            if (w.busy) return void w.droppedByBusy++ // the hook returns at once: no answer
            w.attempted++
            w.busy = true
            const ok = await new Promise<boolean>((resolve) => (w.pending = { settle: resolve }))
            w.busy = false
            w.pending = null
            if (!ok) return
            w.done.push(from)
            const next = from + 1
            setCard(next < w.cards ? next : null)
            await new Promise((res) => setTimeout(res, 0)) // as `answerWith`: the next card draws first
          },
          () => ({ sameCard: w.card === from, cardOnScreen: w.card !== null }),
        )
        await flush()
        break
      }
      case 'save-ok':
      case 'save-fail':
        if (w.pending === null) break
        await act(async () => w.pending!.settle(ev === 'save-ok'))
        await flush()
        await advance(0)
        break
      case 'undo': // as the screen: Undo shows only after a write ended, with an answer to take back
      case 'undo-any': {
        if (ev === 'undo' && (w.busy || w.done.length === 0)) break
        await act(async () => api.undo())
        if (!w.busy && w.done.length > 0) {
          const back = w.done.pop()!
          w.card = back // the card that comes back is one the person saw
          w.lookedAgain = true
        }
        await flush()
        break
      }
      case 'hide':
      case 'show':
      case 'hide-any':
      case 'show-any':
        // A tab switch takes at least two taps; 'hide'/'show' only between writes, '-any' also during a write.
        if ((ev === 'hide' || ev === 'show') && w.busy) break
        await act(async () => api.reset())
        w.lookedAgain = true
        break
      case 'sync-same': // a sync pass draws the same card again: `cardKey` holds, nothing for the guard
        await flush()
        break
      case 'remount': // a vault switch, an erase, review turned off: the screen goes, a new one starts
        if (w.pending !== null) {
          await act(async () => w.pending!.settle(true))
          await flush()
        }
        keyRef.k++
        await act(async () => root.render(createElement(Probe, { key: keyRef.k })))
        w.busy = false
        w.pending = null
        w.lookedAgain = true // a new screen: its first card is not the second tap of a double tap
        break
      case 'wait':
        await advance([1, 50, 150, 399, 400, 401, 1000][Math.floor(r() * 7)])
        break
    }
  }
  // The end of each order: every write ends, then 500 ms of quiet.
  while (w.pending !== null) {
    await act(async () => w.pending!.settle(true))
    await flush()
    await advance(0)
  }
  await advance(500)
  return w
}

let root: ReturnType<typeof createRoot>
let host: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('checker round 3: the tap guard, 2,000 random orders (fake clock)', () => {
  it('F1: the events the screen can give: never stuck, every accepted tap answers, no tap answers an unseen card', async () => {
    const keyRef = { k: 0 }
    const stuck: string[] = []
    const lost: string[] = []
    const unseen: string[] = []
    let taps = 0
    for (let seed = 1; seed <= 2000; seed++) {
      const w = await run(seed, 30, ['tap', 'tap', 'tap', 'save-ok', 'save-ok', 'save-fail', 'undo', 'hide', 'show', 'wait', 'wait', 'sync-same', 'remount'], root, keyRef)
      taps += w.accepted
      if (!api.taps) stuck.push(`seed ${seed}: ${api.state.kind} after 500 ms of quiet; ${w.log.slice(-6).join(' | ')}`)
      if (w.attempted !== w.accepted) lost.push(`seed ${seed}: accepted ${w.accepted}, written ${w.attempted}, dropped by busy ${w.droppedByBusy}; ${w.log.join(' | ')}`)
      unseen.push(...w.unseen.map((u) => `seed ${seed}: ${u}`))
      // After the quiet, one more tap is taken.
      if (w.card !== null) {
        let took = false
        void api.answer(async () => void (took = true), () => ({ sameCard: false, cardOnScreen: true }))
        await flush()
        if (!took) stuck.push(`seed ${seed}: the tap after quiet was dropped`)
      }
    }
    console.log(`[F1] 2000 orders, ${taps} accepted taps; stuck ${stuck.length}; accepted ≠ written ${lost.length}; unseen ${unseen.length}`)
    for (const s of [...stuck, ...lost, ...unseen].slice(0, 5)) console.log('[F1]', s)
    expect(stuck).toEqual([])
    expect(lost).toEqual([])
    expect(unseen).toEqual([])
  }, 600_000)

  it('F1b: the same, with the tab hidden and shown again DURING a write (a tab switch inside the save time)', async () => {
    const keyRef = { k: 0 }
    const stuck: string[] = []
    const lost: string[] = []
    const unseen: string[] = []
    let orders = 0
    for (let seed = 1; seed <= 2000; seed++) {
      const w = await run(20_000 + seed, 30, ['tap', 'tap', 'tap', 'save-ok', 'save-ok', 'save-fail', 'undo', 'hide-any', 'show-any', 'wait', 'wait', 'sync-same', 'remount'], root, keyRef)
      orders++
      if (!api.taps) stuck.push(`seed ${seed}: ${api.state.kind}`)
      if (w.attempted !== w.accepted) lost.push(`seed ${seed}: accepted ${w.accepted}, written ${w.attempted}`)
      if (w.unseen.length > 0) unseen.push(`seed ${seed}: ${w.unseen.join(', ')}; ${w.log.slice(-10).join(' | ')}`)
    }
    console.log(`[F1b] ${orders} orders; stuck ${stuck.length}; orders with a tap dropped by the hook's busy ${lost.length}; orders with an unseen tap ${unseen.length}`)
    for (const s of unseen.slice(0, 2)) console.log('[F1b]', s)
    expect(stuck).toEqual([])
  }, 600_000)

  it('F2 (stress, beyond the screen): Undo at ANY moment, also during a write: never stuck; what breaks the counts', async () => {
    const keyRef = { k: 0 }
    const stuck: string[] = []
    const lost: string[] = []
    const unseen: string[] = []
    for (let seed = 1; seed <= 2000; seed++) {
      const w = await run(10_000 + seed, 30, ['tap', 'tap', 'tap', 'save-ok', 'save-ok', 'save-fail', 'undo-any', 'hide', 'show', 'wait', 'wait'], root, keyRef)
      if (!api.taps) stuck.push(`seed ${seed}: ${api.state.kind}`)
      if (w.attempted !== w.accepted) lost.push(`seed ${seed}: accepted ${w.accepted}, written ${w.attempted}; ${w.log.slice(-12).join(' | ')}`)
      unseen.push(...w.unseen.map((u) => `seed ${seed}: ${u}`))
    }
    console.log(`[F2] 2000 orders; stuck ${stuck.length}; accepted ≠ written ${lost.length}; unseen ${unseen.length}`)
    for (const s of [...lost, ...unseen].slice(0, 4)) console.log('[F2]', s)
    expect(stuck).toEqual([])
  }, 600_000)

  it('F3: Undo at 0, 1, 399, 400, 401 ms; a failed save then Undo; Undo then Undo: ready each time, and one old timer never ends a new settling early', async () => {
    await act(async () => root.render(createElement(Probe)))
    const answerOk = async () => {
      void api.answer(async () => {}, () => ({ sameCard: false, cardOnScreen: true }))
      await flush()
    }
    for (const ms of [0, 1, 399, 400, 401]) {
      await answerOk()
      expect(api.state.kind).toBe('settling')
      if (ms > 0) await act(async () => void vi.advanceTimersByTime(ms))
      await act(async () => api.undo())
      expect([ms, api.taps]).toEqual([ms, true])
      // Undo then Undo: still ready.
      await act(async () => api.undo())
      expect(api.taps).toBe(true)
    }
    // A failed save, then Undo.
    void api.answer(async () => {
      throw new Error('the disk is full')
    }, () => ({ sameCard: true, cardOnScreen: true })).catch(() => {})
    await flush()
    expect(api.taps).toBe(true)
    await act(async () => api.undo())
    expect(api.taps).toBe(true)
    // An old timer: settling A, Undo at 300 ms, settling B at once; at A's 400 ms B is still settling; B ends at its own 400.
    await answerOk()
    await act(async () => void vi.advanceTimersByTime(300))
    await act(async () => api.undo())
    await answerOk()
    await act(async () => void vi.advanceTimersByTime(100))
    expect(api.state.kind).toBe('settling')
    await act(async () => void vi.advanceTimersByTime(299))
    expect(api.state.kind).toBe('settling')
    await act(async () => void vi.advanceTimersByTime(1))
    expect(api.state.kind).toBe('ready')
  })
})
