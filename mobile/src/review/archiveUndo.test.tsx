// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitingCount } from '../status/dot'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5078, the phone's decision: Undo takes back Archive card (and Up next and Fix later), through the answer list.
 * Not sent yet: the mark leaves the list. Sent, or sent with its reply lost: the inverse goes as an action. Either way
 * the card is back in the session at its place, the counts are right, and GitHub ends with the card NOT archived.
 */
let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})
const OLD = '2026-10-04T09:00Z good'
const FILES = { '.yaseendocs/review.json': '{}', 'p.md': page('P', ...[1, 2, 3].map((n) => cardBlock(`Q${n}?\n---\n{{w${n}}}`, `AU-${n}, ${OLD}`))) }
const ops = (hh: ReviewHarness) => hh.answers.waiting().map((w) => `${w.op.kind}:${w.op.id}${'on' in w.op ? `:${w.op.on}` : ''}`)

async function archiveThenUndo(hh: ReviewHarness, between: () => Promise<void>) {
  expect(hh.head()).toBe('Q1? · AU-1 · in P')
  expect(hh.text()).toContain('1 of 3')
  await hh.click('More card actions')
  await hh.click('Archive card')
  expect(hh.head()).toBe('Q2? · AU-2 · in P')
  expect(hh.last()).toBe('Archived·Undo')
  await between()
  await hh.click('Undo')
  // Back in the session, at its place, with the same counts.
  expect(hh.head()).toBe('Q1? · AU-1 · in P')
  expect(hh.text()).toContain('1 of 3')
  expect(hh.last()).not.toContain('Archived')
}

describe('Undo of Archive card on the phone', () => {
  it('not sent yet: the archive leaves the list; nothing is sent; GitHub never had it', async () => {
    h = await reviewSetup(FILES)
    await archiveThenUndo(h, async () => {
      expect(ops(h!)).toEqual(['off:AU-1:true'])
    })
    expect(ops(h)).toEqual([])
    expect(waitingCount(h.answers.waiting())).toBe(0)
    await h.wait(5_000)
    expect(h.commits()).toBe(0)
    expect((await h.remoteLines())['AU-1']).toBe(`<!-- card: AU-1, ${OLD} -->`)
  })

  it('sent: Undo adds the inverse; after the send GitHub has the card NOT archived', async () => {
    h = await reviewSetup(FILES)
    await archiveThenUndo(h, async () => {
      await h!.wait(5_000)
      expect((await h!.remoteLines())['AU-1']).toBe(`<!-- card: AU-1, off, ${OLD} -->`)
    })
    expect(ops(h)).toEqual(['off:AU-1:false'])
    expect(waitingCount(h.answers.waiting())).toBe(1)
    await h.wait(5_000)
    expect(h.answers.waiting()).toEqual([])
    expect((await h.remoteLines())['AU-1']).toBe(`<!-- card: AU-1, ${OLD} -->`)
  })

  it('sent with its reply lost: Undo adds the inverse (the list keeps the archive); GitHub ends NOT archived', async () => {
    let drop = true
    h = await reviewSetup(FILES, {
      fetch: (s) => async (url, init) => {
        const res = await s.github.fetch(url, init)
        if ((init.method ?? 'GET') === 'PATCH' && drop) {
          drop = false
          throw new TypeError('Load failed') // GitHub moved the ref; the phone never heard
        }
        return res
      },
    })
    await archiveThenUndo(h, async () => {
      await h!.wait(5_000)
      expect((await h!.remoteLines())['AU-1']).toBe(`<!-- card: AU-1, off, ${OLD} -->`)
      expect(ops(h!)).toEqual(['off:AU-1:true']) // the list does not know it went
    })
    expect(ops(h)).toEqual(['off:AU-1:true', 'off:AU-1:false'])
    h.answers.online()
    await h.wait(5_000)
    expect(h.answers.waiting()).toEqual([])
    expect((await h.remoteLines())['AU-1']).toBe(`<!-- card: AU-1, ${OLD} -->`)
  })

  it('Up next and Fix later have an Undo too: unsent, the mark leaves the list; the card line is as before', async () => {
    h = await reviewSetup(FILES)
    await h.click('More card actions')
    await h.click('Up next')
    expect(h.last()).toBe('Marked: Up next·Undo')
    await h.click('Undo')
    expect(ops(h)).toEqual([])
    await h.click('More card actions')
    expect(h.button('Up next')).not.toBeNull()
    await h.click('Fix later')
    expect(h.last()).toBe('Marked: Fix later·Undo')
    await h.click('Undo')
    expect(ops(h)).toEqual([])
    await h.click('More card actions')
    expect(h.button('Fix later')).not.toBeNull()
    await h.wait(5_000)
    expect(h.commits()).toBe(0)
  })
})
