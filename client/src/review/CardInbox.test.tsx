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
import { createViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { CardInbox, type CardInboxProps } from './CardInbox'
import { answerLine, cardStateText } from './cardInboxChip'
import { foldHints } from './CardInboxHints'
import { CARD_MIN_WIDTH, clampCardWidth, inboxCardWidth, setInboxCardWidth } from './inboxCardWidth'
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
  (s.buttons === 4 ? (['again', 'hard', 'good', 'easy'] as const) : (['again', 'good'] as const)).map((rating, i) => ({ review: { at: AT, rating }, interval: [0, 3, 9, 20][i], due: 0, inSteps: rating === 'again' }))

let root: Root | null = null
let el: HTMLElement
let session: CardReviewSession
let review: CardReviewApi
let props: CardInboxProps

function sessionOf(text: string | null, over: Partial<CardReviewSession> = {}): CardReviewSession {
  return { label: 'Inbox', scope: 'vault', card: { path: PATH, index: 0, id: 'WIKI-9', due: 0, isNew: true, next: false, page: text === null ? null : { path: PATH, id: 'WIKI-9', text, reviews: [], off: false, next: false } }, position: 3, total: 12, answers: null, canUndo: false, canBack: false, canNext: false, filter: 'all', counts: { all: 12, next: 0, due: 9, new: 3 }, from: ['Vault'], place: [], answered: [], size: 12, today: { cards: 0, reviews: 0, seconds: 0 }, more: { new: 0, next: 0 }, adds: { new: 0, next: 0 }, limited: { new: false, next: false }, canReset: { new: false, next: false }, lastAdd: null, archived: [], toFix: [], ...over }
}

function render() {
  act(() => root?.render(<CardInbox {...props} review={review} session={session} />))
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
    setFix: vi.fn(async () => {}),
    move: vi.fn(),
    turnOff: vi.fn(async () => {}),
    unarchive: vi.fn(async () => {}),
    setFilter: vi.fn(),
    addCards: vi.fn(),
    resetCards: vi.fn(),
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
    openPlace: vi.fn(),
  }
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  render()
}

const flush = () => act(async () => await Promise.resolve())
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = el.querySelector('.card-inbox') ?? document.body) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })))
const shown = () => [...el.querySelectorAll('.card__hidden')].map((s) => s.textContent)
const blanks = () => el.querySelectorAll('.card__blank').length
const sides = () => el.querySelectorAll('.card__side').length
const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.card-inbox__answer')]

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

