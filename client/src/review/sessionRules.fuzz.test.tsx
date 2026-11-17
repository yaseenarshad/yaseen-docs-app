/**
 * YAZ-5614 (checker b of the YAZ-5611 audit), the Mac: random sessions on made-up vaults, thousands of taps in all,
 * with the rules that must always hold (`sessionRules.testing.ts`) checked after each tap. The hook is the one the Mac
 * runs, on the in-memory host (`memoryReviewHost`, the Mac's own pure card read and line writes) with Archive card's
 * Undo as the Mac's host has it (YAZ-5621). A failure names its seed: `SEEDS=<n>` runs that one again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardRecords } from '@shared/cardLine'
import { cardPlan } from '@shared/cardSchedule'
import { sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { memoryReviewHost, type MemoryReviewHost } from './memoryReviewHost'
import { fuzzSession, randomVault, reviewsById, type FuzzDriver } from './sessionRules.testing'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/mac'
/** Made-up "now": Friday 13 November 2026, 9:00 local time (a session never reaches midnight). */
const NOW = new Date(2026, 10, 13, 9, 0).getTime()
const SESSIONS = 60
const TAPS = 80

let root: Root | null = null

function scan(path: string, content: string, mtime: number): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice(ROOT.length + 1, Math.max(ROOT.length + 1, path.lastIndexOf('/')))
  return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder, ext: 'md', size: content.length, ctime: 0, mtime, properties: {}, aliases: [], tags: [], links: [], embeds: [], cards: cardRecords(content) }
}

function macDriver(files: Record<string, string>, settings: ReviewSettings): FuzzDriver & { host: MemoryReviewHost } {
  const host: MemoryReviewHost = { ...memoryReviewHost(new Map(Object.entries(files).map(([p, c]) => [`${ROOT}/${p}`, c])), 'Mac vault'), undoesArchive: true }
  let records: IndexRecord[] = []
  let listeners: Array<() => void> = []
  const mtimes = new Map<string, { content: string; mtime: number }>()
  let tick = 1
  const reindex = () => {
    // A page's mtime moves only when its text changed, as the Mac's index does.
    records = [...host.files].map(([path, content]) => {
      const was = mtimes.get(path)
      const mtime = was !== undefined && was.content === content ? was.mtime : tick++
      mtimes.set(path, { content, mtime })
      return scan(path, content, mtime)
    })
    listeners.forEach((l) => l())
  }
  reindex()
  const source = {
    get records() {
      return records
    },
    folders: [] as IndexRecord[],
    subscribe(l: () => void) {
      listeners.push(l)
      return () => (listeners = listeners.filter((x) => x !== l))
    },
  }
  let api: CardReviewApi
  function Probe() {
    api = useCardReview(ROOT, source, settings, () => undefined, 'Mac vault', host)
    return null
  }
  root = createRoot(document.createElement('div'))
  act(() => root?.render(<Probe />))
  return {
    host,
    review: () => api,
    settle: async () => {
      for (let i = 0; i < 3; i++) await act(async () => void (await Promise.resolve()))
      await act(async () => reindex())
      for (let i = 0; i < 3; i++) await act(async () => void (await Promise.resolve()))
    },
    files: async () => Object.fromEntries(host.files),
    records: () => records,
    plan: () => cardPlan(records, settings, Date.now(), '', undefined, undefined, host.upNextTakenToday(ROOT), host.cardsAddedToday(ROOT)).queue,
    settings,
  }
}

