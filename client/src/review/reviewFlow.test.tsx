/**
 * YAZ-5708, the Mac: every scenario of the Review flow tester (`reviewFlow.testing.tsx`) on the review hook the Mac's
 * Inbox runs, with the shared screen pieces the Inbox draws (`SessionCount`, `SessionBar`, `DoneScreen`, the ⚙'s
 * `AddMoreField`), on an in-memory vault (`memoryReviewHost`: the Mac's own card read and line writes). The other
 * device is a write to the files that the index then has. The phone runs the same scenarios: `mobile/src/review/reviewFlow.test.tsx`.
 */
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cardRecords, cardTime, type CardRating } from '@shared/cardLine'
import { sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { useCardReview, type CardReviewApi } from './useCardReview'
import { memoryReviewHost } from './memoryReviewHost'
import { SessionBar, SessionCount } from './SessionCount'
import { DoneScreen, type DoneLook } from './DoneScreen'
import { AddMoreField } from './AddMoreField'
import { showsAgain } from './cardInboxChip'
import { seeded } from './sessionRules.testing'
import { FLOW_SCENARIOS, FlowModel, FlowTester, readShared, type FlowDriver, type FlowVault } from './reviewFlow.testing'

vi.mock('./confetti', () => ({ confettiBurst: () => () => undefined }))
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/flow'
/** Made-up "now": Friday 13 November 2026, 10:00 local time. */
const NOW = new Date(2026, 10, 13, 10, 0).getTime()
/** The Mac's finish screen look (`CardInbox`'s `DONE_LOOK`). */
const LOOK: DoneLook = { title: 'card-inbox__done-title', line: 'card-inbox__done-line', more: 'card-inbox__done-more', today: 'card-inbox__done-today', go: 'due-end__go' }

let root: Root | null = null
let box: HTMLElement | null = null

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await Promise.resolve()))
}

function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function macDriver(vault: FlowVault): Promise<FlowDriver> {
  const host = memoryReviewHost(new Map(Object.entries(vault.files).filter(([p]) => p.endsWith('.md')).map(([p, c]) => [`${ROOT}/${p}`, c])), 'Flow vault')
  const mtimes = new Map<string, { content: string; mtime: number }>()
  let tick = 1
  let records: IndexRecord[] = []
  let listeners: Array<() => void> = []
  const reindex = () => {
    records = [...host.files].map(([path, content]) => {
      const was = mtimes.get(path)
      const mtime = was !== undefined && was.content === content ? was.mtime : tick++
      mtimes.set(path, { content, mtime })
      const name = path.slice(path.lastIndexOf('/') + 1)
      return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder: '', ext: 'md', size: content.length, ctime: 0, mtime, properties: {}, aliases: [], tags: [], links: [], embeds: [], cards: cardRecords(content) }
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
  const first = sanitizeReviewSettings(JSON.parse(vault.files['.yaseendocs/review.json']))
  let api!: CardReviewApi
  function Probe() {
    const [settings, setSettings] = useState<ReviewSettings>(first)
    api = useCardReview(ROOT, source, settings, () => undefined, 'Flow vault', host, setSettings)
    const s = api.session
    if (s === null) return null
    return (
      <div className="card-inbox">
        {s.progress.total > 0 && <SessionCount session={s} icon={null} />}
        <SessionBar session={s} />
        {(s.card === null || s.end !== null) && (
          <div className="flow-done">
            <DoneScreen review={api} session={s} shown look={LOOK} addKinds={[]} adds={null} from={null} unit={(t) => t} />
          </div>
        )}
        {/* The cards menu's ⚙ › Add today (YAZ-5690): its ask in place first. */}
        <div className="flow-adds">
          {(['new', 'next'] as const).map((k) => s.adds[k] > 0 && <AddMoreField key={k} kind={k} look="setting" start={s.adds[k]} onAdd={(n) => api.addCards(k, n)} />)}
        </div>
      </div>
    )
  }
  box = document.createElement('div')
  document.body.append(box)
  root = createRoot(box)
  await act(async () => root!.render(<Probe />))
  // The index catches up with each write between two clicks, as the Mac's does.
  const step = async (run: () => unknown) => {
    await act(async () => void (await run()))
    await settle()
    await act(async () => reindex())
    await settle()
  }
  await step(() => api.start())
  const button = (words: string) => [...box!.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(words))
  return {
    name: 'mac',
    async view() {
      const s = api.session!
      const card = s.card === null || s.end !== null ? null : { id: s.card.id, isNew: s.card.isNew, again: showsAgain(s.card) }
      return { filter: s.filter, card, menu: { ...s.counts }, ...readShared(box!, LOOK, card === null ? box!.querySelector('.flow-done') : null) }
    },
    async answer(rating: CardRating) {
      vi.setSystemTime(Date.now() + 4_000)
      await step(() => api.showAnswers())
      await step(() => api.answer(rating, 4))
    },
    undo: () => step(() => api.undo()),
    filter: (f) => step(() => api.setFilter(f)),
    async press(words) {
      const b = button(words)
      if (b === undefined) throw new Error(`No "${words}" on: ${box!.textContent}`)
      await step(() => b.click())
    },
    async reopen() {
      await step(() => api.close())
      await step(() => api.start())
    },
    async add(kind, n) {
      const field = box!.querySelector<HTMLElement>(`.card-inbox__add-setting[data-kind="${kind}"]`)
      if (field === null) throw new Error(`No ⚙ Add today for ${kind}`)
      await step(() => typeInto(field.querySelector('input')!, String(n)))
      await step(() => field.querySelector<HTMLButtonElement>('.card-inbox__add-go')!.click())
      // The ask in place: Cancel first, then Add.
      const ask = box!.querySelector('.flow-adds .ask-in-place')
      if (ask === null) throw new Error('Add added with no ask (YAZ-5690)')
      await step(() => ask.querySelectorAll<HTMLButtonElement>('button')[1].click())
    },
    order: (o) => step(() => api.setOrder(o)),
    async elsewhere(id, rating) {
      const path = `${ROOT}/cards.md`
      await host.writeCardAnswer(path, id, { at: cardTime(Date.now() - 1_000), rating })
      await step(() => undefined)
    },
    async clock(time) {
      vi.setSystemTime(time)
      await step(() => window.dispatchEvent(new Event('focus')))
    },
    stop() {
      act(() => root?.unmount())
      root = null
      box?.remove()
      box = null
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  // Shuffle is random: one seed, so a failure plays the same again.
  const rnd = seeded(5708)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  box?.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('YAZ-5708 the Review flow tester on the Mac: every filter and flow, the numbers checked after every answer', () => {
  for (const scenario of FLOW_SCENARIOS)
    it(scenario.name, async () => {
      const vault = scenario.vault(NOW)
      const d = await macDriver(vault)
      const settings = sanitizeReviewSettings(JSON.parse(vault.files['.yaseendocs/review.json']))
      const t = new FlowTester(d, new FlowModel(vault, settings.newPerDay))
      await scenario.run(t, NOW)
      d.stop()
    })
})