describe('the Inbox screen (YAZ-4962)', () => {
  it('YAZ-5044: the head reads "WIKI-9" while the title holds a hidden word (it would tell the answer), then "Capital of France · WIKI-9" (YAZ-5132: the page is in the breadcrumb, not "in Cards"); the hint row shows only keys that act now', async () => {
    mount(TWO_SIDES)
    expect(el.querySelector('.explore__title')).toBeNull()
    const head = () => [...el.querySelector('.card-inbox__head')!.children].map((c) => [c.className, c.textContent])
    expect(head()).toEqual([['card__id', 'WIKI-9']])
    // YAZ-5017: "3 of 12" moved to the top row, on the right.
    expect(el.querySelector('.card-inbox__bar .card-inbox__place')?.textContent).toBe('3 of 12')
    const hints = () => [...el.querySelectorAll('.card-inbox__hints span')].map((h) => h.textContent)
    // Nothing to undo; the digits are on the buttons.
    expect(hints()).toEqual(['Space Show', 'O Open page', 'E Edit card', 'Cmd + Enter New tab'])
    for (let i = 0; i < 4; i++) press(' ')
    await flush()
    // The last step: Space has nothing more to show, and the title shows.
    expect(hints()).toEqual(['O Open page', 'E Edit card', 'Cmd + Enter New tab'])
    expect(head()).toEqual([
      ['card-inbox__name', 'Capital of France'],
      ['card-inbox__dot', '·'],
      ['card__id', 'WIKI-9'],
    ])
  })

  it('YAZ-4999: an up-next card shows the chip "Up next" after the ID; its × removes the mark (setNext)', () => {
    mount(TWO_SIDES)
    expect(el.querySelector('.card__next')).toBeNull()
    const card = session.card!
    session = { ...session, card: { ...card, next: true, page: { ...card.page!, next: true } } }
    render()
    const chip = el.querySelector('.card-inbox__head > .card__id + .card__next')!
    expect(chip.textContent).toBe('Up next×')
    act(() => chip.querySelector<HTMLButtonElement>('[aria-label="Remove from top of Inbox"]')!.click())
    expect(review.setNext).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', false)
  })

  it('YAZ-5012: a click on the ID copies the bare ID', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount(TWO_SIDES)
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__head [aria-label="Copy card ID"]')!.click())
    await flush()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('WIKI-9')
    expect(props.onNotice).toHaveBeenCalledWith('Copied: WIKI-9')
  })

  it('YAZ-5009, over the app\'s real wiring (`useReadOnlyVault` → `exploreVaultOf`): E shows in every vault — no `read-only.json`, `"on": false`, and `"on": true`', async () => {
    mount(TWO_SIDES)
    const hasE = () => [...el.querySelectorAll('.card-inbox__hints span')].map((h) => h.textContent).includes('E Edit card')
    const plain = props.vaultOf
    // As App builds it: the vault's scope, `readOnly: scope.readOnlyVault.settings.on`.
    function Wired({ root: vault }: { root: string }) {
      const readOnly = useReadOnlyVault(vault)
      return <CardInbox {...props} review={review} session={session} vaultOf={(path) => ({ ...plain(path), root: vault, readOnly: readOnly.settings.on })} />
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
    expect(seen).toEqual({ '/no-file': true, '/off': true, '/on': true })
  })

  it('YAZ-5009: the key row shows "E Edit card" at every step — before Space, between the hidden words, after the last — and on a moved-to card', async () => {
    mount(TWO_SIDES)
    const hasE = () => [...el.querySelectorAll('.card-inbox__hints span')].map((h) => h.textContent).includes('E Edit card')
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

  it('YAZ-5009: in a read-only vault the row offers "E Edit card", and E opens the card window in Edit card at once (no ask); the Inbox keeps its card and step under it', () => {
    mount(TWO_SIDES)
    const plain = props.vaultOf
    props.vaultOf = (path) => ({ ...plain(path), readOnly: true })
    render()
    press(' ')
    expect(shown()).toEqual(['France'])
    expect([...el.querySelectorAll('.card-inbox__hints span')].map((h) => h.textContent)).toContain('E Edit card')
    press('e')
    expect(props.openCard).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', 0, true)
    expect(props.openPage).not.toHaveBeenCalled()
    // Back from the card window (the stack closed): the same card, the same step.
    render()
    expect(shown()).toEqual(['France'])
    expect(el.querySelector('.card-inbox__place')?.textContent).toBe('3 of 12')
  })

  it('YAZ-5031: an up-next card in a read-only vault is answered by the same door as in any vault (`answer`, which takes `next` out in the same write): no ask, no other path', async () => {
    for (const readOnly of [false, true]) {
      mount(TWO_SIDES)
      session = { ...session, card: { ...session.card!, next: true, page: { ...session.card!.page!, next: true } }, counts: { ...session.counts, next: 1 } }
      const plain = props.vaultOf
      props.vaultOf = (path) => ({ ...plain(path), readOnly })
      render()
      await flush()
      press('2')
      expect(review.answer).toHaveBeenCalledExactlyOnceWith('good', expect.any(Number))
      expect(review.setNext).not.toHaveBeenCalled()
      if (!readOnly) {
        act(() => root?.unmount())
        el.remove()
      }
    }
  })

  it('Space (D18): the next hidden word, one at a time, in page order; then the next side, whose words show one by one; YAZ-5010: the buttons show from the moment the card shows, and showAnswers is called exactly then', async () => {
    mount(TWO_SIDES)
    expect([sides(), shown(), blanks()]).toEqual([1, [], 1])
    // The card shows: its answers are fixed now, once (the hover is the truth, D13).
    expect(review.showAnswers).toHaveBeenCalledOnce()
    await flush()
    expect(buttons().map((b) => [b.textContent, b.getAttribute('aria-description')])).toEqual([
      ['Forgot1', 'Forgot · later today'],
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
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('good', expect.any(Number))
  })

  it('YAZ-5010: 1 and 2 answer at any step — before the first Space, with words still hidden', async () => {
    mount(TWO_SIDES)
    await flush()
    expect(shown()).toEqual([])
    press('1')
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('again', expect.any(Number))
    act(() => buttons()[1].click())
    expect(review.answer).toHaveBeenLastCalledWith('good', expect.any(Number))
  })

  it('YAZ-5010, YAZ-5029: while the page of the card is still read, the buttons stay in their place — but no digit and no click answers', async () => {
    mount(null)
    await flush()
    expect(review.showAnswers).not.toHaveBeenCalled()
    expect(buttons().map((b) => [b.textContent, b.getAttribute('aria-description')])).toEqual([
      ['Forgot1', 'Forgot'],
      ['Remembered2', 'Remembered'],
    ])
    press('2')
    act(() => buttons()[0].click())
    expect(review.answer).not.toHaveBeenCalled()
  })

  it('YAZ-5029: fast ← → — the buttons, the ← → row and the key row are the SAME elements from card to card (never unmounted, never a smaller row), while the answers are fixed again and the next page is read', async () => {
    mount(TWO_SIDES)
    await flush()
    session = { ...session, canNext: true, canBack: true }
    render()
    const nodes = () => ({ actions: el.querySelector('.card-inbox__actions'), moves: el.querySelector('.card-inbox__moves'), hints: el.querySelector('.card-inbox__hints'), buttons: buttons() })
    const before = nodes()
    expect(before.buttons).toHaveLength(2)
    const card = session.card!
    // → : a new card, its answers not fixed yet, and its page not read yet; then the page; then its answers.
    for (const next of [
      { ...session, position: 4, answers: null, card: { ...card, id: 'WIKI-10', page: null } },
      { ...session, position: 4, answers: null, card: { ...card, id: 'WIKI-10', page: { ...card.page!, id: 'WIKI-10', text: 'Next {{card}}' } } },
    ]) {
      session = next
      render()
      const now = nodes()
      expect(now.actions).toBe(before.actions)
      expect(now.moves).toBe(before.moves)
      expect(now.hints).toBe(before.hints)
      expect(now.buttons).toHaveLength(2)
      now.buttons.forEach((b, i) => expect(b).toBe(before.buttons[i]))
    }
    await flush()
    expect(buttons().map((b) => b.getAttribute('aria-description'))).toEqual(['Forgot · later today', 'Remembered · 3 days'])
    buttons().forEach((b, i) => expect(b).toBe(before.buttons[i]))
  })

  it('YAZ-5029: the same card read again with the same text (a new page) fixes its answers again', async () => {
    mount(TWO_SIDES)
    await flush()
    expect(review.showAnswers).toHaveBeenCalledOnce()
    session = { ...session, answers: null, card: { ...session.card!, page: { ...session.card!.page! } } }
    render()
    expect(review.showAnswers).toHaveBeenCalledTimes(2)
  })

  it('a card with one side and no hidden word shows its buttons at once; four buttons by the setting, 1–4', async () => {
    mount('Just a fact', { ...DEFAULT_REVIEW_SETTINGS, buttons: 4 })
    expect(review.showAnswers).toHaveBeenCalledOnce()
    await flush()
    expect(buttons().map((b) => b.getAttribute('aria-description'))).toEqual(['Again · later today', 'Hard · 3 days', 'Good · 9 days', 'Easy · 20 days'])
    expect([...el.querySelectorAll('.card-inbox__hints kbd')].map((k) => k.textContent)).not.toContain('1–4')
    press('3')
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('good', expect.any(Number))
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
    act(() => void el.querySelector('.card-inbox')!.dispatchEvent(esc))
    expect(esc.defaultPrevented).toBe(false)
    expect(review.close).not.toHaveBeenCalled()
  })

  it('YAZ-5011: no × in the head; behind a page tab (shown false) the Inbox is hidden, keeps its step, and hears no key', async () => {
    mount(TWO_SIDES)
    expect(el.querySelector('[aria-label="Close the review"]')).toBeNull()
    expect([...el.querySelectorAll('.card-inbox__head button')].map((b) => b.textContent)).not.toContain('×')
    press(' ')
    expect(shown()).toEqual(['France'])
    act(() => root?.render(<CardInbox {...props} review={review} session={session} shown={false} />))
    const inbox = el.querySelector<HTMLElement>('.card-inbox')!
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
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('Inbox complete.')
    expect(el.querySelector('.card-inbox__done-line')?.textContent).toBe('Nothing else is due today. Enjoy your day!')
    expect([...el.querySelectorAll('.card-inbox__hints kbd')].map((k) => k.textContent)).toEqual(['Cmd', 'Z'])
    press(' ')
    press('o')
    expect(props.openPage).not.toHaveBeenCalled()
  })

  it('the done screen of "Review this page" says the page is done, and "N more in the Inbox" starts the vault`s review', () => {
    mount(TWO_SIDES)
    session = { ...session, label: 'Cards', scope: 'page', card: null }
    render()
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('This page is done.')
    expect(el.querySelector('.card-inbox__done-line')).toBeNull()
    const more = el.querySelector<HTMLButtonElement>('.card-inbox__done-more')!
    expect(more.textContent).toBe('12 more in the Inbox')
    act(() => more.click())
    expect(review.start).toHaveBeenCalledExactlyOnceWith({})
  })

  it('YAZ-5105: a card with reviews shows its Reviews strip (the card window\'s own `CardReviews`) under the card, outside its frame, as soon as the last side shows (round 3: its hidden words shown or not); never on the front or an earlier side', async () => {
    mount(TWO_SIDES)
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, reviews: [{ at: AT, rating: 'good' }, { at: '2026-11-13T09:00Z', rating: 'again' }] } } }
    render()
    await flush()
    const reviews = () => el.querySelector('.card-reviews')
    // The front and its word (side 1 of 2): no strip.
    for (let step = 0; step < 2; step++) {
      expect(reviews(), `step ${step}`).toBeNull()
      press(' ')
    }
    await flush()
    // Round 3 (Yaseen: "just show on the last side … regardless of it hidden words are all revealed or not"): the
    // last side shows, its two hidden words still hidden, and the strip is there.
    expect(blanks()).toBe(2)
    expect(reviews()).not.toBeNull()
    // It stays while the last side's words show.
    press(' ')
    press(' ')
    await flush()
    expect(blanks()).toBe(0)
    expect(reviews()).not.toBeNull()
    // Round 2 (as Mochi): fully shown, the Reviews strip sits OUTSIDE the card's frame, right under it, before the
    // buttons' band; the buttons stay in their band.
    const column = el.querySelector('.card-inbox__column')!
    const panel = column.querySelector('.card-inbox__panel')!
    expect(panel.contains(reviews())).toBe(false)
    expect(reviews()?.classList.contains('card-reviews--strip')).toBe(true)
    expect(reviews()?.previousElementSibling).toBe(panel)
    expect([...column.children].map((c) => c.className)).toEqual(['card-inbox__above', 'card-inbox__panel', 'card-reviews card-reviews--strip', 'card-inbox__dock', 'explore__foot card-inbox__hints'])
    expect(el.querySelector('.card-inbox__dock')?.contains(reviews())).toBe(false)
    expect(el.querySelectorAll('.card-inbox__dock .card-inbox__answer')).toHaveLength(2)
    // The same toggle as the card window's: closed until asked for; open, the table, with no delete in the Inbox.
    const toggle = el.querySelector<HTMLButtonElement>('.card-reviews__toggle')!
    expect(toggle.textContent).toBe('2 Reviews')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => toggle.click())
    expect(el.querySelectorAll('.card-reviews__table tbody tr').length).toBeGreaterThanOrEqual(2)
    expect(el.querySelector('.card-reviews__delete')).toBeNull()
    // A click in it is not a step, and Space still belongs to the Inbox (nothing left to show).
    expect(review.answer).not.toHaveBeenCalled()
  })

  it('YAZ-5105: no Reviews for a card with none, fully shown too; the next card hides it again and starts closed', async () => {
    mount('Just a {{fact}}')
    await flush()
    press(' ')
    await flush()
    expect(blanks()).toBe(0)
    expect(el.querySelector('.card-reviews')).toBeNull()
    session = { ...session, position: 4, card: { ...session.card!, id: 'WIKI-10', page: { ...session.card!.page!, id: 'WIKI-10', reviews: [{ at: AT, rating: 'good' }] } } }
    render()
    await flush()
    expect(el.querySelector('.card-reviews'), 'the next card starts on its front').toBeNull()
    press(' ')
    await flush()
    expect(el.querySelector('.card-reviews__toggle')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('YAZ-5105 round 3: a one-side card (its front is its last side) shows the strip after its first Space, never before; with no hidden word it is fully shown at once, and so is the strip', async () => {
    mount('One {{a}} and {{b}}')
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, reviews: [{ at: AT, rating: 'good' }] } } }
    render()
    await flush()
    expect(el.querySelector('.card-reviews'), 'the front: nothing shown yet').toBeNull()
    press(' ')
    await flush()
    expect(blanks()).toBe(1)
    expect(el.querySelector('.card-reviews')).not.toBeNull()
    session = { ...session, position: 4, card: { ...session.card!, id: 'WIKI-10', page: { ...session.card!.page!, id: 'WIKI-10', text: 'Nothing hidden', reviews: [{ at: AT, rating: 'good' }] } } }
    render()
    await flush()
    expect(el.querySelector('.card-reviews')).not.toBeNull()
  })

  it('YAZ-5002: the buttons sit under the card, outside its panel; the key row is last; YAZ-5021: no "Press Space" line over the buttons at any step (the key row says Space)', async () => {
    mount(TWO_SIDES)
    const column = el.querySelector('.card-inbox__column')!
    const panel = column.querySelector('.card-inbox__panel')!
    await flush()
    expect(column.querySelector('.card-inbox__space')).toBeNull()
    expect(column.textContent).not.toContain('Press')
    expect(column.querySelector('.card-inbox__hints')?.textContent).toContain('Space Show')
    press(' ')
    expect(column.querySelector('.card-inbox__space')).toBeNull()
    const answers = column.querySelector('.card-inbox__actions')!
    expect(answers.querySelectorAll('.card-inbox__answer')).toHaveLength(2)
    expect(panel.contains(answers)).toBe(false)
    expect([...column.children].map((c) => c.className)).toEqual(['card-inbox__above', 'card-inbox__panel', 'card-inbox__dock', 'explore__foot card-inbox__hints'])
    // YAZ-5049 round 2: the buttons and their line in one band, which stays at the bottom of the view.
    expect([...column.querySelector('.card-inbox__dock')!.children].map((c) => c.className)).toEqual(['card-inbox__actions', 'card-inbox__last'])
  })

  it('YAZ-5027: the state chip sits right above the card, outside its head and its frame; the head ends with the ID (YAZ-5132: no "in <page>"), for a new and a due card; the row stays with no card', () => {
    mount(TWO_SIDES)
    const check = (words: string) => {
      const chip = el.querySelector('.card-inbox__state')!
      const head = el.querySelector('.card-inbox__head')!
      expect(chip.textContent).toBe(words)
      expect(head.contains(chip)).toBe(false)
      expect(el.querySelector('.card-inbox__panel')!.contains(chip)).toBe(false)
      expect(chip.parentElement!.matches('.card-inbox__column > .card-inbox__above:first-child')).toBe(true)
      expect(head.lastElementChild!.className).toBe('card__id')
    }
    check('New card')
    session = { ...session, card: { ...session.card!, isNew: false, due: Date.now() - 3 * 86_400_000 } }
    render()
    check('Due · 3 days ago')
    session = { ...session, card: null }
    render()
    expect(el.querySelector('.card-inbox__state')).toBeNull()
    expect(el.querySelector('.card-inbox__column > .card-inbox__above:first-child')).not.toBeNull()
  })

  it('YAZ-5004: ← → (buttons and keys) move to the card before or after with no answer; each is off at its end; the key row says so', () => {
    mount(TWO_SIDES)
    const moves = () => [...el.querySelectorAll<HTMLButtonElement>('.card-inbox__move')]
    expect(moves().map((b) => [b.getAttribute('aria-label'), b.disabled])).toEqual([['Previous card', true], ['Next card', true]])
    press('ArrowRight')
    expect(review.move).not.toHaveBeenCalled()
    session = { ...session, canNext: true }
    render()
    expect(moves().map((b) => b.disabled)).toEqual([true, false])
    expect([...el.querySelectorAll('.card-inbox__hints span')].map((h) => h.textContent)).toContain('Left / Right Other cards')
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
    const more = () => el.querySelector<HTMLButtonElement>('.card-inbox__more-button')!
    const actions = () => [...el.querySelectorAll<HTMLButtonElement>('.card-inbox__more-action')]
    expect(actions()).toEqual([])
    act(() => more().click())
    expect(actions().map((b) => [b.getAttribute('aria-label'), b.disabled])).toEqual([
      ['Undo last review', true],
      ['Archive card', false],
      ['Put at top of Inbox', false],
      ['Fix later', false],
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
    run('Archive card')
    expect(review.turnOff).toHaveBeenCalledOnce()
    run('Put at top of Inbox')
    expect(review.setNext).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', true)
    run('Fix later')
    expect(review.setFix).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', true)
    run('Open card')
    expect(props.openCard).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', 0, false)
    expect(actions()).toEqual([])
  })

  it('YAZ-5017: the top row — "All cards ▾" opens All cards / Due today / New cards with their counts; a pick sets the filter; the scope shows as a quiet path; the filter`s done screen leads back to All cards', () => {
    mount(TWO_SIDES)
    session = { ...session, scope: 'folder', from: ['Spanish', 'Verbs'] }
    render()
    const bar = el.querySelector('.card-inbox__bar')!
    const filter = bar.querySelector<HTMLButtonElement>('.card-inbox__filter')!
    expect(filter.textContent).toBe('All cards')
    // YAZ-5017 round 2: the scope sits by the filter, "· in …".
    expect(bar.querySelector('.card-inbox__from')?.textContent).toBe('·in Spanish / Verbs')
    expect(bar.querySelector('.card-inbox__from')?.getAttribute('title')).toBe('Reviewing Spanish / Verbs')
    act(() => filter.click())
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.card-inbox__filter-item')]
    expect(rows().map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['All cards12', 'true'],
      ['Up next0', 'false'],
      ['Due today9', 'false'],
      ['New cards3', 'false'],
      ['To fix0', 'false'],
      ['Archived0', 'false'],
    ])
    // The menu is open: the Inbox's keys are not taken (a menu owns them).
    press('1')
    expect(review.answer).not.toHaveBeenCalled()
    act(() => rows()[2].click())
    expect(review.setFilter).toHaveBeenCalledExactlyOnceWith('due')
    expect(rows()).toHaveLength(0)
    // The due cards are done, new cards are left.
    session = { ...session, filter: 'due', card: null, counts: { all: 3, next: 0, due: 0, new: 3 } }
    render()
    expect(el.querySelector('.card-inbox__filter')?.textContent).toBe('Due today')
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('No due cards left.')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__done-more')!.click())
    expect(review.setFilter).toHaveBeenLastCalledWith('all')
  })

  it('YAZ-5028: the menu`s second row is Up next with its count in the chip`s colours (grey at 0); a pick sets the filter; its done screen leads back to All cards', () => {
    mount(TWO_SIDES)
    session = { ...session, counts: { all: 12, next: 2, due: 9, new: 3 } }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.card-inbox__filter-item')]
    expect(rows().map((r) => r.textContent)).toEqual(['All cards12', 'Up next2', 'Due today9', 'New cards3', 'To fix0', 'Archived0'])
    const count = rows()[1].querySelector('.card-inbox__count')!
    expect([count.getAttribute('data-filter'), count.hasAttribute('data-empty')]).toEqual(['next', false])
    act(() => rows()[1].click())
    expect(review.setFilter).toHaveBeenCalledExactlyOnceWith('next')
    // The Up next cards are done, others are left.
    session = { ...session, filter: 'next', card: null, counts: { all: 10, next: 0, due: 7, new: 3 } }
    render()
    expect(el.querySelector('.card-inbox__filter')?.textContent).toBe('Up next')
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('No Up next cards left.')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__done-more')!.click())
    expect(review.setFilter).toHaveBeenLastCalledWith('all')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    expect(rows()[1].querySelector('.card-inbox__count')?.hasAttribute('data-empty')).toBe(true)
  })

  it('YAZ-5018: the buttons wear their glyphs — ✕ Forgot and ✓ Remembered; with four buttons ↺ Again, ~ Hard, ✓ Good, ⇈ Easy — each a round pill with its digit', async () => {
    const glyphs = () => buttons().map((b) => [b.querySelector('.card-inbox__answer-label')?.textContent, b.querySelector('svg.card-inbox__answer-icon path')?.getAttribute('d'), b.querySelector('kbd')?.textContent])
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
    expect(cardStateText({ isNew: true, due: now }, now)).toBe('New card')
    expect(cardStateText({ isNew: false, due: new Date(2026, 10, 12, 1, 0).getTime() }, now)).toBe('Due today')
    expect(cardStateText({ isNew: false, due: new Date(2026, 10, 11, 23, 0).getTime() }, now)).toBe('Due · 1 day ago')
    expect(cardStateText({ isNew: false, due: new Date(2026, 10, 9, 14, 0).getTime() }, now)).toBe('Due · 3 days ago')
    mount(TWO_SIDES)
    session = { ...session, card: { ...session.card!, isNew: false, due: Date.now() } }
    render()
    const chip = el.querySelector('.card-inbox__state')!
    expect([chip.textContent, chip.getAttribute('data-state')]).toEqual(['Due today', 'due'])
  })

  it('YAZ-5019: the width clamps between 420 px and the room the tab leaves', () => {
    expect(clampCardWidth(300, 1000)).toBe(CARD_MIN_WIDTH)
    expect(clampCardWidth(700.4, 1000)).toBe(700)
    expect(clampCardWidth(1400, 1000)).toBe(1000)
    // A tab narrower than the minimum: the minimum (CSS then caps the card at the tab's width).
    expect(clampCardWidth(800, 380)).toBe(CARD_MIN_WIDTH)
  })

  it('YAZ-5019: a drag of the right edge widens the card by twice the move (it stays centred), the left edge the same the other way; clamped to the tab; the width stays across a card change and the Inbox closed and opened again', async () => {
    setInboxCardWidth(null)
    mount(TWO_SIDES)
    const column = () => el.querySelector<HTMLElement>('.card-inbox__column')!
    expect(column().style.width).toBe('')
    const inbox = el.querySelector<HTMLElement>('.card-inbox')!
    Object.defineProperty(inbox, 'clientWidth', { configurable: true, value: 1032 }) // 1000 px of room
    column().getBoundingClientRect = () => ({ width: 640 }) as DOMRect
    const drag = (side: 'left' | 'right', from: number, to: number) => {
      const edge = el.querySelector<HTMLElement>(`.card-inbox__edge[data-side="${side}"]`)!
      expect(edge.getAttribute('role')).toBe('separator')
      act(() => void edge.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: from, button: 0 })))
      expect(document.body.classList.contains('card-inbox--sizing')).toBe(true)
      act(() => void window.dispatchEvent(new MouseEvent('pointermove', { clientX: to })))
      act(() => void window.dispatchEvent(new MouseEvent('pointerup', { clientX: to })))
      expect(document.body.classList.contains('card-inbox--sizing')).toBe(false)
    }
    drag('right', 900, 950)
    expect(inboxCardWidth()).toBe(740)
    expect(column().style.width).toBe('min(740px, 100%)')
    column().getBoundingClientRect = () => ({ width: 740 }) as DOMRect
    drag('left', 300, 400) // the left edge in: narrower by 200
    expect(inboxCardWidth()).toBe(540)
    drag('left', 300, 0) // far out: the room
    expect(inboxCardWidth()).toBe(1000)
    drag('right', 900, 0) // far in: the minimum
    expect(inboxCardWidth()).toBe(CARD_MIN_WIDTH)
    // Another card: the same width.
    session = { ...session, position: 4, card: { ...session.card!, id: 'WIKI-10', page: { ...session.card!.page!, id: 'WIKI-10' } } }
    render()
    expect(column().style.width).toBe(`min(${CARD_MIN_WIDTH}px, 100%)`)
    // The Inbox tab closed and opened again (the app still runs): the same width.
    act(() => root?.unmount())
    el.remove()
    mount(TWO_SIDES)
    expect(column().style.width).toBe(`min(${CARD_MIN_WIDTH}px, 100%)`)
    setInboxCardWidth(null)
  })

  it('YAZ-5020: the progress bar under the top row — empty at start; a Remembered adds a grey part, a Forgot a red one, each 1/size wide; the same answers in a row draw one part', () => {
    mount(TWO_SIDES)
    const bar = () => el.querySelector<HTMLElement>('.card-inbox__top > .card-inbox__progress')!
    const parts = () => [...bar().querySelectorAll<HTMLElement>('.card-inbox__progress-part')].map((p) => [p.dataset.missed === 'true' ? 'red' : 'grey', p.style.width])
    expect(el.querySelector('.card-inbox__top')?.firstElementChild?.className).toBe('card-inbox__bar')
    expect(parts()).toEqual([])
    expect(bar().getAttribute('aria-valuenow')).toBe('0')
    session = { ...session, size: 8, answered: ['good'] }
    render()
    expect(parts()).toEqual([['grey', '12.5%']])
    session = { ...session, answered: ['good', 'again'] }
    render()
    expect(parts()).toEqual([['grey', '12.5%'], ['red', '12.5%']])
    session = { ...session, answered: ['good', 'again', 'again', 'easy', 'hard'] }
    render()
    expect(parts()).toEqual([['grey', '12.5%'], ['red', '25%'], ['grey', '25%']])
    expect([bar().getAttribute('aria-valuenow'), bar().getAttribute('aria-valuemax')]).toEqual(['5', '8'])
  })

  it('YAZ-5024: the key row folds the least important keys when it does not fit — ⌘↵ first, then O; Space and E stay', () => {
    const keys = ['Space', '⌘Z', 'O', 'E', '⌘↵']
    const widths = [80, 60, 80, 70, 60]
    // All fit: 350 + 4 gaps of 16 = 414.
    expect([...foldHints(keys, widths, 16, 414)]).toEqual([])
    expect([...foldHints(keys, widths, 16, 413)]).toEqual(['⌘↵'])
    expect([...foldHints(keys, widths, 16, 300)]).toEqual(['⌘↵', 'O'])
    // Very narrow: ⌘Z too; Space and E never.
    expect([...foldHints(keys, widths, 16, 100)]).toEqual(['⌘↵', 'O', '⌘Z'])
  })

  it('YAZ-5024: the key row measures its room with a ResizeObserver and folds ⌘↵ when "⌘Z Undo" joins it; the row never wraps', async () => {
    let fire: () => void = () => undefined
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          fire = cb
        }
        observe(el: Element) {
          observed.push(el)
        }
        disconnect() {}
      },
    )
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.keys === undefined ? 0 : 70
    })
    const room = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('card-inbox__hints') ? 340 : 0
    })
    try {
      mount(TWO_SIDES)
      const row = el.querySelector<HTMLElement>('.card-inbox__hints')!
      expect(observed).toContain(row)
      const folded = () => [...row.querySelectorAll<HTMLElement>('[data-folded]')].map((s) => s.dataset.keys)
      // Space, O, E, ⌘↵: 4 × 70 = 280 (jsdom lays out no gap), in a row of 340 less its padding (28): all fit.
      expect(folded()).toEqual([])
      session = { ...session, canUndo: true }
      render()
      // ⌘Z joins: 5 × 70 = 350 does not fit in 312: ⌘↵ folds first.
      expect(folded()).toEqual(['⌘↵'])
      // The card made wider (YAZ-5019): the observer says so, and the row has room for all.
      room.mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('card-inbox__hints') ? 600 : 0
      })
      act(() => fire())
      expect(folded()).toEqual([])
    } finally {
      width.mockRestore()
      room.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('YAZ-5025 round 2: no toast; an answer that lands shows one line under the buttons in the hover`s words; its Undo is the hook`s undo, as ⌘Z, and an undo clears it; the next answer replaces it; the row keeps its height', async () => {
    mount(TWO_SIDES)
    await flush()
    const last = () => el.querySelector<HTMLElement>('.card-inbox__last')!
    // The row is there, empty, before any answer (no jump when the line comes).
    expect(last().textContent).toBe('')
    press('2')
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('good', expect.any(Number))
    // Not yet counted by the session (the write runs): no line.
    expect(last().textContent).toBe('')
    session = { ...session, answered: ['good'], canUndo: true }
    render()
    // YAZ-5030: the card by its title, the ID after it.
    expect(last().textContent).toBe('✓ Remembered · Capital of France (WIKI-9) · back in 3 days · Undo Cmd + Z')
    expect(last().dataset.rating).toBe('good')
    expect(props.onNotice).not.toHaveBeenCalled()
    // Undo in the line: the hook's own undo; the session takes the answer off, and the line clears.
    act(() => last().querySelector<HTMLButtonElement>('.card-inbox__last-undo')!.click())
    expect(review.undo).toHaveBeenCalledOnce()
    session = { ...session, answered: [], canUndo: false }
    render()
    expect(last().textContent).toBe('')
    // A failed write: the session counts nothing, so no line (the hook shows its error).
    act(() => buttons()[0].click())
    expect(review.answer).toHaveBeenLastCalledWith('again', expect.any(Number))
    render()
    expect(last().textContent).toBe('')
    // The next answer that lands: its line, in red (a Forgot).
    session = { ...session, answered: ['again'], canUndo: true }
    render()
    expect(last().textContent).toBe('✕ Forgot · Capital of France (WIKI-9) · back later today · Undo Cmd + Z')
    expect(last().dataset.rating).toBe('again')
    // ⌘Z is the same undo; once the session drops the answer, the line clears.
    press('z', { metaKey: true })
    expect(review.undo).toHaveBeenCalledTimes(2)
    session = { ...session, answered: [], canUndo: false }
    render()
    expect(last().textContent).toBe('')
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('YAZ-5025 round 2: the line`s words with four buttons use their own names and glyphs', () => {
    const four = { ...DEFAULT_REVIEW_SETTINGS, buttons: 4 as const }
    expect(answerLine('again', 'DEMO-51', 0, true, four)).toBe('↺ Again · DEMO-51 · back later today')
    expect(answerLine('hard', 'DEMO-51', 1, false, four)).toBe('~ Hard · DEMO-51 · back in 1 day')
    expect(answerLine('easy', 'DEMO-51', 20, false, four)).toBe('⇈ Easy · DEMO-51 · back in 20 days')
    expect(answerLine('good', 'DEMO-51', 9, false, DEFAULT_REVIEW_SETTINGS)).toBe('✓ Remembered · DEMO-51 · back in 9 days')
    // YAZ-5030: by its title, the ID after it; a long title ends in "…", so "back in …" stays in sight.
    expect(answerLine('good', 'DEMO-51', 9, false, DEFAULT_REVIEW_SETTINGS, 'Spanish verb 3')).toBe('✓ Remembered · Spanish verb 3 (DEMO-51) · back in 9 days')
    const long = answerLine('good', 'DEMO-51', 9, false, DEFAULT_REVIEW_SETTINGS, 'A very long card title that goes on and on past the room it has')
    expect(long).toBe(`✓ Remembered · ${'A very long card title that goes on and'}… (DEMO-51) · back in 9 days`)
  })

  it('YAZ-5017 round 2, YAZ-5132: the top row shows the CURRENT card`s place, vault › folders › page, the ONE breadcrumb, each part with its folder or page icon; it changes with the card; a folder opens through `openPlace`, the page as O does; the scope shows only when narrower than the vault', () => {
    mount(TWO_SIDES)
    const parts = () => [...el.querySelectorAll<HTMLButtonElement>('.card-inbox__path-part')]
    session = { ...session, place: [{ kind: 'vault', label: 'Demo', path: '/v' }, { kind: 'folder', label: 'spanish-words', path: '/v/spanish-words' }, { kind: 'page', label: 'Verbs', path: PATH }] }
    render()
    expect(parts().map((p) => p.textContent)).toEqual(['Demo', 'spanish-words', 'Verbs'])
    // YAZ-5132: the tree's own icons (YAZ-5100), a folder's for the vault and the folders, a page's for the page.
    expect(parts().map((p) => p.querySelector('.file-icon')?.classList.contains('file-icon--dir'))).toEqual([true, true, false])
    expect(parts()[2].querySelector('.file-icon--file')).not.toBeNull()
    expect(el.querySelector('.card-inbox__path')?.getAttribute('title')).toBe('Demo › spanish-words › Verbs')
    // The head no longer says "in Verbs": one place, said once.
    expect(el.querySelector('.card-inbox__in')).toBeNull()
    act(() => parts()[2].click())
    expect(props.openPage).toHaveBeenLastCalledWith(PATH)
    expect(props.openPlace).not.toHaveBeenCalled()
    // The whole vault under review: no "· in …" (Yaseen: "isnt this redundant?").
    expect(el.querySelector('.card-inbox__from')).toBeNull()
    act(() => parts()[1].click())
    expect(props.openPlace).toHaveBeenLastCalledWith('/v/spanish-words')
    act(() => parts()[0].click())
    expect(props.openPlace).toHaveBeenLastCalledWith('/v')
    // The next card, in another folder: the path follows it.
    session = { ...session, place: [{ kind: 'vault', label: 'Demo', path: '/v' }, { kind: 'folder', label: 'Bio', path: '/v/Bio' }] }
    render()
    expect(parts().map((p) => p.textContent)).toEqual(['Demo', 'Bio'])
    // A review of one page: the scope says it.
    session = { ...session, scope: 'page', from: ['Cells'] }
    render()
    expect(el.querySelector('.card-inbox__from')?.textContent).toBe('·in Cells')
    // No card (the done screen): no place.
    session = { ...session, card: null, place: [] }
    render()
    expect(el.querySelector('.card-inbox__path')).toBeNull()
  })
})

describe('the title on the front (YAZ-5030)', () => {
  const TITLED = '###### {{Capital of France}}\n\nWhat is the capital of {{France}}?\n---\n{{Paris}}'
  const withLine = (notitle: boolean) => {
    mount(TITLED)
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, notitle } } }
    render()
  }
  /** The title in the head (YAZ-5044): "Title · ID". */
  const label = () => el.querySelector('.card-inbox__head .card-inbox__name')?.textContent ?? null
  const text = () => el.querySelector('.card-inbox__card')?.textContent ?? ''

  it('Hide: the front draws no title, and the title is NEVER a Space step (its hidden word neither); the head shows the ID only until the card is fully shown, then the title (YAZ-5044)', async () => {
    withLine(true)
    await flush()
    expect(text()).not.toContain('Capital of France')
    // The first Space shows the first hidden word of the CONTENT.
    expect(blanks()).toBe(1)
    expect(label()).toBeNull()
    press(' ')
    expect(shown()).toEqual(['France'])
    expect(label()).toBeNull()
    press(' ')
    expect(sides()).toBe(2)
    expect(label()).toBeNull()
    press(' ')
    expect(shown()).toEqual(['France', 'Paris'])
    // Fully shown: the head says which card it was; the card itself still has no title.
    expect(label()).toBe('Capital of France')
    expect(el.querySelector('.card-inbox__head')!.textContent).toBe('Capital of France·WIKI-9')
    expect(el.querySelectorAll('.card-inbox__title')).toHaveLength(0)
    expect(text()).not.toContain('Capital of France')
  })

  it('Show (an old card, no part): the title is part of the front as before, its hidden word the first Space step; the head waits for the last step to show it, as the title tells the answer (YAZ-5044)', async () => {
    withLine(false)
    await flush()
    expect(blanks()).toBe(2)
    press(' ')
    expect(shown()).toEqual(['Capital of France'])
    press(' ')
    press(' ')
    press(' ')
    expect(shown()).toEqual(['Capital of France', 'France', 'Paris'])
    expect(label()).toBe('Capital of France')
  })

  it('the answer line names the card by its title, a hidden title too (the answer is given)', async () => {
    withLine(true)
    await flush()
    press('2')
    session = { ...session, answered: ['good'], canUndo: true }
    render()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe('✓ Remembered · Capital of France (WIKI-9) · back in 3 days · Undo Cmd + Z')
  })
})

