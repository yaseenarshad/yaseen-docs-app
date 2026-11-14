// @vitest-environment jsdom
/// <reference path="../../../client/src/bridge.d.ts" />
// The Mac's host reads the desktop bridge's types (a test runs it with a fake bridge; the phone's own build never has it).
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopReviewHost } from '@client/review/desktopReviewHost'
import type { ReviewHost } from '@client/review/reviewHost'
import { useCardReview, type CardReviewApi } from '@client/review/useCardReview'
import { storage } from '@client/lib/storage'
import { cardIdOf, formatCardLine, pageCards } from '@shared/cardLine'
import { sanitizeReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { answersSetup } from '../answers/testing'
import { openPhoneDays, phoneReviewHost } from '../answers/reviewHost'
import { phoneRecord } from '../sync/phoneIndex'
import { VAULT } from '../sync/testing'
import { createReviewSource } from './source'
import { NOW, cardBlock, cardFile, page } from './testing'

/**
 * Decision 3, "one review logic": the SAME made-up vault and the SAME taps through the Mac's host
 * (`desktopReviewHost`, its files through a fake bridge, as `useCardReview.test.tsx` does) and the phone's host (the
 * answer list on the real engine and the fake GitHub). The due list after each step and the card lines at the end
 * must be the same.
 */
const ROOT = '/vault'
let disk = new Map<string, string>()
let mtime = 1

vi.mock('@client/views/writeProperty', () => ({
  transformFile: vi.fn(async (path: string, transform: (content: string) => string) => {
    const content = disk.get(path)
    if (content === undefined) throw new Error('cannot write')
    const next = transform(content)
    disk.set(path, next)
    mtime++
    return { mtime, content: next }
  }),
}))
vi.mock('@client/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@client/api')>()
  return {
    ...real,
    api: {
      readFile: vi.fn(async (path: string) => {
        const content = disk.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', 'gone')
        return { path, content, mtime }
      }),
      state: { setFolder: vi.fn(async () => undefined) },
    },
  }
})

const SETTINGS = sanitizeReviewSettings({ newPerDay: 3, fuzz: false })
const FILES: Record<string, string> = {
  '.yaseendocs/review.json': JSON.stringify({ newPerDay: 3, fuzz: false }),
  'spanish.md': page(
    'Spanish words',
    cardBlock('Old one?\n---\n{{viejo}}', 'PA-1, 2026-10-01T09:00Z good, 2026-10-05T09:00Z good'),
    cardBlock('Hola?\n---\n{{hello}}', 'PA-2'),
    cardBlock('Adios?\n---\n{{bye}}', 'PA-3, next'),
  ),
  'cards/light.md': cardFile('Speed of light', cardBlock('How fast?\n---\n{{300,000 km/s}}', 'PA-4')),
  'git.md': page('Git', cardBlock('git pull?\n---\nIt {{fetches}} and {{merges}}.', 'PA-5, 2026-11-10T09:00Z again'), cardBlock('git push?\n---\n{{uploads}}', 'PA-6'), '![[PA-4]]'),
}

/** One run: the hook with a host, and the steps. Returns what showed after each step, and the card lines. */
interface Run {
  review: () => CardReviewApi
  settle: () => Promise<void>
  lines: () => Promise<Record<string, string>>
  stop: () => void
}

function mount(source: Parameters<typeof useCardReview>[1], host: ReviewHost, root: string): { get: () => CardReviewApi; root: Root } {
  let api: CardReviewApi
  function Probe() {
    api = useCardReview(root, source, SETTINGS, () => undefined, 'vault', host)
    return null
  }
  const r = createRoot(document.createElement('div'))
  act(() => r.render(createElement(Probe)))
  return { get: () => api, root: r }
}

async function desktopRun(files: Record<string, string> = FILES): Promise<Run> {
  disk = new Map(Object.entries(files).map(([p, c]) => [`${ROOT}/${p}`, c]))
  storage.setUpNextTaken(ROOT, { day: '2000-1-1', cards: [] })
  storage.setCardsAdded(ROOT, { day: '2000-1-1', newCards: 0, upNext: 0 })
  const listeners = new Set<() => void>()
  let records: IndexRecord[] = []
  const reindex = () => {
    records = [...disk]
      .filter(([p]) => p.endsWith('.md'))
      .map(([p, c]) => phoneRecord(p, c.length, c, { ctime: 0, mtime }))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
    listeners.forEach((l) => l())
  }
  reindex()
  const source = { get records() { return records }, folders: [] as IndexRecord[], letters: undefined, subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)) }
  const m = mount(source, desktopReviewHost, ROOT)
  const settle = async () => {
    for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
    await act(async () => reindex())
  }
  const lines = async () => linesOf(Object.fromEntries([...disk].map(([p, c]) => [p.slice(ROOT.length + 1), c])))
  return { review: m.get, settle, lines, stop: () => act(() => m.root.unmount()) }
}

