// @vitest-environment jsdom
/**
 * YAZ-5708, the phone: every scenario of the Review flow tester (`@client/review/reviewFlow.testing.tsx`) on the REAL
 * Review screen (`ReviewView`): the engine and the answer list on the fake GitHub, every step a tap on the screen and
 * every number read from it — the top's count, the bar, the cards sheet (its counts, its ⚙ with Add today and its
 * ask, the Order rows), the finish screens. The other device is a commit on GitHub that a sync brings. The Mac runs
 * the same scenarios: `client/src/review/reviewFlow.test.tsx`.
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { changeCard, withCardReview, cardTime, type CardRating } from '@shared/cardLine'
import { sanitizeReviewSettings } from '@shared/reviews'
import type { CardFilter } from '@client/review/useCardReview'
import { CARD_FILTERS } from '@client/review/cardFilters'
import { seeded } from '@client/review/sessionRules.testing'
import { FLOW_SCENARIOS, FlowModel, FlowTester, readShared, type FlowDriver, type FlowVault } from '@client/review/reviewFlow.testing'
import { BRANCH } from '../sync/testing'
import { DONE_LOOK } from './ReviewView'
import { NOW, mountReview, reviewSetup, type ReviewHarness } from './testing'

vi.mock('@client/review/confetti', () => ({ confettiBurst: () => () => undefined }))

let h: ReviewHarness | undefined

function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function phoneDriver(vault: FlowVault): Promise<FlowDriver> {
  h = await reviewSetup(vault.files, { dueShuffle: true })
  const q = <T extends Element = HTMLElement>(sel: string) => h!.host.querySelector<T>(sel)
  const click = async (el: HTMLElement | null, what: string) => {
    if (el === null) throw new Error(`No ${what} on: ${h!.host.textContent}`)
    await h!.seen()
    await act(async () => el.click())
    await h!.settle()
  }
  const filterButton = () => q<HTMLButtonElement>('.review__filter')
  const openSheet = async () => {
    if (q('.review__sheet') === null) await click(filterButton(), 'the filter button')
  }
  const closeSheet = async () => {
    if (q('.review__sheet') !== null) await click(filterButton(), 'the filter button')
  }
  const openCog = async () => {
    await openSheet()
    if (q('.review__sheet-settings') === null) await click(q('.review__sheet-cog'), 'the ⚙')
  }
  return {
    name: 'phone',
    async view() {
      const label = filterButton()?.getAttribute('aria-label') ?? ''
      const filter = (CARD_FILTERS.find((f) => label.startsWith(`${f.label}.`))?.id ?? 'all') as CardFilter
      const box = q('.review__card')
      const card = box === null ? null : { id: (q('.review__id')?.textContent ?? '').trim(), isNew: q('.review__chip[data-new]') !== null, again: q('.review__again') !== null }
      const shared = readShared(h!.host, DONE_LOOK, box === null ? q('.review__done') : null)
      // The sheet's counts: what is left in each list (Up next only while some card is marked).
      await openSheet()
      const menu: Record<CardFilter, number> = { all: 0, next: 0, due: 0, new: 0 }
      for (const row of h!.host.querySelectorAll('.review__sheet-row')) {
        const id = row.querySelector<HTMLElement>('[data-filter]')?.dataset.filter as CardFilter
        menu[id] = Number(/^\d+/.exec(row.querySelector('.review__sheet-n')?.textContent ?? '')?.[0] ?? NaN)
      }
      await closeSheet()
      return { filter, card, menu, ...shared }
    },
    async answer(rating: CardRating) {
      vi.setSystemTime(Date.now() + 4_000)
      await h!.click(rating === 'again' ? 'Forgot' : 'Remembered')
    },
    async undo() {
      // The hint line's Undo while it shows, else the ⋯ menu's "Undo last answer".
      if (h!.button('Undo') !== null) return h!.click('Undo')
      if (h!.button('More card actions') !== null) await h!.click('More card actions')
      await h!.click('Undo last answer')
    },
    async filter(f) {
      await openSheet()
      await click(q(`.review__sheet-pick[data-filter="${f}"]`), `the sheet's ${f}`)
    },
    async press(words) {
      await h!.click(new RegExp(`^${words} \\d+$`))
    },
    async reopen() {
      // The Review tab closed and the app opened again: a new screen on the same phone (its answers kept).
      const t = h!
      t.unmount()
      h = await mountReview(t)
    },
    async add(kind, n) {
      await openCog()
      const field = q(`.review__sheet-settings .card-inbox__add-setting[data-kind="${kind}"]`)
      if (field === null) throw new Error(`No ⚙ Add today for ${kind} on: ${h!.host.textContent}`)
      await act(async () => typeInto(field.querySelector('input')!, String(n)))
      await click(field.querySelector('.card-inbox__add-go'), 'Add')
      const ask = q('.review__sheet-settings .ask-in-place')
      if (ask === null) throw new Error('Add added with no ask (YAZ-5690)')
      await click(ask.querySelectorAll<HTMLElement>('button')[1], 'the ask`s Add')
      await closeSheet()
    },
    async order(o) {
      await openCog()
      const [group, label] = 'all' in o ? ['All cards', o.all === 'shuffle' ? 'Shuffle' : 'Due first'] : ['Due today', o.due === 'shuffle' ? 'Shuffle' : 'In order']
      const radios = [...h!.host.querySelectorAll<HTMLElement>(`[aria-label="Order of ${group}"] [role="radio"]`)]
      await click(radios.find((r) => (r.textContent ?? '').trim() === label) ?? null, `${group} ${label}`)
      await closeSheet()
    },
    async elsewhere(id, rating) {
      // The phone sends what it has; the Mac's answer lands on GitHub; the next sync brings it.
      await h!.wait(5_000)
      const files = await h!.s.git.filesAt(h!.s.git.branches.get(BRANCH)!)
      const text = files['cards.md'] as string
      await h!.s.git.push({ 'cards.md': changeCard(text, id, (l) => withCardReview(l, { at: cardTime(Date.now() - 1_000), rating })) })
      await act(async () => {
        await h!.engine.syncNow()
        await h!.engine.idle()
      })
      await h!.settle()
    },
    async clock(time) {
      vi.setSystemTime(time)
      await act(async () => void window.dispatchEvent(new Event('focus')))
      await h!.settle()
    },
    stop() {
      h?.unmount()
      h = undefined
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  const rnd = seeded(5708)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('YAZ-5708 the Review flow tester on the phone: every filter and flow, the numbers checked after every answer', () => {
  for (const scenario of FLOW_SCENARIOS)
    it(scenario.name, { timeout: 120_000 }, async () => {
      const vault = scenario.vault(NOW)
      const d = await phoneDriver(vault)
      const settings = sanitizeReviewSettings(JSON.parse(vault.files['.yaseendocs/review.json']))
      const t = new FlowTester(d, new FlowModel(vault, settings.newPerDay))
      await scenario.run(t, NOW)
      d.stop()
    })
})