describe('YAZ-5044 the Inbox head: "Title · ID" (YAZ-5132: the page is the breadcrumb`s last part), "Open card" for a card file', () => {
  const PLAIN = 'Capital of France\n\nWhat is the capital of {{France}}?'
  const headText = () => el.querySelector('.card-inbox__head')!.textContent
  const hints = () => [...el.querySelectorAll('.card-inbox__hints span')].map((h) => h.textContent)
  /** The card's file is a card file (`kind: card`), as the index says. */
  const asCardFile = () => {
    const record = { path: PATH, name: 'cards.md', basename: 'cards', title: 'Capital of France', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: { kind: 'card' }, aliases: [], tags: [], links: [], embeds: [], kind: 'card' as const }
    const wikilinks = createWikilinkResolveSource()
    wikilinks.update(() => null, [record])
    props = { ...props, vaultOf: () => ({ root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never }), openTab: vi.fn() }
    render()
  }

  it('a card in a page: "Capital of France · WIKI-9" from the start (no hidden word in its title), no "in Cards"; the breadcrumb`s page part and O open the page', () => {
    mount(PLAIN)
    session = { ...session, place: [{ kind: 'vault', label: 'Demo', path: '/v' }, { kind: 'page', label: 'Cards', path: PATH }] }
    render()
    expect(headText()).toBe('Capital of France·WIKI-9')
    expect(el.querySelector('.card-inbox__in')).toBeNull()
    expect(el.querySelector('.card-inbox__name')!.tagName).toBe('SPAN')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__path-part[data-kind="page"]')!.click())
    expect(props.openPage).toHaveBeenCalledExactlyOnceWith(PATH)
    expect(props.openPlace).not.toHaveBeenCalled()
    press('o')
    expect(props.openPage).toHaveBeenCalledTimes(2)
    expect(hints()).toContain('O Open page')
  })

  it('a card file adds nothing: "Capital of France · WIKI-9"; its title is the link, and it and O open the card file`s tab ("Open card")', () => {
    mount(PLAIN)
    asCardFile()
    expect(headText()).toBe('Capital of France·WIKI-9')
    expect(el.querySelector('.card-inbox__in')).toBeNull()
    expect(hints()).toContain('O Open card')
    expect(hints()).not.toContain('O Open page')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__name')!.click())
    expect(props.openTab).toHaveBeenCalledExactlyOnceWith(PATH)
    press('o')
    expect(props.openTab).toHaveBeenCalledTimes(2)
    expect(props.openPage).not.toHaveBeenCalled()
  })

  it('a card file with `notitle`: the ID only until the card is fully shown, then the title; O opens its tab all along', async () => {
    mount(PLAIN)
    asCardFile()
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, notitle: true } } }
    render()
    await flush()
    expect(headText()).toBe('WIKI-9')
    press('o')
    expect(props.openTab).toHaveBeenCalledOnce()
    press(' ')
    expect(headText()).toBe('Capital of France·WIKI-9')
  })

  it('while the card`s page is still read: the ID, no title yet', () => {
    mount(null)
    expect(headText()).toBe('WIKI-9')
  })
})

