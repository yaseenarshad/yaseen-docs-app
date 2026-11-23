// @vitest-environment jsdom
/**
 * YAZ-5614 (checker b of the YAZ-5611 audit), the phone: the same random sessions and the same rules as the Mac
 * (`@client/review/sessionRules.testing.ts`), through the phone's REAL review host: the answer list (actions, sent
 * later in one commit), its index source and its own day numbers, on the fake GitHub. A random "send" tap sends the
 * waiting answers mid-session, so Undo also takes back answers GitHub has. After each session the phone sends: GitHub
 * must hold each card's reviews exactly as the phone shows them (every answer saved once, none lost, none twice).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCardReview, type CardReviewApi } from '@client/review/useCardReview'
import { fuzzSession, randomVault, reviewsById, type FuzzDriver } from '@client/review/sessionRules.testing'
import { cardPlan } from '@shared/cardSchedule'
import { answersSetup } from '../answers/testing'
import { openPhoneDays, phoneReviewHost } from '../answers/reviewHost'
import { BRANCH, VAULT } from '../sync/testing'
import { SEND_AFTER_MS } from '../sync/cadence'
import { createReviewSource } from './source'
import { NOW } from './testing'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SESSIONS = 16
const TAPS = 60

let root: Root | null = null

async function phoneDriver(files: Record<string, string>) {
  const t = await answersSetup({ files })
  // No signal until a "send" tap: the answers wait in the list, as on a phone offline.
  t.s.github.offline = true
  const link = { engine: t.engine, answers: t.answers, store: t.store }
  const source = createReviewSource(link, VAULT, 'vault')
  await source.refresh()
  const days = await openPhoneDays(t.store, VAULT)
  const host = phoneReviewHost({ answers: t.answers, days, vaultName: () => 'vault' })
  const settings = source.settings
  let api: CardReviewApi
  function Probe() {
    api = useCardReview(VAULT, source, settings, () => undefined, 'vault', host)
    return null
  }
  root = createRoot(document.createElement('div'))
  act(() => root?.render(createElement(Probe)))
  const settle = async () => {
    for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  }
  const send = async () => {
    t.s.github.offline = false
    await t.answers.sendNow()
    await t.tick(SEND_AFTER_MS)
    await t.answers.sendNow()
    t.s.github.offline = true
  }
  const driver: FuzzDriver = {
    review: () => api,
    settle,
    files: async () => {
      const out: Record<string, string> = {}
      for (const p of Object.keys(files)) out[p] = (await t.answers.text(p)) ?? ''
      return out
    },
    records: () => source.records,
    plan: () => cardPlan(source.records, settings, Date.now(), '', undefined, source.letters, days.upNextTakenToday(), days.cardsAddedToday()).queue,
    settings,
    send,
  }
  return { driver, t, stop: () => (act(() => root?.unmount()), (root = null), source.stop()) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

const seeds = (): number[] => {
  const only = process.env.SEEDS
  return only ? only.split(',').map(Number) : Array.from({ length: SESSIONS }, (_, i) => 1000 + i)
}

describe('YAZ-5614 random sessions on the phone: the rules always hold', () => {
  it(`${SESSIONS} sessions of ${TAPS} random taps through the answer list, then GitHub holds each answer once`, { timeout: 600_000 }, async () => {
    let taps = 0
    let answers = 0
    for (const seed of seeds()) {
      const vault = randomVault(seed, NOW)
      vi.setSystemTime(NOW)
      const { driver, t, stop } = await phoneDriver({ ...vault.files, '.yaseendocs/review.json': JSON.stringify(vault.review) })
      const result = await fuzzSession(driver, seed, TAPS, NOW)
      taps += result.taps
      answers += result.answers
      // The phone gets a signal: GitHub has each card's reviews as the phone shows them, each one time.
      await act(async () => driver.send!())
      const phone = reviewsById(await driver.files())
      const remote = reviewsById(Object.fromEntries(Object.entries(await t.s.git.filesAt(t.s.git.branches.get(BRANCH)!)).filter((e): e is [string, string] => typeof e[1] === 'string')))
      const key = (m: Map<string, { at: string; rating: string }[]>) => [...m].map(([id, list]) => `${id}: ${list.map((r) => `${r.at} ${r.rating}`).join(', ')}`).sort()
      expect({ seed, remote: key(remote) }).toEqual({ seed, remote: key(phone) })
      expect({ seed, waiting: t.answers.waiting().length, lost: t.answers.state().lost.length }).toEqual({ seed, waiting: 0, lost: 0 })
      stop()
    }
    expect(taps).toBeGreaterThanOrEqual(seeds().length * TAPS)
    expect(answers).toBeGreaterThan(taps / 4)
  })
})
