// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitingCount } from '../status/dot'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * Checker round 4 (YAZ-5078, pick B11): Undo of Archive card, Up next and Fix later, through the answer list and the
 * fake GitHub. 3 marks x [not sent | tried, reply lost | sent] x [Undo at once | Undo after the next answer].
 */
let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})
const OLD = '2026-10-04T09:00Z good'
const FILES = { '.yaseendocs/review.json': '{}', 'p.md': page('P', ...[1, 2, 3].map((n) => cardBlock(`Q${n}?\n---\n{{w${n}}}`, `MK-${n}, ${OLD}`))) }
type Mark = 'archive' | 'next' | 'fix'
type Sent = 'unsent' | 'lost-reply' | 'sent'
const reviewsIn = (lines: Record<string, string>) => Object.values(lines).join(' ').match(/T\d\d:\d\dZ/g)?.length ?? 0

async function setup(sent: Sent) {
  let drop = sent === 'lost-reply'
  const hh = await reviewSetup(FILES, {
    fetch: (s) => async (url, init) => {
      const res = await s.github.fetch(url, init)
      if ((init.method ?? 'GET') === 'PATCH' && drop) {
        drop = false
        throw new TypeError('Load failed')
      }
      return res
    },
  })
  return hh
}

async function doMark(hh: ReviewHarness, mark: Mark) {
  await hh.click('More card actions')
  await hh.click(mark === 'archive' ? 'Archive card' : mark === 'next' ? 'Up next' : 'Fix later')
}

const LINES: string[] = []
for (const mark of ['archive', 'next', 'fix'] as Mark[])
  for (const sent of ['unsent', 'lost-reply', 'sent'] as Sent[])
    for (const when of ['at once', 'after the next answer'] as const)
      describe(`check4 ${mark} / ${sent} / Undo ${when}`, () => {
        it('the card line on GitHub ends byte for byte as before the undone action; counts agree', async () => {
          h = await setup(sent)
          const before = await h.remoteLines()
          await doMark(h, mark)
          const afterMarkLine = h.last()
          if (sent !== 'unsent') await h.wait(5_000)
          const markedLines = await h.remoteLines()
          if (when === 'at once') {
            await h.click('Undo')
            const lineAfter = h.last()
            if (sent === 'lost-reply') h.answers.online()
            await h.wait(5_000)
            await h.wait(5_000)
            const end = await h.remoteLines()
            LINES.push(`${mark}/${sent}/${when}: line "${afterMarkLine}" -> "${lineAfter}"; head ${h.head()}; waiting ${h.answers.waiting().length}; lost ${h.answers.state().lost.length}`)
            expect(end).toEqual(before)
            expect(reviewsIn(end)).toBe(reviewsIn(before))
            expect(h.answers.waiting()).toEqual([])
            expect(waitingCount(h.answers.waiting())).toBe(0)
            expect(h.answers.state().lost).toEqual([])
          } else {
            // The next answer: for Archive the next card; for Up next and Fix later the same card (it stays).
            await h.click('Remembered')
            const ansLine = h.last()
            await h.click('Undo')
            const lineAfter = h.last()
            if (sent === 'lost-reply') h.answers.online()
            await h.wait(5_000)
            await h.wait(5_000)
            const end = await h.remoteLines()
            LINES.push(`${mark}/${sent}/${when}: mark line "${afterMarkLine}", answer line "${ansLine}" -> after Undo "${lineAfter}"; head ${h.head()}; waiting ${h.answers.waiting().length}; lost ${h.answers.state().lost.length}`)
            // Undo took back the newer answer only: the mark stays, as the line had it after the mark was sent.
            const expected = sent === 'unsent' ? null : markedLines
            if (expected !== null) expect(end).toEqual(expected)
            expect(reviewsIn(end)).toBe(reviewsIn(before))
            expect(h.answers.waiting()).toEqual([])
            expect(h.answers.state().lost).toEqual([])
          }
        })
      })

describe('check4 race: Undo of a mark while its save still runs', () => {
  for (const mark of ['next', 'fix'] as Mark[])
    it(`${mark}: a tap on Undo right after the mark (the write takes 300 ms) still ends with the line as before`, async () => {
      h = await setup('unsent')
      const before = await h.remoteLines()
      const realAdd = h.answers.add.bind(h.answers)
      ;(h.answers as { add: typeof realAdd }).add = async (...args) => {
        await new Promise((r) => setTimeout(r, 300))
        return realAdd(...args)
      }
      await h.click('More card actions')
      const b = h.button(mark === 'next' ? 'Up next' : 'Fix later')!
      const { act } = await import('react')
      await act(async () => b.click())
      // Undo is on the screen at once; the person taps it.
      const undo = h.button('Undo')
      LINES.push(`race ${mark}: line right after the tap "${h.last()}"; Undo button ${undo === null ? 'absent' : 'present'}`)
      if (undo !== null) await act(async () => undo.click())
      await act(async () => void (await new Promise((r) => setTimeout(r, 700))))
      await h.settle()
      await h.wait(5_000)
      const end = await h.remoteLines()
      LINES.push(`race ${mark}: waiting ${JSON.stringify(h.answers.waiting().map((w) => w.op))}; end ${end['MK-1']}`)
      expect(end).toEqual(before)
    })
})

describe('check4 archive undo when the Mac changed the card meanwhile', () => {
  for (const sent of ['unsent', 'sent'] as const)
    it(`${sent}: the undo lands on the Mac's new text`, async () => {
      h = await setup('unsent')
      if (sent === 'unsent') h.s.github.offline = true
      await doMark(h, 'archive')
      if (sent === 'sent') await h.wait(5_000)
      // The Mac changes MK-1: a new text and a new review, archived or not as GitHub holds it now.
      const now = (await h.s.git.filesAt(h.s.git.branches.get('main')!))['p.md'] as string
      const mac = now.replace('Q1?\n---\n{{w1}}', 'Q1 changed on the Mac?\n---\n{{w1}}').replace(/(<!-- card: MK-1[^>]*?)( -->)/, '$1, 2026-11-13T08:00Z hard$2')
      await h.s.git.push({ 'p.md': mac })
      const macLine = /<!-- card: MK-1[^>]*-->/.exec(mac)![0]
      await h.click('Undo')
      h.s.github.offline = false
      await h.wait(5_000)
      await h.wait(5_000)
      const end = (await h.s.git.filesAt(h.s.git.branches.get('main')!))['p.md'] as string
      const expected = mac.replace(macLine, macLine.replace(', off', ''))
      LINES.push(`mac ${sent}: end line ${/<!-- card: MK-1[^>]*-->/.exec(end)![0]}`)
      expect(end).toBe(expected)
      expect(h.answers.waiting()).toEqual([])
    })
})

afterAll(() => console.log(LINES.join('\n')))
import { afterAll } from 'vitest'