describe('sound and boards in the Inbox (YAZ-5014, YAZ-5015)', () => {
  /** jsdom has no media engine: `play` and `pause` move `paused`. */
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { value: false, configurable: true })
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { value: true, configurable: true })
    })
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  const hints = () => [...el.querySelectorAll('.card-inbox__hints span')].map((h) => h.textContent)

  it('nothing plays by itself; P plays and stops; P typed in a field is not the Inbox`s; the next card stops it', async () => {
    const { cardAudioPlaying } = await import('../editor/card/cardMedia')
    mount('Hear it ![[tone.mp3]]\n---\nA tone')
    expect(el.querySelector('.card__audio')).not.toBeNull()
    expect(cardAudioPlaying()).toBe(false)
    press('p')
    expect(cardAudioPlaying()).toBe(true)
    press('P')
    expect(cardAudioPlaying()).toBe(false)
    const field = document.createElement('input')
    el.querySelector('.card-inbox')!.append(field)
    press('p', {}, field)
    expect(cardAudioPlaying()).toBe(false)
    field.remove()
    press('p')
    expect(cardAudioPlaying()).toBe(true)
    // ← → or an answer: another card comes, and the sound stops.
    session = { ...sessionOf('Next card'), position: 4 }
    render()
    expect(cardAudioPlaying()).toBe(false)
  })

  it('a click on the player plays and does not step the card; "P Play" is in the key row only while a side that shows has a sound', async () => {
    const { cardAudioPlaying, stopCardAudio } = await import('../editor/card/cardMedia')
    mount('Front {{word}}\n---\n![](assets/audio/tone.mp3)')
    expect(hints()).not.toContain('P Play')
    press(' ')
    press(' ')
    expect(el.querySelector('.card__audio')).not.toBeNull()
    expect(hints()).toContain('P Play')
    const before = shown()
    act(() => el.querySelector<HTMLButtonElement>('.card__audio-play')!.click())
    expect(cardAudioPlaying()).toBe(true)
    expect(shown()).toEqual(before)
    stopCardAudio()
    session = { ...sessionOf('No sound'), position: 9 }
    render()
    expect(hints()).not.toContain('P Play')
  })

  it('a board`s picture shows; a click opens the board on top (the Explore layer), never a step', () => {
    mount('Loading')
    const viewOnlyLinks = createViewOnlyLinkSource()
    viewOnlyLinks.update({ entries: [], resolve: (t: string) => (t === 'Card pipeline.drawio' ? '/v/Card pipeline.drawio' : null) } as never)
    const base = props.vaultOf
    props = { ...props, vaultOf: (p) => ({ ...base(p), viewOnlyLinks }) }
    session = { ...sessionOf('A diagram\n---\n![[Card pipeline.drawio]]'), position: 5 }
    render()
    press(' ')
    const board = el.querySelector<HTMLElement>('.card__board')!
    expect(board.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    act(() => void board.querySelector('img')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })))
    expect(props.openLayer).toHaveBeenCalledWith('/v/Card pipeline.drawio')
  })
})

