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
import { formatCardLine, parseCardLine, type CardLine } from '@shared/cardLine'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { createViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { CardInbox, type CardInboxProps } from './CardInbox'
import { answerLine, cardStateText } from './cardInboxChip'
import { foldHints } from './CardInboxHints'
import { CARD_MIN_WIDTH, clampCardWidth, inboxCardWidth, setInboxCardWidth } from './inboxCardWidth'
import { useReadOnlyVault } from '../vault/readOnlyVault'
import { ZOOM_EVENT } from '../editor/zoomRequest'
import { listenTour } from '../course/tourBus'

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

/** The card line writes (YAZ-5164 part 3: the head's rename, YAZ-5308 on the card line), recorded instead of written. */
const lineWrites = vi.hoisted(() => [] as unknown[][])
vi.mock('./cardFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cardFile')>()),
  changeCardLine: vi.fn(async (...args: unknown[]) => void lineWrites.push(args)),
}))

const PATH = '/v/cards.md'
const TWO_SIDES = 'Capital of {{France}}\n---\n{{Paris}} on the {{Seine}}'
const AT = '2026-11-12T14:05:00.000Z'
const answersOf = (s: ReviewSettings): CardAnswer[] =>
  (s.buttons === 4 ? (['again', 'hard', 'good', 'easy'] as const) : (['again', 'good'] as const)).map((rating, i) => ({ review: { at: AT, rating }, interval: [0, 3, 9, 20][i], due: 0, comesBack: rating === 'again' }))

let root: Root | null = null
let el: HTMLElement
let session: CardReviewSession
let review: CardReviewApi
let props: CardInboxProps

/** The card's title, off its card line (YAZ-5308). */
const TITLE = 'Capital of France'

function sessionOf(text: string | null, over: Partial<CardReviewSession> = {}, title = TITLE): CardReviewSession {
  return { label: 'Inbox', scope: 'vault', card: { path: PATH, index: 0, id: 'WIKI-9', due: 0, isNew: true, next: false, page: text === null ? null : { path: PATH, id: 'WIKI-9', text, title, reviews: [], off: false, next: false } }, answers: null, canUndo: false, canBack: false, canNext: false, filter: 'all', counts: { all: 12, next: 0, due: 9, new: 3 }, from: ['Vault'], place: [], answered: [], progress: { done: 2, total: 12, waiting: 0 }, misses: 0, learned: null, today: { cards: 0, seconds: 0 }, more: { new: 0, next: 0 }, adds: { new: 0, next: 0 }, limited: { new: false, next: false }, canReset: { new: false, next: false }, upNext: true, lastAdd: null, newFrom: [], newFallback: false, order: { all: 'due-first', due: 'shuffle' }, end: null, landing: null, ...over }
}

function render() {
  act(() => root?.render(<CardInbox {...props} review={review} session={session} />))
}