const seeds = (): number[] => {
  const only = typeof process !== 'undefined' ? process.env.SEEDS : undefined
  return only ? only.split(',').map(Number) : Array.from({ length: SESSIONS }, (_, i) => i + 1)
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

describe('YAZ-5614 random sessions on the Mac: the rules always hold', () => {
  it(`${SESSIONS} sessions of ${TAPS} random taps: each answer saved once, dates forward, counts never grow`, { timeout: 240_000 }, async () => {
    let taps = 0
    let answers = 0
    let undone = 0
    for (const seed of seeds()) {
      const vault = randomVault(seed, NOW)
      vi.setSystemTime(NOW)
      const driver = macDriver(vault.files, sanitizeReviewSettings(vault.review))
      const result = await fuzzSession(driver, seed, TAPS, NOW)
      taps += result.taps
      answers += result.answers
      undone += result.undone
      act(() => root?.unmount())
      root = null
    }
    // The run did real work: thousands of taps, most of them answers, some taken back.
    expect(taps).toBeGreaterThanOrEqual(seeds().length * TAPS)
    expect(answers).toBeGreaterThan(taps / 4)
    expect(undone).toBeGreaterThan(0)
  })

  // The bugs the random sessions found, each as one plain case (failing before its fix).
  const card = (id: string, extra = '') => `\`\`\`card\nQ ${id}?\n---\nA {{${id}}}\n\`\`\`\n<!-- card: ${id}${extra} -->`
  const vault = (...cards: string[]) => ({ 'p.md': `# P\n\n${cards.join('\n\n')}\n` })
  const step = async (driver: FuzzDriver, run: () => unknown) => {
    await act(async () => void (await run()))
    await driver.settle()
  }

  it('closed and opened again, the card at the head takes no answer time of the session before (seed 230)', async () => {
    const d = macDriver(vault(card('AA-1', ', 2026-11-06T09:00:00.000Z again')), sanitizeReviewSettings({ fuzz: false }))
    await step(d, () => d.review().start())
    await step(d, () => d.review().showAnswers())
    await step(d, () => d.review().close())
    vi.setSystemTime(NOW + 90_000)
    await step(d, () => d.review().start())
    await step(d, () => d.review().showAnswers())
    await step(d, () => d.review().answer('good'))
    // The time of the buttons of THIS session, never the time they showed before the close.
    expect(reviewsById(await d.files()).get('AA-1')?.at(-1)?.at).toBe(new Date(NOW + 90_000).toISOString())
  })

  it('two ⌘Z in one tick on "Add more" take the day`s number down once (seed 394)', async () => {
    const d = macDriver(vault(card('AA-1'), card('AA-2'), card('AA-3'), card('AA-4')), sanitizeReviewSettings({ newPerDay: 1, fuzz: false }))
    await step(d, () => d.review().start())
    await step(d, () => d.review().addCards('new', 1))
    await step(d, () => d.review().addCards('new', 1))
    expect(d.host.cardsAddedToday(ROOT).newCards).toBe(2)
    await step(d, () => Promise.all([d.review().undo(), d.review().undo()]))
    // One step taken back: one add left, and the Inbox agrees with the session.
    expect(d.host.cardsAddedToday(ROOT).newCards).toBe(1)
    expect([d.review().dueCount, d.review().session?.counts.all]).toEqual([2, 2])
  })

  // Review rules v1, rule 2 (YAZ-5655) changed the expected end: a card with only ✕ is a New card, so it is in no Due
  // today pass and makes no stop at all. Before, it was a due card and the pass ended on "Due today is done." (100%).
  it('a ✕-only card`s first ✓ (a new card learned, back once today) makes no "Review missed cards" stop (seed 230; rule 2: a ✕-only card is New)', async () => {
    const d = macDriver(vault(card('AA-1', ', 2026-11-06T09:00:00.000Z again')), sanitizeReviewSettings({ fuzz: false }))
    await step(d, () => d.review().start())
    expect(d.review().session?.counts).toMatchObject({ all: 1, due: 0, new: 1 })
    await step(d, () => d.review().showAnswers())
    await step(d, () => d.review().answer('good'))
    // No miss: the card comes back at once (its second ✓ of the steps), with no % screen, now a Due today card (rule 3).
    expect(d.review().session?.end).toBeNull()
    expect(d.review().session?.card).toMatchObject({ id: 'AA-1', repeat: true, isNew: false })
    vi.setSystemTime(NOW + 70_000)
    await step(d, () => d.review().showAnswers())
    await step(d, () => d.review().answer('good'))
    expect(d.review().session?.end).toBeNull()
    expect(d.review().session?.card).toBeNull()
  })

  // Open item 1 of YAZ-5614, now Review rules v1, rule 10 (YAZ-5655): Up next takes no New cards place. The counts
  // follow rule 7 (each card in one list): Up next 1, New cards 1.
  it('rule 10: a Forgot on a new Up next card keeps today`s new cards, also after the Inbox opens again', async () => {
    const d = macDriver(vault(card('AA-1', ', next'), card('AA-2'), card('AA-3')), sanitizeReviewSettings({ newPerDay: 1, fuzz: false }))
    await step(d, () => d.review().start())
    expect(d.review().session?.counts).toMatchObject({ all: 2, next: 1, new: 1 })
    await step(d, () => d.review().showAnswers())
    await step(d, () => d.review().answer('again'))
    // AA-1 waits to come back (a New card: rule 2), AA-2 is still today's new card: All cards 2.
    expect(d.review().session?.counts).toMatchObject({ all: 2, next: 0, new: 2 })
    await step(d, () => d.review().close())
    await step(d, () => d.review().start())
    expect(d.review().session?.counts).toMatchObject({ all: 2, next: 0, due: 0, new: 2 })
    expect(d.review().dueCount).toBe(2)
  })
})
