/**
 * Chapters 3 to 5 and the kit pieces they added (YAZ-5121): each new piece draws at 0, 0.5 and 1 with and without
 * reduced motion; reduced motion moves nothing; Edit card's keys are in the app's words everywhere on the stage; the
 * facts on the stage are the app's own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { COURSE } from '../script'
import { showOnlyHost } from '../courseHost'
import { SHOW_ONLY } from '../courseCards'
import { CHAPTER_SCENES } from '.'
import { COMPOUND_FACTS } from './compound'
import { AgentChat, beatAt, CardEditKeyRow, EmbedView, InboxView, JournalCover, LinkPill, PageText, PageView, ReviewsLine, Head, litFocus, type Beat } from './kit'
import { mountScene, testClock } from './testing'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.textContent = ''
  vi.restoreAllMocks()
})

function draw(node: ReactElement): HTMLElement {
  const el = document.createElement('div')
  el.className = 'course-kit'
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  return el
}

const pieces: [string, (b: Beat) => ReactElement][] = [
  [
    'InboxView',
    (b) => (
      <InboxView
        beat={b}
        card={{ title: 'The Moon’s orbit', text: 'About {{27 days}}.\n---\nThe back.', shown: 1, sides: 2 }}
        answered={[false, true]}
        place={['My vault', 'Course Cards']}
        forgot={{ press: b.progress }}
        remembered={{ key: b.progress }}
        hover={{ on: 'remembered', text: 'Remembered · 9 days', p: b.progress }}
        cursor={{ on: 'remembered', move: b.progress, click: b.progress }}
        last={{ rating: 'good', text: '✓ Remembered · X (R4M8) · back in 9 days', p: b.progress, undo: b.progress }}
        glowKey={{ Show: b.progress }}
        done={b.progress > 0.9 ? b.progress : 0}
      />
    ),
  ],
  [
    'PageView, EmbedView, LinkPill, ReviewsLine',
    (b) => (
      <PageView title="Food basics">
        <PageText beat={b} p={b.progress}>
          Text.
        </PageText>
        <LinkPill title="Protein" id="DEMO-7" glow={b.progress} />
        <EmbedView beat={b} title="Protein" id="DEMO-7" text={'A {{b}} c.\n---\nBack.'} head={b.progress} name={b.progress} editing={b.progress === 0.5} editor={<p>x</p>} footer={<ReviewsLine beat={b} count={4} p={b.progress} />} />
      </PageView>
    ),
  ],
  ['AgentChat', (b) => <AgentChat beat={b} lines={[{ who: 'you', text: 'Embed my card.', p: b.progress }, { who: 'agent', text: 'Done.', p: b.progress, step: 'Edited Food basics' }]} />],
  ['JournalCover', (b) => <JournalCover beat={b} issue={{ journal: 'Science', year: 2008 }} p={b.progress} out={b.progress / 2} />],
  ['Head', (b) => <Head beat={b} p={b.progress} light={{ arrive: b.progress }} glow={b.progress} dots={[{ x: 0.5, y: 0.5, p: b.progress }]} noise={b.progress} />],
]

describe('the kit pieces of chapters 3 to 5 (YAZ-5121)', () => {
  for (const [name, make] of pieces) {
    it(`${name}: draws at 0, 0.5 and 1, and moves nothing with reduced motion`, () => {
      const errors = vi.spyOn(console, 'error')
      for (const reduced of [false, true]) {
        for (const p of [0, 0.5, 1]) {
          const el = draw(make(beatAt(p, 6, [], reduced, true)))
          expect(el.firstElementChild, `${name} @ ${p}`).not.toBeNull()
          if (reduced) {
            for (const node of el.querySelectorAll<HTMLElement>('.kit-journal, .kit-chat__msg, .kit-page__p, .kit-reviews')) expect(node.style.transform, `${name} @ ${p}`).toBe('')
          }
        }
      }
      expect(errors).not.toHaveBeenCalled()
    })
  }

  it('the head\'s light does not travel with reduced motion: it is at its place from the start', () => {
    const at = (reduced: boolean) => draw(<Head beat={beatAt(0.3, 6, [], reduced)} light={{ arrive: 0.3 }} />).querySelector('.kit-head__light')!.getAttribute('cy')
    expect(at(true)).toBe('157')
    expect(at(false)).not.toBe('157')
  })

  it("writes Edit card's keys in the app's words (fix of the review: no key symbols)", () => {
    const el = draw(<CardEditKeyRow />)
    expect(el.textContent).toBe('Cmd + L hide wordCmd + Shift + Enter new sideCmd + Enter / Esc Done')
  })

  it('follows the lit part of a long card (Fit pans to it), and jumps there with reduced motion', () => {
    expect(litFocus(beatAt(0.5), [], 6, 0.3)).toBe(0.3)
    expect(litFocus(beatAt(0.5), [0, 0, 1], 5)).toBe(0.5)
    expect(litFocus(beatAt(0.5), [0, 0, 0.5, 0, 0.5], 5)).toBeCloseTo(0.75)
    expect(litFocus(beatAt(0.5, 6, [], true), [0, 0, 0.4, 0, 0.6], 5)).toBe(1)
  })
})

describe('the stage of chapters 1 to 5 (YAZ-5121)', () => {
  it('shows no key symbol: every key is in words, as the app writes them', () => {
    const chapters = ['why', 'first-card', 'inbox', 'where', 'compound']
    const seen: string[] = []
    for (const ch of CHAPTER_SCENES.filter((c) => chapters.includes(c.chapter))) {
      const chapter = COURSE.find((c) => c.id === ch.chapter)!
      for (const entry of ch.entries) {
        const { clock, at } = testClock(6)
        const scene = mountScene(entry.scene, chapter, { clock, done: () => undefined, host: showOnlyHost('/demo', SHOW_ONLY.readOnly) })
        for (const clipId of entry.clips) {
          scene.render(chapter.clips.find((c) => c.id === clipId)!)
          for (const f of [0.3, 0.5, 0.7, 0.95]) {
            at(f, true)
            if (/[⌘⇧↵⌥]/.test(scene.el.textContent ?? '')) seen.push(`${clipId} @ ${f}`)
          }
        }
        scene.unmount()
      }
    }
    expect(seen).toEqual([])
  })

  it("chapter 5's path is the app's own: gaps of 2, 11, 46 and 163 days, then the longest gap", () => {
    const days = COMPOUND_FACTS.reviewDays
    expect(days.slice(1).map((d, i) => d - days[i])).toEqual([2, 11, 46, 163])
    expect(COMPOUND_FACTS.maxDays).toBe(DEFAULT_REVIEW_SETTINGS.maxDays)
  })

  it('gives each clip of chapters 3 to 5 its cues on the words (marks)', () => {
    for (const id of ['inbox', 'where', 'compound']) for (const clip of COURSE.find((c) => c.id === id)!.clips) expect(clip.marks?.length ?? 0, clip.id).toBeGreaterThan(0)
  })
})
