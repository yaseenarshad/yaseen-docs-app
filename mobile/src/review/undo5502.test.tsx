// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { NOW, cardBlock, page } from './testing'

/**
 * The phone's order of work (YAZ-5502): React draws in a task of its own (the browser's MessageChannel; Node's
 * `setImmediate`, which React's scheduler takes at load). On the phone that task can come AFTER a 0 ms timer that
 * was set after the state change (WebKit runs timers and messages from different queues; a busy main thread). Here
 * the scheduler's task waits 4 ms, so a 0 ms timer set after an answer always runs first — the phone's worst order.
 */
vi.hoisted(() => {
  const g = globalThis as { setImmediate?: (fn: (...a: unknown[]) => void, ...a: unknown[]) => unknown }
  g.setImmediate = (fn, ...a) => setTimeout(fn, 4, ...a)
})

/**
 * YAZ-5502 (bug): the 4-second "↶ Undo" after an answer does not show. The whole Review screen in the Shell, with the
 * real engine, answer list and host on the fake GitHub. The answer is a plain tap, NOT inside React's `act`, and time
 * runs as on the phone: React draws when its own scheduler says, as in the browser. Made-up data only.
 */
const OLD = '2026-10-02T09:00:00.000Z good, 2026-10-12T09:00:00.000Z good'
const FILES = { '.yaseendocs/review.json': '{}', 'spanish.md': page('Spanish words', cardBlock('Hola?\n---\n{{Hello}}', `UN-1, ${OLD}`), cardBlock('Adios?\n---\n{{Bye}}', `UN-2, ${OLD}`), cardBlock('Gracias?\n---\n{{Thanks}}', `UN-3, ${OLD}`)) }

let h: Harness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const head = () => h.host.querySelector('.review__head')?.textContent?.trim() ?? null
const undoInHint = () => h.host.querySelector<HTMLButtonElement>('.review__hint .review__undo')
/** Waits by real time, outside `act` (the browser's way), until `ok` or `ms` pass. */
async function within(ms: number, ok: () => boolean): Promise<boolean> {
  for (const end = performance.now() + ms; performance.now() < end; await sleep(10)) if (ok()) return true
  return ok()
}

async function app() {
  const t = await answersSetup({ files: FILES })
  // The phone reads its index again after each answer (IndexedDB): slower than the fake here. It comes late, as on
  // the phone, so the screen draws the answer from the review hook's own state change, not from that read.
  const view = t.answers.view.bind(t.answers)
  t.answers.view = async (index) => {
    await sleep(60)
    return view(index)
  }
  await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
  h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
  await h.syncSet({ status: 'synced', vault: VAULT, ready: true })
  h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  await h.click('Search')
  await h.click('Review')
  for (const end = performance.now() + 5000; head() === null && performance.now() < end; ) await h.settle()
  return t
}

describe('YAZ-5502: the 4-second Undo after an answer', () => {
  it('a tap on ✓ in the Shell\'s Review shows "↶ Undo" in the hint line within the 4 s; a tap on it brings the card back', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    try {
      const t = await app()
      expect(head()).toBe('UN-1')
      // The card's short "seen" time (YAZ-5226), as a person waits.
      await within(2000, () => h.host.querySelector('[data-guard]') === null)
      h.host.querySelector<HTMLButtonElement>('button[aria-label="Remembered"]')!.click()
      expect(await within(3000, () => head() === 'UN-2')).toBe(true)
      expect(await within(3000, () => undoInHint() !== null)).toBe(true)
      expect(t.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op.id)).toEqual(['UN-1'])
      undoInHint()!.click()
      expect(await within(3000, () => head() === 'UN-1')).toBe(true)
      expect(await within(3000, () => t.answers.waiting().every((w) => w.op.kind !== 'review'))).toBe(true)
    } finally {
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      await act(async () => undefined)
    }
  })
})
