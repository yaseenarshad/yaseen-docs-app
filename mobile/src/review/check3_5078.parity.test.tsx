// @vitest-environment jsdom
/// <reference path="../../../client/src/bridge.d.ts" />
// Checker round 3 (YAZ-5078): one new made-up vault (based on round 2's harness); earlier: three made-up vaults of the checker's own, 40 actions each, through the Mac's host and the
// phone's host. The due list (with its ORDER), the counts, and the bytes of every file must be the same.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopReviewHost } from '@client/review/desktopReviewHost'
import type { ReviewHost } from '@client/review/reviewHost'
import { useCardReview, type CardReviewApi } from '@client/review/useCardReview'
import { storage } from '@client/lib/storage'
import { cardPlan } from '@shared/cardSchedule'
import { sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { answersSetup } from '../answers/testing'
import { openPhoneDays, phoneReviewHost } from '../answers/reviewHost'
import { phoneRecord } from '../sync/phoneIndex'
import { BRANCH, VAULT } from '../sync/testing'
import { SEND_AFTER_MS } from '../sync/cadence'
import { createReviewSource } from './source'
import { NOW, cardBlock, cardFile, page } from './testing'

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

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 16) + 'Z'
const ago = (days: number, hours = 0) => iso(NOW - days * DAY - hours * 3_600_000)

// ── Vault 1: a language vault. New cards over the day limit, due, answered today, archived, Up next, Fix later,
//    a card with 5 hidden words, a two-sided card, pages and card files, an invalid card file. newPerDay 3.
const V1: Record<string, string> = {
  '.yaseendocs/review.json': JSON.stringify({ newPerDay: 3, fuzz: false }),
  'lang/verbs.md': page(
    'Verbs',
    cardBlock('ser?\n---\n{{to be}}', `VB-1, ${ago(20)} good, ${ago(9)} good`),
    cardBlock('tener?\n---\n{{to have}}', 'VB-2'),
    cardBlock('ir?\n---\n{{to go}}', 'VB-3'),
    cardBlock('hacer?\n---\n{{to do}}', `VB-4, ${ago(0, 2)} again, ${ago(0, 1)} good`),
    cardBlock('poder?\n---\n{{can}}', 'VB-5, off, ' + ago(30) + ' good'),
    cardBlock('decir?\n---\n{{to say}}', 'VB-6, next'),
    cardBlock('ver?\n---\n{{to see}}', `VB-7, ${ago(40)} good, ${ago(12)} hard, fix`),
  ),
  'lang/sentences.md': page(
    'Sentences',
    cardBlock('Fill: {{yo}} {{tengo}} {{un}} {{perro}} {{negro}}', 'SN-1'),
    cardBlock('Side one?\n---\nSide {{two}}\n---\nSide {{three}}', `SN-2, ${ago(3)} again`),
    cardBlock('Nada?\n---\n{{nothing}}', 'SN-3'),
    cardBlock('Todo?\n---\n{{everything}}', 'SN-4'),
  ),
  'cards/el-gato.md': cardFile('El gato', cardBlock('gato?\n---\n{{cat}}', `CF-1, ${ago(15)} good, ${ago(6)} good`)),
  'cards/el-perro.md': cardFile('El perro', cardBlock('perro?\n---\n{{dog}}', 'CF-2, next')),
  'cards/broken.md': cardFile('Broken', cardBlock('one?\n---\n{{1}}', 'CF-3'), '\n' + cardBlock('two?\n---\n{{2}}', 'CF-4') + '\n'),
  'lang/renamed-file-name.md': page('A title that is not the file name', cardBlock('renamed?\n---\n{{yes}}', `RN-1, ${ago(10)} good, ${ago(4)} good`)),
  'index.md': page('Home', '![[CF-1]]', '[[Verbs]]'),
}

// ── Vault 2: the new-card limit is spent by reviews IN THE FILES (another device answered 3 new cards today).
const V2: Record<string, string> = {
  '.yaseendocs/review.json': JSON.stringify({ newPerDay: 3, upNextPerDay: 1, fuzz: false }),
  'a.md': page(
    'Done elsewhere',
    cardBlock('n1?\n---\n{{1}}', `NW-1, ${ago(0, 3)} good`),
    cardBlock('n2?\n---\n{{2}}', `NW-2, ${ago(0, 3)} good`),
    cardBlock('n3?\n---\n{{3}}', `NW-3, ${ago(0, 3)} again`),
    cardBlock('n4?\n---\n{{4}}', 'NW-4'),
    cardBlock('n5?\n---\n{{5}}', 'NW-5'),
    cardBlock('n6?\n---\n{{6}}', 'NW-6, next'),
    cardBlock('n7?\n---\n{{7}}', 'NW-7, next'),
    cardBlock('n8?\n---\n{{8}}', 'NW-8, next'),
  ),
  'b.md': page('Due', cardBlock('d1?\n---\n{{1}}', `DU-1, ${ago(30)} good, ${ago(8)} good`), cardBlock('d2?\n---\n{{2}}', `DU-2, ${ago(5)} again`), cardBlock('d3?\n---\n{{3}}', `DU-3, ${ago(60)} easy, ${ago(20)} good`)),
}