function mount(text: string | null, settings: ReviewSettings = DEFAULT_REVIEW_SETTINGS) {
  // A second mount in one test drops the first Inbox, so no stale one keeps its document listeners (YAZ-5372's zoom keys).
  if (root !== null) {
    act(() => root?.unmount())
    el.remove()
  }
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
    answer: vi.fn(async () => true),
    undo: vi.fn(async () => {}),
    close: vi.fn(),
    deleteReview: vi.fn(async () => {}),
    setNext: vi.fn(async () => {}),
    setMark: vi.fn(async () => {}),
    move: vi.fn(),
    turnOff: vi.fn(async () => {}),
    setFilter: vi.fn(),
    addCards: vi.fn(),
    resetCards: vi.fn(),
    setNewFrom: vi.fn(),
    setOrder: vi.fn(),
    goOn: vi.fn(),
    newCardFolders: vi.fn(() => ({ all: 38, folders: [{ folder: 'spanish', label: 'Spanish', count: 24 }, { folder: 'spanish/verbs', label: 'Verbs', count: 4 }, { folder: 'geo', label: 'Geography', count: 12 }] })),
  }
  const wikilinks = createWikilinkResolveSource()
  props = {
    review,
    session,
    vaultOf: () => ({ root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never }),
    openPage: vi.fn(),
    editCard: vi.fn(),
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

describe('YAZ-5484: the Inbox draws its card with the card\'s vault\'s look', () => {
  it('the card\'s vault\'s variables on the Inbox\'s root (two vaults, two looks); its zoom stays; no card, none', () => {
    const LOOKS: Record<string, Record<string, string>> = { '/v': { '--shown-hidden-words': 'box', '--card-clean': 'on' }, '/w': { '--shown-hidden-words': 'underline', '--card-clean': 'off' } }
    mount(TWO_SIDES)
    const cardVarsOf = vi.fn((path: string) => LOOKS[path.slice(0, 2)])
    props = { ...props, cardVarsOf }
    render()
    const box = el.querySelector<HTMLElement>('.card-inbox')!
    expect(cardVarsOf).toHaveBeenCalledWith(PATH)
    expect([box.style.getPropertyValue('--shown-hidden-words'), box.style.getPropertyValue('--card-clean')]).toEqual(['box', 'on'])
    expect(box.style.getPropertyValue('--document-zoom')).not.toBe('')
    // The next card is in the other vault: its look.
    session = { ...session, card: { ...session.card!, path: '/w/cards.md', page: { ...session.card!.page!, path: '/w/cards.md' } } }
    render()
    expect([box.style.getPropertyValue('--shown-hidden-words'), box.style.getPropertyValue('--card-clean')]).toEqual(['underline', 'off'])
    session = { ...session, card: null }
    render()
    expect(box.style.getPropertyValue('--shown-hidden-words')).toBe('')
  })
})

describe('the Inbox screen (YAZ-4962)', () => {
  it('YAZ-5308 A3: the head reads the ID; the title, off the card line, is in the band at the top of the card`s frame from the start, with no label, never a word of the front (YAZ-5132: the page is in the breadcrumb, not "in Cards"); the hint row shows only keys that act now', async () => {
    mount(TWO_SIDES)
    expect(el.querySelector('.explore__title')).toBeNull()
    const head = () => [...el.querySelector('.card-inbox__head')!.children].map((c) => [c.className, c.textContent])
    const band = () => el.querySelector('.card-inbox__panel > .card-band')?.textContent ?? null
    expect(head()).toEqual([['card__id', 'WIKI-9']])
    expect(band()).toBe('Capital of France')
    expect(el.querySelector('.card-band__label')).toBeNull()
    // YAZ-5675: Mochi's "done / total" in the top row, on the right.
    expect(el.querySelector('.card-inbox__bar .card-inbox__place')?.textContent).toBe('2 / 12')
    const hints = () => [...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)
    // Nothing to undo; the digits are on the buttons.
    expect(hints()).toEqual(['Show (Space)', 'Open page (O)', 'Edit card (E)', 'New tab (Cmd+Enter)'])
    for (let i = 0; i < 4; i++) press(' ')
    await flush()
    // The last step: Space has nothing more to show, and the title shows.
    expect(hints()).toEqual(['Open page (O)', 'Edit card (E)', 'New tab (Cmd+Enter)'])
    expect(head()).toEqual([['card__id', 'WIKI-9']])
    expect(band()).toBe('Capital of France')
  })

  it('YAZ-5626: a card back after a Forgot wears "Again" beside its state chip, as on the phone (YAZ-5594); others none', () => {
    mount(TWO_SIDES)
    const again = () => el.querySelector('.card-inbox__above .card-inbox__again')
    expect(again()).toBeNull()
    // A new card back for its second ✓ (YAZ-5610): it comes back, but not forgotten, so no label (YAZ-5626, Yaseen).
    session = { ...session, card: { ...session.card!, isNew: false, repeat: true, forgot: false } }
    render()
    expect(again()).toBeNull()
    session = { ...session, card: { ...session.card!, isNew: false, repeat: true, forgot: true } }
    render()
    expect(again()?.textContent).toBe('Again')
    expect(again()?.getAttribute('title')).toBe('You forgot it: it comes back until you remember it')
    // Right after the state chip, before the ID.
    expect(again()?.previousElementSibling?.classList.contains('card-inbox__state')).toBe(true)
    // Remembered: the card leaves; the next one has no label. The done screen has none.
    session = { ...session, card: { ...session.card!, id: 'WIKI-10', repeat: undefined, forgot: undefined } }
    render()
    expect(again()).toBeNull()
  })

  it('YAZ-4999: an up-next card shows the chip "Up next" after the ID; its × removes the mark (setNext)', () => {
    mount(TWO_SIDES)
    expect(el.querySelector('.card__next')).toBeNull()
    const card = session.card!
    session = { ...session, card: { ...card, next: true, page: { ...card.page!, next: true } } }
    render()
    const chip = el.querySelector('.card-inbox__head > .card__id + .card__next')!
    expect(chip.textContent).toBe('Up next×')
    act(() => chip.querySelector<HTMLButtonElement>('[aria-label="Remove from Up next"]')!.click())
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
    const hasE = () => [...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent).includes('Edit card (E)')
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
    const hasE = () => [...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent).includes('Edit card (E)')
    const seen = [hasE()]
    for (let i = 0; i < 4; i++) {
      press(' ')
      await flush()
      seen.push(hasE())
    }
    expect(seen).toEqual([true, true, true, true, true])
    session = { ...session, canNext: true, canBack: true }
    render()
    expect(hasE()).toBe(true)
    press('e')
    expect(props.editCard).toHaveBeenCalledExactlyOnceWith(PATH, { id: 'WIKI-9', index: 0 })
  })

  it('YAZ-5145: in a read-only vault the row offers "E Edit card", and E asks Explore to edit (its own "Allow edits?" asks there); the Inbox keeps its card and step under it', () => {
    mount(TWO_SIDES)
    const plain = props.vaultOf
    props.vaultOf = (path) => ({ ...plain(path), readOnly: true })
    render()
    press(' ')
    expect(shown()).toEqual(['France'])
    expect([...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)).toContain('Edit card (E)')
    press('e')
    expect(props.editCard).toHaveBeenCalledExactlyOnceWith(PATH, { id: 'WIKI-9', index: 0 })
    expect(props.openPage).not.toHaveBeenCalled()
    // Back from Explore (the stack closed): the same card, the same step.
    render()
    expect(shown()).toEqual(['France'])
    expect(el.querySelector('.card-inbox__place')?.textContent).toBe('2 / 12')
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
      ['Forgot (1)', 'Forgot · later today'],
      ['Remembered (2)', 'Remembered · 3 days'],
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
      ['Forgot (1)', 'Forgot'],
      ['Remembered (2)', 'Remembered'],
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
      { ...session, answers: null, card: { ...card, id: 'WIKI-10', page: null } },
      { ...session, answers: null, card: { ...card, id: 'WIKI-10', page: { ...card.page!, id: 'WIKI-10', text: 'Next {{card}}' } } },
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
    expect(el.querySelector('.card-inbox__hints')?.textContent).not.toContain('1–4')
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

  it('YAZ-5022: O opens the page on top at its TOP (no card index: no scroll to the card); YAZ-5145: E asks Explore to edit the page, landed on the card (its index); ⌘↵ in a tab; ⌘Z undoes only when there is an answer to undo; YAZ-5011: Esc does not close the Inbox (a tab), and the key is not taken', () => {
    mount(TWO_SIDES)
    press('o')
    expect(props.openPage).toHaveBeenLastCalledWith(PATH)
    expect(vi.mocked(props.openPage).mock.calls[0]).toHaveLength(1)
    press('e')
    expect(props.editCard).toHaveBeenCalledExactlyOnceWith(PATH, { id: 'WIKI-9', index: 0 })
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

  it('YAZ-5120: with the course`s offer (App gives it to a beginner only), the empty vault Inbox says one line, with Take the course and Don`t show again', () => {
    mount(TWO_SIDES)
    const offer = { onOpen: vi.fn(), onDismiss: vi.fn() }
    session = { ...session, card: null, counts: { all: 0, next: 0, due: 0, new: 0 } }
    props = { ...props, courseOffer: offer }
    render()
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('Inbox complete.')
    expect(el.querySelector('.course-offer__line')?.textContent).toBe('No cards yet. Take the course, or make a card.')
    const [open, dismiss] = [...el.querySelectorAll<HTMLButtonElement>('.course-offer button')]
    expect([open.textContent, dismiss.textContent]).toEqual(['Take the course', "Don't show again"])
    act(() => open.click())
    act(() => dismiss.click())
    expect(offer.onOpen).toHaveBeenCalledOnce()
    expect(offer.onDismiss).toHaveBeenCalledOnce()
    // No offer: the screen is as before.
    props = { ...props, courseOffer: undefined }
    render()
    expect(el.querySelector('.course-offer')).toBeNull()
  })

  it('the done screen: "Inbox complete." and one quiet line; only ⌘Z (with an answer to undo) in the hint row', () => {
    mount(TWO_SIDES)
    // Nothing due in the vault (YAZ-5623: cards still due get "Review K more").
    review = { ...review, dueCount: 0 }
    session = { ...session, card: null, canUndo: true }
    render()
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('Inbox complete.')
    expect(el.querySelector('.card-inbox__done-line')?.textContent).toBe('Nothing else is due today. Enjoy your day!')
    expect([...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)).toEqual(['Undo (Cmd+Z)'])
    press(' ')
    press('o')
    expect(props.openPage).not.toHaveBeenCalled()
  })

  it('the done screen of "Review this page" says the page is done, then Mochi`s "You have cards due in other pages." · "Review cards 12", which starts the vault`s review (YAZ-5678)', () => {
    mount(TWO_SIDES)
    session = { ...session, label: 'Cards', scope: 'page', card: null }
    render()
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('This page is done.')
    expect(el.querySelector('.card-inbox__done-line')?.textContent).toBe('You have cards due in other pages.')
    const more = el.querySelector<HTMLButtonElement>('.card-inbox__done .due-end__go')!
    expect(more.textContent).toBe('Review cards 12')
    act(() => more.click())
    expect(review.start).toHaveBeenCalledExactlyOnceWith({})
  })

  it('YAZ-5105: a card with reviews shows its Reviews strip (the card window\'s own `CardReviews`) under the card, outside its frame, as soon as the last side shows (round 3: its hidden words shown or not); never on the front or an earlier side', async () => {
    mount(TWO_SIDES)
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, reviews: [{ at: AT, rating: 'good' }, { at: '2026-11-13T09:00:00.000Z', rating: 'again' }] } } }
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
    expect([...column.children].map((c) => c.className)).toEqual(['card-inbox__above', 'card-inbox__panel', 'card-reviews card-reviews--strip', 'card-inbox__dock'])
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

  it('YAZ-5380: a card with no reviews, fully shown, has the strip too, "0 Reviews" dimmed beside Properties; the next card hides it again and starts closed', async () => {
    mount('Just a {{fact}}')
    await flush()
    press(' ')
    await flush()
    expect(blanks()).toBe(0)
    const parts = [...el.querySelectorAll<HTMLElement>('.card-reviews__toggle')]
    expect(parts.map((p) => [p.dataset.part, p.textContent, p.hasAttribute('data-empty')])).toEqual([
      ['reviews', '0 Reviews', true],
      ['properties', 'Properties0', true],
    ])
    session = { ...session, card: { ...session.card!, id: 'WIKI-10', page: { ...session.card!.page!, id: 'WIKI-10', reviews: [{ at: AT, rating: 'good' }] } } }
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
    session = { ...session, card: { ...session.card!, id: 'WIKI-10', page: { ...session.card!.page!, id: 'WIKI-10', text: 'Nothing hidden', reviews: [{ at: AT, rating: 'good' }] } } }
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
    expect(column.querySelector('.card-inbox__hints')?.textContent).toContain('Show (Space)')
    press(' ')
    expect(column.querySelector('.card-inbox__space')).toBeNull()
    const answers = column.querySelector('.card-inbox__actions')!
    expect(answers.querySelectorAll('.card-inbox__answer')).toHaveLength(2)
    expect(panel.contains(answers)).toBe(false)
    expect([...column.children].map((c) => c.className)).toEqual(['card-inbox__above', 'card-inbox__panel', 'card-inbox__dock'])
    // YAZ-5049 round 2: the buttons and their line in one band, which stays at the bottom of the view. YAZ-5431 (as
    // Mochi): the key row is in that band too, so the whole block under the card is pinned to the bottom as one.
    expect([...column.querySelector('.card-inbox__dock')!.children].map((c) => c.className)).toEqual(['card-inbox__actions', 'card-inbox__last', 'explore__foot card-inbox__hints'])
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
    expect([...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)).toContain('Other cards (Left / Right)')
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

  it('YAZ-5004, YAZ-5697 round 2: ⋯ opens the ONE card menu (Undo last review, then the card\'s Inbox rows; Undo off while there is nothing to undo); each runs the hook`s own action; Archive card asks first; Esc closes it', async () => {
    mount(TWO_SIDES)
    const more = () => el.querySelector<HTMLButtonElement>('.card-inbox__more-button')!
    const actions = () => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu .ctx-menu__item')]
    expect(actions()).toEqual([])
    act(() => more().click())
    expect(actions().map((b) => [b.textContent, b.disabled])).toEqual([
      ['Undo last review', true],
      ['Open card', false],
      ['Move to Up next', false],
      ['Archive card', false],
      ['Title in review', false],
    ])
    press('Escape')
    expect(actions()).toEqual([])
    expect(review.close).not.toHaveBeenCalled()
    session = { ...session, canUndo: true }
    render()
    const run = (label: string) => {
      act(() => more().click())
      act(() => actions().find((b) => b.textContent === label)!.click())
    }
    run('Undo last review')
    expect(review.undo).toHaveBeenCalledOnce()
    run('Archive card')
    // One click never archives: it asks in place first.
    expect(review.turnOff).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(el.querySelector('.ctx-menu__ask')?.textContent).toContain('Archive this card?'))
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__ask button')].find((b) => b.textContent === 'Archive')!.click())
    expect(review.turnOff).toHaveBeenCalledOnce()
    run('Move to Up next')
    expect(review.setNext).toHaveBeenCalledExactlyOnceWith(PATH, 'WIKI-9', true)
    // YAZ-5145: Open card opens as O does: Explore's own layer.
    run('Open card')
    expect(props.openPage).toHaveBeenCalledExactlyOnceWith(PATH)
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
    // YAZ-5678, Mochi's words: "Finished reviewing." / "How about learning some new cards?" · Learn new cards 3.
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('Finished reviewing.')
    expect(el.querySelector('.card-inbox__done-line')?.textContent).toBe('How about learning some new cards?')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__done .due-end__go')!.click())
    expect(review.setFilter).toHaveBeenLastCalledWith('new')
  })

  it('YAZ-5028: the menu`s second row is Up next with its count in the chip`s colours (grey at 0); a pick sets the filter; its done screen leads back to All cards', () => {
    mount(TWO_SIDES)
    session = { ...session, counts: { all: 12, next: 2, due: 9, new: 3 } }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.card-inbox__filter-item')]
    expect(rows().map((r) => r.textContent)).toEqual(['All cards12', 'Up next2', 'Due today9', 'New cards3'])
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

  /**
   * YAZ-5321 (Yaseen: "Up next should only show if they have in the card base, in the vault, up next selected"): with no
   * card of the vault marked Up next, the cards menu has no Up next row and the done screen says nothing of Up next. The
   * row stays while Up next is the filter on show (its last card answered just now); one mark brings it back.
   */
  it('YAZ-5321: no card marked Up next: no Up next row in the menu, none on the done screen; one mark brings the row back', () => {
    mount(TWO_SIDES)
    session = { ...session, upNext: false }
    render()
    const open = () => act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.card-inbox__filter-item')].map((r) => r.textContent)
    open()
    expect(rows()).toEqual(['All cards12', 'Due today9', 'New cards3'])
    open()
    // The done screen: nothing of Up next (nothing waits, no add).
    session = { ...session, card: null, counts: { all: 0, next: 0, due: 0, new: 0 } }
    render()
    expect(el.querySelector('.card-inbox__done')?.textContent).not.toContain('Up next')
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('Inbox complete.')
    // Up next on show, its last card just answered: the row stays, checked, so the menu says where you are.
    session = { ...session, filter: 'next', counts: { all: 10, next: 0, due: 7, new: 3 } }
    render()
    open()
    expect(rows()).toEqual(['All cards10', 'Up next0', 'Due today7', 'New cards3'])
    open()
    // One card marked Up next: the row is back.
    session = { ...session, filter: 'all', upNext: true }
    render()
    open()
    expect(rows()).toEqual(['All cards10', 'Up next0', 'Due today7', 'New cards3'])
  })

  it('YAZ-5018: the buttons wear their glyphs — ✕ Forgot and ✓ Remembered; with four buttons ↺ Again, ~ Hard, ✓ Good, ⇈ Easy — each a round pill with its digit', async () => {
    const glyphs = () => buttons().map((b) => [b.querySelector('.card-inbox__answer-label')?.textContent, b.querySelector('svg.card-inbox__answer-icon path')?.getAttribute('d'), b.querySelector('.key-label')?.textContent])
    mount('Plain')
    await flush()
    const two = glyphs()
    expect(two.map(([label, , key]) => [label, key])).toEqual([['Forgot', '(1)'], ['Remembered', '(2)']])
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
    expect(column().style.width).toBe('min(calc(740px * var(--document-zoom, 1)), 100%)')
    column().getBoundingClientRect = () => ({ width: 740 }) as DOMRect
    drag('left', 300, 400) // the left edge in: narrower by 200
    expect(inboxCardWidth()).toBe(540)
    drag('left', 300, 0) // far out: the room
    expect(inboxCardWidth()).toBe(1000)
    drag('right', 900, 0) // far in: the minimum
    expect(inboxCardWidth()).toBe(CARD_MIN_WIDTH)
    // Another card: the same width.
    session = { ...session, card: { ...session.card!, id: 'WIKI-10', page: { ...session.card!.page!, id: 'WIKI-10' } } }
    render()
    expect(column().style.width).toBe(`min(calc(${CARD_MIN_WIDTH}px * var(--document-zoom, 1)), 100%)`)
    // The Inbox tab closed and opened again (the app still runs): the same width.
    act(() => root?.unmount())
    el.remove()
    mount(TWO_SIDES)
    expect(column().style.width).toBe(`min(calc(${CARD_MIN_WIDTH}px * var(--document-zoom, 1)), 100%)`)
    setInboxCardWidth(null)
  })

  it('YAZ-5675: the progress bar under the top row reads the filter`s numbers — grey done ÷ total, red (done + waiting) ÷ total, both from the left', () => {
    mount(TWO_SIDES)
    const bar = () => el.querySelector<HTMLElement>('.card-inbox__top > .card-inbox__progress')!
    const widths = () => [bar().querySelector<HTMLElement>('.session-bar__grey')!.style.width, bar().querySelector<HTMLElement>('.session-bar__red')!.style.width]
    expect(el.querySelector('.card-inbox__top')?.firstElementChild?.className).toBe('card-inbox__bar')
    session = { ...session, progress: { done: 0, total: 4, waiting: 0 } }
    render()
    expect(widths()).toEqual(['0%', '0%'])
    // YAZ-5671 finding 15: ✕ 1 · 1 / 5, grey 20%, red 40%.
    session = { ...session, progress: { done: 1, total: 5, waiting: 1 } }
    render()
    expect(widths()).toEqual(['20%', '40%'])
    expect([bar().getAttribute('aria-valuenow'), bar().getAttribute('aria-valuemax')]).toEqual(['1', '5'])
    // The first pass over: full, the red at the right end.
    session = { ...session, progress: { done: 4, total: 6, waiting: 2 } }
    render()
    expect(widths()[1]).toBe('100%')
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
    // YAZ-5030, YAZ-5433: the card by its title alone.
    expect(last().textContent).toBe('✓ Remembered · Capital of France · back in 3 days · Undo (Cmd+Z)')
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
    expect(last().textContent).toBe('✕ Forgot · Capital of France · back later today · Undo (Cmd+Z)')
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
    // YAZ-5030, YAZ-5433 (Yaseen: "we can probably just have the title"): by its title only, no ID; a card with no
    // title by its ID, its only name. A long title ends in "…", so "back in …" stays in sight.
    expect(answerLine('good', 'DEMO-51', 9, false, DEFAULT_REVIEW_SETTINGS, 'Spanish verb 3')).toBe('✓ Remembered · Spanish verb 3 · back in 9 days')
    expect(answerLine('again', 'DEMO-51', 0, true, DEFAULT_REVIEW_SETTINGS, 'Spanish verb 3')).toBe('✕ Forgot · Spanish verb 3 · back later today')
    expect(answerLine('good', 'DEMO-51', 9, false, DEFAULT_REVIEW_SETTINGS, '   ')).toBe('✓ Remembered · DEMO-51 · back in 9 days')
    const long = answerLine('good', 'DEMO-51', 9, false, DEFAULT_REVIEW_SETTINGS, 'A very long card title that goes on and on past the room it has')
    expect(long).toBe(`✓ Remembered · ${'A very long card title that goes on and'}… · back in 9 days`)
  })

  it('YAZ-5017 round 2, YAZ-5132: the top row shows the CURRENT card`s place, folders › page (YAZ-5682: no vault), the ONE breadcrumb, each part with its folder or page icon; it changes with the card; a folder opens through `openPlace`, the page as O does; the scope shows only when narrower than the vault', () => {
    mount(TWO_SIDES)
    const parts = () => [...el.querySelectorAll<HTMLButtonElement>('.card-inbox__path-part')]
    session = { ...session, place: [{ kind: 'folder', label: 'spanish-words', path: '/v/spanish-words' }, { kind: 'page', label: 'Verbs', path: PATH }] }
    render()
    expect(parts().map((p) => p.textContent)).toEqual(['spanish-words', 'Verbs'])
    // YAZ-5132: the tree's own icons (YAZ-5100), a folder's for the folders, a page's for the page.
    expect(parts().map((p) => p.querySelector('.file-icon')?.classList.contains('file-icon--dir'))).toEqual([true, false])
    expect(parts()[1].querySelector('.file-icon--file')).not.toBeNull()
    expect(el.querySelector('.card-inbox__path')?.getAttribute('title')).toBe('spanish-words › Verbs')
    // The head no longer says "in Verbs": one place, said once.
    expect(el.querySelector('.card-inbox__in')).toBeNull()
    act(() => parts()[1].click())
    expect(props.openPage).toHaveBeenLastCalledWith(PATH)
    expect(props.openPlace).not.toHaveBeenCalled()
    // The whole vault under review: no "· in …" (Yaseen: "isnt this redundant?").
    expect(el.querySelector('.card-inbox__from')).toBeNull()
    act(() => parts()[0].click())
    expect(props.openPlace).toHaveBeenLastCalledWith('/v/spanish-words')
    // The next card, in another folder: the path follows it.
    session = { ...session, place: [{ kind: 'folder', label: 'Bio', path: '/v/Bio' }] }
    render()
    expect(parts().map((p) => p.textContent)).toEqual(['Bio'])
    // A review of one page: the scope says it.
    session = { ...session, scope: 'page', from: ['Cells'] }
    render()
    expect(el.querySelector('.card-inbox__from')?.textContent).toBe('·in Cells')
    // No card (the done screen): no place.
    session = { ...session, card: null, place: [] }
    render()
    expect(el.querySelector('.card-inbox__path')).toBeNull()
  })

  it('YAZ-5713: a long place folds from the START, "… › History › History cards"; a click on "…" opens the bubble with the full path and Show in sidebar', () => {
    // jsdom has no layout: each part 8 px a letter plus 20 px (its icon and separator); the box's room set here.
    let room = 1000
    const width = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const w = this.matches('[data-fold], [data-fold-more]') ? (this.textContent ?? '').length * 8 + 20 : 0
      return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: w, width: w, height: 0, toJSON: () => ({}) } as DOMRect
    })
    const box = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('card-inbox__path') ? room : 0
    })
    try {
      const place: CardReviewSession['place'] = [
        { kind: 'folder', label: 'New cards test', path: '/v/New cards test' },
        { kind: 'folder', label: 'History', path: '/v/New cards test/History' },
        { kind: 'page', label: 'History cards', path: PATH },
      ]
      const drawAt = (px: number) => {
        room = px
        mount(TWO_SIDES)
        props = { ...props, showInSidebar: vi.fn() }
        session = { ...session, place }
        render()
      }
      const shownParts = () => [...el.querySelectorAll<HTMLElement>('.card-inbox__path > *')].filter((p) => p.style.display !== 'none').map((p) => p.textContent)
      drawAt(1000)
      expect(shownParts()).toEqual(['New cards test›', 'History›', 'History cards'])
      // 132 + 76 + 124 = 332 px: at 250 the first folder folds ("…›" 36 + 76 + 124 = 236).
      drawAt(250)
      expect(shownParts()).toEqual(['…›', 'History›', 'History cards'])
      // Narrower: only "…" and the page.
      drawAt(170)
      expect(shownParts()).toEqual(['…›', 'History cards'])
      // A click on "…": the bubble, the full path, one button.
      act(() => el.querySelector<HTMLButtonElement>('.card-inbox__path-more')!.click())
      const bubble = el.querySelector('.place-bubble')
      expect(bubble?.querySelector('.place-bubble__path')?.textContent).toBe('New cards test / History / History cards')
      expect([...bubble!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Show in sidebar'])
      // A click outside closes it.
      act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      expect(el.querySelector('.place-bubble')).toBeNull()
      act(() => el.querySelector<HTMLButtonElement>('.card-inbox__path-more')!.click())
      act(() => el.querySelector<HTMLButtonElement>('.place-bubble__go')!.click())
      expect(props.showInSidebar).toHaveBeenCalledWith(PATH)
      expect(el.querySelector('.place-bubble')).toBeNull()
    } finally {
      width.mockRestore()
      box.mockRestore()
    }
  })
})

describe('the guided tour hears the Inbox (YAZ-5123)', () => {
  it('each Space that shows a part fires inbox-step-shown once; the card, the answers and the ⋯ are marks', async () => {
    mount(TWO_SIDES)
    await flush()
    const heard: string[] = []
    const stop = listenTour((name) => heard.push(name))
    try {
      expect(el.querySelector('.card-inbox__card')!.getAttribute('data-tour')).toBe('inbox-card')
      expect(el.querySelector('.card-inbox__answers')!.getAttribute('data-tour')).toBe('inbox-answers')
      expect(el.querySelector('.card-inbox__more-button')!.getAttribute('data-tour')).toBe('card-menu')
      press(' ')
      expect(heard).toEqual(['inbox-step-shown'])
      press(' ')
      press(' ')
      expect(heard).toEqual(['inbox-step-shown', 'inbox-step-shown', 'inbox-step-shown'])
      // All shown: one more Space shows nothing, and fires nothing.
      press(' ')
      press(' ')
      const all = heard.length
      press(' ')
      expect(heard).toHaveLength(all)
      act(() => el.querySelector<HTMLButtonElement>('.card-inbox__more-button')!.click())
      const marks = [...el.querySelectorAll<HTMLElement>('.ctx-menu .ctx-menu__item[data-tour]')].map((b) => [b.textContent, b.dataset.tour])
      expect(marks).toEqual([['Archive card', 'card-menu-archive']])
    } finally {
      stop()
    }
  })
})

describe('the title on the front (YAZ-5030)', () => {
  const TITLED = 'What is the capital of {{France}}?\n---\n{{Paris}}'
  const withLine = (notitle: boolean) => {
    mount(TITLED)
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, notitle } } }
    render()
  }
  /** The title in the card's band (YAZ-5308 A3); null while there is no band. */
  const label = () => el.querySelector('.card-inbox__panel > .card-band .card-inbox__name')?.textContent ?? null
  const text = () => el.querySelector('.card-inbox__card')?.textContent ?? ''

  it('Hide (YAZ-5695, Yaseen: "it should never show up in reviews. Period."): no band and no title at ANY step — the front, each Space, Side 2, fully shown; the title is never a Space step either', async () => {
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
    // Fully shown: still no band; the head is the ID alone; the title is nowhere on the screen.
    expect(label()).toBeNull()
    expect(el.querySelector('.card-inbox__head')!.textContent).toBe('WIKI-9')
    expect(el.querySelectorAll('.card-inbox__title')).toHaveLength(0)
    expect(el.textContent).not.toContain('Capital of France')
  })

  it('Show (no part): the band shows the title from the start; it is no part of the front, so never a Space step (YAZ-5308)', async () => {
    withLine(false)
    await flush()
    expect(label()).toBe('Capital of France')
    expect(text()).not.toContain('Capital of France')
    expect(blanks()).toBe(1)
    press(' ')
    expect(shown()).toEqual(['France'])
  })

  it('the answer line names a card by its title; a title hidden in review never (YAZ-5695): its ID', async () => {
    withLine(false)
    await flush()
    press('2')
    session = { ...session, answered: ['good'], canUndo: true }
    render()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe('✓ Remembered · Capital of France · back in 3 days · Undo (Cmd+Z)')
  })

  it('after an answer, a title hidden in review is still nowhere (YAZ-5695): the answer line names the card by its ID', async () => {
    withLine(true)
    await flush()
    press('2')
    session = { ...session, answered: ['good'], canUndo: true }
    render()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe('✓ Remembered · WIKI-9 · back in 3 days · Undo (Cmd+Z)')
    expect(el.textContent).not.toContain('Capital of France')
  })

  it('YAZ-5694: on a finish screen the answer line`s Undo is the only one; the key row under it does not say it again', async () => {
    withLine(false)
    await flush()
    press('2')
    session = { ...session, answered: ['good'], canUndo: true }
    render()
    // The last card answered: the finish screen, the line still there with its Undo.
    session = { ...session, card: null }
    render()
    expect(el.querySelector('.card-inbox__done-title')).not.toBeNull()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe('✓ Remembered · Capital of France · back in 3 days · Undo (Cmd+Z)')
    const undos = (el.querySelector('.card-inbox__dock')?.textContent ?? '').match(/Undo/g) ?? []
    expect(undos).toHaveLength(1)
    expect([...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)).toEqual([])
  })
})

describe('YAZ-5044 the Inbox head: the ID, the title in the card`s band (YAZ-5308 A3; YAZ-5132: the page is the breadcrumb`s last part), "Open card" for a card file', () => {
  const PLAIN = 'What is the capital of {{France}}?'
  /** The head's ID, then the band's title. */
  const headText = () => `${el.querySelector('.card-inbox__head')!.textContent} | ${el.querySelector('.card-inbox__panel > .card-band')?.textContent ?? ''}`
  const hints = () => [...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)
  /** The card's file is a card file (`kind: card`), as the index says. */
  const asCardFile = () => {
    const record = { path: PATH, name: 'cards.md', basename: 'cards', title: 'Capital of France', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: { kind: 'card' }, aliases: [], tags: [], links: [], embeds: [], kind: 'card' as const }
    const wikilinks = createWikilinkResolveSource()
    wikilinks.update(() => null, [record])
    props = { ...props, vaultOf: () => ({ root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never }) }
    render()
  }

  it('a card in a page: "WIKI-9", and "Capital of France" in the band, from the start, no "in Cards"; the breadcrumb`s page part and O open the page', () => {
    mount(PLAIN)
    session = { ...session, place: [{ kind: 'page', label: 'Cards', path: PATH }] }
    render()
    expect(headText()).toBe('WIKI-9 | Capital of France')
    expect(el.querySelector('.card-inbox__in')).toBeNull()
    expect(el.querySelector('.card-inbox__name')!.tagName).toBe('SPAN')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__path-part[data-kind="page"]')!.click())
    expect(props.openPage).toHaveBeenCalledExactlyOnceWith(PATH)
    expect(props.openPlace).not.toHaveBeenCalled()
    press('o')
    expect(props.openPage).toHaveBeenCalledTimes(2)
    expect(hints()).toContain('Open page (O)')
  })

  // YAZ-5307: Settings › Cards › Inbox: O opens the page at. The top (the default) asks for the page alone, as YAZ-5022;
  // The card asks for it landed on the card (its ID and index: Explore's page layer `card`, found by its ID, the one landing, YAZ-5164). The
  // breadcrumb's page part and ⋯ › Open card open as O does. E and a card file do not change.
  it.each([
    ['top', [PATH]],
    ['card', [PATH, { id: 'WIKI-9', index: 1 }]],
  ] as const)('YAZ-5307: with "%s", O, the breadcrumb`s page part and ⋯ › Open card ask for %j; E is unchanged', (openAt, asked) => {
    mount(PLAIN)
    props = { ...props, openAt }
    session = { ...session, card: { ...session.card!, index: 1 }, place: [{ kind: 'page', label: 'Cards', path: PATH }] }
    render()
    press('o')
    expect(vi.mocked(props.openPage).mock.lastCall).toEqual(asked)
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__path-part[data-kind="page"]')!.click())
    expect(vi.mocked(props.openPage).mock.lastCall).toEqual(asked)
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__more-button')!.click())
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu .ctx-menu__item')].find((b) => b.textContent === 'Open card')!.click())
    expect(vi.mocked(props.openPage).mock.calls).toEqual([asked, asked, asked])
    press('e')
    expect(props.editCard).toHaveBeenCalledExactlyOnceWith(PATH, { id: 'WIKI-9', index: 1 })
  })

  it('YAZ-5307: with "card", a card FILE still opens as itself (no card index)', () => {
    mount(PLAIN)
    asCardFile()
    props = { ...props, openAt: 'card' }
    render()
    press('o')
    expect(vi.mocked(props.openPage).mock.calls).toEqual([[PATH]])
  })

  it('YAZ-5164 part 3: the front never shows the title; a click on the head`s title renames the card on its card line (YAZ-5308), one write', async () => {
    lineWrites.length = 0
    mount(PLAIN)
    expect(el.querySelector('.card-inbox__card')?.textContent).not.toContain('Capital of France')
    expect(el.querySelector('.card-inbox__card')?.textContent).toContain('What is the capital of')
    act(() => el.querySelector<HTMLElement>('.card-inbox__name .page-title__text')!.click())
    const field = el.querySelector<HTMLTextAreaElement>('.card-inbox__name .page-title__input')!
    expect(field.value).toBe('Capital of France')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'France')
      field.blur()
    })
    expect(lineWrites).toHaveLength(1)
    expect(lineWrites[0].slice(0, 2)).toEqual([PATH, 'WIKI-9'])
    const change = lineWrites[0][2] as (line: CardLine) => CardLine
    expect(formatCardLine(change(parseCardLine('<!-- card: WIKI-9, title "Capital of France" -->')!))).toBe('<!-- card: WIKI-9, title "France" -->')
  })

  it('a card file adds nothing: "WIKI-9", the band "Capital of France"; its title is the link, and it and O open it in Explore ("Open card", YAZ-5145: as Explore opens it, not its tab); E edits it there, with no card index', () => {
    mount(PLAIN)
    asCardFile()
    expect(headText()).toBe('WIKI-9 | Capital of France')
    expect(el.querySelector('.card-inbox__in')).toBeNull()
    expect(hints()).toContain('Open card (O)')
    expect(hints()).not.toContain('Open page (O)')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__name')!.click())
    expect(props.openPage).toHaveBeenCalledExactlyOnceWith(PATH)
    press('o')
    expect(props.openPage).toHaveBeenCalledTimes(2)
    press('e')
    expect(props.editCard).toHaveBeenCalledExactlyOnceWith(PATH, null)
  })

  it('a card file with `notitle` (DEMO-182, YAZ-5695): no band at any step, fully shown too; O opens it all along', async () => {
    mount(PLAIN)
    asCardFile()
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, notitle: true } } }
    render()
    await flush()
    expect(headText()).toBe('WIKI-9 | ')
    press('o')
    expect(props.openPage).toHaveBeenCalledOnce()
    press(' ')
    press(' ')
    press(' ')
    expect(headText()).toBe('WIKI-9 | ')
  })

  it('while the card`s page is still read: the ID, no title yet', () => {
    mount(null)
    expect(headText()).toBe('WIKI-9 | ')
  })
})

