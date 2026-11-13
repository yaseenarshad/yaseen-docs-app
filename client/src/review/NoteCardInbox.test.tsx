/**
 * The Inbox screen (YAZ-4962, D18) over a stand-in of `useCardReview`: Space steps one hidden word, then one side, at a
 * time; the buttons show with the card and `showAnswers` is called exactly then (YAZ-5010); the keys answer at any
 * step; a key typed in a field, or while a dialog is open, is not the Inbox's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { CardAnswer } from '@shared/cardSchedule'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { NoteCardInbox, type NoteCardInboxProps } from './NoteCardInbox'
import { noteCardStateText } from './noteCardInboxChip'
import { useReadOnlyVault } from '../vault/readOnlyVault'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Each vault's `.yaseendocs/read-only.json` for the real `useReadOnlyVault` (YAZ-5009): no entry = no file. */
const vaultFiles = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../api', () => ({
  api: {
    shell: { openLink: vi.fn() },
    vaultConfig: {
      read: vi.fn(async (root: string) => {
        if (!vaultFiles.has(root)) throw new Error('ENOENT')
        return vaultFiles.get(root)
      }),
      onChange: () => () => undefined,
    },
  },
}))

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
  return { label: 'Inbox', scope: 'vault', card: { path: PATH, index: 0, id: 'WIKI-9', due: 0, isNew: true, next: false, page: text === null ? null : { path: PATH, id: 'WIKI-9', text, reviews: [], off: false, next: false } }, position: 3, total: 12, answers: null, canUndo: false, canBack: false, canNext: false, filter: 'all', counts: { all: 12, due: 9, new: 3 }, from: ['Vault'], ...over }
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
    close: vi.fn(),
    deleteReview: vi.fn(async () => {}),
    setNext: vi.fn(async () => {}),
    move: vi.fn(),
    turnOff: vi.fn(async () => {}),
    setFilter: vi.fn(),
  }
  const wikilinks = createWikilinkResolveSource()
  props = {
    review,
    session,
    vaultOf: () => ({ root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never }),
    nameOf: () => 'Cards',
    openPage: vi.fn(),
    openCard: vi.fn(),
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
  it('YAZ-5012: the head reads "Cards (WIKI-9)": the page name first, then the ID in brackets — no card title (the card is below); the hint row shows only keys that act now', async () => {
    mount(TWO_SIDES)
    expect(el.querySelector('.explore__title')).toBeNull()
    const head = [...el.querySelector('.note-card-inbox__head')!.children].map((c) => [c.className, c.textContent])
    expect(head).toEqual([
      // YAZ-5018: the state chip at the card's top left, as Mochi's.
      ['note-card-inbox__state', 'New card'],
      ['note-card-strip__page note-card-inbox__page', 'Cards'],
      ['note-card__id', '(WIKI-9)'],
    ])
    // YAZ-5017: "3 of 12" moved to the top row, on the right.
    expect(el.querySelector('.note-card-inbox__bar .note-card-inbox__place')?.textContent).toBe('3 of 12')
    const hints = () => [...el.querySelectorAll('.note-card-inbox__hints span')].map((h) => h.textContent)
    // Nothing to undo; the digits are on the buttons.
    expect(hints()).toEqual(['Space Show', 'O Open page', 'E Edit card', '⌘↵ Open page in a new tab'])
    for (let i = 0; i < 4; i++) press(' ')
    await flush()
    // The last step: Space has nothing more to show.
    expect(hints()).toEqual(['O Open page', 'E Edit card', '⌘↵ Open page in a new tab'])
  })

  it('YAZ-4999: an up-next card shows the chip "Up next" after the ID; its × removes the mark (setNext)', () => {
    mount(TWO_SIDES)
    expect(el.querySelector('.note-card__next')).toBeNull()
    const card = session.card!
    session = { ...session, card: { ...card, next: true, page: { ...card.page!, next: true } } }
    render()
    const chip = el.querySelector('.note-card-inbox__head > .note-card-inbox__page + .note-card__id + .note-card__next')!
    expect(chip.textContent).toBe('Up next×')
    act(() => chip.querySelector<HTMLButtonElement>('[aria-label="Remove from top of Inbox"]')!.click())
    expect(review.setNext).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', false)
  })

  it('YAZ-5012: a click on "(WIKI-9)" copies the bare ID, not the brackets', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount(TWO_SIDES)
    act(() => el.querySelector<HTMLButtonElement>('.note-card-inbox__head [aria-label="Copy card ID"]')!.click())
    await flush()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('WIKI-9')
    expect(props.onNotice).toHaveBeenCalledWith('Copied: WIKI-9')
  })

  it('YAZ-5009 root cause, over the app\'s real wiring (`useReadOnlyVault` → `exploreVaultOf`): E follows the vault\'s `read-only.json` — shown with no file or `"on": false`, hidden with `"on": true`', async () => {
    mount(TWO_SIDES)
    const hasE = () => [...el.querySelectorAll('.note-card-inbox__hints span')].map((h) => h.textContent).includes('E Edit card')
    const plain = props.vaultOf
    // As App builds it: the vault's scope, `readOnly: scope.readOnlyVault.settings.on`.
    function Wired({ root: vault }: { root: string }) {
      const readOnly = useReadOnlyVault(vault)
      return <NoteCardInbox {...props} review={review} session={session} vaultOf={(path) => ({ ...plain(path), root: vault, readOnly: readOnly.settings.on })} />
    }
    const seen: Record<string, boolean> = {}
    for (const [vault, file] of [['/no-file', undefined], ['/off', { on: false }], ['/on', { on: true }]] as const) {
      vaultFiles.clear()
      if (file !== undefined) vaultFiles.set(vault, file)
      act(() => root?.render(<Wired key={vault} root={vault} />))
      await flush()
      await flush()
      seen[vault] = hasE()
    }
    expect(seen).toEqual({ '/no-file': true, '/off': true, '/on': false })
  })

  it('YAZ-5009: the key row shows "E Edit card" at every step — before Space, between the hidden words, after the last — and on a moved-to card', async () => {
    mount(TWO_SIDES)
    const hasE = () => [...el.querySelectorAll('.note-card-inbox__hints span')].map((h) => h.textContent).includes('E Edit card')
    const seen = [hasE()]
    for (let i = 0; i < 4; i++) {
      press(' ')
      await flush()
      seen.push(hasE())
    }
    expect(seen).toEqual([true, true, true, true, true])
    session = { ...session, canNext: true, canBack: true, position: 4 }
    render()
    expect(hasE()).toBe(true)
    press('e')
    expect(props.openCard).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', 0, true)
  })

  it('YAZ-5003: a read-only vault blocks Edit card, as the page does: E opens nothing, and the hint row does not offer E', () => {
    mount(TWO_SIDES)
    const plain = props.vaultOf
    props.vaultOf = (path) => ({ ...plain(path), readOnly: true })
    render()
    expect([...el.querySelectorAll('.note-card-inbox__hints kbd')].map((k) => k.textContent)).not.toContain('E')
    press('e')
    expect(props.openCard).not.toHaveBeenCalled()
    expect(props.openPage).not.toHaveBeenCalled()
  })

  it('Space (D18): the next hidden word, one at a time, in page order; then the next side, whose words show one by one; YAZ-5010: the buttons show from the moment the card shows, and showAnswers is called exactly then', async () => {
    mount(TWO_SIDES)
    expect([sides(), shown(), blanks()]).toEqual([1, [], 1])
    // The card shows: its answers are fixed now, once (the hover is the truth, D13).
    expect(review.showAnswers).toHaveBeenCalledOnce()
    await flush()
    expect(buttons().map((b) => [b.textContent, b.getAttribute('aria-description')])).toEqual([
      ['Forgot1', 'Forgot · today'],
      ['Remembered2', 'Remembered · 3 days'],
    ])
    press(' ')
    expect([sides(), shown(), blanks()]).toEqual([1, ['France'], 0])
    press(' ')
    expect([sides(), shown(), blanks()]).toEqual([2, ['France'], 2])
    press(' ')
    expect([sides(), shown(), blanks()]).toEqual([2, ['France', 'Paris'], 1])
    // The buttons stay through every step, and the answers are not fixed again.
    expect(buttons()).toHaveLength(2)
    press(' ')
    expect([sides(), shown(), blanks()]).toEqual([2, ['France', 'Paris', 'Seine'], 0])
    // More Space changes nothing.
    press(' ')
    expect(review.showAnswers).toHaveBeenCalledOnce()
    press('2')
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('good')
  })

  it('YAZ-5010: 1 and 2 answer at any step — before the first Space, with words still hidden', async () => {
    mount(TWO_SIDES)
    await flush()
    expect(shown()).toEqual([])
    press('1')
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('again')
    act(() => buttons()[1].click())
    expect(review.answer).toHaveBeenLastCalledWith('good')
  })

  it('YAZ-5010: while the page of the card is still read, no button shows and no digit answers', async () => {
    mount(null)
    await flush()
    expect(review.showAnswers).not.toHaveBeenCalled()
    expect(buttons()).toHaveLength(0)
    press('2')
    expect(review.answer).not.toHaveBeenCalled()
  })

  it('a card with one side and no hidden word shows its buttons at once; four buttons by the setting, 1–4', async () => {
    mount('Just a fact', { ...DEFAULT_REVIEW_SETTINGS, buttons: 4 })
    expect(review.showAnswers).toHaveBeenCalledOnce()
    await flush()
    expect(buttons().map((b) => b.getAttribute('aria-description'))).toEqual(['Again · today', 'Hard · 3 days', 'Good · 9 days', 'Easy · 20 days'])
    expect([...el.querySelectorAll('.note-card-inbox__hints kbd')].map((k) => k.textContent)).not.toContain('1–4')
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
    // An editor's `[[` picker and a table's colour menu stay in the DOM, hidden: they take no key.
    const picker = document.createElement('div')
    picker.setAttribute('role', 'listbox')
    picker.dataset.show = 'false'
    const palette = document.createElement('div')
    palette.setAttribute('role', 'menu')
    palette.hidden = true
    document.body.append(picker, palette)
    press('2')
    expect(review.answer).toHaveBeenCalledOnce()
    picker.remove()
    palette.remove()
  })

  it('YAZ-5022: O opens the page on top at its TOP (no card index: no scroll to the card); YAZ-5003: E opens only the card, in the card window, in Edit card; ⌘↵ in a tab; ⌘Z undoes only when there is an answer to undo; YAZ-5011: Esc does not close the Inbox (a tab), and the key is not taken', () => {
    mount(TWO_SIDES)
    press('o')
    expect(props.openPage).toHaveBeenLastCalledWith(PATH)
    expect(vi.mocked(props.openPage).mock.calls[0]).toHaveLength(1)
    press('e')
    expect(props.openCard).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', 0, true)
    expect(props.openPage).toHaveBeenCalledOnce()
    press('Enter', { metaKey: true })
    expect(props.openInTab).toHaveBeenCalledExactlyOnceWith(PATH)
    press('z', { metaKey: true })
    expect(review.undo).not.toHaveBeenCalled()
    session = { ...session, canUndo: true }
    render()
    press('z', { metaKey: true })
    expect(review.undo).toHaveBeenCalledOnce()
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void el.querySelector('.note-card-inbox')!.dispatchEvent(esc))
    expect(esc.defaultPrevented).toBe(false)
    expect(review.close).not.toHaveBeenCalled()
  })

  it('YAZ-5011: no × in the head; behind a page tab (shown false) the Inbox is hidden, keeps its step, and hears no key', async () => {
    mount(TWO_SIDES)
    expect(el.querySelector('[aria-label="Close the review"]')).toBeNull()
    expect([...el.querySelectorAll('.note-card-inbox__head button')].map((b) => b.textContent)).not.toContain('×')
    press(' ')
    expect(shown()).toEqual(['France'])
    act(() => root?.render(<NoteCardInbox {...props} review={review} session={session} shown={false} />))
    const inbox = el.querySelector<HTMLElement>('.note-card-inbox')!
    expect(inbox.hidden).toBe(true)
    press(' ', {}, document.body)
    press('2', {}, document.body)
    press('o', {}, document.body)
    expect(review.answer).not.toHaveBeenCalled()
    expect(props.openPage).not.toHaveBeenCalled()
    render()
    expect(inbox.hidden).toBe(false)
    expect(shown()).toEqual(['France'])
  })

  it('the done screen: "Inbox complete." and one quiet line; only ⌘Z (with an answer to undo) in the hint row', () => {
    mount(TWO_SIDES)
    session = { ...session, card: null, canUndo: true }
    render()
    expect(el.querySelector('.note-card-inbox__done-title')?.textContent).toBe('Inbox complete.')
    expect(el.querySelector('.note-card-inbox__done-line')?.textContent).toBe('Nothing else is due today. Enjoy your day!')
    expect([...el.querySelectorAll('.note-card-inbox__hints kbd')].map((k) => k.textContent)).toEqual(['⌘Z'])
    press(' ')
    press('o')
    expect(props.openPage).not.toHaveBeenCalled()
  })

  it('the done screen of "Review this page" says the page is done, and "N more in the Inbox" starts the vault`s review', () => {
    mount(TWO_SIDES)
    session = { ...session, label: 'Cards', scope: 'page', card: null }
    render()
    expect(el.querySelector('.note-card-inbox__done-title')?.textContent).toBe('This page is done.')
    expect(el.querySelector('.note-card-inbox__done-line')).toBeNull()
    const more = el.querySelector<HTMLButtonElement>('.note-card-inbox__done-more')!
    expect(more.textContent).toBe('12 more in the Inbox')
    act(() => more.click())
    expect(review.start).toHaveBeenCalledExactlyOnceWith({})
  })

  it('YAZ-5000: no Reviews section, also for a card with reviews: only the card, the steps and the answer buttons', async () => {
    mount('Just a fact')
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, reviews: [{ at: AT, rating: 'good' }] } } }
    render()
    await flush()
    expect(el.querySelector('.note-card-inbox__card')).not.toBeNull()
    expect(el.querySelectorAll('.note-card-inbox__answer')).toHaveLength(2)
    expect(el.querySelector('.note-card-reviews')).toBeNull()
    expect(el.textContent).not.toContain('Reviews')
  })

  it('YAZ-5002: the buttons sit under the card, outside its panel; the key row is last; YAZ-5021: no "Press Space" line over the buttons at any step (the key row says Space)', async () => {
    mount(TWO_SIDES)
    const column = el.querySelector('.note-card-inbox__column')!
    const panel = column.querySelector('.note-card-inbox__panel')!
    await flush()
    expect(column.querySelector('.note-card-inbox__space')).toBeNull()
    expect(column.textContent).not.toContain('Press')
    expect(column.querySelector('.note-card-inbox__hints')?.textContent).toContain('Space Show')
    press(' ')
    expect(column.querySelector('.note-card-inbox__space')).toBeNull()
    const answers = column.querySelector('.note-card-inbox__actions')!
    expect(answers.querySelectorAll('.note-card-inbox__answer')).toHaveLength(2)
    expect(panel.contains(answers)).toBe(false)
    expect([...column.children].map((c) => c.className)).toEqual(['note-card-inbox__panel', 'note-card-inbox__actions', 'explore__foot note-card-inbox__hints'])
  })

  it('YAZ-5004: ← → (buttons and keys) move to the card before or after with no answer; each is off at its end; the key row says so', () => {
    mount(TWO_SIDES)
    const moves = () => [...el.querySelectorAll<HTMLButtonElement>('.note-card-inbox__move')]
    expect(moves().map((b) => [b.getAttribute('aria-label'), b.disabled])).toEqual([['Previous card', true], ['Next card', true]])
    press('ArrowRight')
    expect(review.move).not.toHaveBeenCalled()
    session = { ...session, canNext: true }
    render()
    expect(moves().map((b) => b.disabled)).toEqual([true, false])
    expect([...el.querySelectorAll('.note-card-inbox__hints span')].map((h) => h.textContent)).toContain('← → Other cards')
    press('ArrowRight')
    act(() => moves()[1].click())
    expect(vi.mocked(review.move).mock.calls).toEqual([[1], [1]])
    press('ArrowLeft')
    expect(review.move).toHaveBeenCalledTimes(2)
    session = { ...session, canBack: true }
    render()
    press('ArrowLeft')
    expect(review.move).toHaveBeenLastCalledWith(-1)
    expect(review.answer).not.toHaveBeenCalled()
    // A key typed in a field is the field's.
    const field = document.createElement('input')
    el.append(field)
    press('ArrowLeft', {}, field)
    expect(review.move).toHaveBeenCalledTimes(3)
  })

  it('YAZ-5004: ⋯ opens a row of icon actions with their names (Undo off while there is nothing to undo); each runs the hook`s own action; Esc closes the row first', () => {
    mount(TWO_SIDES)
    const more = () => el.querySelector<HTMLButtonElement>('.note-card-inbox__more-button')!
    const actions = () => [...el.querySelectorAll<HTMLButtonElement>('.note-card-inbox__more-action')]
    expect(actions()).toEqual([])
    act(() => more().click())
    expect(actions().map((b) => [b.getAttribute('aria-label'), b.disabled])).toEqual([
      ['Undo last review', true],
      ['Turn review off', false],
      ['Put at top of Inbox', false],
      ['Open card', false],
    ])
    expect(actions().every((b) => b.querySelector('svg') !== null)).toBe(true)
    press('Escape')
    expect(actions()).toEqual([])
    expect(review.close).not.toHaveBeenCalled()
    session = { ...session, canUndo: true }
    render()
    const run = (label: string) => {
      act(() => more().click())
      act(() => actions().find((b) => b.getAttribute('aria-label') === label)!.click())
    }
    run('Undo last review')
    expect(review.undo).toHaveBeenCalledOnce()
    run('Turn review off')
    expect(review.turnOff).toHaveBeenCalledOnce()
    run('Put at top of Inbox')
    expect(review.setNext).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', true)
    run('Open card')
    expect(props.openCard).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', 0, false)
    expect(actions()).toEqual([])
  })

  it('YAZ-5017: the top row — "All cards ▾" opens All cards / Due today / New cards with their counts; a pick sets the filter; the scope shows as a quiet path; the filter`s done screen leads back to All cards', () => {
    mount(TWO_SIDES)
    session = { ...session, from: ['Spanish', 'Verbs'] }
    render()
    const bar = el.querySelector('.note-card-inbox__bar')!
    const filter = bar.querySelector<HTMLButtonElement>('.note-card-inbox__filter')!
    expect(filter.textContent).toBe('All cards')
    expect(bar.querySelector('.note-card-inbox__from')?.textContent).toBe('Spanish/Verbs')
    expect(bar.querySelector('.note-card-inbox__from')?.getAttribute('title')).toBe('Spanish / Verbs')
    act(() => filter.click())
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.note-card-inbox__filter-item')]
    expect(rows().map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['All cards12', 'true'],
      ['Due today9', 'false'],
      ['New cards3', 'false'],
    ])
    // The menu is open: the Inbox's keys are not taken (a menu owns them).
    press('1')
    expect(review.answer).not.toHaveBeenCalled()
    act(() => rows()[1].click())
    expect(review.setFilter).toHaveBeenCalledExactlyOnceWith('due')
    expect(rows()).toHaveLength(0)
    // The due cards are done, new cards are left.
    session = { ...session, filter: 'due', card: null, counts: { all: 3, due: 0, new: 3 } }
    render()
    expect(el.querySelector('.note-card-inbox__filter')?.textContent).toBe('Due today')
    expect(el.querySelector('.note-card-inbox__done-title')?.textContent).toBe('No due cards left.')
    act(() => el.querySelector<HTMLButtonElement>('.note-card-inbox__done-more')!.click())
    expect(review.setFilter).toHaveBeenLastCalledWith('all')
  })

  it('YAZ-5018: the buttons wear their glyphs — ✕ Forgot and ✓ Remembered; with four buttons ↺ Again, ~ Hard, ✓ Good, ⇈ Easy — each a round pill with its digit', async () => {
    const glyphs = () => buttons().map((b) => [b.querySelector('.note-card-inbox__answer-label')?.textContent, b.querySelector('svg.note-card-inbox__answer-icon path')?.getAttribute('d'), b.querySelector('kbd')?.textContent])
    mount('Plain')
    await flush()
    const two = glyphs()
    expect(two.map(([label, , key]) => [label, key])).toEqual([['Forgot', '1'], ['Remembered', '2']])
    expect(two.every(([, d]) => typeof d === 'string' && d.length > 0)).toBe(true)
    expect(two[0][1]).not.toBe(two[1][1])
    act(() => root?.unmount())
    el.remove()
    mount('Plain', { ...DEFAULT_REVIEW_SETTINGS, buttons: 4 })
    await flush()
    const four = glyphs()
    expect(four.map(([label]) => label)).toEqual(['Again', 'Hard', 'Good', 'Easy'])
    // Four different glyphs; Good is Remembered's check, Again is not Forgot's ✕.
    expect(new Set(four.map(([, d]) => d)).size).toBe(4)
    expect(four[2][1]).toBe(two[1][1])
    expect(four[0][1]).not.toBe(two[0][1])
  })

  it('YAZ-5018: the state chip — "New card" for a card never reviewed, "Due today", "Due · 3 days ago" past its day', () => {
    const now = new Date(2026, 10, 12, 9, 0).getTime()
    expect(noteCardStateText({ isNew: true, due: now }, now)).toBe('New card')
    expect(noteCardStateText({ isNew: false, due: new Date(2026, 10, 12, 1, 0).getTime() }, now)).toBe('Due today')
    expect(noteCardStateText({ isNew: false, due: new Date(2026, 10, 11, 23, 0).getTime() }, now)).toBe('Due · 1 day ago')
    expect(noteCardStateText({ isNew: false, due: new Date(2026, 10, 9, 14, 0).getTime() }, now)).toBe('Due · 3 days ago')
    mount(TWO_SIDES)
    session = { ...session, card: { ...session.card!, isNew: false, due: Date.now() } }
    render()
    const chip = el.querySelector('.note-card-inbox__state')!
    expect([chip.textContent, chip.getAttribute('data-state')]).toEqual(['Due today', 'due'])
  })
})