// ── Vault 3: four buttons, many due cards, archived and fixed among them.
const V3cards = Array.from({ length: 14 }, (_, i) => cardBlock(`q${i}?\n---\n{{a${i}}} and {{b${i}}}`, `QQ-${i + 1}${i % 3 === 0 ? `, ${ago(9 + i)} good, ${ago(2 + (i % 4))} hard` : i % 5 === 1 ? ', fix' : i === 7 ? ', off' : ''}`))
const V3: Record<string, string> = {
  '.yaseendocs/review.json': JSON.stringify({ buttons: 4, newPerDay: 5, fuzz: false }),
  'q/one.md': page('One', ...V3cards.slice(0, 7)),
  'q/two.md': page('Two', ...V3cards.slice(7)),
  'cards/x.md': cardFile('X card', cardBlock('x?\n---\n{{x}}', `XX-1, ${ago(4)} again`)),
}

interface Run {
  review: () => CardReviewApi
  settle: () => Promise<void>
  files: () => Promise<Record<string, string>>
  records: () => readonly IndexRecord[]
  setFix: (path: string, id: string, on: boolean) => Promise<void>
  stop: () => void
}

function mount(source: Parameters<typeof useCardReview>[1], host: ReviewHost, root: string, settings: ReviewSettings): { get: () => CardReviewApi; root: Root } {
  let api: CardReviewApi
  function Probe() {
    api = useCardReview(root, source, settings, () => undefined, 'vault', host)
    return null
  }
  const r = createRoot(document.createElement('div'))
  act(() => r.render(createElement(Probe)))
  return { get: () => api, root: r }
}

const settingsOf = (files: Record<string, string>) => sanitizeReviewSettings(JSON.parse(files['.yaseendocs/review.json']))

async function desktopRun(files: Record<string, string>): Promise<Run> {
  disk = new Map(Object.entries(files).map(([p, c]) => [`${ROOT}/${p}`, c]))
  storage.setUpNextTaken(ROOT, { day: '2000-1-1', cards: [] })
  storage.setCardsAdded(ROOT, { day: '2000-1-1', newCards: 0, upNext: 0 })
  const listeners = new Set<() => void>()
  let records: IndexRecord[] = []
  const reindex = () => {
    records = [...disk]
      .filter(([p]) => p.endsWith('.md'))
      .map(([p, c]) => phoneRecord(p, new TextEncoder().encode(c).length, c, { ctime: 0, mtime }))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
    listeners.forEach((l) => l())
  }
  reindex()
  const source = { get records() { return records }, folders: [] as IndexRecord[], letters: undefined, subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)) }
  const host: ReviewHost = desktopReviewHost
  const m = mount(source, host, ROOT, settingsOf(files))
  const settle = async () => {
    for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
    await act(async () => reindex())
    for (let i = 0; i < 2; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  }
  return {
    review: m.get,
    settle,
    files: async () => Object.fromEntries([...disk].map(([p, c]) => [p.slice(ROOT.length + 1), c])),
    records: () => records,
    setFix: async (path, id, on) => void (await m.get().setFix(path, id, on)),
    stop: () => act(() => m.root.unmount()),
  }
}

async function phoneRun(files: Record<string, string>) {
  const t = await answersSetup({ files })
  t.s.github.offline = true
  const link = { engine: t.engine, answers: t.answers, store: t.store }
  const source = createReviewSource(link, VAULT, 'vault')
  await source.refresh()
  const days = await openPhoneDays(t.store, VAULT)
  const host = phoneReviewHost({ answers: t.answers, days, vaultName: () => 'vault' })
  const m = mount(source, host, VAULT, settingsOf(files))
  const settle = async () => {
    for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  }
  const run: Run = {
    review: m.get,
    settle,
    files: async () => {
      const out: Record<string, string> = {}
      for (const p of Object.keys(files)) out[p] = (await t.answers.text(p)) ?? ''
      return out
    },
    records: () => source.records,
    setFix: async (path, id, on) => void (await m.get().setFix(path, id, on)),
    stop: () => (act(() => m.root.unmount()), source.stop()),
  }
  return { run, t }
}