describe('when a shown title appears (YAZ-5696, YAZ-5709: Never · Always · After the first click · Before Side 2)', () => {
  // Two hidden words on the front, one on Side 2.
  const CARD = 'A {{one}} and {{two}}\n---\n{{three}}'
  type Show = 'never' | 'always' | 'click' | 'side2'
  // These walks are Title room "Only when it shows" (YAZ-5864); Always (YAZ-5880, the default) has its own tests below.
  const at = (titleAt: Show, own?: { titleAt?: 'always' | 'click' | 'side2'; title?: string }, text = CARD, titleRoom: 'always' | 'shown' = 'shown') => {
    mount(text, { ...DEFAULT_REVIEW_SETTINGS, titleAt, titleRoom })
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, ...(own?.title !== undefined && { title: own.title }), ...(own?.titleAt !== undefined && { titleAt: own.titleAt }) } } }
    render()
  }
  /**
   * The band: 'shown' with its title, 'none' (Only when it shows: a title that waits draws no band, the text flush with
   * the top, YAZ-5864), 'waits' (Always: the band is there, the title in it unseen and unread, YAZ-5880), 'empty' (Always,
   * no title shown), and '+fade' when a waited title fades in.
   */
  const band = () => {
    const b = el.querySelector<HTMLElement>('.card-inbox__panel > .card-band')
    if (b === null) return 'none'
    if (b.classList.contains('card-band--waiting')) return b.getAttribute('aria-hidden') === 'true' ? 'waits' : 'waits, read'
    if (b.textContent === '') return b.getAttribute('aria-hidden') === 'true' ? 'empty' : 'empty, read'
    return `shown: ${b.textContent}${b.classList.contains('card-band--fade') ? ' +fade' : ''}`
  }
  const click = (sel: string) => act(() => el.querySelector<HTMLElement>(sel)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))

  it('Title room Always (YAZ-5880, the default): every card has the band; a waiting title is in it unseen, then fades in; Never keeps an empty band; nothing moves', async () => {
    expect(DEFAULT_REVIEW_SETTINGS.titleRoom).toBe('always')
    at('click', undefined, CARD, 'always')
    await flush()
    expect(band()).toBe('waits')
    press(' ')
    expect(band()).toBe('shown: Capital of France +fade')
    press(' ')
    expect(band()).toBe('shown: Capital of France +fade')
    at('side2', undefined, CARD, 'always')
    await flush()
    expect(walk(3)).toEqual(['one | 1 | waits', 'one+two | 1 | waits', 'one+two | 1 | shown: Capital of France +fade'])
    // A title that shows from the front never fades: it was never away.
    at('always', undefined, CARD, 'always')
    await flush()
    expect(band()).toBe('shown: Capital of France')
    // Never (global or the card's `notitle`): the band is there, empty, at every step.
    at('never', undefined, CARD, 'always')
    await flush()
    expect(walk(3).map((s) => s.split(' | ')[2])).toEqual(['empty', 'empty', 'empty'])
    expect(band()).toBe('empty')
  })

  it('Always (the default): the title shows from the front, as before', async () => {
    expect(DEFAULT_REVIEW_SETTINGS.titleAt).toBe('always')
    at('always')
    await flush()
    expect(band()).toBe('shown: Capital of France')
  })

  it('Never (global): no band at any step, and the answer line names the card by its ID', async () => {
    at('never')
    await flush()
    expect(band()).toBe('none')
    press(' ')
    press(' ')
    press(' ')
    expect(band()).toBe('none')
    press('2')
    session = { ...session, answered: ['good'], canUndo: true }
    render()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe('✓ Remembered · WIKI-9 · back in 3 days · Undo (Cmd+Z)')
  })

  /** What shows after each Space (YAZ-5709): the shown words, the sides, and the band. */
  const walk = (n: number) =>
    Array.from({ length: n }, () => {
      press(' ')
      return `${shown().join('+') || '-'} | ${sides()} | ${band()}`
    })

  it('After the first click (YAZ-5709, YAZ-5857): no band while the title waits, the text first in the frame; the first Space shows the title BY ITSELF, then the words, then Side 2', async () => {
    at('click')
    await flush()
    expect(band()).toBe('none')
    // Flush with the top: nothing of the title is in the card, not even hidden.
    expect(el.querySelector('.card-inbox__panel')?.textContent).not.toContain('Capital of France')
    expect(walk(5)).toEqual([
      '- | 1 | shown: Capital of France',
      'one | 1 | shown: Capital of France',
      'one+two | 1 | shown: Capital of France',
      'one+two | 2 | shown: Capital of France',
      'one+two+three | 2 | shown: Capital of France',
    ])
    // Hiding a word again keeps the title.
    click('.card__hidden[data-hidden="0"]')
    expect(band()).toBe('shown: Capital of France')
  })

  it('After the first click: a click on a blank shows that word only, the next Space the title; a one-sided card with nothing hidden: the title is the one Space', async () => {
    at('click')
    await flush()
    click('.card__blank[data-hidden="1"]')
    expect(shown()).toEqual(['two'])
    expect(band()).toBe('none')
    press(' ')
    expect(shown()).toEqual(['two'])
    expect(band()).toBe('shown: Capital of France')
    at('click', undefined, 'Nothing hidden here.')
    await flush()
    expect(band()).toBe('none')
    press(' ')
    expect(band()).toBe('shown: Capital of France')
  })

  it('Before Side 2 (YAZ-5709): 2 words on the front + 1 on the back = 5 Spaces: word, word, the title, Side 2, the back word', async () => {
    at('side2')
    await flush()
    expect(band()).toBe('none')
    const hint = () => el.querySelector('.card-inbox__hints > span')?.textContent
    expect(walk(2)).toEqual(['one | 1 | none', 'one+two | 1 | none'])
    // The next Space is the title, not the side: the hint says Show.
    expect(hint()).toBe('Show (Space)')
    expect(walk(1)).toEqual(['one+two | 1 | shown: Capital of France'])
    expect(hint()).toBe('Next side (Space)')
    expect(walk(2)).toEqual(['one+two | 2 | shown: Capital of France', 'one+two+three | 2 | shown: Capital of France'])
  })

  it('Before Side 2: a card of 3 sides gets its title before Side 2, not before the last side', async () => {
    at('side2', undefined, 'A {{one}}\n---\nB {{two}}\n---\nC')
    await flush()
    expect(walk(5)).toEqual(['one | 1 | none', 'one | 1 | shown: Capital of France', 'one | 2 | shown: Capital of France', 'one+two | 2 | shown: Capital of France', 'one+two | 3 | shown: Capital of France'])
  })

  it('Before Side 2: a one-sided card gets its title last, after every hidden word; with none, it is the one Space', async () => {
    at('side2', undefined, 'A {{one}} and {{two}}')
    await flush()
    expect(walk(3)).toEqual(['one | 1 | none', 'one+two | 1 | none', 'one+two | 1 | shown: Capital of France'])
    at('side2', undefined, 'Nothing hidden here.')
    await flush()
    expect(walk(1)).toEqual(['- | 1 | shown: Capital of France'])
  })

  it('the card\'s own choice wins over the global one, a global Never too', async () => {
    at('always', { titleAt: 'side2' })
    await flush()
    expect(band()).toBe('none')
    at('side2', { titleAt: 'always' })
    await flush()
    expect(band()).toBe('shown: Capital of France')
    at('never', { titleAt: 'click' })
    await flush()
    expect(band()).toBe('none')
    press(' ')
    expect(band()).toBe('shown: Capital of France')
  })

  it('a title with a hidden-word mark waits until the card is fully shown, Always too', async () => {
    at('always', { title: 'Capital: {{Paris}}' })
    await flush()
    expect(band()).toBe('none')
    press(' ')
    press(' ')
    press(' ')
    expect(band()).toBe('none')
    press(' ')
    expect(shown()).toEqual(['one', 'two', 'three'])
    expect(band()).toBe('shown: Capital: {{Paris}}')
  })

  it('a card that comes back (another card, then this one again) starts at its front: the title waits again', async () => {
    at('click')
    await flush()
    press(' ')
    expect(band()).toBe('shown: Capital of France')
    const was = session.card!
    session = { ...session, card: { ...was, id: 'WIKI-10', page: { ...was.page!, id: 'WIKI-10' } } }
    render()
    session = { ...session, card: was }
    render()
    expect(band()).toBe('none')
  })

  it('Before Side 2: a card that comes back (Undo of its answer) starts at its front: its title step comes again', async () => {
    at('side2', undefined, 'Nothing hidden here.')
    await flush()
    press(' ')
    expect(band()).toBe('shown: Capital of France')
    const was = session.card!
    session = { ...session, card: { ...was, id: 'WIKI-10', page: { ...was.page!, id: 'WIKI-10' } } }
    render()
    session = { ...session, card: was }
    render()
    expect(band()).toBe('none')
    press(' ')
    expect(band()).toBe('shown: Capital of France')
  })

  it('the answer line names the card by its title, though it had not shown yet', async () => {
    at('side2')
    await flush()
    press('2')
    session = { ...session, answered: ['good'], canUndo: true }
    render()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe('✓ Remembered · Capital of France · back in 3 days · Undo (Cmd+Z)')
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
  const hints = () => [...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)

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
    session = { ...sessionOf('Next card'), answered: ['good'] }
    render()
    expect(cardAudioPlaying()).toBe(false)
  })

  it('a click on the player plays and does not step the card; "P Play" is in the key row only while a side that shows has a sound', async () => {
    const { cardAudioPlaying, stopCardAudio } = await import('../editor/card/cardMedia')
    mount('Front {{word}}\n---\n![](assets/audio/tone.mp3)')
    expect(hints()).not.toContain('Play (P)')
    press(' ')
    press(' ')
    expect(el.querySelector('.card__audio')).not.toBeNull()
    expect(hints()).toContain('Play (P)')
    const before = shown()
    act(() => el.querySelector<HTMLButtonElement>('.card__audio-play')!.click())
    expect(cardAudioPlaying()).toBe(true)
    expect(shown()).toEqual(before)
    stopCardAudio()
    session = { ...sessionOf('No sound') }
    render()
    expect(hints()).not.toContain('Play (P)')
  })

  it('a board`s picture shows; a click opens the board on top (the Explore layer), never a step', () => {
    mount('Loading')
    const viewOnlyLinks = createViewOnlyLinkSource()
    viewOnlyLinks.update({ entries: [], resolve: (t: string) => (t === 'Card pipeline.drawio' ? '/v/Card pipeline.drawio' : null) } as never)
    const base = props.vaultOf
    props = { ...props, vaultOf: (p) => ({ ...base(p), viewOnlyLinks }) }
    session = { ...sessionOf('A diagram\n---\n![[Card pipeline.drawio]]') }
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
    // The next card (one more answer in the session: a new turn, YAZ-5594): from zero.
    session = sessionOf(TWO_SIDES, { answered: ['good'] })
    render()
    await flush()
    work(3)
    press('2')
    expect(secondsOfAnswer()).toBe(3)
    // ⌘Z shows the first card again: from zero again, not its old 20 s.
    session = sessionOf(TWO_SIDES, { answered: [] })
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

describe('YAZ-5679: "Added card to reviews · Undo" (Mochi`s toast) when a new card is learned', () => {
  it('shows at the bottom right for about 3 s; its Undo takes the answer back; a new learned card shows it again', () => {
    vi.useFakeTimers()
    try {
      mount(TWO_SIDES)
      const toast = () => el.querySelector('.card-inbox > .learned-toast')
      expect(toast()).toBeNull()
      session = { ...session, learned: 's1:a' }
      render()
      expect(toast()?.textContent).toBe('Added card to reviews·Undo')
      act(() => void vi.advanceTimersByTime(2900))
      expect(toast()).not.toBeNull()
      act(() => void vi.advanceTimersByTime(200))
      expect(toast()).toBeNull()
      session = { ...session, learned: 's1:b' }
      render()
      act(() => toast()!.querySelector<HTMLButtonElement>('.learned-toast__undo')!.click())
      expect(review.undo).toHaveBeenCalledOnce()
      expect(toast()).toBeNull()
      // The next answer (not a learned card): gone.
      session = { ...session, learned: 's1:c' }
      render()
      session = { ...session, learned: null }
      render()
      expect(toast()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("YAZ-5674: the top right as Mochi's — ✕ K, the filter's icon, done / total; today's total in the cards menu", () => {
  const SHOWN = { ...DEFAULT_REVIEW_SETTINGS, timeSoFar: 'shown' as const }
  const top = () => el.querySelector('.card-inbox__bar .card-inbox__place')
  it('"✕ 2" in red, then the open filter`s icon (the menu`s own) and "4 / 6"; no ✕ at 0 (hidden in the missed pass: `misses` 0)', () => {
    mount(TWO_SIDES)
    session = { ...session, progress: { done: 4, total: 6, waiting: 2 }, misses: 2 }
    render()
    expect(top()?.querySelector('.session-count__misses')?.textContent).toBe('2')
    expect(top()?.querySelector('.session-count__misses svg')).not.toBeNull()
    expect(top()?.querySelector('.session-count__done')?.textContent).toBe('4 / 6')
    expect(top()?.querySelector('.session-count__done svg')?.outerHTML).toBe(el.querySelector('.card-inbox__filter svg')?.outerHTML)
    expect(top()?.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('2 missed, 4 of 6 done')
    // YAZ-5689 (Yaseen: "make the 3 normal black color", Mochi's): the done number, then "/ total" apart; the ✕'s number apart from the ✕.
    expect(top()?.querySelector('.session-count__n')?.textContent).toBe('4')
    expect(top()?.querySelector('.session-count__total')?.textContent).toBe(' / 6')
    expect(top()?.querySelector('.session-count__misses-n')?.textContent).toBe('2')
    session = { ...session, filter: 'new', progress: { done: 0, total: 4, waiting: 0 }, misses: 0 }
    render()
    expect(top()?.querySelector('.session-count__misses')).toBeNull()
    expect(top()?.textContent).toBe('0 / 4')
    // New cards: the dotted circle.
    expect(top()?.querySelector('circle')?.getAttribute('stroke-dasharray')).toBe('2.2 2')
  })

  it('YAZ-5680 check 2: every finish screen keeps the count, as Mochi ("Finished learning cards." with 4 / 4); an empty session has none', () => {
    mount(TWO_SIDES)
    session = { ...session, card: null, filter: 'new', counts: { all: 4, next: 0, due: 4, new: 0 }, progress: { done: 4, total: 4, waiting: 0 }, misses: 0 }
    render()
    expect(el.querySelector('.card-inbox__done-title')?.textContent).toBe('Finished learning cards.')
    expect(top()?.textContent).toBe('4 / 4')
    session = { ...session, filter: 'all', counts: { all: 0, next: 0, due: 0, new: 0 }, progress: { done: 0, total: 0, waiting: 0 } }
    render()
    expect(top()).toBeNull()
  })

  it('no "Today: …" and no "N of M" in the top row; the cards menu`s last line is "Today: N cards" alone (YAZ-5690): no reviews, no time, whatever Time so far says', () => {
    mount(TWO_SIDES, SHOWN)
    session = { ...session, today: { cards: 21, seconds: 9 * 60 + 10 } }
    render()
    const bar = el.querySelector('.card-inbox__bar')!
    expect(bar.querySelector('.card-inbox__today')).toBeNull()
    expect(bar.textContent).not.toMatch(/Today|\d+ of \d+/)
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    expect(document.querySelector('.card-inbox__menu-today')?.textContent).toBe('Today: 21 cards')
    expect(document.querySelector('.card-inbox__menu-foot .card-inbox__time')).toBeNull()
    session = { ...session, today: { cards: 1, seconds: 0 } }
    render()
    expect(document.querySelector('.card-inbox__menu-today')?.textContent).toBe('Today: 1 card')
    // Nothing answered today: no line.
    session = { ...session, today: { cards: 0, seconds: 0 } }
    render()
    expect(document.querySelector('.card-inbox__menu-today')).toBeNull()
  })

  it('the done screen says today`s total under "Inbox complete.": the cards menu`s words, then the time (YAZ-5710)', () => {
    mount(TWO_SIDES, SHOWN)
    session = { ...session, card: null, today: { cards: 26, seconds: 4 * 60 + 31 } }
    render()
    const done = el.querySelector('.card-inbox__done')!
    expect(done.querySelector('.card-inbox__done-title')?.textContent).toBe('Inbox complete.')
    expect(done.querySelector('.card-inbox__done-today')?.textContent).toBe('Today: 26 cards · 5 min')
    // Still shown on a page's done screen.
    session = { ...session, scope: 'page' }
    render()
    expect(el.querySelector('.card-inbox__done-today')?.textContent).toBe('Today: 26 cards · 5 min')
  })
})

describe('YAZ-5689: the top row`s right end is the count and ONE sliders icon, "View"; a click opens Time, Zoom, Focus mode', () => {
  const today = { cards: 21, seconds: 9 * 60 + 10 }
  const view = () => el.querySelector<HTMLButtonElement>('.card-inbox__bar .card-inbox__view')
  const panel = () => document.querySelector<HTMLElement>('.card-inbox__view-panel')
  const open = () => {
    if (panel() === null) act(() => view()!.click())
    return panel()!
  }
  const rowsOf = () => [...open().querySelectorAll<HTMLElement>('.card-inbox__view-row')]
  const labels = () => rowsOf().map((r) => r.querySelector('.card-inbox__view-label')!.textContent)
  const timeRow = () => rowsOf().find((r) => r.dataset.row === 'time')
  const withFocus = (on: boolean, onFocusMode: (on: boolean) => void) => act(() => root?.render(<CardInbox {...props} review={review} session={session} focusMode={on} onFocusMode={onFocusMode} />))
  beforeEach(() => localStorage.removeItem('inbox:zoom'))

  it('at rest: the count, then one quiet icon button — the page header`s sliders — "View", aria-haspopup, aria-expanded; no zoom pill, no focus button, no clock in the row', () => {
    mount(TWO_SIDES)
    withFocus(false, vi.fn())
    const bar = el.querySelector('.card-inbox__bar')!
    expect(bar.querySelector('.card-inbox__tools, .document-zoom, .card-inbox__focus, .card-inbox__time')).toBeNull()
    expect(view()!.previousElementSibling?.className).toBe('card-inbox__place')
    expect(bar.lastElementChild).toBe(view())
    expect([view()!.type, view()!.getAttribute('aria-label'), view()!.getAttribute('aria-haspopup'), view()!.getAttribute('aria-expanded'), view()!.tabIndex]).toEqual(['button', 'View', 'dialog', 'false', 0])
    // The page header's "adjust" icon (`PropertiesIcon`): two lines with a knob each.
    expect(view()!.querySelectorAll('svg path, svg circle').length).toBe(3)
    expect(panel()).toBeNull()
  })

  it('a click opens the panel under it: Time, Zoom (− 100% +), Focus mode; a click again, Esc or a press outside closes it', () => {
    mount(TWO_SIDES)
    session = { ...session, today }
    withFocus(false, vi.fn())
    act(() => view()!.click())
    expect([panel()?.getAttribute('role'), panel()?.querySelector('[role="group"]')?.getAttribute('aria-label'), view()!.getAttribute('aria-expanded')]).toEqual(['dialog', 'View', 'true'])
    expect(labels()).toEqual(['Time', 'Zoom', 'Focus mode'])
    expect(open().querySelector('.document-zoom')?.getAttribute('aria-label')).toBe('Inbox zoom')
    act(() => view()!.click())
    expect([panel(), view()!.getAttribute('aria-expanded')]).toEqual([null, 'false'])
    open()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(panel()).toBeNull()
    open()
    act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(panel()).toBeNull()
  })

  it('Time follows Time so far: hidden (the default) behind a tap, "Show" then the time; shown: the time; off: no Time row', () => {
    mount(TWO_SIDES)
    session = { ...session, today }
    render()
    expect(review.settings.timeSoFar).toBe('hidden')
    const show = timeRow()!.querySelector<HTMLButtonElement>('button.card-inbox__view-time')!
    expect([show.textContent, show.getAttribute('aria-label')]).toEqual(['Show', 'Show time so far'])
    act(() => show.click())
    expect(timeRow()!.querySelector('.card-inbox__view-time')!.textContent).toBe('9 min')
    // It folds again with the panel: hidden each time it opens.
    act(() => view()!.click())
    expect(timeRow()!.querySelector('.card-inbox__view-time')!.textContent).toBe('Show')
    act(() => view()!.click())
    mount(TWO_SIDES, { ...DEFAULT_REVIEW_SETTINGS, timeSoFar: 'shown' })
    session = { ...session, today }
    render()
    expect(timeRow()!.querySelector('.card-inbox__view-time')!.textContent).toBe('9 min')
    act(() => view()!.click())
    mount(TWO_SIDES, { ...DEFAULT_REVIEW_SETTINGS, timeSoFar: 'off' })
    session = { ...session, today }
    render()
    expect(labels()).toEqual(['Zoom'])
  })

  it('Zoom in the panel: + and − zoom the card; the key ladder works with the panel shut; away from 100% the icon wears a dot', () => {
    mount(TWO_SIDES)
    const level = () => el.querySelector<HTMLElement>('.card-inbox')!.style.getPropertyValue('--document-zoom')
    expect(view()!.hasAttribute('data-zoomed')).toBe(false)
    const plus = open().querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!
    act(() => plus.click())
    expect([level(), localStorage.getItem('inbox:zoom')]).toEqual(['1.25', '125'])
    expect(view()!.hasAttribute('data-zoomed')).toBe(true)
    act(() => view()!.click())
    expect(panel()).toBeNull()
    act(() => void el.querySelector('.card-inbox')!.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: 0, bubbles: true, cancelable: true })))
    expect(level()).toBe('1')
    expect(view()!.hasAttribute('data-zoomed')).toBe(false)
  })

  it('Focus mode in the panel: the same button (aria-pressed) and F; without the App`s door no Focus mode row', () => {
    mount(TWO_SIDES)
    expect(labels()).toEqual(['Time', 'Zoom'])
    act(() => view()!.click())
    const onFocusMode = vi.fn()
    withFocus(false, onFocusMode)
    const focus = () => open().querySelector<HTMLButtonElement>('.card-inbox__focus')!
    expect([focus().getAttribute('aria-label'), focus().getAttribute('aria-pressed')]).toEqual(['Focus mode', 'false'])
    act(() => focus().click())
    expect(onFocusMode).toHaveBeenLastCalledWith(true)
    withFocus(true, onFocusMode)
    expect(focus().getAttribute('aria-pressed')).toBe('true')
  })
})

describe('YAZ-5042: add more cards for today, from the Inbox (no trip to Settings)', () => {
  const rows = () => [...document.querySelectorAll<HTMLElement>('.card-inbox__filter-row')]
  // A field reads as "[10]": the done screen's pill is "Add [10] new cards" (round 2).
  const textOf = (node: Node): string => (node instanceof HTMLInputElement ? `[${node.value}]` : node.childNodes.length === 0 ? (node.textContent ?? '') : [...node.childNodes].map(textOf).join(''))
  const doneText = () => [...el.querySelectorAll('.card-inbox__done > :not(.done-cheer__party)')].map(textOf)
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

  it('round 2: the Up next row reads "today / total" ("2 / 5"); New cards its count alone (YAZ-5434); no limit: the count alone', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    expect(rows().map((r) => r.textContent)).toEqual(['All cards22', 'Up next2 / 5', 'Due today10', 'New cards10'])
    // The total is every card of the kind: nothing waits, it is today's count.
    session = { ...session, more: { new: 0, next: 0 }, adds: { new: 0, next: 0 } }
    render()
    expect(rows().map((r) => r.textContent)).toEqual(['All cards22', 'Up next2 / 2', 'Due today10', 'New cards10'])
    session = { ...session, limited: { new: false, next: false } }
    render()
    expect(rows().map((r) => r.textContent)).toEqual(['All cards22', 'Up next2', 'Due today10', 'New cards10'])
  })

  it('YAZ-5690 round 2 (Yaseen: "Yes, under ⚙"): a click on any count only picks its filter; no row turns into a field, no "Click to add"', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    for (const r of rows()) expect([r.querySelector('.card-inbox__count')!.getAttribute('title'), r.querySelector('.card-inbox__count')!.hasAttribute('data-add')]).toEqual([null, false])
    act(() => rows()[1].querySelector<HTMLElement>('.card-inbox__count')!.click())
    expect(field()).toBeNull()
    expect(review.setFilter).toHaveBeenCalledExactlyOnceWith('next')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    act(() => rows()[3].querySelector<HTMLElement>('.card-inbox__count')!.click())
    expect(field()).toBeNull()
    expect(review.setFilter).toHaveBeenLastCalledWith('new')
    expect(review.addCards).not.toHaveBeenCalled()
  })

  it('round 2: after an add the row says "22 / 48 · Reset"; Reset calls the hook and the menu stays open', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING, counts: { all: 34, next: 2, due: 10, new: 22 }, more: { new: 26, next: 3 }, canReset: { new: true, next: false } }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    expect(rows().map((r) => r.textContent)).toEqual(['All cards34', 'Up next2 / 5', 'Due today10', 'New cards22Reset'])
    act(() => rows()[3].querySelector<HTMLButtonElement>('.card-inbox__reset')!.click())
    expect(review.resetCards).toHaveBeenCalledExactlyOnceWith('new')
    expect(review.setFilter).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(4)
  })

  it('the line under the answer buttons says the add, and its Undo is the hook\'s undo; Cmd + Z undoes it too', () => {
    mount(TWO_SIDES)
    session = { ...session, lastAdd: { kind: 'new', count: 10, reset: false }, canUndo: true }
    render()
    const last = el.querySelector<HTMLElement>('.card-inbox__last')!
    expect(last.textContent).toBe('+ Added 10 new cards for today · Undo (Cmd+Z)')
    expect(last.dataset.rating).toBeUndefined()
    act(() => last.querySelector<HTMLButtonElement>('.card-inbox__last-undo')!.click())
    expect(review.undo).toHaveBeenCalledTimes(1)
    press('z', { metaKey: true })
    expect(review.undo).toHaveBeenCalledTimes(2)
    session = { ...session, lastAdd: { kind: 'next', count: 1, reset: false } }
    render()
    expect(last.textContent).toBe('+ Added 1 Up next card for today · Undo (Cmd+Z)')
    // On the done screen too.
    session = { ...session, card: null, lastAdd: { kind: 'new', count: 2, reset: false } }
    render()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe('+ Added 2 new cards for today · Undo (Cmd+Z)')
    // Round 2: a Reset says so, with the same Undo.
    session = { ...session, lastAdd: { kind: 'new', count: 12, reset: true } }
    render()
    expect(el.querySelector('.card-inbox__last')?.textContent).toBe("↺ Reset today's new cards · Undo (Cmd+Z)")
  })

  it('the done screen says what waits, with one add button for each kind; nothing waits: as before', () => {
    mount(TWO_SIDES)
    session = { ...session, card: null, counts: { all: 0, next: 0, due: 0, new: 0 }, more: { new: 38, next: 3 }, adds: { new: 10, next: 2 } }
    render()
    expect(doneText()).toEqual(['Inbox complete.', '38 new cards and 3 Up next cards wait for another day.', 'Add[10]new cardsfrom All foldersAdd[2]Up next'])
    expect(pills().map(textOf)).toEqual(['Add[10]new cardsfrom All folders', 'Add[2]Up next'])
    // YAZ-5699 (Yaseen: "that should be a two click as well"): a click on "Add" or the words never adds; it asks in place.
    const ask = () => el.querySelector<HTMLElement>('.card-inbox__done .ask-in-place')
    const answer = (word: 'Cancel' | 'Add') => act(() => [...ask()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === word)!.click())
    act(() => addButtons()[0].click())
    expect(review.addCards).not.toHaveBeenCalled()
    expect([ask()!.querySelector('.confirm__text')!.textContent, [...ask()!.querySelectorAll('button')].map((b) => b.textContent), document.activeElement?.textContent]).toEqual(['Add 10 new cards to today?', ['Cancel', 'Add'], 'Cancel'])
    answer('Cancel')
    expect([ask(), vi.mocked(review.addCards).mock.calls.length]).toEqual([null, 0])
    act(() => addButtons()[0].click())
    answer('Add')
    expect(review.addCards).toHaveBeenCalledExactlyOnceWith('new', 10)
    act(() => pills()[1].querySelectorAll<HTMLButtonElement>('.card-inbox__done-add-word')[1].click())
    expect(ask()!.querySelector('.confirm__text')!.textContent).toBe('Add 2 Up next cards to today?')
    // Esc cancels.
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect([ask(), vi.mocked(review.addCards).mock.calls.length]).toEqual([null, 1])
    act(() => pills()[1].querySelectorAll<HTMLButtonElement>('.card-inbox__done-add-word')[1].click())
    answer('Add')
    expect(review.addCards).toHaveBeenLastCalledWith('next', 2)
    // The same field: type, then Enter asks (the Inbox's keys do not see it); Add adds the typed number.
    const input = pills()[0].querySelector('input')!
    typeIn(input, '25')
    key(input, 'Enter')
    expect(vi.mocked(review.addCards).mock.calls.length).toBe(2)
    answer('Add')
    expect(review.addCards).toHaveBeenLastCalledWith('new', 25)
    // Only one kind waits: its line and its button.
    session = { ...session, more: { new: 0, next: 3 }, adds: { new: 0, next: 2 } }
    render()
    expect(doneText()).toEqual(['Inbox complete.', '3 Up next cards wait for another day.', 'Add[2]Up next'])
    session = { ...session, more: { new: 1, next: 0 }, adds: { new: 1, next: 0 } }
    render()
    expect(doneText()).toEqual(['Inbox complete.', '1 new card waits for another day.', 'Add[1]new cardfrom All folders'])
    // Nothing waits (also: no limit), and nothing is due (YAZ-5623): as now.
    review = { ...review, dueCount: 0 }
    session = { ...session, more: { new: 0, next: 0 }, adds: { new: 0, next: 0 } }
    render()
    expect(doneText()).toEqual(['Inbox complete.', 'Nothing else is due today. Enjoy your day!'])
  })

  it('YAZ-5623: the vault done while cards are still due (a new day began): "Review cards 3" (YAZ-5678, Mochi`s words), both apps', () => {
    mount(TWO_SIDES)
    session = { ...session, card: null, counts: { all: 0, next: 0, due: 0, new: 0 } }
    // Nothing due in the vault: as before.
    review = { ...review, dueCount: 0 }
    render()
    expect(doneText()).toEqual(['Inbox complete.', 'Nothing else is due today. Enjoy your day!'])
    // Midnight passed during the review: 3 cards are due now. The screen offers them, and the click starts the vault again.
    review = { ...review, dueCount: 3 }
    render()
    expect(doneText()).toEqual(['Inbox complete.', 'Review cards 3'])
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__done .due-end__go')!.click())
    expect(review.start).toHaveBeenCalledExactlyOnceWith({})
    // Cards wait to be added: the adds, as on the phone (no "Review K more" beside them).
    session = { ...session, more: { new: 5, next: 0 }, adds: { new: 5, next: 0 } }
    render()
    expect(doneText()).toEqual(['Inbox complete.', '5 new cards wait for another day.', 'Add[5]new cardsfrom All folders'])
  })

  it('a filter done (YAZ-5678, Mochi`s words): "Finished learning cards." · Review cards 12, then its add; Up next`s "12 more in All cards"; Due today has no add', () => {
    mount(TWO_SIDES)
    session = { ...session, filter: 'new', card: null, counts: { all: 12, next: 0, due: 12, new: 0 }, more: { new: 38, next: 3 }, adds: { new: 10, next: 2 } }
    render()
    expect(doneText()).toEqual(['Finished learning cards.', "Now let's review the cards you've learned.", 'Review cards 12', 'Add[10]new cardsfrom All folders'])
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__done .due-end__go')!.click())
    expect(review.setFilter).toHaveBeenLastCalledWith('due')
    // YAZ-5699: "Review cards 12" moves to the next list and changes nothing: one click. The add asks first.
    act(() => addButtons()[0].click())
    expect(review.addCards).not.toHaveBeenCalled()
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.card-inbox__done .ask-in-place button')].find((b) => b.textContent === 'Add')!.click())
    expect(review.addCards).toHaveBeenCalledExactlyOnceWith('new', 10)
    session = { ...session, filter: 'next' }
    render()
    expect(doneText()).toEqual(['No Up next cards left.', 'Add[2]Up next', '12 more in All cards'])
    session = { ...session, filter: 'due' }
    render()
    expect(doneText()).toEqual(['Finished reviewing.', '12 more in All cards'])
  })

  it('folder review done: "This folder is done." then that folder\'s waiting cards, then the way to the Inbox', () => {
    mount(TWO_SIDES)
    session = { ...session, label: 'Bio', scope: 'folder', card: null, counts: { all: 0, next: 0, due: 0, new: 0 }, more: { new: 5, next: 0 }, adds: { new: 5, next: 0 } }
    render()
    expect(doneText()).toEqual(['This folder is done.', '5 new cards wait for another day.', 'Add[5]new cardsfrom All folders', 'You have cards due in other pages.', 'Review cards 12'])
  })
})

describe('YAZ-5319: no Archived row in the Inbox; YAZ-5430: no To fix row', () => {
  it('the cards menu lists the rows that review and nothing under a line: archived cards and cards to fix are found in a folder page\'s table', () => {
    mount(TWO_SIDES)
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    expect([...document.querySelectorAll<HTMLButtonElement>('.card-inbox__filter-item')].map((r) => r.dataset.filter)).toEqual(['all', 'next', 'due', 'new'])
    expect(document.querySelector('.card-inbox__filter-sep')).toBeNull()
    expect(document.querySelector('.ctx-menu')!.textContent).not.toContain('To fix')
  })
})

describe('YAZ-5430: To fix never shows in the Inbox (Yaseen: "As long as to fix doesn\'t show up in the inbox")', () => {
  it('a card marked `fix` has no "To fix" on its head', () => {
    mount(TWO_SIDES)
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, fix: true } } }
    render()
    expect(el.querySelector('.card-inbox__head')).not.toBeNull()
    expect(el.querySelector('.card__fix')).toBeNull()
    expect(el.textContent).not.toContain('To fix')
  })

  it('⋯ has no Fix later and no Remove Fix later, marked or not', () => {
    mount(TWO_SIDES)
    const labels = () => {
      act(() => el.querySelector<HTMLButtonElement>('.card-inbox__more-button')!.click())
      const out = [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu .ctx-menu__item')].map((b) => b.textContent)
      press('Escape')
      return out
    }
    expect(labels()).toEqual(['Undo last review', 'Open card', 'Move to Up next', 'Archive card', 'Title in review'])
    session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, fix: true } } }
    render()
    expect(labels()).toEqual(['Undo last review', 'Open card', 'Move to Up next', 'Archive card', 'Title in review'])
  })
})

