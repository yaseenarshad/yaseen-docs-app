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
import { cardIdOf, pageCards, withCardFix } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
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
 * answer list on the real engine and the fake GitHub). The due list after each step, its order, the title each card
 * shows, and the card lines and files at the end must be the same, byte for byte. YAZ-5309: the titles are on the card
 * lines (YAZ-5308, decision D), some with a quote, a comma (`&#44;`, YAZ-5393), `-->`, a backslash, non-ASCII letters and
 * an emoji; a card file's properties hold only `kind: card`. YAZ-5349: each card's own properties are on its card line
 * too (`tags "europe" "capitals"`, `["x"]`, a value with a comma, a hand-written form, 20 of them), and every step
 * keeps them byte for byte on both hosts. One title is in an older build's form (a raw comma): both hosts encode it.
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
const TWENTY = Array.from({ length: 20 }, (_, i) => `p${i + 1} ${i % 2 === 0 ? `"v${i}"` : String(i)}`).join(', ')
const FILES: Record<string, string> = {
  '.yaseendocs/review.json': JSON.stringify({ newPerDay: 3, fuzz: false }),
  'spanish.md': page(
    'Spanish words',
    cardBlock('Old one?\n---\n{{viejo}}', 'PA-1, title "Viejo", tags "europe" "capitals", level "A2", 2026-10-01T09:00:00.000Z good, 2026-10-05T09:00:00.000Z good'),
    cardBlock('Hola?\n---\n{{hello}}', 'PA-2, title "Hola&#44; \\"mundo\\" --\\> \\\\ ñandú 🙂", source "Atlas, chapter 3", say "\\"hi\\""'),
    cardBlock('Adios?\n---\n{{bye}}', `PA-3, tags ["x"], none [], ${TWENTY}, next`),
  ),
  'cards/speed-of-light-pa-4.md': cardFile('Speed of light', cardBlock('How fast?\n---\n{{300,000 km/s}}', 'PA-4, note "x&#44;y", ratio 2.50')),
  'git.md': page('Git', cardBlock('git pull?\n---\nIt {{fetches}} and {{merges}}.', 'PA-5, title "a > b, by hand", tags  "a"   "b", 2026-11-10T09:00:00.000Z again'), cardBlock('git push?\n---\n{{uploads}}', 'PA-6, title ""'), '![[PA-4]]'),
}

/** One run: the hook with a host, and the steps. Returns what showed after each step, and the card lines. */
interface Run {
  review: () => CardReviewApi
  settle: () => Promise<void>
  lines: () => Promise<Record<string, string>>
  /** Each file as it is now, by its path in the vault. */
  files: () => Promise<Record<string, string>>
  /** Fix later through the host, as the phone's ⋯ writes it (the hook has no setFix since YAZ-5430). */
  setFix: (path: string, id: string, on: boolean) => Promise<void>
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
  const onDisk = async () => Object.fromEntries([...disk].map(([p, c]) => [p.slice(ROOT.length + 1), c]))
  const lines = async () => linesOf(await onDisk())
  return { review: m.get, settle, lines, files: onDisk, setFix: async (path, id, on) => void (await desktopReviewHost.changeCardLine(path, id, (l) => withCardFix(l, on))), stop: () => act(() => m.root.unmount()) }
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
  const shown = async () => {
    const out: Record<string, string> = {}
    for (const p of Object.keys(files)) out[p] = (await t.answers.text(p)) ?? ''
    return out
  }
  const lines = async () => linesOf(await shown())
  return { review: m.get, settle, lines, files: shown, setFix: async (path, id, on) => void (await host.changeCardLine(path, id, (l) => withCardFix(l, on))), stop: () => (act(() => m.root.unmount()), source.stop()) }
}

/** Each card's line as the file holds it: its bytes, not the parser's reading of them. */
function linesOf(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const content of Object.values(files)) {
    const body = splitFrontmatter(content).body.split('\n')
    for (const c of pageCards(content)) out[cardIdOf(c.line) ?? '?'] = c.lineAt === null ? '' : body[c.lineAt]
  }
  return out
}