describe('YAZ-5033: how long each answer took — the timer pauses when you are idle; no cap', () => {
  const T0 = new Date(2026, 10, 13, 10, 0).getTime()
  const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
  /** `seconds` of work: each second a mouse move, as a hand on the mouse. */
  const work = (seconds: number, kind: 'mousemove' | 'wheel' | 'pointerdown' = 'mousemove') => {
    for (let i = 0; i < seconds; i++) {
      tick(1000)
      act(() => void window.dispatchEvent(kind === 'wheel' ? new WheelEvent('wheel') : new MouseEvent(kind)))
    }
  }
  const secondsOfAnswer = () => vi.mocked(review.answer).mock.calls.at(-1)?.[1]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
  })
  afterEach(() => vi.useRealTimers())

  it('10 s of work, 90 s with no key or mouse, 5 s of work → 15 s with the 60 s setting: the idle stretch counts nothing', async () => {
    mount(TWO_SIDES)
    await flush()
    work(10)
    tick(90_000)
    act(() => void window.dispatchEvent(new MouseEvent('mousemove'))) // back at the desk: the time goes on from here
    work(5)
    press('2')
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('good', 15)
  })

  it('the setting decides what is idle: 10 s, 45 s still, 5 s → 15 s with 30 s, 60 s with 60 s (a long think counts in full: no cap)', async () => {
    for (const [pauseAfter, want] of [
      [30, 15],
      [60, 60],
    ] as const) {
      mount(TWO_SIDES, { ...DEFAULT_REVIEW_SETTINGS, pauseAfter })
      await flush()
      work(10)
      tick(45_000)
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })))
      work(5, 'wheel')
      press('1')
      expect(secondsOfAnswer()).toBe(want)
      act(() => root?.unmount())
      el.remove()
      root = null
      vi.clearAllMocks()
    }
    mount(TWO_SIDES) // for afterEach
  })

  it('no touch at all still counts while it is no idle stretch: 40 s reading, then the answer key → 40 s', async () => {
    mount(TWO_SIDES)
    await flush()
    tick(40_000)
    press('2')
    expect(secondsOfAnswer()).toBe(40)
  })

  it('a blurred window pauses it: a mouse over the window in the background counts nothing; focus goes on', async () => {
    mount(TWO_SIDES)
    await flush()
    work(5)
    act(() => void window.dispatchEvent(new FocusEvent('blur')))
    work(30)
    act(() => void window.dispatchEvent(new FocusEvent('focus')))
    work(3, 'pointerdown')
    press('2')
    expect(secondsOfAnswer()).toBe(8)
  })

  it('a hidden window pauses it (visibilitychange)', async () => {
    mount(TWO_SIDES)
    await flush()
    work(4)
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    work(20)
    state.mockReturnValue('visible')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    work(2)
    state.mockRestore()
    press('2')
    expect(secondsOfAnswer()).toBe(6)
  })

  it('the Inbox tab behind a page tab pauses it; in front again it goes on', async () => {
    mount(TWO_SIDES)
    await flush()
    work(7)
    props = { ...props, shown: false }
    render()
    work(50)
    props = { ...props, shown: true }
    render()
    work(3)
    press('2')
    expect(secondsOfAnswer()).toBe(10)
  })

  it('it starts again from 0 when a card shows — the next card, and the card ⌘Z shows again', async () => {
    mount(TWO_SIDES)
    await flush()
    work(20)
    // The next card (a new place in the session): from zero.
    session = sessionOf(TWO_SIDES, { position: 4 })
    render()
    await flush()
    work(3)
    press('2')
    expect(secondsOfAnswer()).toBe(3)
    // ⌘Z shows the first card again: from zero again, not its old 20 s.
    session = sessionOf(TWO_SIDES, { position: 3 })
    render()
    await flush()
    work(2)
    press('1')
    expect(secondsOfAnswer()).toBe(2)
  })

  it('a click on an answer button writes the seconds too', async () => {
    mount(TWO_SIDES)
    await flush()
    work(12, 'pointerdown')
    act(() => buttons()[1].click())
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('good', 12)
  })
})