describe('the card as you read it (YAZ-5048, YAZ-5049, YAZ-5051)', () => {
  const hints = () => [...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)
  const sideCount = () => el.querySelector('.card-inbox__sides')?.textContent ?? null

  it('YAZ-5048: a card of two sides says "Side 1 of 2" above it, and Space says what it does next: "Show" a word, then "Next side"; a card of one side says nothing', async () => {
    mount(TWO_SIDES)
    expect(sideCount()).toBe('Side 1 of 2')
    expect(hints()[0]).toBe('Show (Space)')
    press(' ')
    await flush()
    // Side 1 has no hidden word left: the next Space shows side 2.
    expect(sideCount()).toBe('Side 1 of 2')
    expect(hints()[0]).toBe('Next side (Space)')
    press(' ')
    await flush()
    expect(sideCount()).toBe('Side 2 of 2')
    expect(hints()[0]).toBe('Show (Space)')
    act(() => root?.unmount())
    el.remove()
    mount('One {{side}} only')
    expect(sideCount()).toBeNull()
  })

  it('YAZ-5048: a side with no hidden word says "Next side" at once', async () => {
    mount('Plain front\n---\nBack {{word}}')
    expect(hints()[0]).toBe('Next side (Space)')
  })

  it('YAZ-5051: the head (YAZ-5044: the ID; YAZ-5132: the page is in the breadcrumb) sits in the row above the card, after the state chip; the card frame holds only the card', () => {
    mount(TWO_SIDES)
    const above = el.querySelector('.card-inbox__above')!
    const panel = el.querySelector('.card-inbox__panel')!
    expect([...above.children].map((c) => c.className).slice(0, 2)).toEqual(['card-inbox__state', 'card-inbox__head'])
    expect([...above.querySelector('.card-inbox__head')!.children].map((c) => c.textContent)).toEqual(['WIKI-9'])
    expect(panel.querySelector('.card-inbox__head, .explore__head, .card-inbox__page, .card__id')).toBeNull()
  })

  describe('YAZ-5049: Space and the scroll (round 2: one long page, with room below; round 6: a Space that scrolls shows nothing, a Space that shows never scrolls)', () => {
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
        const key = this.dataset.hidden !== undefined ? `word${this.dataset.hidden}` : this.dataset.side !== undefined ? `side${this.dataset.side}` : this.classList.contains('card-reviews--strip') ? 'strip' : this.classList.contains('card-inbox__panel') ? 'panel' : ''
        // The strip (YAZ-5380: on every card's last side) sits right under the card, as laid out.
        const [top, bottom] = place[key] ?? (key === 'strip' && place.panel !== undefined ? [place.panel[1], place.panel[1] + 36] : [150, 170])
        return box(top, bottom)
      })
    })
    afterEach(() => vi.restoreAllMocks())
    /** The Inbox's own view scrolls (round 2): the card has no scroll bar of its own. */
    // `range`: how far it scrolls (its content less its height); a long card's view scrolls far.
    const scroller = (scrollTop = 0, range = 5000) => {
      const view = el.querySelector<HTMLElement>('.card-inbox')!
      scrollTo = vi.fn()
      view.scrollTo = scrollTo as never
      Object.defineProperty(view, 'clientHeight', { configurable: true, value: 600 })
      Object.defineProperty(view, 'scrollHeight', { configurable: true, value: 600 + range })
      view.scrollTop = scrollTop
      return view
    }
    /** One side, three blanks. */
    const THREE = 'A {{one}} b {{two}} c {{three}}'

    describe('round 6 (Yaseen: "there are certain space clicks that are actually oriented towards just moving the screen"): the word just shown stays still', () => {
      it('the marked blank in view: Space shows it and NOTHING moves, even with the next blank low in the room or below the view', () => {
        mount(THREE)
        scroller()
        place.word0 = [150, 170]
        place.word1 = [320, 340]
        press(' ')
        expect(shown()).toEqual(['one'])
        expect(el.querySelector('[data-next]')?.getAttribute('data-hidden')).toBe('1')
        place.word1 = [200, 220]
        place.word2 = [700, 720]
        press(' ')
        expect(shown()).toEqual(['one', 'two'])
        expect(scrollTo).not.toHaveBeenCalled()
      })

      it('the next blank off screen: that Space only glides it in, a third of the way down, and shows nothing; the next Space shows it, and nothing moves', () => {
        mount(THREE)
        scroller()
        press(' ')
        place.word1 = [700, 720]
        press(' ')
        expect(shown()).toEqual(['one'])
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 700 - 200 }))
        // The glide put it in view: now Space shows it, and the view stays where it is.
        place.word1 = [200, 220]
        place.word2 = [700, 720]
        scrollTo.mockClear()
        press(' ')
        expect(shown()).toEqual(['one', 'two'])
        expect(scrollTo).not.toHaveBeenCalled()
      })

      it('a blank cut by the buttons` edge, or by the top row`s, is not in view: Space only moves it (above the view: the least scroll, a small gap kept)', () => {
        mount(THREE)
        scroller()
        place.word0 = [390, 410]
        press(' ')
        expect(shown()).toEqual([])
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 390 - 200 }))
        mount(THREE)
        scroller(300)
        place.word0 = [90, 110]
        press(' ')
        expect(shown()).toEqual([])
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 300 + 90 - 100 - 6 }))
      })

      it('the next side: Space shows it when the card`s end sits in the top two thirds of the room; lower, that Space only brings the end up a third of the way down, and the next shows the side, with no move after', () => {
        mount(TWO_SIDES)
        scroller()
        press(' ')
        expect(shown()).toEqual(['France'])
        place.panel = [110, 700]
        press(' ')
        expect(sides()).toBe(1)
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 700 - 200 }))
        scrollTo.mockClear()
        place.panel = [110, 200]
        place.word1 = [700, 720]
        press(' ')
        expect(sides()).toBe(2)
        expect(shown()).toEqual(['France'])
        expect(scrollTo).not.toHaveBeenCalled()
        // The side's first blank is below the view: the next Space only moves it.
        press(' ')
        expect(shown()).toEqual(['France'])
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 700 - 200 }))
      })

      it('fix "my spacebar on inbox is no longer working": a short card (its end low in the room, nothing to scroll) shows its next side at once; a move the view cannot make in full is cut to what it can', () => {
        mount(TWO_SIDES)
        scroller(0, 0)
        press(' ')
        expect(shown()).toEqual(['France'])
        // A short card ends right where its buttons start: its end is low in the room, and the view cannot move.
        place.panel = [110, 400]
        press(' ')
        expect(sides()).toBe(2)
        expect(scrollTo).not.toHaveBeenCalled()
        press(' ')
        expect(shown()).toEqual(['France', 'Paris'])
        // A view that scrolls 40 px more: the Space glides those 40 px only (not the 200 the rule wants), then shows.
        mount(TWO_SIDES)
        scroller(0, 40)
        press(' ')
        place.panel = [110, 400]
        press(' ')
        expect(sides()).toBe(1)
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 40 }))
      })

      it('THE END: the last word shows and nothing moves; then a Space brings the card`s end in (no ring), and the next one rings the buttons', () => {
        mount(THREE)
        scroller()
        const answers = () => el.querySelector('.card-inbox__answers')!
        press(' ')
        press(' ')
        place.word2 = [200, 220]
        place.panel = [110, 700]
        press(' ')
        expect(blanks()).toBe(0)
        expect(scrollTo).not.toHaveBeenCalled()
        press(' ')
        // The card's end is its strip (YAZ-5380: every card's last side has one), 36 tall under the panel.
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 700 + 36 - 400 + 6 }))
        expect(answers().hasAttribute('data-nudge')).toBe(false)
        scrollTo.mockClear()
        place.panel = [110, 350]
        press(' ')
        expect(scrollTo).not.toHaveBeenCalled()
        expect(answers().getAttribute('data-nudge')).not.toBeNull()
      })

      it('THE END with reviews: the end is the Reviews strip under the card (YAZ-5105)', async () => {
        mount(THREE)
        session = { ...session, card: { ...session.card!, page: { ...session.card!.page!, reviews: [{ at: AT, rating: 'good' }] } } }
        render()
        await flush()
        scroller()
        for (let i = 0; i < 3; i++) press(' ')
        expect(scrollTo).not.toHaveBeenCalled()
        place.panel = [110, 380]
        place.strip = [384, 420]
        press(' ')
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 420 - 400 + 6 }))
      })

      it('after a scroll by hand took the next blank out of view: Space only brings it back', () => {
        mount(THREE)
        const view = scroller()
        press(' ')
        expect(shown()).toEqual(['one'])
        view.scrollTop = 500
        place.word1 = [-200, -180]
        press(' ')
        expect(shown()).toEqual(['one'])
        expect(scrollTo).toHaveBeenCalledOnce()
      })

      it('a new card starts at its top, with no glide', () => {
        mount(TWO_SIDES)
        const view = scroller(500)
        session = { ...sessionOf(TWO_SIDES), card: { ...sessionOf(TWO_SIDES).card!, id: 'WIKI-10' } }
        render()
        expect(scrollTo).not.toHaveBeenCalled()
        expect(view.scrollTop).toBe(0)
      })
    })

    describe('round 4 (Yaseen: "mouse behavior and spacebar behavior is a little bit different"): a click shows THAT word and the view stays put; round 6: a click on a shown word hides it again', () => {
      const word = (n: number) => el.querySelector<HTMLElement>(`[data-hidden="${n}"]`)!
      const click = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
      const nextMark = () => el.querySelector('[data-next]')?.getAttribute('data-hidden') ?? null
      const hints = () => [...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)

      it('a click on a hidden word shows that word — not the marked one — and nothing scrolls, even with the next blank below the view', () => {
        mount(THREE)
        scroller()
        place.word1 = [320, 340]
        place.word2 = [700, 720]
        click(word(1))
        expect(shown()).toEqual(['two'])
        expect(scrollTo).not.toHaveBeenCalled()
        // The mark goes to the next blank still hidden AFTER the clicked word, in reading order.
        expect(nextMark()).toBe('2')
      })

      it('nothing hidden after the clicked word: the mark goes to the first hidden word before it; the next Space shows the marked word', () => {
        mount(THREE)
        scroller()
        click(word(2))
        expect(shown()).toEqual(['three'])
        expect(nextMark()).toBe('0')
        press(' ')
        expect(shown()).toEqual(['one', 'three'])
        expect(nextMark()).toBe('1')
        expect(scrollTo).not.toHaveBeenCalled()
      })

      it('a click elsewhere on the card shows the marked word, and the view stays put too', () => {
        mount(THREE)
        scroller()
        click(word(1))
        place.word0 = [700, 720]
        click(el.querySelector('.card__side')!)
        expect(shown()).toEqual(['two', 'three'])
        expect(scrollTo).not.toHaveBeenCalled()
        expect(nextMark()).toBe('0')
      })

      it('round 6 (Yaseen: "click on a hidden word in order to be able to hide it again"): a click on a shown word hides it; it becomes the marked blank, and the next Space shows it again; nothing scrolls', () => {
        mount(THREE)
        scroller()
        press(' ')
        press(' ')
        expect(shown()).toEqual(['one', 'two'])
        expect(nextMark()).toBe('2')
        click(word(0))
        expect(shown()).toEqual(['two'])
        expect(blanks()).toBe(2)
        expect(nextMark()).toBe('0')
        expect(scrollTo).not.toHaveBeenCalled()
        press(' ')
        expect(shown()).toEqual(['one', 'two'])
        expect(nextMark()).toBe('2')
      })

      it('round 6: the steps follow a hide — a fully shown card is not done any more (Space is back in the hint row); the click shows it again', () => {
        mount(THREE)
        scroller()
        for (const n of [2, 0, 1]) click(word(n))
        expect(blanks()).toBe(0)
        expect(hints()).not.toContain('Show (Space)')
        click(word(1))
        expect(shown()).toEqual(['one', 'three'])
        expect(hints()[0]).toBe('Show (Space)')
        click(word(1))
        expect(blanks()).toBe(0)
        expect(hints()).not.toContain('Show (Space)')
        expect(scrollTo).not.toHaveBeenCalled()
      })

      it('round 6: a shown word on an earlier side hides again too; the next side stays shown', () => {
        mount(TWO_SIDES)
        scroller()
        press(' ')
        press(' ')
        expect(sides()).toBe(2)
        click(word(0))
        expect(sides()).toBe(2)
        expect(shown()).toEqual([])
        expect(nextMark()).toBe('0')
      })

      it('on two sides: clicks on the front`s words, then Space shows the next side as before', () => {
        mount(TWO_SIDES)
        scroller()
        click(word(0))
        expect(sides()).toBe(1)
        press(' ')
        expect(sides()).toBe(2)
        expect(nextMark()).toBe('1')
      })
    })

    it('THE END: the hint row drops Space; one more Space moves nothing and gives the answer buttons one soft nudge, each time', () => {
      mount(THREE)
      scroller()
      const answers = () => el.querySelector('.card-inbox__answers')!
      const hints = () => [...el.querySelectorAll('.card-inbox__hints > span')].map((h) => h.textContent)
      press(' ')
      press(' ')
      expect(hints()[0]).toBe('Show (Space)')
      press(' ')
      expect(hints()).not.toContain('Show (Space)')
      expect(answers().hasAttribute('data-nudge')).toBe(false)
      scrollTo.mockClear()
      press(' ')
      expect(scrollTo).not.toHaveBeenCalled()
      const first = answers().getAttribute('data-nudge')
      expect(first).not.toBeNull()
      press(' ')
      // A new value each time, so the nudge plays again.
      expect(answers().getAttribute('data-nudge')).not.toBe(first)
      // The next card: no nudge.
      session = { ...sessionOf(THREE), card: { ...sessionOf(THREE).card!, id: 'WIKI-10' } }
      render()
      expect(answers().hasAttribute('data-nudge')).toBe(false)
    })
  })
})