async function phoneRun(files: Record<string, string> = FILES): Promise<Run> {
  const t = await answersSetup({ files })
  t.s.github.offline = true // the phone answers with no signal; the lines are the phone's view
  const link = { engine: t.engine, answers: t.answers, store: t.store }
  const source = createReviewSource(link, VAULT, 'vault')
  await source.refresh()
  const days = await openPhoneDays(t.store, VAULT)
  const host = phoneReviewHost({ answers: t.answers, days, vaultName: () => 'vault' })
  const m = mount(source, host, VAULT)
  const settle = async () => {
    for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  }
  const lines = async () => {
    const out: Record<string, string> = {}
    for (const p of Object.keys(files)) out[p] = (await t.answers.text(p)) ?? ''
    return linesOf(out)
  }
  return { review: m.get, settle, lines, stop: () => (act(() => m.root.unmount()), source.stop()) }
}

function linesOf(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const content of Object.values(files)) for (const c of pageCards(content)) out[cardIdOf(c.line) ?? '?'] = formatCardLine(c.line) ?? ''
  return out
}

/** The steps: the same taps on both. Each returns what the session shows after it. */
async function script(run: Run): Promise<string[]> {
  const seen: string[] = []
  const look = () => {
    const s = run.review().session
    seen.push(s === null ? 'none' : `${s.card?.id ?? 'done'} ${s.position}/${s.total} due:${run.review().dueCount} [${s.counts.all}/${s.counts.next}/${s.counts.due}/${s.counts.new}]`)
  }
  const minute = (m: number) => vi.setSystemTime(NOW + m * 60_000)
  const step = async (m: number, fn: () => unknown) => {
    minute(m)
    await act(async () => void (await fn()))
    await run.settle()
    look()
  }
  await step(0, () => run.review().start())
  await step(1, () => run.review().answer('good', 12))
  await step(2, () => run.review().answer('again', 30))
  await step(3, () => run.review().undo())
  await step(4, () => run.review().answer('good', 5))
  const c = () => run.review().session!.card!
  await step(5, () => run.review().setNext(c().path, c().id, true))
  await step(6, () => run.review().turnOff())
  await step(7, () => run.review().answer('again', 9))
  await step(7, () => run.review().answer('good', 4)) // the same minute: a second review (YAZ-5078)
  for (let m = 8; m < 20 && run.review().session?.card != null; m++) await step(m, () => run.review().answer('good', 3))
  await step(21, () => run.review().addCards('new'))
  return seen
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('one review logic (decision 3): the Mac host and the phone host give the same due list and the same card lines', () => {
  it('the same made-up vault, the same taps', async () => {
    const mac = await desktopRun()
    const macSeen = await script(mac)
    const macLines = await mac.lines()
    mac.stop()
    vi.setSystemTime(NOW)
    const phone = await phoneRun()
    const phoneSeen = await script(phone)
    const phoneLines = await phone.lines()
    phone.stop()
    expect(phoneSeen).toEqual(macSeen)
    expect(phoneLines).toEqual(macLines)
    // The run did something: answers, Up next, an archive, two reviews in one minute.
    expect(Object.values(macLines).join('\n')).toMatch(/off/)
    expect(macSeen.length).toBeGreaterThan(8)
    console.log(`[4B parity] ${macSeen.length} steps; due list: ${macSeen.join(' | ')}`)
  })

  it('one new card, Remembered two times in ONE minute (it comes back at once): two reviews on both', async () => {
    const files = { '.yaseendocs/review.json': '{}', 'one.md': page('One', cardBlock('Only?\n---\n{{one}}', 'PA-9')) }
    const tap = async (run: Run) => {
      const seen: string[] = []
      for (const fn of [() => run.review().start(), () => run.review().answer('good', 2), () => run.review().answer('good', 3)]) {
        await act(async () => void (await fn()))
        await run.settle()
        seen.push(run.review().session?.card?.id ?? 'done')
      }
      return seen
    }
    const mac = await desktopRun(files)
    const macSeen = await tap(mac)
    const macLines = await mac.lines()
    mac.stop()
    const phone = await phoneRun(files)
    expect(await tap(phone)).toEqual(macSeen)
    expect(await phone.lines()).toEqual(macLines)
    phone.stop()
    expect(macSeen).toEqual(['PA-9', 'PA-9', 'done'])
    expect(macLines['PA-9'].match(/good/g)).toHaveLength(2)
  })
})