describe("YAZ-5033: today's total — the top row and the done screen", () => {
  const SHOWN = { ...DEFAULT_REVIEW_SETTINGS, timeSoFar: 'shown' as const }
  it('the top row says "Today: N cards · M min" before "3 of 12"; nothing with no card answered today', () => {
    mount(TWO_SIDES, SHOWN)
    expect(el.querySelector('.card-inbox__today')).toBeNull()
    session = { ...session, today: { cards: 31, reviews: 35, seconds: 9 * 60 + 10 } }
    render()
    const bar = el.querySelector('.card-inbox__bar')!
    expect(bar.querySelector('.card-inbox__today')?.textContent).toBe('Today: 31 cards · 9 min')
    expect(bar.querySelector('.card-inbox__today + .card-inbox__place')?.textContent).toBe('3 of 12')
    session = { ...session, today: { cards: 1, reviews: 1, seconds: 13 } }
    render()
    expect(bar.querySelector('.card-inbox__today')?.textContent).toBe('Today: 1 card · 13 s')
    // Only old reviews (no seconds) today: the cards alone.
    session = { ...session, today: { cards: 2, reviews: 2, seconds: 0 } }
    render()
    expect(bar.querySelector('.card-inbox__today')?.textContent).toBe('Today: 2 cards')
  })

  it('the done screen says today`s total under "Inbox complete."', () => {
    mount(TWO_SIDES, SHOWN)
    session = { ...session, card: null, today: { cards: 12, reviews: 14, seconds: 4 * 60 + 31 } }
    render()
    const done = el.querySelector('.card-inbox__done')!
    expect(done.querySelector('.card-inbox__done-title')?.textContent).toBe('Inbox complete.')
    expect(done.querySelector('.card-inbox__done-today')?.textContent).toBe('Today: 12 cards · 5 min')
    // Still shown on a page's done screen.
    session = { ...session, scope: 'page' }
    render()
    expect(el.querySelector('.card-inbox__done-today')?.textContent).toBe('Today: 12 cards · 5 min')
  })
})

describe('YAZ-5130: Time so far — hidden behind a click (the default), shown, or off', () => {
  const today = { cards: 31, reviews: 35, seconds: 9 * 60 + 10 }
  const bar = () => el.querySelector('.card-inbox__bar .card-inbox__today')
  const clock = () => el.querySelector<HTMLButtonElement>('.card-inbox__bar .card-inbox__time')

  it('hidden: the cards, then a clock in the time\'s place; a click shows the time, a second click hides it again', () => {
    mount(TWO_SIDES)
    expect(review.settings.timeSoFar).toBe('hidden')
    session = { ...session, today }
    render()
    expect(bar()?.textContent).toBe('Today: 31 cards · ')
    expect(clock()?.getAttribute('aria-label')).toBe('Show time so far')
    expect(clock()?.getAttribute('aria-pressed')).toBe('false')
    expect(clock()?.querySelector('svg')).not.toBeNull()
    act(() => clock()!.click())
    expect(bar()?.textContent).toBe('Today: 31 cards · 9 min')
    expect(clock()?.getAttribute('aria-label')).toBe('Hide time so far')
    expect(clock()?.getAttribute('aria-pressed')).toBe('true')
    act(() => clock()!.click())
    expect(bar()?.textContent).toBe('Today: 31 cards · ')
    // The keyboard stays in the Inbox: a press on the clock takes no focus.
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    clock()!.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
  })

  it('hidden: the done screen hides the time the same way, and a click there shows it', () => {
    mount(TWO_SIDES)
    session = { ...session, card: null, today }
    render()
    const done = () => el.querySelector('.card-inbox__done-today')
    expect(done()?.textContent).toBe('Today: 31 cards · ')
    act(() => done()!.querySelector<HTMLButtonElement>('.card-inbox__time')!.click())
    expect(done()?.textContent).toBe('Today: 31 cards · 9 min')
  })

  it('hidden with no seconds today: no clock, as there is no time to show', () => {
    mount(TWO_SIDES)
    session = { ...session, today: { cards: 2, reviews: 2, seconds: 0 } }
    render()
    expect(bar()?.textContent).toBe('Today: 2 cards')
    expect(clock()).toBeNull()
  })

  it('off: the cards alone, no clock, in the top row and on the done screen; the answer still saves its seconds', async () => {
    mount(TWO_SIDES, { ...DEFAULT_REVIEW_SETTINGS, timeSoFar: 'off' })
    session = { ...session, today }
    render()
    expect(bar()?.textContent).toBe('Today: 31 cards')
    expect(el.querySelector('.card-inbox__time')).toBeNull()
    await flush()
    press('2')
    expect(review.answer).toHaveBeenCalledExactlyOnceWith('good', expect.any(Number))
    session = { ...session, card: null }
    render()
    expect(el.querySelector('.card-inbox__done-today')?.textContent).toBe('Today: 31 cards')
    expect(el.querySelector('.card-inbox__time')).toBeNull()
  })
})