type Action = 'good' | 'again' | 'hard' | 'easy' | 'undo' | 'archive' | 'next' | 'unnext' | 'fix' | 'add-new' | 'add-next' | 'f-all' | 'f-new' | 'f-due' | 'f-next'
const SCRIPT_A: Action[] = ['good', 'again', 'undo', 'good', 'next', 'good', 'fix', 'again', 'again', 'undo', 'undo', 'good', 'archive', 'f-new', 'good', 'again', 'f-due', 'good', 'f-all', 'add-new', 'good', 'undo', 'good', 'add-next', 'again', 'good', 'unnext', 'good', 'fix', 'good', 'again', 'again', 'good', 'good', 'add-new', 'good', 'undo', 'undo', 'good', 'good']
const SCRIPT_B: Action[] = ['f-next', 'good', 'good', 'f-new', 'good', 'again', 'undo', 'f-all', 'again', 'good', 'add-new', 'good', 'good', 'add-next', 'good', 'undo', 'good', 'again', 'archive', 'good', 'next', 'good', 'add-new', 'again', 'good', 'good', 'undo', 'fix', 'good', 'good', 'good', 'add-next', 'good', 'again', 'again', 'good', 'good', 'good', 'add-new', 'good']
const SCRIPT_C: Action[] = ['hard', 'easy', 'again', 'undo', 'good', 'hard', 'archive', 'fix', 'easy', 'again', 'again', 'undo', 'next', 'good', 'f-new', 'easy', 'f-due', 'hard', 'f-next', 'good', 'f-all', 'add-new', 'easy', 'again', 'undo', 'undo', 'good', 'hard', 'add-next', 'good', 'good', 'good', 'again', 'good', 'good', 'easy', 'good', 'good', 'add-new', 'good']

async function play(run: Run, script: Action[], settings: ReviewSettings): Promise<string[]> {
  const seen: string[] = []
  const look = (what: string) => {
    const r = run.review()
    const s = r.session
    const plan = cardPlan(run.records(), settings, Date.now()).queue.map((c) => `${c.id}${c.isNew ? '*' : ''}${c.next ? '^' : ''}`)
    seen.push(`${what} → ${s === null ? 'none' : `${s.card?.id ?? 'done'} ${s.position}/${s.total} due:${r.dueCount} c[${s.counts.all}/${s.counts.next}/${s.counts.due}/${s.counts.new}] more[${s.more.new}/${s.more.next}] adds[${s.adds.new}/${s.adds.next}] f:${s.filter} undo:${s.canUndo} today:${s.today.cards}`} plan:${plan.join(',')}`)
  }
  vi.setSystemTime(NOW)
  await act(async () => run.review().start())
  await run.settle()
  look('start')
  for (let i = 0; i < script.length; i++) {
    vi.setSystemTime(NOW + (i + 1) * 20_000) // 20 s apart: two or three actions share each minute
    const a = script[i]
    const r = run.review()
    const c = r.session?.card ?? null
    await act(async () => {
      if (a === 'good' || a === 'again' || a === 'hard' || a === 'easy') {
        if (c !== null) r.showAnswers()
      }
    })
    await act(async () => {
      const rr = run.review()
      const cc = rr.session?.card ?? null
      switch (a) {
        case 'good': case 'again': case 'hard': case 'easy':
          if (cc !== null) await rr.answer(a, 5 + i)
          break
        case 'undo': await rr.undo(); break
        case 'archive': if (cc !== null) await rr.turnOff(); break
        case 'next': if (cc !== null) await rr.setNext(cc.path, cc.id, true); break
        case 'unnext': if (cc !== null) await rr.setNext(cc.path, cc.id, false); break
        case 'fix': if (cc !== null) await run.setFix(cc.path, cc.id, true); break
        case 'add-new': rr.addCards('new'); break
        case 'add-next': rr.addCards('next'); break
        case 'f-all': rr.setFilter('all'); break
        case 'f-new': rr.setFilter('new'); break
        case 'f-due': rr.setFilter('due'); break
        case 'f-next': rr.setFilter('next'); break
      }
    })
    await run.settle()
    look(`${i + 1}:${a}${c === null ? '' : `@${c.id}`}`)
  }
  return seen
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())