/** The steps: the same taps on both. Each returns what the session shows after it. */
async function script(run: Run): Promise<string[]> {
  const seen: string[] = []
  const look = () => {
    const s = run.review().session
    seen.push(s === null ? 'none' : `${s.card?.id ?? 'done'} "${s.card?.page?.title ?? '-'}" ${JSON.stringify(s.card?.page?.properties ?? null)} ${s.position}/${s.total} due:${run.review().dueCount} [${s.counts.all}/${s.counts.next}/${s.counts.due}/${s.counts.new}]`)
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
  await step(5, () => run.setFix(c().path, c().id, true))
  await step(6, () => run.review().turnOff())
  await step(7, () => run.review().answer('again', 9))
  await step(7, () => run.review().answer('good', 4)) // the same minute: a second review (YAZ-5078)
  // YAZ-5495 (the Mac's YAZ-5043): a stop at the end of Due today is passed with its one button, as a person does.
  for (let m = 8; m < 20 && (run.review().session?.card != null || run.review().session?.end != null); m++) await step(m, () => (run.review().session?.end != null ? run.review().goOn() : run.review().answer('good', 3)))
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
    const [macFiles, phoneFiles] = [await mac.files(), await phone.files()]
    phone.stop()
    expect(phoneSeen).toEqual(macSeen)
    // YAZ-5409: the phone changes only its own parts. A part that an older build or a hand wrote with a raw comma keeps
    // its bytes on the phone (its splice); the Mac's write encodes it (YAZ-5393). Every other byte is the same.
    const RAW: [string, string][] = [
      ['source "Atlas&#44; chapter 3"', 'source "Atlas, chapter 3"'],
      ['title "a \\> b&#44; by hand"', 'title "a > b, by hand"'],
    ]
    const asPhone = (texts: Record<string, string>) => Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, RAW.reduce((t, [mac, raw]) => t.replace(mac, raw), v)]))
    expect(phoneLines).toEqual(asPhone(macLines))
    expect(phoneFiles).toEqual(asPhone(macFiles))
    expect(phoneLines).not.toEqual(macLines)
    // The titles showed, and each title part is where it was, with its bytes, on both.
    expect(macSeen.join('\n')).toContain('PA-2 "Hola, "mundo" --> \\ ñandú 🙂" {"source":"Atlas, chapter 3","say":"\\"hi\\""}')
    expect(macSeen.join('\n')).toContain('"Speed of light"')
    for (const [id, part] of [
      ['PA-1', 'title "Viejo", tags "europe" "capitals", level "A2"'],
      // A raw comma in a value: the Mac's first write encodes it, as a title's (YAZ-5393, the one escape).
      ['PA-2', 'title "Hola&#44; \\"mundo\\" --\\> \\\\ ñandú 🙂", source "Atlas&#44; chapter 3", say "\\"hi\\""'],
      ['PA-3', `tags ["x"], none [], ${TWENTY}`],
      ['PA-4', 'title "Speed of light", note "x&#44;y", ratio 2.50'],
      // An older build's raw comma: the Mac's first write encodes it (YAZ-5393); the hand-written property keeps its bytes.
      ['PA-5', 'title "a \\> b&#44; by hand", tags  "a"   "b"'],
      ['PA-6', 'title ""'],
    ])
      expect(macLines[id].startsWith(`<!-- card: ${id}, ${part}`), `${id}: ${macLines[id]}`).toBe(true)
    expect(macFiles['cards/speed-of-light-pa-4.md'].startsWith('---\nkind: card\n---\n')).toBe(true)
    expect(Object.values(macLines).join('\n')).toMatch(/fix/)
    // The run did something: answers, Up next, an archive, two reviews in one minute.
    expect(Object.values(macLines).join('\n')).toMatch(/off/)
    expect(macSeen.length).toBeGreaterThan(8)
    console.log(`[4B parity] ${macSeen.length} steps; due list: ${macSeen.join(' | ')}`)
  })

  it('one new card, Remembered two times in ONE minute (it comes back at once): two reviews on both', async () => {
    const files = { '.yaseendocs/review.json': '{}', 'one.md': page('One', cardBlock('Only?\n---\n{{one}}', 'PA-9')) }
    const tap = async (run: Run) => {
      const seen: string[] = []
      vi.setSystemTime(NOW)
      for (const fn of [() => run.review().start(), () => run.review().answer('good', 2), () => run.review().answer('good', 3)]) {
        vi.setSystemTime(Date.now() + 1_000) // YAZ-5642: each answer has its own time, in the same minute
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