describe('YAZ-5042: add more cards for today, from the Inbox (no trip to Settings)', () => {
  const rows = () => [...document.querySelectorAll<HTMLElement>('.card-inbox__filter-row')]
  // A field reads as "[10]": the done screen's pill is "Add [10] new cards" (round 2).
  const textOf = (node: Node): string => (node instanceof HTMLInputElement ? `[${node.value}]` : node.childNodes.length === 0 ? (node.textContent ?? '') : [...node.childNodes].map(textOf).join(''))
  const doneText = () => [...el.querySelectorAll('.card-inbox__done > *')].map(textOf)
  const pills = () => [...el.querySelectorAll<HTMLElement>('.card-inbox__done-add')]
  const addButtons = () => pills().map((p) => p.querySelector<HTMLButtonElement>('.card-inbox__done-add-word')!)

  const typeIn = (input: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const key = (target: Element, k: string) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
  const field = () => document.querySelector<HTMLInputElement>('.card-inbox__add-number')
  const WAITING = { counts: { all: 22, next: 2, due: 10, new: 10 }, more: { new: 38, next: 3 }, adds: { new: 10, next: 2 }, limited: { new: true, next: true } }

  it('round 2: the Up next and New cards rows read "today / total" ("2 / 5", "10 / 48"); no limit: the count alone', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    expect(rows().map((r) => r.textContent)).toEqual(['All cards22', 'Up next2 / 5', 'Due today10', 'New cards10 / 48', 'To fix0', 'Archived0'])
    // The total is every card of the kind: nothing waits, it is today's count.
    session = { ...session, more: { new: 0, next: 0 }, adds: { new: 0, next: 0 } }
    render()
    expect(rows().map((r) => r.textContent)).toEqual(['All cards22', 'Up next2 / 2', 'Due today10', 'New cards10 / 10', 'To fix0', 'Archived0'])
    session = { ...session, limited: { new: false, next: false } }
    render()
    expect(rows().map((r) => r.textContent)).toEqual(['All cards22', 'Up next2', 'Due today10', 'New cards10', 'To fix0', 'Archived0'])
  })

  it('round 2: a click on the count turns the row into "Add [10] more new cards" (the Settings number, selected); Enter adds the typed number and the menu stays open; Esc goes back; the keys stay in the field', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    // A click on the name picks the filter; on the count, the field.
    act(() => rows()[3].querySelector<HTMLElement>('.card-inbox__count')!.click())
    expect(review.setFilter).not.toHaveBeenCalled()
    expect(rows()[3].textContent).toBe('Add  more new cardsEnter')
    expect(field()?.value).toBe('10')
    expect(document.activeElement).toBe(field())
    typeIn(field()!, '12')
    // Space and the digits do not reach the Inbox; Esc does not close the menu.
    key(field()!, ' ')
    expect(review.answer).not.toHaveBeenCalled()
    key(field()!, 'Enter')
    expect(review.addCards).toHaveBeenCalledExactlyOnceWith('new', 12)
    // The menu stays open, the row back to its count.
    expect(rows()).toHaveLength(6)
    expect(field()).toBeNull()
    // Up next: its own field, at its own number; Esc goes back and the menu stays.
    act(() => rows()[1].querySelector<HTMLElement>('.card-inbox__count')!.click())
    expect(field()?.value).toBe('2')
    expect(rows()[1].textContent).toBe('Add  more Up nextEnter')
    key(field()!, 'ArrowUp')
    expect(field()?.value).toBe('3')
    key(field()!, 'Escape')
    expect(field()).toBeNull()
    expect(rows()).toHaveLength(6)
    expect(review.addCards).toHaveBeenCalledTimes(1)
    // Empty: Enter adds nothing.
    act(() => rows()[3].querySelector<HTMLElement>('.card-inbox__count')!.click())
    typeIn(field()!, '')
    key(field()!, 'Enter')
    expect(review.addCards).toHaveBeenCalledTimes(1)
    // Nothing waits: the count does not add, it picks the filter.
    session = { ...session, more: { new: 0, next: 3 }, adds: { new: 0, next: 2 } }
    render()
    act(() => rows()[3].querySelector<HTMLElement>('.card-inbox__count')!.click())
    expect(review.setFilter).toHaveBeenCalledExactlyOnceWith('new')
  })

  it('round 2: after an add the row says "22 / 48 · Reset"; Reset calls the hook and the menu stays open', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING, counts: { all: 34, next: 2, due: 10, new: 22 }, more: { new: 26, next: 3 }, canReset: { new: true, next: false } }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    expect(rows().map((r) => r.textContent)).toEqual(['All cards34', 'Up next2 / 5', 'Due today10', 'New cards22 / 48Reset', 'To fix0', 'Archived0'])
    act(() => rows()[3].querySelector<HTMLButtonElement>('.card-inbox__reset')!.click())
    expect(review.resetCards).toHaveBeenCalledExactlyOnceWith('new')
    expect(review.setFilter).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(6)
  })

  it('the line under the answer buttons says the add, and its Undo is the hook\'s undo; Cmd + Z undoes it too', () => {
    mount(TWO_SIDES)
    session = { ...session, lastAdd: { kind: 'new', count: 10, reset: false }, canUndo: true }
    render()
    const last = el.querySelector<HTMLElement>('.card-inbox__last')!
    expect(last.textContent).toBe('+ Added 10 new cards for today · Undo Cmd + Z')
    expect(last.dataset.rating).toBeUndefined()
    act(() => last.querySelector<HTMLButtonElement>('.card-inbox__last-undo')!.click())
    expect(review.undo).toHaveBeenCalledTimes(1)
    press('z', { metaKey: true })
    expect(review.undo).toHaveBeenCalledTimes(2)
    session = { ...session, lastAdd: { kind: 'next', count: 1, reset: false } }
    render()
    expect(last.textContent).toBe('+ Added 1 Up next card for today · Undo Cmd + Z')
    // On the done screen too.
    session = { ...session, card: null, lastAdd: { kind: 'new', count: 2, reset: false } }
    render()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe('+ Added 2 new cards for today · Undo Cmd + Z')
    // Round 2: a Reset says so, with the same Undo.
    session = { ...session, lastAdd: { kind: 'new', count: 12, reset: true } }
    render()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe("↺ Reset today's new cards · Undo Cmd + Z")
  })

  it('the done screen says what waits, with one add button for each kind; nothing waits: as before', () => {
    mount(TWO_SIDES)
    session = { ...session, card: null, counts: { all: 0, next: 0, due: 0, new: 0 }, more: { new: 38, next: 3 }, adds: { new: 10, next: 2 } }
    render()
    expect(doneText()).toEqual(['Inbox complete.', '38 new cards and 3 Up next cards wait for another day.', 'Add[10]new cardsAdd[2]Up next'])
    expect(pills().map(textOf)).toEqual(['Add[10]new cards', 'Add[2]Up next'])
    // A click on "Add" or the words adds the number shown.
    act(() => addButtons()[0].click())
    expect(review.addCards).toHaveBeenCalledExactlyOnceWith('new', 10)
    act(() => pills()[1].querySelectorAll<HTMLButtonElement>('.card-inbox__done-add-word')[1].click())
    expect(review.addCards).toHaveBeenLastCalledWith('next', 2)
    // The same field: type, then Enter (the Inbox's keys do not see it).
    const input = pills()[0].querySelector('input')!
    typeIn(input, '25')
    key(input, 'Enter')
    expect(review.addCards).toHaveBeenLastCalledWith('new', 25)
    // Only one kind waits: its line and its button.
    session = { ...session, more: { new: 0, next: 3 }, adds: { new: 0, next: 2 } }
    render()
    expect(doneText()).toEqual(['Inbox complete.', '3 Up next cards wait for another day.', 'Add[2]Up next'])
    session = { ...session, more: { new: 1, next: 0 }, adds: { new: 1, next: 0 } }
    render()
    expect(doneText()).toEqual(['Inbox complete.', '1 new card waits for another day.', 'Add[1]new card'])
    // Nothing waits (also: no limit): as now.
    session = { ...session, more: { new: 0, next: 0 }, adds: { new: 0, next: 0 } }
    render()
    expect(doneText()).toEqual(['Inbox complete.', 'Nothing else is due today. Enjoy your day!'])
  })

  it('a filter done: "No new cards left." then its add and, quiet, "12 more in All cards"; Due today has no add', () => {
    mount(TWO_SIDES)
    session = { ...session, filter: 'new', card: null, counts: { all: 12, next: 0, due: 12, new: 0 }, more: { new: 38, next: 3 }, adds: { new: 10, next: 2 } }
    render()
    expect(doneText()).toEqual(['No new cards left.', 'Add[10]new cards', '12 more in All cards'])
    act(() => addButtons()[0].click())
    expect(review.addCards).toHaveBeenCalledExactlyOnceWith('new', 10)
    session = { ...session, filter: 'next' }
    render()
    expect(doneText()).toEqual(['No Up next cards left.', 'Add[2]Up next', '12 more in All cards'])
    session = { ...session, filter: 'due' }
    render()
    expect(doneText()).toEqual(['No due cards left.', '12 more in All cards'])
  })

  it('folder review done: "This folder is done." then that folder\'s waiting cards, then the way to the Inbox', () => {
    mount(TWO_SIDES)
    session = { ...session, label: 'Bio', scope: 'folder', card: null, counts: { all: 0, next: 0, due: 0, new: 0 }, more: { new: 5, next: 0 }, adds: { new: 5, next: 0 } }
    render()
    expect(doneText()).toEqual(['This folder is done.', '5 new cards wait for another day.', 'Add[5]new cards', '12 more in the Inbox'])
  })
})

describe('YAZ-5046: archived cards in the Inbox, to look at (not to review)', () => {
  const ARCHIVED = [
    { path: '/v/a.md', index: 2, id: 'WIKI-4', title: 'Old fact' },
    { path: '/v/b.md', index: 0, id: 'WIKI-8' },
  ]
  const openMenu = () => act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
  const items = () => [...document.querySelectorAll<HTMLButtonElement>('.card-inbox__filter-item')]
  const listRows = () => [...el.querySelectorAll<HTMLElement>('.card-inbox__archived-row')]

  it('the cards menu ends with an Archived row and its count, under a line, apart from the rows that review; a pick sets the filter', () => {
    mount(TWO_SIDES)
    session = { ...session, archived: ARCHIVED }
    render()
    openMenu()
    expect(items().map((r) => r.textContent)).toEqual(['All cards12', 'Up next0', 'Due today9', 'New cards3', 'To fix0', 'Archived2'])
    // The line sits right before the two lists, To fix (YAZ-5097) and Archived.
    expect(document.querySelector('.card-inbox__filter-sep + .card-inbox__filter-row [data-filter="fix"]')).not.toBeNull()
    act(() => items()[5].click())
    expect(review.setFilter).toHaveBeenCalledExactlyOnceWith('archived')
  })

  it('Archived lists the cards: each its title ("New card" when empty) and its page; a click opens the card window to look at it; Unarchive unarchives it; no answer buttons, no "3 of 12"', () => {
    mount(TWO_SIDES)
    session = { ...session, filter: 'archived', card: null, archived: ARCHIVED }
    render()
    expect(el.querySelector('.card-inbox__filter')?.textContent).toBe('Archived')
    expect(listRows().map((r) => [r.querySelector('.card-inbox__archived-title')?.textContent, r.querySelector('.card-inbox__archived-page')?.textContent])).toEqual([
      ['Old fact', 'Cards'],
      ['New card', 'Cards'],
    ])
    expect(buttons()).toEqual([])
    expect(el.querySelector('.card-inbox__place')).toBeNull()
    expect(el.querySelector('.card-inbox__done')).toBeNull()
    act(() => listRows()[0].querySelector<HTMLButtonElement>('.card-inbox__archived-open')!.click())
    expect(props.openCard).toHaveBeenCalledExactlyOnceWith('/v/a.md', 'WIKI-4', 2, false)
    act(() => listRows()[1].querySelector<HTMLButtonElement>('.card-inbox__archived-unarchive')!.click())
    expect(review.unarchive).toHaveBeenCalledExactlyOnceWith('/v/b.md', 'WIKI-8')
    expect(listRows()[1].querySelector('.card-inbox__archived-unarchive')?.textContent).toBe('Unarchive')
  })

  it('none archived: one quiet line, and the way back to All cards', () => {
    mount(TWO_SIDES)
    session = { ...session, filter: 'archived', card: null, archived: [] }
    render()
    expect(el.querySelector('.card-inbox__archived-empty')?.textContent).toBe('No archived cards.')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__done-more')!.click())
    expect(review.setFilter).toHaveBeenLastCalledWith('all')
  })
})