describe('YAZ-5322: where new cards come from — the New cards row, the picker, the chip and the done screen', () => {
  const rows = () => [...document.querySelectorAll<HTMLElement>('.card-inbox__filter-row')]
  const picker = () => document.querySelector<HTMLElement>('.card-inbox__picker')
  const pickerRows = () => [...picker()!.querySelectorAll<HTMLLabelElement>('.card-inbox__picker-row')]
  const textOf = (node: Node): string => (node instanceof HTMLInputElement ? `[${node.value}]` : node.childNodes.length === 0 ? (node.textContent ?? '') : [...node.childNodes].map(textOf).join(''))
  const doneText = () => [...el.querySelectorAll('.card-inbox__done > :not(.done-cheer__party)')].map(textOf)
  const WAITING = { counts: { all: 22, next: 2, due: 10, new: 10 }, more: { new: 14, next: 3 }, adds: { new: 10, next: 2 }, limited: { new: true, next: true } }
  const SPANISH = [{ folder: 'spanish', label: 'Spanish' }]
  const cog = () => document.querySelector<HTMLButtonElement>('.card-inbox__menu-foot .card-inbox__cog')
  const part = () => document.querySelector<HTMLElement>('.card-inbox__filter-menu .card-inbox-settings')
  /** YAZ-5685: the ⚙ by the Today line opens the settings part; the open menu's part. */
  const openSettings = () => {
    act(() => cog()!.click())
    return part()!
  }

  it('the row reads "New cards  10", its line under it "All folders", grey; a click on the line opens the picker beside the menu, not the filter', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    expect(rows()[3].textContent).toBe('New cards10')
    const from = openSettings().querySelector<HTMLElement>('.card-inbox__new-from')!
    expect(from.textContent).toBe('All folders')
    expect(from.hasAttribute('data-on')).toBe(false)
    // No chip with All folders.
    expect(el.querySelector('.card-inbox__pick-chip')).toBeNull()
    act(() => from.click())
    expect(review.setFilter).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(4)
    // All folders, then each folder with its new cards, a subfolder under its parent.
    expect(pickerRows().map((r) => r.textContent)).toEqual(['All folders38', 'Spanish24', 'Verbs4', 'Geography12'])
    expect(pickerRows()[0].querySelector('input')!.checked).toBe(true)
    // A tick saves at once.
    act(() => pickerRows()[1].querySelector('input')!.click())
    expect(review.setNewFrom).toHaveBeenLastCalledWith(['spanish'])
  })

  it('a folder picked: the row names it, the chip "New cards: Spanish ×" shows and × clears it; a tick takes the subfolders', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING, newFrom: SPANISH }
    render()
    expect(el.querySelector('.card-inbox__pick-chip')?.textContent).toBe('New cards: Spanish×')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    // YAZ-5685: the row says the pick quietly, "New cards · Spanish".
    expect(rows()[3].textContent).toBe('New cards· Spanish10')
    const from = openSettings().querySelector<HTMLElement>('.card-inbox__new-from')!
    expect(from.hasAttribute('data-on')).toBe(true)
    act(() => from.click())
    const boxes = pickerRows().map((r) => r.querySelector('input')!)
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[false, false], [true, false], [true, true], [false, false]])
    expect(picker()!.textContent).toContain('Stays until you clear it.')
    // Geography too; then Spanish off.
    act(() => boxes[3].click())
    expect(review.setNewFrom).toHaveBeenLastCalledWith(['spanish', 'geo'])
    act(() => boxes[1].click())
    expect(review.setNewFrom).toHaveBeenLastCalledWith([])
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__pick-chip-x')!.click())
    expect(review.setNewFrom).toHaveBeenLastCalledWith([])
  })

  it('the done screen: "Add [10] new cards from [Spanish ▾]" names the pick; ▾ opens the same picker; Up next picks no folders', () => {
    mount(null)
    session = { ...session, ...WAITING, card: null, counts: { all: 0, next: 0, due: 0, new: 0 }, newFrom: SPANISH }
    render()
    expect(doneText().slice(0, 3)).toEqual(['Inbox complete.', '14 new Spanish cards and 3 Up next cards wait for another day.', 'Add[10]new cardsfrom SpanishAdd[2]Up next'])
    const from = el.querySelector<HTMLButtonElement>('.card-inbox__done-from')!
    act(() => from.click())
    expect(pickerRows().map((r) => r.textContent)).toEqual(['All folders38', 'Spanish24', 'Verbs4', 'Geography12'])
    act(() => pickerRows()[0].querySelector('input')!.click())
    expect(review.setNewFrom).toHaveBeenLastCalledWith([])
    expect(el.querySelectorAll('.card-inbox__done-add')[1].querySelector('.card-inbox__done-from')).toBeNull()
  })

  it('the fallback: no new Spanish cards left — a plain line says so, the button reads "from All folders", the chip keeps the pick', () => {
    mount(null)
    session = { ...session, ...WAITING, card: null, counts: { all: 0, next: 0, due: 0, new: 0 }, more: { new: 14, next: 0 }, adds: { new: 10, next: 0 }, newFrom: SPANISH, newFallback: true }
    render()
    expect(doneText().slice(0, 4)).toEqual(['Inbox complete.', 'No new cards left in Spanish, so these come from All folders.', '14 new cards wait for another day.', 'Add[10]new cardsfrom All folders'])
    expect(el.querySelector('.card-inbox__pick-chip')?.textContent).toBe('New cards: Spanish×')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__done-from')!.click())
    expect(picker()!.textContent).toContain('Spanish stays picked. Its new cards come first again once you make some.')
  })

  /**
   * YAZ-5685 (Yaseen: "how do i make it so that new cards is just even and smooth… a small cog icon and that would then
   * expand the bottom part"): three even rows, no line under New cards; the Today line ends with a ⚙ that opens the
   * New cards settings under it ("From" and the same folder picker); a click again, or closing the menu, folds it.
   */
  it('YAZ-5685: three even rows (glyph, name, count; no line under New cards); the Today line ends with a quiet ⚙, folded', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING, today: { cards: 41, seconds: 0 } }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    const items = [...document.querySelectorAll<HTMLButtonElement>('.card-inbox__filter-item')]
    expect(items.map((b) => [b.children.length, b.lastElementChild!.className, b.lastElementChild!.textContent])).toEqual([
      [2, 'card-inbox__count', '22'],
      [2, 'card-inbox__count', '2 / 5'],
      [2, 'card-inbox__count', '10'],
      [2, 'card-inbox__count', '10'],
    ])
    // Each row is its button alone: no second line, no group.
    expect(rows().map((r) => r.children.length)).toEqual([1, 1, 1, 1])
    expect(document.querySelector('.card-inbox__filter-menu .card-inbox__new-from')).toBeNull()
    // The foot: the Today line, then the ⚙ at its right; the last thing in the menu while folded.
    const foot = document.querySelector('.card-inbox__menu-foot')!
    expect(foot.parentElement!.lastElementChild).toBe(foot)
    expect([...foot.children].map((c) => c.className)).toEqual(['card-inbox__menu-today', 'card-inbox__cog'])
    expect(foot.querySelector('.card-inbox__menu-today')!.textContent).toBe('Today: 41 cards')
    expect([cog()!.tagName, cog()!.type, cog()!.getAttribute('aria-label'), cog()!.getAttribute('aria-expanded'), cog()!.tabIndex]).toEqual(['BUTTON', 'button', 'Review settings', 'false', 0])
    expect(cog()!.querySelector('svg')).not.toBeNull()
    expect(part()).toBeNull()
  })

  it('YAZ-5685: ⚙ opens the part under the Today line — "New cards", a list with "From" and the folder picker (opens beside, not the filter); ⚙ again folds it', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING, newFrom: SPANISH }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    const settings = openSettings()
    expect(cog()!.getAttribute('aria-expanded')).toBe('true')
    expect(cog()!.getAttribute('aria-controls')).toBe(settings.id)
    // Under the Today line, the menu's last part.
    expect(settings.previousElementSibling!.className).toBe('card-inbox__menu-foot')
    expect(settings.parentElement!.lastElementChild).toBe(settings)
    expect(settings.querySelector('h6')!.textContent).toBe('New cards')
    const list = settings.querySelector('ul')!
    expect([...list.children].map((li) => [li.tagName, li.getAttribute('data-setting'), li.firstElementChild!.textContent])).toEqual([['LI', 'from', 'From'], ['LI', 'add', 'Add today']])
    // The same control as before: a folder glyph, the pick, a small ▾; a button, so Tab reaches it.
    const from = list.querySelector<HTMLButtonElement>('.card-inbox__new-from')!
    expect([...from.children].map((c) => c.tagName.toLowerCase())).toEqual(['svg', 'span', 'svg'])
    expect([from.tagName, from.getAttribute('aria-haspopup'), from.textContent, from.title]).toEqual(['BUTTON', 'dialog', 'Spanish', 'New cards come from Spanish'])
    act(() => from.click())
    expect(review.setFilter).not.toHaveBeenCalled()
    expect(pickerRows().map((r) => r.textContent)).toEqual(['All folders38', 'Spanish24', 'Verbs4', 'Geography12'])
    act(() => cog()!.click())
    expect([part(), cog()!.getAttribute('aria-expanded')]).toEqual([null, 'false'])
    // The rows are still the filter.
    act(() => [...document.querySelectorAll<HTMLElement>('.card-inbox__filter-item')][3]!.click())
    expect(review.setFilter).toHaveBeenCalledExactlyOnceWith('new')
  })

  it('YAZ-5707: the ⚙ part ends with "All cards" · Order Due first · Shuffle and "Due today" · Order In order · Shuffle, one picked in each; a click saves that row alone, the menu stays open', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    const settings = openSettings()
    const sections = [...settings.querySelectorAll('section')].slice(-2)
    const rows = () =>
      [...part()!.querySelectorAll('section')].slice(-2).map((g) => [
        g.querySelector('h6')!.textContent,
        g.querySelector('li[data-setting="order"]')!.firstElementChild!.textContent,
        g.querySelector('[role="radiogroup"]')!.getAttribute('aria-label'),
        [...g.querySelectorAll('button[role="radio"]')].map((c) => `${c.textContent}${c.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`),
      ])
    expect(rows()).toEqual([
      ['All cards', 'Order', 'Order of All cards', ['Due first ✓', 'Shuffle']],
      ['Due today', 'Order', 'Order of Due today', ['In order', 'Shuffle ✓']],
    ])
    act(() => sections[0].querySelectorAll<HTMLButtonElement>('button[role="radio"]')[1].click())
    expect(review.setOrder).toHaveBeenLastCalledWith({ all: 'shuffle' })
    act(() => sections[1].querySelectorAll<HTMLButtonElement>('button[role="radio"]')[0].click())
    expect(review.setOrder).toHaveBeenLastCalledWith({ due: 'in-order' })
    expect(part()).not.toBeNull()
    session = { ...session, order: { all: 'shuffle', due: 'in-order' } }
    render()
    expect(rows().map((r) => r[3])).toEqual([['Due first', 'Shuffle ✓'], ['In order ✓', 'Shuffle']])
  })

  it('YAZ-5690: the ⚙ part`s "Add today" — a number field at the Settings number and "Add" — adds that many new cards for today; Enter too; the menu stays open; nothing more to add: a quiet "No more new cards in …"', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    openSettings()
    const row = () => part()!.querySelector<HTMLElement>('li[data-setting="add"]')!
    const number = () => row().querySelector<HTMLInputElement>('input.card-inbox__add-number')!
    const add = () => row().querySelector<HTMLButtonElement>('button.card-inbox__add-go')!
    expect([number().value, number().getAttribute('aria-label'), add().textContent]).toEqual(['10', 'How many new cards to add', 'Add'])
    // Not focused on its own: the menu keeps the keyboard where it was.
    expect(document.activeElement).not.toBe(number())
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(number(), '12')
      number().dispatchEvent(new Event('input', { bubbles: true }))
    })
    // YAZ-5690 round 3 (Yaseen: "too easy to click"): one click never adds; it asks in place, Cancel first and focused.
    act(() => add().click())
    expect(review.addCards).not.toHaveBeenCalled()
    const ask = () => row().querySelector<HTMLElement>('.ask-in-place')
    expect([ask()!.querySelector('.confirm__text')!.textContent, [...ask()!.querySelectorAll('button')].map((b) => b.textContent)]).toEqual(['Add 12 new cards to today?', ['Cancel', 'Add']])
    expect(document.activeElement?.textContent).toBe('Cancel')
    // Cancel: back to the field, nothing added.
    act(() => ask()!.querySelector<HTMLButtonElement>('button')!.click())
    expect([ask(), vi.mocked(review.addCards).mock.calls.length]).toEqual([null, 0])
    // Esc cancels the ask alone: the menu stays open.
    act(() => add().click())
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect([ask(), document.querySelector('.card-inbox__filter-menu') !== null, vi.mocked(review.addCards).mock.calls.length]).toEqual([null, true, 0])
    // A click elsewhere (the focus leaves it) cancels.
    act(() => add().click())
    act(() => (document.activeElement as HTMLElement).blur())
    expect([ask(), vi.mocked(review.addCards).mock.calls.length]).toEqual([null, 0])
    // Two clicks add.
    act(() => add().click())
    act(() => ask()!.querySelectorAll<HTMLButtonElement>('button')[1]!.click())
    expect(review.addCards).toHaveBeenCalledExactlyOnceWith('new', 12)
    expect(document.querySelector('.card-inbox__filter-menu')).not.toBeNull()
    // Enter in the field asks too; it never adds on its own.
    act(() => void number().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect([ask() !== null, vi.mocked(review.addCards).mock.calls.length]).toEqual([true, 1])
    act(() => ask()!.querySelectorAll<HTMLButtonElement>('button')[1]!.click())
    expect(review.addCards).toHaveBeenLastCalledWith('new', 12)
    expect(review.setFilter).not.toHaveBeenCalled()
    // No more new cards to add (Yaseen): the row stays, a quiet line in place of the field, as From says.
    session = { ...session, more: { new: 0, next: 3 }, adds: { new: 0, next: 2 } }
    render()
    expect([row().querySelector('input'), row().querySelector('button'), row().querySelector('.card-inbox__add-none')?.textContent]).toEqual([null, null, 'No more new cards in any folder'])
    session = { ...session, newFrom: SPANISH }
    render()
    expect(row().querySelector('.card-inbox__add-none')?.textContent).toBe('No more new cards in Spanish')
  })

  it('YAZ-5690 round 2: the ⚙ part`s second group "Up next" — "Add today [2] Add" adds that many Up next cards; only while Up next cards wait beyond today`s limit', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    openSettings()
    expect([...part()!.querySelectorAll('section')].map((g) => [g.querySelector('h6')!.textContent, [...g.querySelectorAll('li')].map((li) => li.getAttribute('data-setting'))])).toEqual([
      ['New cards', ['from', 'add']],
      ['Up next', ['add']],
      ['All cards', ['order']],
      ['Due today', ['order']],
    ])
    const upNext = () => part()!.querySelectorAll('section')[1]!
    const number = upNext().querySelector<HTMLInputElement>('input.card-inbox__add-number')!
    expect([upNext().querySelector('li')!.firstElementChild!.textContent, number.value, number.getAttribute('aria-label')]).toEqual(['Add today', '2', 'How many Up next cards to add'])
    act(() => upNext().querySelector<HTMLButtonElement>('button.card-inbox__add-go')!.click())
    expect(review.addCards).not.toHaveBeenCalled()
    expect(upNext().querySelector('.ask-in-place .confirm__text')!.textContent).toBe('Add 2 Up next cards to today?')
    act(() => upNext().querySelectorAll<HTMLButtonElement>('.ask-in-place button')[1]!.click())
    expect(review.addCards).toHaveBeenCalledExactlyOnceWith('next', 2)
    // No Up next card waiting beyond today's limit: no Up next group at all.
    session = { ...session, more: { new: 38, next: 0 }, adds: { new: 10, next: 0 } }
    render()
    expect([...part()!.querySelectorAll('h6')].map((h) => h.textContent)).toEqual(['New cards', 'All cards', 'Due today'])
  })

  it('YAZ-5685: closing the menu folds the part — a click on the filter, Esc — so it opens folded each time; with nothing done today the ⚙ stays', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING, today: { cards: 0, seconds: 0 } }
    render()
    const filter = () => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!
    act(() => filter().click())
    // No Today words: the foot is the ⚙ alone.
    expect(document.querySelector('.card-inbox__menu-today')).toBeNull()
    openSettings()
    act(() => filter().click())
    expect(document.querySelector('.card-inbox__filter-menu')).toBeNull()
    act(() => filter().click())
    expect([part(), cog()!.getAttribute('aria-expanded')]).toEqual([null, 'false'])
    openSettings()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('.card-inbox__filter-menu')).toBeNull()
    act(() => filter().click())
    expect(part()).toBeNull()
  })

  it('YAZ-5685: the New cards row says the pick quietly ("New cards · Spanish"), never All folders or the fallback', () => {
    mount(TWO_SIDES)
    session = { ...session, ...WAITING, newFrom: SPANISH }
    render()
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__filter')!.click())
    const rowPick = () => rows()[3].querySelector('.card-inbox__filter-pick')
    expect([rowPick()?.textContent, rows()[3].querySelector('.card-inbox__count')!.textContent]).toEqual(['· Spanish', '10'])
    session = { ...session, newFrom: [] }
    render()
    expect(rowPick()).toBeNull()
    session = { ...session, newFrom: SPANISH, newFallback: true }
    render()
    expect(rowPick()).toBeNull()
  })
})

