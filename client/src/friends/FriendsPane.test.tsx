/**
 * Desktop Friends UI tests (YAZ-6220):
 * - Friends icon placement in CardInboxBar (between SessionCount and View) + in-place toggle in CardInbox
 * - Cards-hero + 🔥 streak + 7-day chain + time + Cards | Time | Streak sort
 * - Study Buddy Emojis with tooltips
 * - AcceptCardSheet (existing vault folder pick vs 1-click "Put in Shared Cards" + Up next)
 * - Reversible Dismiss / Undo + Group Shared Cards & 1-shot Import folder (N)
 * - Signed-out state with one-click Sign in with GitHub button
 * - Quiet toast on unseen incoming Cheer/Nudge + You vs Friend shared-card count
 * - DoneScreen 1-line Friends summary (hidden when 0 friends)
 * - Card menu `Share with friend or group…` door
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FriendsBoardPayload } from '@shared/friendsApi'
import type { FriendDay, FriendStats } from '@shared/friendStatsFormat'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { api } from '../api'
import { FriendsPane } from './FriendsPane'
import { AcceptCardSheet, LAST_IMPORT_DIR_KEY } from './AcceptCardSheet'
import { CardInboxBar } from '../review/CardInboxBar'
import { CardInbox, type CardInboxProps } from '../review/CardInbox'
import { DoneScreen, type DoneLook } from '../review/DoneScreen'
import { cardMenuSections } from '../review/cardMenuView'
import { FriendsSendControl, FRIENDS_INBOX_VISIBLE_KEY } from '../settings/FriendsSendControl'
import type { CardReviewApi, CardReviewSession } from '../review/useCardReview'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))

const friendsMock = vi.hoisted(() => ({
  status: vi.fn(),
  board: vi.fn(),
  updatePrefs: vi.fn(),
  createInvite: vi.fn(),
  acceptInvite: vi.fn(),
  removeFriend: vi.fn(),
  sendMark: vi.fn(),
  markSeen: vi.fn(),
  createGroup: vi.fn(),
  approveMember: vi.fn(),
  removeMember: vi.fn(),
  rotateGroupInvite: vi.fn(),
  shareCards: vi.fn(),
  setCardState: vi.fn(),
  setFolderState: vi.fn(),
  deleteSharedCard: vi.fn(),
  importCards: vi.fn(),
  deleteMe: vi.fn(),
  onInviteLink: vi.fn(() => () => undefined),
}))

const githubMock = vi.hoisted(() => ({
  signIn: vi.fn(),
}))

const treeMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  api: {
    friends: friendsMock,
    github: githubMock,
    tree: treeMock,
    shell: { openLink: vi.fn() },
    vaultConfig: {
      read: vi.fn(async () => {
        throw new Error('ENOENT')
      }),
      onChange: () => () => undefined,
    },
  },
}))

const pad = (n: number) => String(n).padStart(2, '0')
function dayOffset(delta: number): string {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function makeDay(day: string, cards: number, seconds: number, done: boolean): FriendDay {
  return { day, cards, seconds, remembered: cards, forgot: 0, newCards: 0, done }
}

function makeStats(login: string, name: string, days: FriendDay[], streak: number): FriendStats {
  const totalCards = days.reduce((s, d) => s + d.cards, 0)
  return {
    v: 1,
    login,
    name,
    avatar: '',
    days,
    totals: { cards: totalCards, inReview: totalCards, newLeft: 0, mature: 0, dueLeft: 0, addedThisWeek: 0, streak, bestStreak: streak, bestDay: days[0]?.cards ?? 0, bestWeek: totalCards },
    at: new Date().toISOString(),
  }
}

function makeBoard(overrides?: Partial<FriendsBoardPayload>): FriendsBoardPayload {
  const today = dayOffset(0)
  const yest = dayOffset(-1)
  return {
    me: {
      id: 1,
      login: 'yaseen',
      name: 'Yaseen',
      nickname: null,
      avatarUrl: null,
      zone: 'America/Denver',
      vaults: ['main'],
      stats: makeStats('yaseen', 'Yaseen', [makeDay(today, 20, 600, true), makeDay(yest, 15, 420, true)], 5),
      statsAt: new Date().toISOString(),
    },
    friends: [
      {
        id: 2,
        login: 'ali',
        name: 'Ali',
        avatarUrl: null,
        since: '2026-01-01T00:00:00Z',
        stats: makeStats('ali', 'Ali', [makeDay(today, 42, 900, true), makeDay(yest, 30, 700, true)], 6),
        statsAt: new Date().toISOString(),
        incomingMark: { kind: 'cheer', message: 'cheered your 5-day streak! 🔥', at: new Date().toISOString(), seenAt: null },
        outgoingMark: null,
        sharedCardCount: 7,
      },
      {
        id: 3,
        login: 'sara',
        name: 'Sara',
        avatarUrl: null,
        since: '2026-02-01T00:00:00Z',
        stats: makeStats('sara', 'Sara', [makeDay(today, 18, 2400, true), makeDay(yest, 10, 600, true)], 14),
        statsAt: new Date().toISOString(),
        incomingMark: null,
        outgoingMark: null,
        sharedCardCount: 2,
      },
    ],
    invites: [],
    groups: [
      {
        id: 'grp-1',
        name: 'Spanish 101',
        adminId: 1,
        isAdmin: true,
        myStatus: 'active',
        inviteCode: 'span1234',
        members: [
          {
            id: 1,
            login: 'yaseen',
            name: 'Yaseen',
            avatarUrl: null,
            since: '2026-01-01T00:00:00Z',
            stats: makeStats('yaseen', 'Yaseen', [makeDay(today, 20, 600, true)], 5),
            statsAt: new Date().toISOString(),
          },
          {
            id: 2,
            login: 'ali',
            name: 'Ali',
            avatarUrl: null,
            since: '2026-01-01T00:00:00Z',
            stats: makeStats('ali', 'Ali', [makeDay(today, 42, 900, true)], 6),
            statsAt: new Date().toISOString(),
          },
        ],
        pending: [{ id: 9, login: 'omar', name: 'Omar', avatarUrl: null }],
        sharedFolders: [
          {
            id: 'fld-1',
            name: 'Verbs Pack',
            senderId: 2,
            senderLogin: 'ali',
            createdAt: new Date().toISOString(),
            cards: [
              {
                id: 'fc-1',
                folderId: 'fld-1',
                senderId: 2,
                senderLogin: 'ali',
                title: 'Ser vs Estar',
                markdown: 'Ser is permanent\n---\nEstar is temporary',
                note: 'Must know',
                attachments: [],
                status: 'pending',
                createdAt: new Date().toISOString(),
              },
              {
                id: 'fc-2',
                folderId: 'fld-1',
                senderId: 2,
                senderLogin: 'ali',
                title: 'Por vs Para',
                markdown: 'Por = reason\n---\nPara = destination',
                note: null,
                attachments: [],
                status: 'pending',
                createdAt: new Date().toISOString(),
              },
            ],
          },
        ],
        sharedCards: [
          {
            id: 'gc-dismissed',
            folderId: null,
            senderId: 2,
            senderLogin: 'ali',
            title: 'Old Grammar Tip',
            markdown: 'Front\n---\nBack',
            note: null,
            attachments: [],
            status: 'dismissed',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    ],
    incomingCards: [
      {
        id: 'ic-1',
        folderId: null,
        senderId: 2,
        senderLogin: 'ali',
        title: 'Hola greeting',
        markdown: 'Hola\n---\nHello',
        note: 'Try this card',
        attachments: [],
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  }
}

function makeSession(withCard = true): CardReviewSession {
  return {
    label: 'Inbox',
    scope: 'vault',
    card: withCard
      ? {
          path: '/vault/cards.md',
          id: 'C-1',
          index: 0,
          due: 0,
          state: 'due',
          page: {
            id: 'C-1',
            title: 'Capital of France',
            text: 'Capital of {{France}}\n---\n{{Paris}}',
            off: false,
            next: false,
            fix: false,
            notitle: false,
            reviews: [],
          },
        }
      : null,
    canBack: false,
    canNext: false,
    answers: null,
    canUndo: false,
    filter: 'all',
    counts: { all: withCard ? 1 : 0, next: 0, due: withCard ? 1 : 0, new: 0 },
    from: ['Vault'],
    place: [],
    answered: [],
    progress: { done: 4, total: 16 },
    misses: 0,
    today: { cards: 4, seconds: 120 },
    adds: { new: 0, next: 0 },
    more: { new: 0, next: 0 },
    canReset: { new: false, next: false },
    newFrom: [],
    newFallback: false,
    order: 'default',
    end: null,
    landing: 1,
    learned: null,
    lastAdd: null,
    lastArchive: null,
  } as unknown as CardReviewSession
}

function makeReviewApi(session: CardReviewSession): CardReviewApi {
  return {
    dueCount: 0,
    settings: DEFAULT_REVIEW_SETTINGS,
    session,
    start: vi.fn(),
    showAnswers: vi.fn(() => null),
    answer: vi.fn(async () => true),
    undo: vi.fn(async () => undefined),
    close: vi.fn(),
    deleteReview: vi.fn(async () => undefined),
    setNext: vi.fn(async () => undefined),
    setMark: vi.fn(async () => undefined),
    turnOff: vi.fn(async () => undefined),
    move: vi.fn(),
    setFilter: vi.fn(),
    goOn: vi.fn(),
    addCards: vi.fn(),
    resetCards: vi.fn(),
    setNewFrom: vi.fn(),
    newCardFolders: vi.fn(() => ({ all: 0, folders: [] })),
    setOrder: vi.fn(),
  } as unknown as CardReviewApi
}

let root: Root | null = null
let el: HTMLElement

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  friendsMock.markSeen.mockResolvedValue({ ok: true })
  friendsMock.sendMark.mockResolvedValue({ ok: true })
  friendsMock.setCardState.mockResolvedValue({ ok: true })
  friendsMock.setFolderState.mockResolvedValue({ ok: true })
  friendsMock.importCards.mockResolvedValue({ ok: true, paths: ['/vault/Spanish/hola.md'] })
  friendsMock.createInvite.mockResolvedValue({ ok: true, code: 'abc12345', link: 'https://docs.yaseenarshad.com/friend#abc12345', expiresAt: '2026-12-01T00:00:00Z' })
  friendsMock.acceptInvite.mockResolvedValue({ ok: true, result: { kind: 'friend', friendId: 4 } })
  treeMock.mockResolvedValue({
    root: '/vault',
    generatedAt: Date.now(),
    tree: [
      { type: 'dir', name: 'Spanish', path: '/vault/Spanish', children: [] },
      { type: 'dir', name: 'History', path: '/vault/History', children: [] },
    ],
  })
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

async function flush(n = 4) {
  for (let i = 0; i < n; i++) await act(async () => await Promise.resolve())
}

describe('Desktop Friends UI (YAZ-6220)', () => {
  it('places Friends icon directly between SessionCount and View in CardInboxBar', () => {
    const session = makeSession(true)
    act(() => {
      root!.render(
        <CardInboxBar
          session={session}
          setFilter={vi.fn()}
          friendsButton={<button type="button" className="card-inbox__friends-btn" aria-label="Friends" />}
          view={<button type="button" className="card-inbox__view" aria-label="View" />}
        />,
      )
    })
    const bar = el.querySelector('.card-inbox__bar')!
    const place = bar.querySelector('.card-inbox__place')!
    const friendsBtn = bar.querySelector('.card-inbox__friends-btn')!
    const viewBtn = bar.querySelector('.card-inbox__view')!
    expect(place.nextElementSibling).toBe(friendsBtn)
    expect(friendsBtn.nextElementSibling).toBe(viewBtn)
  })

  it('toggles FriendsPane in place inside CardInbox while pausing the review card, and returns to it on Back to Review', async () => {
    friendsMock.board.mockResolvedValue({ ok: true, board: makeBoard() })
    const session = makeSession(true)
    const review = makeReviewApi(session)
    const props: CardInboxProps = {
      shown: true,
      review,
      session,
      vaultOf: () => ({
        root: '/vault',
        wikilinks: { records: [], resolve: () => null, subscribe: () => () => undefined } as never,
        wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never,
      }),
      openPage: vi.fn(),
      editCard: vi.fn(),
      openInTab: vi.fn(),
      openLinkIn: vi.fn(),
      openLayer: vi.fn(),
      onNotice: vi.fn(),
    }

    act(() => root!.render(<CardInbox {...props} />))
    await flush()

    const friendsBtn = el.querySelector<HTMLButtonElement>('.card-inbox__friends-btn')!
    expect(friendsBtn).not.toBeNull()
    expect(friendsBtn.hasAttribute('data-unread')).toBe(true)

    const col = el.querySelector<HTMLElement>('.card-inbox__column')!
    expect(col.hidden).toBe(false)

    // Toggle open
    await act(async () => friendsBtn.click())
    await flush(6)
    expect(col.hidden).toBe(true)
    expect(el.querySelector('.fr-pane')).not.toBeNull()

    // Back to Review returns right to the paused card
    const backBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Back to Review'))!
    await act(async () => backBtn.click())
    await flush()
    expect(col.hidden).toBe(false)
    expect(el.querySelector('.fr-pane')).toBeNull()
  })

  it('renders Cards-hero, 🔥 streak, 7-day chain, time, Study Buddy Emojis with tooltips, and sorts by Cards | Time | Streak', async () => {
    friendsMock.board.mockResolvedValue({ ok: true, board: makeBoard() })
    act(() => root!.render(<FriendsPane vaultRoot="/vault" onBack={vi.fn()} />))
    await flush(6)

    // Quiet toast for unseen incoming cheer + markSeen called
    expect(el.querySelector('.fr-toast')?.textContent).toContain('Ali cheered your 5-day streak!')
    expect(friendsMock.markSeen).toHaveBeenCalledWith([2])

    const rowIds = () => [...el.querySelectorAll<HTMLElement>('.fr-row')].map((r) => Number(r.dataset.userId))
    // Default sort: Status -> Cards (Ali 42, Yaseen 20, Sara 18)
    expect(rowIds()).toEqual([2, 1, 3])

    // Cards hero, streak, 7-day chain (7 dots), time
    const aliRow = el.querySelector<HTMLElement>('.fr-row[data-user-id="2"]')!
    expect(aliRow.querySelector('.fr-hero-cards')?.textContent).toContain('42')
    expect(aliRow.querySelector('.fr-sub')?.textContent).toContain('🔥 6d')
    expect(aliRow.querySelectorAll('.fr-chain__dot').length).toBe(7)
    expect(aliRow.querySelector('.fr-sub')?.textContent).toContain('15m')

    // Study Buddy Emojis with tooltip explaining why they earned it
    const emojis = [...aliRow.querySelectorAll<HTMLElement>('.fr-emojis [role="img"]')]
    expect(emojis.length).toBeGreaterThan(0)
    expect(emojis.some((e) => e.textContent === '🔥' && (e.getAttribute('title') ?? '').includes('day streak'))).toBe(true)
    expect(emojis.some((e) => ['💛', '❤️', '💕'].includes(e.textContent ?? '') && (e.getAttribute('title') ?? '').includes('Study Buddy'))).toBe(true)

    // Switch sort to Time -> Sara (2400s) first, Ali (900s), Yaseen (600s)
    const timeBtn = [...el.querySelectorAll<HTMLButtonElement>('.fr-sort button')].find((b) => b.textContent === 'Time')!
    await act(async () => timeBtn.click())
    expect(rowIds()).toEqual([3, 2, 1])

    // Switch sort to Streak -> Sara (14d), Ali (6d), Yaseen (5d)
    const streakBtn = [...el.querySelectorAll<HTMLButtonElement>('.fr-sort button')].find((b) => b.textContent === 'Streak')!
    await act(async () => streakBtn.click())
    expect(rowIds()).toEqual([3, 2, 1])

    // Open You vs Friend view and verify shared cards count
    const aliTap = aliRow.querySelector<HTMLButtonElement>('.fr-row__tap')!
    await act(async () => aliTap.click())
    expect(el.textContent).toContain('7 cards shared together')
  })

  it('supports reversible Dismiss / Undo on incoming cards and 1-shot Import folder (N) in Group Shared Cards', async () => {
    const board = makeBoard()
    friendsMock.board.mockResolvedValue({ ok: true, board })
    act(() => root!.render(<FriendsPane vaultRoot="/vault" onBack={vi.fn()} />))
    await flush(6)

    // Pinned Incoming cards (1) at top
    expect(el.textContent).toContain('Incoming cards (1)')
    expect(el.textContent).toContain('Hola greeting')

    // Dismiss incoming card -> calls setCardState('ic-1', 'dismissed') and shows Undo dismiss
    const dismissBtn = [...el.querySelectorAll<HTMLButtonElement>('section[aria-label="Incoming cards"] button')].find((b) => b.textContent === 'Dismiss')!
    await act(async () => dismissBtn.click())
    await flush()
    expect(friendsMock.setCardState).toHaveBeenCalledWith('ic-1', 'dismissed')

    const undoBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Undo dismiss')!
    await act(async () => undoBtn.click())
    await flush()
    expect(friendsMock.setCardState).toHaveBeenCalledWith('ic-1', 'pending')

    // Switch to Group -> Shared Cards tab -> 1-shot Import folder (2) + Dismissed filter Undo dismiss
    const groupPill = [...el.querySelectorAll<HTMLButtonElement>('.fr-lists button')].find((b) => b.textContent?.includes('Spanish 101'))!
    await act(async () => groupPill.click())
    const cardsTab = [...el.querySelectorAll<HTMLButtonElement>('.fr-seg button')].find((b) => b.textContent?.includes('Shared Cards'))!
    await act(async () => cardsTab.click())
    expect(el.textContent).toContain('Import folder (2)')

    const dismissedFilter = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Shared card filter"] button')].find((b) => b.textContent === 'Dismissed')!
    await act(async () => dismissedFilter.click())
    expect(el.textContent).toContain('Old Grammar Tip')
    const groupUndo = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Undo dismiss')!
    await act(async () => groupUndo.click())
    await flush()
    expect(friendsMock.setCardState).toHaveBeenCalledWith('gc-dismissed', 'pending')
  })

  it('AcceptCardSheet lets user pick an existing vault folder (remembering last pick) OR click 1-click Put in Shared Cards', async () => {
    const onImported = vi.fn()
    const card = { id: 'ic-1', title: 'Hola greeting', markdown: 'Hola\n---\nHello', senderLogin: 'ali' }

    act(() => {
      root!.render(
        <AcceptCardSheet cards={[card]} vaultRoot="/vault" onImported={onImported} onClose={vi.fn()} />,
      )
    })
    await flush(4)

    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Vault folder"]')!
    expect([...select.options].map((o) => o.value)).toEqual(['', 'History', 'Spanish'])

    // Pick "Spanish" + check "Move to Up next"
    act(() => {
      select.value = 'Spanish'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const upNextBox = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    act(() => upNextBox.click())

    const addBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Add to Spanish'))!
    await act(async () => addBtn.click())
    await flush()

    expect(friendsMock.importCards).toHaveBeenCalledWith({
      root: '/vault',
      dir: 'Spanish',
      cards: [{ ...card, upNext: true }],
    })
    expect(localStorage.getItem(LAST_IMPORT_DIR_KEY)).toBe('Spanish')
    expect(friendsMock.setCardState).toHaveBeenCalledWith('ic-1', 'accepted')

    // Now test 1-click "Put in Shared Cards"
    friendsMock.importCards.mockClear()
    const sharedBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Put in Shared Cards')!
    await act(async () => sharedBtn.click())
    await flush()

    expect(friendsMock.importCards).toHaveBeenCalledWith({
      root: '/vault',
      dir: '',
      createFolder: 'Shared Cards',
      cards: [{ ...card, upNext: true }],
    })
  })

  it('renders clean signed-out state with one-click Sign in with GitHub button calling api.github.signIn()', async () => {
    friendsMock.board.mockResolvedValueOnce({ ok: false, error: 'signed_out' })
    githubMock.signIn.mockResolvedValueOnce({ signedIn: true, login: 'yaseen' })
    friendsMock.board.mockResolvedValueOnce({ ok: true, board: makeBoard() })

    act(() => root!.render(<FriendsPane vaultRoot="/vault" onBack={vi.fn()} />))
    await flush(4)

    const signInBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Sign in with GitHub')!
    expect(signInBtn).not.toBeNull()

    await act(async () => signInBtn.click())
    await flush(6)

    expect(api.github.signIn).toHaveBeenCalledTimes(1)
    expect(el.textContent).toContain('All friends (2)')
  })

  it('DoneScreen shows subtle 1-line Friends prompt when friendsCount > 0 and hides it when 0', () => {
    const session = makeSession(false)
    const review = makeReviewApi(session)
    const look: DoneLook = { title: 't', line: 'l', more: 'm', today: 'td', go: 'g' }
    const onOpenFriends = vi.fn()

    act(() => {
      root!.render(
        <DoneScreen
          review={review}
          session={session}
          shown
          look={look}
          addKinds={[]}
          adds={null}
          from={null}
          unit={(s) => s}
          friendsSummary={{ friendsCount: 3, finishedToday: 2, myStreak: 5, onOpenFriends }}
        />,
      )
    })
    expect(el.querySelector('.card-inbox__done-friends')?.textContent).toContain('🔥 5d streak · 2 of 3 friends finished today')
    act(() => el.querySelector<HTMLButtonElement>('.card-inbox__done-friends-btn')!.click())
    expect(onOpenFriends).toHaveBeenCalledTimes(1)

    // Hidden when 0 friends
    act(() => {
      root!.render(
        <DoneScreen
          review={review}
          session={session}
          shown
          look={look}
          addKinds={[]}
          adds={null}
          from={null}
          unit={(s) => s}
          friendsSummary={{ friendsCount: 0, finishedToday: 0, myStreak: 5, onOpenFriends }}
        />,
      )
    })
    expect(el.querySelector('.card-inbox__done-friends')).toBeNull()
  })

  it('wires shareFriend door in cardMenuSections', () => {
    const shareFriend = vi.fn()
    const sections = cardMenuSections({
      marks: null,
      upNext: false,
      copyId: 'C-1',
      change: vi.fn(),
      onNotice: vi.fn(),
      shareFriend,
    })
    const item = sections.flat().find((i) => i.id === 'share-friend')
    expect(item?.label).toBe('Share with friend or group…')
    item?.onSelect?.()
    expect(shareFriend).toHaveBeenCalledTimes(1)
  })

  it('FriendsSendControl renders Show Friends in Inbox toggle (default ON), Vaults that count, and Delete my Friends data with confirm', async () => {
    friendsMock.status.mockResolvedValue({ status: 'sent', lastSentAt: Date.now() - 60_000, retryAt: null, friends: 2, groups: 1, missing: 0 })
    friendsMock.board.mockResolvedValue({ ok: true, board: makeBoard() })
    friendsMock.updatePrefs.mockResolvedValue({ ok: true, vaults: [], zone: null, nickname: null })
    friendsMock.deleteMe.mockResolvedValue({ ok: true })

    act(() => root!.render(<FriendsSendControl />))
    await flush(4)

    const toggle = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0]!
    expect(toggle.checked).toBe(true)
    await act(async () => toggle.click())
    expect(localStorage.getItem(FRIENDS_INBOX_VISIBLE_KEY)).toBe('false')

    // Vaults that count checkbox ("main")
    const vaultBox = [...el.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')][0]!
    expect(vaultBox.checked).toBe(true)
    await act(async () => vaultBox.click())
    await flush()
    expect(friendsMock.updatePrefs).toHaveBeenCalledWith({ vaults: [] })

    // Delete my Friends data -> confirm -> deleteMe()
    const delBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete my Friends data')!
    await act(async () => delBtn.click())
    const confirmBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Confirm delete')!
    await act(async () => confirmBtn.click())
    await flush()
    expect(friendsMock.deleteMe).toHaveBeenCalledTimes(1)
  })
})