const R3 = (id: string, front: string, extra = '') => `\`\`\`card\n${front}\n---\nR3 back of ${id}: {{x ${id}}}\n---\nlast side {{y ${id}}} and {{z ${id}}}\n\`\`\`\n<!-- card: ${id}${extra} -->`
const VR3: Record<string, string> = {
  '.yaseendocs/review.json': '{"newPerDay": 2, "upNextPerDay": 1, "fuzz": false}',
  'garden/plants.md': `---\ntitle: Plant notes (round 3)\n---\n\n# Plants\n\nSome text before the cards.\n\n${R3('PL-1', 'What is a fern?', ', 2026-09-20T08:00Z good, 2026-10-10T08:00Z good')}\n\n${R3('PL-2', 'Moss or lichen?')}\n\n${R3('PL-3', 'Which tree loses leaves?', ', next')}\n\n${R3('PL-4', 'Cactus water?', ', 2026-11-12T09:00Z again, 2026-11-13T07:00Z hard')}\n\n${R3('PL-5', 'Secret title\nWhat is a {{bulb}}?', ', notitle, 2026-10-25T08:00Z good')}\n`,
  'cards/pl-6.md': `---\nkind: card\ntitle: Oak\n---\n\n${R3('PL-6', 'How old can an oak get?', ', 2026-08-01T08:00Z easy, 2026-09-15T08:00Z good')}\n`,
  'cards/pl-7.md': `---\nkind: card\ntitle: Ivy\n---\n\n${R3('PL-7', 'Does ivy climb?', ', next')}\n`,
  'garden/more.md': `---\ntitle: More\n---\n\n${R3('PL-8', 'Archived one?', ', off, 2026-10-01T08:00Z good')}\n\n${R3('PL-9', 'Rose thorns?', ', fix')}\n\n${R3('PL-10', 'Tulip from?')}\n\n${R3('PL-11', 'Daisy?', ', 2026-11-01T08:00Z good')}\n\n![[cards/pl-6]]\n\n![[PL-7]]\n`,
}
// (builder, YAZ-5336) The REAL Mac host, on the actions both apps have. An Undo right after Archive card is the one
// designed difference (the phone takes back the archive; the Mac, the answer before): it is not in this script. The
// phone's Undo of Archive card has its own test (`archiveUndo.test.tsx`).
const SCRIPT_R3: Action[] = ['again', 'good', 'undo', 'good', 'next', 'good', 'f-new', 'again', 'good', 'undo', 'undo', 'f-next', 'good', 'f-due', 'archive', 'good', 'fix', 'f-all', 'add-new', 'good', 'again', 'add-next', 'good', 'unnext', 'good', 'undo', 'good', 'again', 'again', 'next', 'good', 'archive', 'good', 'f-new', 'good', 'add-new', 'good', 'good', 'again', 'good']
const CASES: [string, Record<string, string>, Action[]][] = [['R3 checker round 3 vault', VR3, SCRIPT_R3]]

describe('checker 4B r3: the same answers as the Mac, one new vault, 40 actions', () => {
  for (const [name, files, script] of CASES) {
    it(name, async () => {
      const settings = settingsOf(files)
      const mac = await desktopRun(files)
      const macSeen = await play(mac, script, settings)
      const macFiles = await mac.files()
      mac.stop()
      vi.setSystemTime(NOW)
      const { run: phone, t } = await phoneRun(files)
      const phoneSeen = await play(phone, script, settings)
      const phoneFiles = await phone.files()
      // Then the phone gets a signal and sends: GitHub's bytes must be the Mac's bytes too.
      t.s.github.offline = false
      await t.answers.sendNow()
      await t.tick(SEND_AFTER_MS)
      await t.answers.sendNow()
      const remote = await t.s.git.filesAt(t.s.git.branches.get(BRANCH)!)
      phone.stop()
      const diffs = macSeen.map((m, i) => (m === phoneSeen[i] ? null : `#${i}\n  mac:   ${m}\n  phone: ${phoneSeen[i]}`)).filter(Boolean)
      console.log(`[parity3 ${name}] steps ${macSeen.length}; first: ${macSeen[0]}\n  last: ${macSeen.at(-1)}\n  diffs: ${diffs.length}\n${diffs.slice(0, 4).join('\n')}`)
      const fileDiffs = Object.keys(files).filter((p) => macFiles[p] !== phoneFiles[p] || macFiles[p] !== remote[p])
      for (const p of fileDiffs) console.log(`[parity3 ${name}] FILE ${p}\n--mac--\n${macFiles[p]}\n--phone view--\n${phoneFiles[p]}\n--github--\n${remote[p]}`)
      const changed = Object.keys(files).filter((p) => macFiles[p] !== files[p])
      console.log(`[parity3 ${name}] files changed by the script: ${changed.join(', ')}; waiting after send: ${t.answers.waiting().length}; lost: ${t.answers.state().lost.length}`)
      expect(phoneSeen).toEqual(macSeen)
      expect(fileDiffs).toEqual([])
    })
  }
})