describe('the Inbox zoom (YAZ-5372)', () => {
  const zoomKey = (step: -1 | 0 | 1, target: EventTarget = el.querySelector('.card-inbox')!) => {
    const event = new CustomEvent(ZOOM_EVENT, { detail: step, bubbles: true, cancelable: true })
    act(() => void target.dispatchEvent(event))
    return event.defaultPrevented
  }
  const level = () => el.querySelector<HTMLElement>('.card-inbox')!.style.getPropertyValue('--document-zoom')
  beforeEach(() => localStorage.removeItem('inbox:zoom'))

  it('⌘+ / ⌘− / ⌘0 while the Inbox shows are its own — from the Inbox, the body, the tab row — never the sidebar\'s; a key in the sidebar or a claimed one is left alone', () => {
    mount(TWO_SIDES)
    expect(zoomKey(1)).toBe(true)
    expect(level()).toBe('1.25')
    expect(zoomKey(-1, document.body)).toBe(true)
    expect(level()).toBe('1')
    expect(zoomKey(1, document.body)).toBe(true)
    expect(zoomKey(0)).toBe(true)
    expect([level(), localStorage.getItem('inbox:zoom')]).toEqual(['1', null])
    const sidebar = document.createElement('aside')
    sidebar.className = 'sidebar'
    document.body.appendChild(sidebar)
    expect(zoomKey(1, sidebar)).toBe(false)
    sidebar.remove()
    // Explore's stack (or a page) claimed it first: not the Inbox's.
    const claim = (e: Event) => e.preventDefault()
    document.addEventListener(ZOOM_EVENT, claim, true)
    zoomKey(1)
    document.removeEventListener(ZOOM_EVENT, claim, true)
    expect(level()).toBe('1')
    // Behind a page tab, the Inbox takes no zoom key.
    act(() => root?.render(<CardInbox {...props} review={review} session={session} shown={false} />))
    expect(zoomKey(1, document.body)).toBe(false)
  })

  it('YAZ-5372 Decision: the zoom scales the whole card as a page\'s does — the card\'s width grows with it (capped by the window), and a drag of its edge at 125% sets the width at 100%', () => {
    localStorage.setItem('inbox:zoom', '125')
    setInboxCardWidth(null)
    mount(TWO_SIDES)
    expect(level()).toBe('1.25')
    const column = el.querySelector<HTMLElement>('.card-inbox__column')!
    const inbox = el.querySelector<HTMLElement>('.card-inbox')!
    Object.defineProperty(inbox, 'clientWidth', { configurable: true, value: 1032 }) // 1000 px of room on screen: 800 at 100%
    column.getBoundingClientRect = () => ({ width: 800 }) as DOMRect // 640 at 100%
    const drag = (side: 'left' | 'right', from: number, to: number) => {
      const edge = el.querySelector<HTMLElement>(`.card-inbox__edge[data-side="${side}"]`)!
      act(() => void edge.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: from, button: 0 })))
      act(() => void window.dispatchEvent(new MouseEvent('pointermove', { clientX: to })))
      act(() => void window.dispatchEvent(new MouseEvent('pointerup', { clientX: to })))
    }
    drag('right', 900, 950) // 100 px wider on screen: 80 at 100%
    expect(inboxCardWidth()).toBe(720)
    expect(column.style.width).toBe('min(calc(720px * var(--document-zoom, 1)), 100%)')
    drag('left', 300, 0) // far out: the room, at 100%
    expect(inboxCardWidth()).toBe(800)
    setInboxCardWidth(null)
  })
})

