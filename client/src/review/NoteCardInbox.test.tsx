/**
 * The Inbox screen (YAZ-4962, D18) over a stand-in of `useCardReview`: Space steps one hidden word, then one side, at a
 * time; the buttons show after the last step and `showAnswers` is called exactly then; the keys answer only once the
 * buttons show; a key typed in a field, or while a dialog is open, is not the Inbox's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { CardAnswer } from '@shared/cardSchedule'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { NoteCardInbox, type NoteCardInboxProps } from './NoteCardInbox'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', () => ({ api: { shell: { openLink: vi.fn() } } }))

const PATH = '/v/cards.md'
const TWO_SIDES = 'Capital of {{France}}\n---\n{{Paris}} on the {{Seine}}'
const AT = '2026-11-12T14:05Z'
const answersOf = (s: ReviewSettings): CardAnswer[] =>
  (s.buttons === 4 ? (['again', 'hard', 'good', 'easy'] as const) : (['again', 'good'] as const)).map((rating, i) => ({ review: { at: AT, rating }, interval: [0, 3, 9, 20][i], due: 0 }))

let root: Root | null = null
let el: HTMLElement
let session: CardReviewSession
let review: CardReviewApi
let props: NoteCardInboxProps

function sessionOf(text: string | null, over: Partial<CardReviewSession> = {}): CardReviewSession {
  return { label: 'Inbox', card: { path: PATH, index: 0, id: 'WIKI-9', due: 0, isNew: true, page: text === null ? null : { path: PATH, id: 'WIKI-9', text, reviews: [], off: false } }, position: 3, total: 12, answers: null, canUndo: false, ...over }
}

function render() {
  act(() => root?.render(<NoteCardInbox {...props} review={review} session={session} />))
}

function mount(text: string | null, settings: ReviewSettings = DEFAULT_REVIEW_SETTINGS) {
  session = sessionOf(text)
  review = {
    dueCount: 12,
    settings,
    session,
    start: vi.fn(),
    // The hook fixes the answers and hands them in the session: the stand-in does the same.
    showAnswers: vi.fn(() => {
      session = { ...session, answers: answersOf(settings) }
      queueMicrotask(render)
      return session.answers
    }),
    answer: vi.fn(async () => {}),
    undo: vi.fn(async () => {}),
    skip: vi.fn(),
    close: vi.fn(),
    deleteReview: vi.fn(async () => {}),
  }
  const wikilinks = createWikilinkResolveSource()
  props = {
    review,
    session,
    vaultOf: () => ({ root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never }),
    nameOf: () => 'Cards',
    openPage: vi.fn(),
    openInTab: vi.fn(),
    openLinkIn: vi.fn(),
    openLayer: vi.fn(),
    onNotice: vi.fn(),
  }
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  render()
}

const flush = () => act(async () => await Promise.resolve())
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = el.querySelector('.note-card-inbox') ?? document.body) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })))
const shown = () => [...el.querySelectorAll('.note-card__hidden')].map((s) => s.textContent)
const blanks = () => el.querySelectorAll('.note-card__blank').length
const sides = () => el.querySelectorAll('.note-card__side').length
const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.note-card-inbox__answer')]

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

describe('the Inbox screen (YAZ-4962)', () => {
  it('the head: the card title, the grey card ID, "3 of 12", the page name; the hint row says each key once', () => {
    mount(TWO_SIDES)
    expect(el.querySelector('.explore__title')?.textContent).toBe('Capital of France')
    expect(el.querySelector('.note-card__id')?.textContent).toBe('WIKI-9')
    expect(el.querySelector('.note-card-inbox__place')?.textContent).toBe('3 of 12')
    expect(el.querySelector('.note-card-strip__page')?.textContent).toBe('Cards')
    expect([...el.querySelectorAll('.note-card-inbox__hints kbd')].map((k) => k.textContent)).toEqual(['Space', '1–2', '⌘Z', 'O', 'E', '⌘↵', 'Esc'])
  })

  it('Space (D18): the next hidden word, one at a time, in page order; then the next side, whose words show one by one; then the buttons, and showAnswers is called exactly then', async () => {
    mount(TWO_SIDES)
    expect([sides(), shown(), blanks()]).toEqual([1, [], 1])
    press(' ')
    expect([sides(), shown(), blanks()]).toEqual([1, ['France'], 0])
    press(' ')
    expect([sides(), shown(), blanks()]).toEqual([2, ['France'], 2])
    press(' ')
    expect([sides(), shown(), blanks()]).toEqual([2, ['France', 'Paris'], 1])
    // No answer before the last step: 2 does nothing.
    press('2')
    expect(review.answer).not.toHaveBeenCalled()
    expect(review.showAnswers).not.toHaveBeenCalled()
    expect(buttons()).toHaveLength(0)
    press(' ')
    expect([sides(), shown(), blanks()]).toEqual([2, ['France', 'Paris', 'Seine'], 0])
    expect(review.showAnswers).toHaveBeenCalledOnce()
    await flush()
    // The hover is the truth (D13): each button says when the card comes back.
    expect(buttons().map((b) => [b.textContent, b.title])).toEqual([
      ['Forgot1', 'Forgot · today'],
      ['Remembered2', 'Remembered · 3 days'],
    ])
    // More Space changes nothing.
    press(' ')
    expect(review.showAnswers).toHaveBeenCalledOnce()
    press('2')
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('good')
  })

  it('a card with one side and no hidden word shows its buttons at once; four buttons by the setting, 1–4', async () => {
    mount('Just a fact', { ...DEFAULT_REVIEW_SETTINGS, buttons: 4 })
    expect(review.showAnswers).toHaveBeenCalledOnce()
    await flush()
    expect(buttons().map((b) => b.title)).toEqual(['Again · today', 'Hard · 3 days', 'Good · 9 days', 'Easy · 20 days'])
    expect([...el.querySelectorAll('.note-card-inbox__hints kbd')].map((k) => k.textContent)).toContain('1–4')
    press('3')
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('good')
  })

  it('the key guard: a key typed in a field, or while a dialog or a menu is open (the Explore stack is a dialog), is not the Inbox\'s', async () => {
    mount('Just a fact')
    await flush()
    const field = document.createElement('input')
    document.body.appendChild(field)
    press('2', {}, field)
    press('Escape', {}, field)
    expect(review.answer).not.toHaveBeenCalled()
    expect(review.close).not.toHaveBeenCalled()
    field.remove()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    press('2')
    press('o')
    expect(review.answer).not.toHaveBeenCalled()
    expect(props.openPage).not.toHaveBeenCalled()
    dialog.remove()
    // The keyboard elsewhere (a sidebar button): not the Inbox's either.
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    press('2', {}, elsewhere)
    expect(review.answer).not.toHaveBeenCalled()
    elsewhere.remove()
    press('2')
    expect(review.answer).toHaveBeenCalledOnce()
  })

  it('O and E open the page on top, landed on the card (E in edit); ⌘↵ in a tab; ⌘Z undoes only when there is an answer to undo; Esc closes', () => {
    mount(TWO_SIDES)
    press('o')
    expect(props.openPage).toHaveBeenLastCalledWith(PATH, 0, false)
    press('e')
    expect(props.openPage).toHaveBeenLastCalledWith(PATH, 0, true)
    press('Enter', { metaKey: true })
    expect(props.openInTab).toHaveBeenCalledExactlyOnceWith(PATH)
    press('z', { metaKey: true })
    expect(review.undo).not.toHaveBeenCalled()
    session = { ...session, canUndo: true }
    render()
    press('z', { metaKey: true })
    expect(review.undo).toHaveBeenCalledOnce()
    press('Escape')
    expect(review.close).toHaveBeenCalledOnce()
  })

  it('the done screen: "Inbox complete." and one quiet line; only Esc (and ⌘Z with an answer to undo) in the hint row', () => {
    mount(TWO_SIDES)
    session = { ...session, card: null, canUndo: true }
    render()
    expect(el.querySelector('.note-card-inbox__done-title')?.textContent).toBe('Inbox complete.')
    expect(el.querySelector('.note-card-inbox__done-line')?.textContent).toBe('Nothing else is due today. Enjoy your day!')
    expect([...el.querySelectorAll('.note-card-inbox__hints kbd')].map((k) => k.textContent)).toEqual(['⌘Z', 'Esc'])
    press(' ')
    press('o')
    expect(props.openPage).not.toHaveBeenCalled()
  })

  it('the Reviews section under the card starts closed (silence) and opens with the full table', () => {
    mount('Just a fact')
    expect(el.querySelector('.note-card-reviews .backlinks__header')?.getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelector('.note-card-reviews__table')).toBeNull()
    act(() => el.querySelector<HTMLButtonElement>('.note-card-reviews .backlinks__header')?.click())
    expect(el.querySelector('.note-card-reviews__table')).not.toBeNull()
  })
})