describe('YAZ-5097: Fix later in the Inbox, and the To fix list', () => {
  const TO_FIX = [
    { path: '/v/a.md', index: 2, id: 'WIKI-4', title: 'Typo in carf' },
    { path: '/v/b.md', index: 0, id: 'WIKI-8' },
  ]
  const openMenu = () => act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
  const items = () => [...document.querySelectorAll<HTMLButtonElement>('.card-inbox__filter-item')]
  const listRows = () => [...el.querySelectorAll<HTMLElement>('.card-inbox__archived-row')]

  it('the cards menu has a To fix row with its count, after the rows that review; a pick sets the filter', () => {
    mount(TWO_SIDES)
    session = { ...session, toFix: TO_FIX }
    render()
    openMenu()
    expect(items().map((r) => r.textContent)).toEqual(['All cards12', 'Up next0', 'Due today9', 'New cards3', 'To fix2', 'Archived0'])
    act(() => items()[4].click())
    expect(review.setFilter).toHaveBeenCalledExactlyOnceWith('fix')
  })

  it('To fix lists the cards: each its title and its page; a click opens the card window in Edit card; Fixed takes the mark off; no answer buttons, no "3 of 12"', () => {
    mount(TWO_SIDES)
    session = { ...session, filter: 'fix', card: null, toFix: TO_FIX }
    render()
    expect(el.querySelector('.card-inbox__filter')?.textContent).toBe('To fix')
    expect(el.querySelector('.card-inbox__archived')?.getAttribute('aria-label')).toBe('Cards to fix')
    expect(listRows().map((r) => [r.querySelector('.card-inbox__archived-title')?.textContent, r.querySelector('.card-inbox__archived-page')?.textContent])).toEqual([
      ['Typo in carf', 'Cards'],
      ['New card', 'Cards'],
    ])
    expect(buttons()).toEqual([])
    expect(el.querySelector('.card-inbox__place')).toBeNull()
    act(() => listRows()[0].querySelector<HTMLButtonElement>('.card-inbox__archived-open')!.click())
    expect(props.openCard).toHaveBeenCalledExactlyOnceWith('/v/a.md', 'WIKI-4', 2, true)
    const fixed = listRows()[1].querySelector<HTMLButtonElement>('.card-inbox__archived-unarchive')!
    expect(fixed.textContent).toBe('Fixed')
    expect(fixed.getAttribute('aria-label')).toBe('Remove Fix later')
    act(() => fixed.click())
    expect(review.setFix).toHaveBeenCalledExactlyOnceWith('/v/b.md', 'WIKI-8', false)
  })

  it('none to fix: one quiet line, and the way back to All cards', () => {
    mount(TWO_SIDES)
    session = { ...session, filter: 'fix', card: null, toFix: [] }
    render()
    expect(el.querySelector('.card-inbox__archived-empty')?.textContent).toBe('No cards to fix.')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__done-more')!.click())
    expect(review.setFilter).toHaveBeenLastCalledWith('all')
  })

  it('a marked card shows a quiet "To fix" in its head, and ⋯ says Remove Fix later', () => {
    mount(TWO_SIDES)
    expect(el.querySelector('.card-inbox__head .card__fix')).toBeNull()
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, fix: true } } }
    render()
    expect(el.querySelector('.card-inbox__head .card__fix')?.textContent).toBe('To fix')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__more-button')!.click())
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.card-inbox__more-action')].find((b) => b.getAttribute('aria-label') === 'Remove Fix later')!.click())
    expect(review.setFix).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', false)
  })
})

describe('the card as you read it (YAZ-5048, YAZ-5049, YAZ-5051)', () => {
  const hints = () => [...el.querySelectorAll('.card-inbox__hints span')].map((h) => h.textContent)
  const sideCount = () => el.querySelector('.card-inbox__sides')?.textContent ?? null

  it('YAZ-5048: a card of two sides says "Side 1 of 2" above it, and Space says what it does next: "Show" a word, then "Next side"; a card of one side says nothing', async () => {
    mount(TWO_SIDES)
    expect(sideCount()).toBe('Side 1 of 2')
    expect(hints()[0]).toBe('Space Show')
    press(' ')
    await flush()
    // Side 1 has no hidden word left: the next Space shows side 2.
    expect(sideCount()).toBe('Side 1 of 2')
    expect(hints()[0]).toBe('Space Next side')
    press(' ')
    await flush()
    expect(sideCount()).toBe('Side 2 of 2')
    expect(hints()[0]).toBe('Space Show')
    act(() => root?.unmount())
    el.remove()
    mount('One {{side}} only')
    expect(sideCount()).toBeNull()
  })

  it('YAZ-5048: a side with no hidden word says "Next side" at once', async () => {
    mount('Plain front\n---\nBack {{word}}')
    expect(hints()[0]).toBe('Space Next side')
  })

  it('YAZ-5051: the head (YAZ-5044: the ID; YAZ-5132: the page is in the breadcrumb) sits in the row above the card, after the state chip; the card frame holds only the card', () => {
    mount(TWO_SIDES)
    const above = el.querySelector('.card-inbox__above')!
    const panel = el.querySelector('.card-inbox__panel')!
    expect([...above.children].map((c) => c.className).slice(0, 2)).toEqual(['card-inbox__state', 'card-inbox__head'])
    expect([...above.querySelector('.card-inbox__head')!.children].map((c) => c.textContent)).toEqual(['WIKI-9'])
    expect(panel.querySelector('.card-inbox__head, .explore__head, .card-inbox__page, .card__id')).toBeNull()
  })

  describe('YAZ-5049: Space brings the word it shows into view (round 2: one long page, with room below the word)', () => {
    const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
    let place: Record<string, [number, number]>
    let scrollTo: ReturnType<typeof vi.fn>
    // The view 0–600; its sticky top row ends at 100, its sticky buttons start at 400: the room is 100–400.
    beforeEach(() => {
      place = {}
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains('card-inbox')) return box(0, 600)
        if (this.classList.contains('card-inbox__top')) return box(0, 100)
        if (this.classList.contains('card-inbox__dock')) return box(400, 480)
        const key = this.dataset.hidden !== undefined ? `word${this.dataset.hidden}` : this.dataset.side !== undefined ? `side${this.dataset.side}` : ''
        const [top, bottom] = place[key] ?? [150, 170]
        return box(top, bottom)
      })
    })
    afterEach(() => vi.restoreAllMocks())
    /** The Inbox's own view scrolls (round 2): the card has no scroll bar of its own. */
    const scroller = (scrollTop = 0) => {
      const view = el.querySelector<HTMLElement>('.card-inbox')!
      scrollTo = vi.fn()
      view.scrollTo = scrollTo as never
      view.scrollTop = scrollTop
      return view
    }

    it('a word in the top two thirds of the room: no movement', () => {
      mount(TWO_SIDES)
      scroller()
      place.word0 = [270, 290]
      press(' ')
      expect(scrollTo).not.toHaveBeenCalled()
    })

    it('a word in the lower third, or below the view: it comes up to a third of the way down (never the centre), so what comes next shows', () => {
      mount(TWO_SIDES)
      scroller()
      place.word0 = [320, 340]
      press(' ')
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 320 - 200 }))
      // Below the view: the same place.
      mount(TWO_SIDES)
      scroller()
      place.word0 = [700, 720]
      press(' ')
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 700 - 200 }))
    })

    it('a word above the view (scrolled past): the least scroll that shows it, a small gap kept', () => {
      mount(TWO_SIDES)
      scroller(300)
      place.word0 = [40, 60]
      press(' ')
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 300 + 40 - 100 - 6 }))
    })

    it('a new side low in the view comes up by its top; a new card starts at its top, with no glide', () => {
      mount(TWO_SIDES)
      scroller()
      press(' ')
      place.side1 = [350, 900]
      press(' ')
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 350 - 200 }))
      scrollTo.mockClear()
      const view = scroller(500)
      session = { ...sessionOf(TWO_SIDES), position: 4, card: { ...sessionOf(TWO_SIDES).card!, id: 'WIKI-10' } }
      render()
      expect(scrollTo).not.toHaveBeenCalled()
      expect(view.scrollTop).toBe(0)
    })
  })
})
