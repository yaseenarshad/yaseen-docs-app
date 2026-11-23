/**
 * Desktop Friends UI tests (YAZ-6220 / YAZ-6222 final locked design):
 * - Friends icon placement in CardInboxBar (between SessionCount and View) + in-place toggle in CardInbox
 * - Leaderboard: left 🥇 medal + right green ✓ for finishers (cards > 0 && done), empty left slot for unfinished,
 *   tiered sort (Finished -> Cards desc -> Name), formatted duration (`15 min`, `2hr 5m`), relative sync time on Today
 * - Buddy Streak: daily 🔔 reveal -> 🤝 Nd pill on Friends tab (hidden on Group tabs), VS 1:1 stats + 30-day strip + Remove friend confirm modal
 * - Group leaderboard + clickable Group streak footer bar -> 30-day Group Streak detail view + Group Settings
 * - Unified Shared (N) flat list: compact Add, two-tap × -> Dismiss?, Undo, Import (N), Explore preview
 * - AcceptCardSheet centered modal (Shared Cards folder default vs Pick a vault folder + Move to Up next)
 * - Zero-friends first-run empty state + Signed-out Sign in with GitHub state
 * - DoneScreen 1-line Friends summary, cardMenuSections shareFriend door, FriendsSendControl per-vault checkboxes & Display name
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FriendsBoardPayload } from '@shared/friendsApi'
import type { FriendDay, FriendStats } from '@shared/friendStatsFormat'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { api } from '../api'
import { FriendsPane, friendlyInviteError, friendlyInviteSuccess } from './FriendsPane'
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
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
  createInvite: vi.fn(),
  acceptInvite: vi.fn(),
  removeFriend: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  removeMember: vi.fn(),
  banMember: vi.fn(),
  unbanMember: vi.fn(),
  rotateGroupInvite: vi.fn(),
  shareCards: vi.fn(),
  setCardState: vi.fn(),
  setFolderState: vi.fn(),
  deleteSharedCard: vi.fn(),
  importCards: vi.fn(),
  setVaultIncluded: vi.fn(),
  getDeckSettings: vi.fn(async () => ({ ok: true as const, settings: { mode: 'none' as const, vaults: [], allowedFriendIds: [] } })),
  saveDeckSettings: vi.fn(async (input: unknown) => ({ ok: true as const, settings: input })),
  listInstallableRepos: vi.fn(async () => ({ ok: true as const, repos: [] })),
  browseDeckTree: vi.fn(),
  browseDeckFile: vi.fn(),
  browseDeckAsset: vi.fn(),
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
    totals: {
      cards: totalCards,
      inReview: totalCards,
      newLeft: 5,
      mature: 12,
      dueLeft: 0,
      addedThisWeek: 3,
      streak,
      bestStreak: streak,
      bestDay: days[0]?.cards ?? 0,
      bestWeek: totalCards,
    },
    at: new Date().toISOString(),
  }
}

function makeBoard(overrides?: Partial<FriendsBoardPayload>): FriendsBoardPayload {
  const today = dayOffset(0)
  const yest = dayOffset(-1)
  const nowIso = new Date().toISOString()
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
      statsAt: nowIso,
    },
    friends: [
      {
        id: 2,
        login: 'ali',
        name: 'Ali',
        avatarUrl: null,
        since: '2026-01-01T00:00:00Z',
        stats: makeStats('ali', 'Ali', [makeDay(today, 42, 900, true), makeDay(yest, 30, 700, true)], 6),
        statsAt: nowIso,
        sharedCardCount: 7,
        buddyStreak: 5,
      } as FriendsBoardPayload['friends'][number],
      {
        id: 3,
        login: 'sara',
        name: 'Sara',
        avatarUrl: null,
        since: '2026-02-01T00:00:00Z',
        stats: makeStats('sara', 'Sara', [makeDay(today, 58, 4500, false), makeDay(yest, 10, 600, true)], 14),
        statsAt: nowIso,
        sharedCardCount: 2,
        buddyStreak: 3,
      } as FriendsBoardPayload['friends'][number],
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
            statsAt: nowIso,
          },
          {
            id: 2,
            login: 'ali',
            name: 'Ali',
            avatarUrl: null,
            since: '2026-01-01T00:00:00Z',
            stats: makeStats('ali', 'Ali', [makeDay(today, 42, 900, true)], 6),
            statsAt: nowIso,
          },
        ],
        pending: [],
        sharedFolders: [
          {
            id: 'fld-1',
            name: 'Verbs Pack',
            senderId: 2,
            senderLogin: 'ali',
            createdAt: nowIso,
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
                createdAt: nowIso,
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
                createdAt: nowIso,
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
            createdAt: nowIso,
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
        createdAt: nowIso,
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
  friendsMock.setCardState.mockResolvedValue({ ok: true })
  friendsMock.setFolderState.mockResolvedValue({ ok: true })
  friendsMock.importCards.mockResolvedValue({ ok: true, paths: ['/vault/Spanish/hola.md'] })
  friendsMock.createInvite.mockResolvedValue({ ok: true, code: 'abc12345', link: 'https://docs.yaseenarshad.com/friend#abc12345', expiresAt: '2026-12-01T00:00:00Z' })
  friendsMock.acceptInvite.mockResolvedValue({ ok: true, result: { kind: 'friend', friendId: 4 } })
  friendsMock.removeFriend.mockResolvedValue({ ok: true })
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

describe('Desktop Friends UI (YAZ-6220 / YAZ-6222)', () => {
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

  it('toggles FriendsPane in place inside CardInbox while hiding/pausing the review card, and returns on Back to Review', async () => {
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
    expect(friendsBtn.hasAttribute('data-unread')).toBe(false)

    const col = el.querySelector<HTMLElement>('.card-inbox__column')!
    expect(col.hidden).toBe(false)

    // Toggle open
    await act(async () => friendsBtn.click())
    await flush(6)
    expect(col.hidden).toBe(true)
    expect(col.style.display).toBe('none')
    expect(el.querySelector('.fr-pane')).not.toBeNull()

    // Back to Review returns right to the paused card
    const backBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Back to Review'))!
    await act(async () => backBtn.click())
    await flush()
    expect(col.hidden).toBe(false)
    expect(el.querySelector('.fr-pane')).toBeNull()
  })

  it('renders tiered leaderboard (left 🥇 + right ✓ for finishers, Buddy Streak 🔔 -> 🤝, formatted duration, VS 1:1 stats + Remove confirm)', async () => {
    friendsMock.board.mockResolvedValue({ ok: true, board: makeBoard() })
    act(() => root!.render(<FriendsPane vaultRoot="/vault" onBack={vi.fn()} />))
    await flush(6)

    // Tiered sort: Finished (Ali 42, Yaseen 20) before Unfinished (Sara 58)
    const rowIds = [...el.querySelectorAll<HTMLElement>('.fr-row')].map((r) => Number(r.dataset.userId))
    expect(rowIds).toEqual([2, 1, 3])

    // Ali (finished, 42 cards): left 🥇, right ✓ 42 cards, 6d 🔥 · 15 min, 🔔 bell for mutual Today finish
    const aliRow = el.querySelector<HTMLElement>('.fr-row[data-user-id="2"]')!
    expect(aliRow.querySelector('.fr-rank--medal')?.textContent).toBe('🥇')
    expect(aliRow.querySelector('.fr-hero-cards')?.textContent).toContain('✓')
    expect(aliRow.querySelector('.fr-hero-cards')?.textContent).toContain('42')
    expect(aliRow.querySelector('.fr-nums__sub')?.textContent).toContain('6d 🔥 · 15 min')

    // Click 🔔 bell to reveal 🤝 5d buddy streak
    const bell = aliRow.querySelector<HTMLButtonElement>('.fr-bell-btn')!
    expect(bell).not.toBeNull()
    await act(async () => bell.click())
    expect(aliRow.querySelector('.fr-buddy-pill')?.textContent).toContain('🤝 5d')

    // Sara (unfinished, 58 cards, 75 min = 1hr 15min): empty left slot, NO ✓, muted 🤝 3d buddy streak
    const saraRow = el.querySelector<HTMLElement>('.fr-row[data-user-id="3"]')!
    expect(saraRow.querySelector('.fr-rank--medal')?.textContent).toBe('')
    expect(saraRow.querySelector('.fr-mark--finished')).toBeNull()
    expect(saraRow.querySelector('.fr-nums__sub')?.textContent).toContain('14d 🔥 · 1hr 15min')
    expect(saraRow.querySelector('.fr-buddy-pill--pending')?.textContent).toContain('🤝 3d')

    // Open You vs Ali: Buddy Streak + 30-day strip + full 1:1 stats + Remove friend confirm modal
    const aliTap = aliRow.querySelector<HTMLElement>('.fr-row__tap')!
    await act(async () => aliTap.click())
    expect(el.textContent).toContain('🤝 5d buddy streak')
    expect(el.textContent).toContain('7 cards shared together')
    expect(el.textContent).toContain('cards today')
    expect(el.textContent).toContain('Their vault')
    expect(el.textContent).toContain('days reviewed of 30')

    // Click Remove friend -> opens confirmation modal -> Confirm
    const removeBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Remove friend')!
    await act(async () => removeBtn.click())
    const confirmModal = document.body.querySelector<HTMLElement>('[aria-label="Remove Ali?"]')!
    expect(confirmModal).not.toBeNull()
    const confirmRemove = [...confirmModal.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Remove friend')!
    await act(async () => confirmRemove.click())
    await flush()
    expect(friendsMock.removeFriend).toHaveBeenCalledWith(2, false)
  })

  it('supports unified Shared (N) flat list with two-tap dismiss, Undo, Import (N), and Group streak 30-day view', async () => {
    friendsMock.board.mockResolvedValue({ ok: true, board: makeBoard() })
    act(() => root!.render(<FriendsPane vaultRoot="/vault" onBack={vi.fn()} />))
    await flush(6)

    // Switch to Shared (3) pill (1 direct + 2 folder cards)
    const sharedPill = [...el.querySelectorAll<HTMLButtonElement>('.fr-lists button')].find((b) => b.textContent?.includes('Shared (3)'))!
    expect(sharedPill).not.toBeNull()
    await act(async () => sharedPill.click())
    expect(el.textContent).toContain('Hola greeting')
    expect(el.textContent).toContain('Import (2)')

    // Two-tap × -> Dismiss? on Hola greeting
    const dismissX = el.querySelector<HTMLButtonElement>('.fr-shared-x')!
    await act(async () => dismissX.click())
    expect(friendsMock.setCardState).not.toHaveBeenCalled()
    const armedBtn = el.querySelector<HTMLButtonElement>('.fr-shared-dismiss-confirm')!
    expect(armedBtn.textContent).toBe('Dismiss?')
    await act(async () => armedBtn.click())
    await flush()
    expect(friendsMock.setCardState).toHaveBeenCalledWith('ic-1', 'dismissed')

    // Switch to Dismissed filter -> Undo on Old Grammar Tip
    const dismissedFilter = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Shared card filter"] button')].find((b) => b.textContent === 'Dismissed')!
    await act(async () => dismissedFilter.click())
    expect(el.textContent).toContain('Old Grammar Tip')
    const undoBtn = el.querySelector<HTMLButtonElement>('.fr-shared-undo')!
    await act(async () => undoBtn.click())
    await flush()
    expect(friendsMock.setCardState).toHaveBeenCalledWith('gc-dismissed', 'pending')

    // Switch to Group -> Buddy Streak hidden on group tab, clickable Group streak footer opens 30-day detail view
    const groupPill = [...el.querySelectorAll<HTMLButtonElement>('.fr-lists button')].find((b) => b.textContent?.includes('Spanish 101'))!
    await act(async () => groupPill.click())
    expect(el.querySelector('.fr-buddy-pill, .fr-bell-btn')).toBeNull()
    const summaryBtn = el.querySelector<HTMLButtonElement>('.fr-group-summary')!
    expect(summaryBtn.textContent).toContain('Group streak')
    await act(async () => summaryBtn.click())
    expect(el.querySelector('[aria-label="Group 30-day history"]')).not.toBeNull()
  })

  it('AcceptCardSheet defaults to Shared Cards folder and lets user switch to Pick a vault folder + Up next', async () => {
    const onImported = vi.fn()
    const card = { id: 'ic-1', title: 'Hola greeting', markdown: 'Hola\n---\nHello', senderLogin: 'ali' }

    act(() => {
      root!.render(
        <AcceptCardSheet cards={[card]} vaultRoot="/vault" onImported={onImported} onClose={vi.fn()} />,
      )
    })
    await flush(4)

    // Default: Shared Cards folder with ONE primary button "Add to Shared Cards"
    const sharedPrimary = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Add to Shared Cards')!
    expect(sharedPrimary).not.toBeNull()
    await act(async () => sharedPrimary.click())
    await flush()
    expect(friendsMock.importCards).toHaveBeenCalledWith({
      root: '/vault',
      dir: '',
      createFolder: 'Shared Cards',
      cards: [{ ...card, upNext: false }],
    })

    // Switch radio to "Pick a vault folder", select "Spanish", check "Move to Up next"
    friendsMock.importCards.mockClear()
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    await act(async () => radios[1].click())

    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Vault folder"]')!
    expect([...select.options].map((o) => o.value)).toEqual(['', 'History', 'Spanish'])
    act(() => {
      select.value = 'Spanish'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const upNextBox = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    act(() => upNextBox.click())

    const addBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Add to Spanish')!
    await act(async () => addBtn.click())
    await flush()
    expect(friendsMock.importCards).toHaveBeenCalledWith({
      root: '/vault',
      dir: 'Spanish',
      cards: [{ ...card, upNext: true }],
    })
    expect(localStorage.getItem(LAST_IMPORT_DIR_KEY)).toBe('Spanish')
  })

  it('renders clean zero-friends first-run empty state and signed-out GitHub button', async () => {
    friendsMock.board.mockResolvedValueOnce({ ok: true, board: makeBoard({ friends: [], groups: [], incomingCards: [] }) })
    act(() => root!.render(<FriendsPane vaultRoot="/vault" onBack={vi.fn()} />))
    await flush(4)
    expect(el.textContent).toContain('Study together with friends')
    expect(el.textContent).toContain('Add a friend or create a group')

    // Signed-out state
    friendsMock.board.mockResolvedValueOnce({ ok: false, error: 'signed_out' })
    githubMock.signIn.mockResolvedValueOnce({ signedIn: true, login: 'yaseen' })
    friendsMock.board.mockResolvedValueOnce({ ok: true, board: makeBoard() })

    act(() => root!.render(<FriendsPane key="signed-out" vaultRoot="/vault" onBack={vi.fn()} />))
    await flush(4)

    const signInBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Sign in with GitHub')!
    expect(signInBtn).not.toBeNull()
    expect(el.textContent).toContain('keep each other accountable')
    expect(el.textContent).not.toContain('cheer each other on')
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

  it('wires shareFriend door in cardMenuSections and FriendsSendControl per-vault checkboxes & delete', async () => {
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

    friendsMock.status.mockResolvedValue({
      status: 'sent',
      lastSentAt: Date.now() - 60_000,
      retryAt: null,
      friends: 2,
      groups: 1,
      missing: 0,
      knownVaults: [{ path: '/vault/main', name: 'Main Vault', included: true }],
    })
    friendsMock.board.mockResolvedValue({ ok: true, board: makeBoard() })
    friendsMock.setVaultIncluded.mockResolvedValue({
      ok: true,
      knownVaults: [{ path: '/vault/main', name: 'Main Vault', included: false }],
    })
    friendsMock.deleteMe.mockResolvedValue({ ok: true })

    act(() => root!.render(<FriendsSendControl />))
    await flush(4)

    const toggle = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0]!
    expect(toggle.checked).toBe(true)
    await act(async () => toggle.click())
    expect(localStorage.getItem(FRIENDS_INBOX_VISIBLE_KEY)).toBe('false')

    const vaultBox = [...el.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')][0]!
    expect(vaultBox.checked).toBe(true)
    await act(async () => vaultBox.click())
    await flush()
    expect(friendsMock.setVaultIncluded).toHaveBeenCalledWith('/vault/main', false)

    const delBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete my Friends data')!
    await act(async () => delBtn.click())
    const confirmBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Confirm delete')!
    await act(async () => confirmBtn.click())
    await flush()
    expect(friendsMock.deleteMe).toHaveBeenCalledTimes(1)
  })

  it('YAZ-6277 / YAZ-6278: Group Settings Rename, Ban, and Unban call real IPC methods and reload the board', async () => {
    const initial = makeBoard()
    const afterRename: FriendsBoardPayload = {
      ...initial,
      groups: initial.groups.map((g) => ({ ...g, name: 'Daily Readers' })),
    }
    const afterBan: FriendsBoardPayload = {
      ...afterRename,
      groups: afterRename.groups.map((g) => ({
        ...g,
        members: g.members.filter((m) => m.id !== 2),
        banned: [{ id: 2, login: 'ali', name: 'Ali' }],
      })),
    }
    const afterUnban: FriendsBoardPayload = {
      ...afterRename,
      groups: afterRename.groups.map((g) => ({ ...g, banned: [] })),
    }

    friendsMock.board
      .mockResolvedValueOnce({ ok: true, board: initial })
      .mockResolvedValueOnce({ ok: true, board: afterRename })
      .mockResolvedValueOnce({ ok: true, board: afterBan })
      .mockResolvedValueOnce({ ok: true, board: afterUnban })
    friendsMock.renameGroup.mockResolvedValue({ ok: true, name: 'Daily Readers' })
    friendsMock.banMember.mockResolvedValue({ ok: true })
    friendsMock.unbanMember.mockResolvedValue({ ok: true })

    const onNotice = vi.fn()
    act(() => root!.render(<FriendsPane vaultRoot="/vault" onBack={vi.fn()} onNotice={onNotice} />))
    await flush(4)

    // Switch to Spanish 101 tab, click again to open Manage sheet, then Group Settings
    const groupPill = [...el.querySelectorAll<HTMLButtonElement>('.fr-pill')].find((b) => b.textContent?.includes('Spanish 101'))!
    await act(async () => groupPill.click())
    await act(async () => groupPill.click())
    const settingsBtn = [...document.querySelectorAll<HTMLButtonElement>('.fr-sheet__item')].find((b) => b.textContent === 'Group Settings')!
    await act(async () => settingsBtn.click())

    // Rename group
    const nameInput = el.querySelector<HTMLInputElement>('input[aria-label="Group name"]')!
    const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setVal?.call(nameInput, 'Daily Readers')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const saveBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Save')!
    await act(async () => saveBtn.click())
    await flush(3)
    expect(friendsMock.renameGroup).toHaveBeenCalledWith('grp-1', 'Daily Readers')
    expect(friendsMock.board).toHaveBeenCalledWith(true)

    // Ban Ali
    const banBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Ban')!
    await act(async () => banBtn.click())
    await flush(3)
    expect(friendsMock.banMember).toHaveBeenCalledWith('grp-1', 2)
    expect(el.textContent).toContain('Ali')
    expect(el.textContent).toContain('Unban')

    // Unban Ali
    const unbanBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Unban')!
    await act(async () => unbanBtn.click())
    await flush(3)
    expect(friendsMock.unbanMember).toHaveBeenCalledWith('grp-1', 2)
    expect(el.textContent).toContain('No banned people')
  })

  it('clamps VS & Group 30-day strips to sinceDay, hides pre-history red X, uses average7Day, and removes mature cards (YAZ-6284)', async () => {
    const today = dayOffset(0)
    const yest = dayOffset(-1)
    const twoAgo = dayOffset(-2)
    const threeAgo = dayOffset(-3)

    const meStats = makeStats(
      'yaseen',
      'Yaseen',
      [
        { day: today, cards: 0, seconds: 0, remembered: 0, forgot: 0, newCards: 0, done: false },
        { day: yest, cards: 40, seconds: 600, remembered: 36, forgot: 4, newCards: 5, done: true },
        { day: twoAgo, cards: 20, seconds: 300, remembered: 18, forgot: 2, newCards: 2, done: true },
      ],
      5,
    )
    const aliStats = makeStats(
      'ali',
      'Ali',
      [
        { day: today, cards: 10, seconds: 180, remembered: 9, forgot: 1, newCards: 2, done: true },
        { day: yest, cards: 30, seconds: 420, remembered: 28, forgot: 2, newCards: 4, done: true },
      ],
      2,
    )
    const board = makeBoard({
      me: { ...makeBoard().me, stats: meStats },
      friends: [
        {
          id: 2,
          login: 'ali',
          name: 'Ali',
          avatarUrl: null,
          since: `${threeAgo}T12:00:00.000Z`,
          stats: aliStats,
          statsAt: new Date().toISOString(),
          sharedCardCount: 0,
          canBrowseDeck: true,
          browsableVaults: [{ repo: 'ali/med-notes', name: 'Med Notes' }],
        },
      ],
      groups: [
        {
          id: 'grp-new',
          name: 'New Study',
          adminId: 1,
          isAdmin: true,
          myStatus: 'active',
          inviteCode: 'new12345',
          createdAt: `${twoAgo}T12:00:00.000Z`,
          members: [
            { id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: null, since: `${twoAgo}T12:00:00.000Z`, stats: meStats, statsAt: new Date().toISOString() },
            { id: 2, login: 'ali', name: 'Ali', avatarUrl: null, since: `${yest}T12:00:00.000Z`, stats: aliStats, statsAt: new Date().toISOString() },
          ],
          pending: [],
          sharedFolders: [],
          sharedCards: [],
        },
      ],
    })

    friendsMock.board.mockResolvedValue({ ok: true, board })
    act(() => root!.render(<FriendsPane vaultRoot="/vault" onBack={vi.fn()} />))
    await flush(4)

    // Open VS Ali
    const aliTap = el.querySelector<HTMLElement>('.fr-row[data-user-id="2"] .fr-row__tap')!
    await act(async () => aliTap.click())
    await flush(2)

    // Strip clamped to 4 days (threeAgo..today), not 30
    const vsDays = el.querySelectorAll('.fr-strip30 .fr-day30')
    expect(vsDays.length).toBe(4)
    // No red X for days without a recorded entry (threeAgo has no entry for either user)
    expect(vsDays[0].querySelectorAll('.fr-ring-av__badge--missed').length).toBe(0)
    // `mature cards` row is removed
    expect(el.textContent).not.toContain('mature cards')
    // `7 day average` uses average7Day (Yaseen: (40+20)/2 = 30 excluding unstarted today; Ali: (10+30)/2 = 20)
    const avgRow = [...el.querySelectorAll('.fr-vs')].find((r) => r.textContent?.includes('7 day average'))!
    expect(avgRow.textContent).toContain('30')
    expect(avgRow.textContent).toContain('20')

    // Go back, open New Study group, click Group streak footer
    const backBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Back to leaderboard'))!
    await act(async () => backBtn.click())
    const grpPill = [...el.querySelectorAll<HTMLButtonElement>('.fr-pill')].find((b) => b.textContent?.includes('New Study'))!
    await act(async () => grpPill.click())
    const streakRow = el.querySelector<HTMLButtonElement>('.fr-group-summary')!
    await act(async () => streakRow.click())
    await flush(2)

    // Clamped to 3 days (twoAgo..today); Ali joined on yest so Ali is NOT blamed on twoAgo and has 2 eligible days
    expect(el.querySelectorAll('.fr-strip30 .fr-day30').length).toBe(3)
    expect(el.textContent).not.toContain('Last broken')
    expect(el.textContent).toContain('2 of 2 days finished')
    expect(el.textContent).toContain('2 of 3 days finished')
  })

  it('opens Browse deck Explore modal from VS, supports instant search, stacked preview panels, and Add to my deck (YAZ-6284)', async () => {
    const board = makeBoard({
      friends: [
        {
          id: 2,
          login: 'maya',
          name: 'Maya',
          avatarUrl: null,
          since: '2026-01-01T00:00:00Z',
          stats: makeStats('maya', 'Maya', [{ day: dayOffset(0), cards: 25, seconds: 600, remembered: 23, forgot: 2, newCards: 3, done: true }], 5),
          statsAt: new Date().toISOString(),
          sharedCardCount: 0,
          canBrowseDeck: true,
          browsableVaults: [{ repo: 'maya/med-notes', name: 'Med Notes' }],
        },
      ],
    })
    friendsMock.board.mockResolvedValue({ ok: true, board })
    friendsMock.browseDeckTree.mockResolvedValue({
      ok: true,
      tree: {
        repo: 'maya/med-notes',
        name: 'Med Notes',
        files: [
          { path: 'Biochem/ATP Synthase.md', title: 'ATP Synthase', kind: 'md' },
          { path: 'Spanish/Subjunctive Triggers.md', title: 'Subjunctive Triggers', kind: 'md' },
        ],
      },
    })
    friendsMock.browseDeckFile.mockResolvedValue({
      ok: true,
      file: {
        path: 'Biochem/ATP Synthase.md',
        title: 'ATP Synthase',
        markdown: 'How does ATP Synthase work?\n---\nProton gradient spins the rotor.',
        assetPaths: [],
      },
    })
    treeMock.mockResolvedValue({ root: '/vault', tree: [] })
    friendsMock.importCards.mockResolvedValue({ ok: true, paths: ['/vault/Shared Cards/atp.md'] })

    const onNotice = vi.fn()
    act(() => root!.render(<FriendsPane vaultRoot="/vault" onBack={vi.fn()} onNotice={onNotice} />))
    await flush(4)

    // Open VS Maya and click Browse deck
    const mayaTap = el.querySelector<HTMLElement>('.fr-row[data-user-id="2"] .fr-row__tap')!
    await act(async () => mayaTap.click())
    const browseBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Browse deck')!
    expect(browseBtn).toBeTruthy()
    await act(async () => browseBtn.click())
    await flush(4)

    expect(friendsMock.browseDeckTree).toHaveBeenCalledWith(2, 'maya/med-notes')
    const modal = document.querySelector('.fr-browse-modal')!
    expect(modal).not.toBeNull()
    expect(modal.textContent).toContain('Biochem')
    expect(modal.textContent).toContain('ATP Synthase')

    // Instant search filters down to ATP Synthase
    const searchInput = modal.querySelector<HTMLInputElement>('input[aria-label="Search deck"]')!
    const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setVal?.call(searchInput, 'ATP')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(modal.textContent).toContain('ATP Synthase')
    expect(modal.textContent).not.toContain('Subjunctive Triggers')

    // Click result -> pushes stacked Explore preview panel
    const resultBtn = modal.querySelector<HTMLButtonElement>('.fr-browse-tree__file--result')!
    await act(async () => resultBtn.click())
    await flush(4)
    expect(friendsMock.browseDeckFile).toHaveBeenCalledWith(2, 'maya/med-notes', 'Biochem/ATP Synthase.md')
    expect(modal.querySelector('.fr-browse-panel')?.textContent).toContain('Proton gradient spins the rotor.')

    // Click Add to my deck -> opens AcceptCardSheet -> imports with skipServerState
    const addBtn = [...modal.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Add to my deck')!
    await act(async () => addBtn.click())
    await flush(3)
    const confirmAdd = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Add to Shared Cards')!
    await act(async () => confirmAdd.click())
    await flush(3)
    expect(friendsMock.importCards).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('ATP Synthase'))

    // Esc pops preview panel, then Esc closes modal
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('.fr-browse-panel')).toBeNull()
    expect(document.querySelector('.fr-browse-modal')).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('.fr-browse-modal')).toBeNull()
  })

  it('YAZ-6299: FriendsSendControl shows Profile picture status, Reset to GitHub photo, and first-name Display name hint', async () => {
    friendsMock.status.mockResolvedValue({
      status: 'sent',
      lastSentAt: Date.now() - 60_000,
      retryAt: null,
      friends: 2,
      groups: 1,
      missing: 0,
    })
    const customBoard = makeBoard()
    ;(customBoard.me as typeof customBoard.me & { hasCustomAvatar?: boolean }).hasCustomAvatar = true
    customBoard.me.avatarUrl = 'https://docs.yaseenarshad.com/api/friends/avatar/1?v=abc123'
    friendsMock.board.mockResolvedValue({ ok: true, board: customBoard })
    friendsMock.deleteAvatar.mockResolvedValue({
      ok: true,
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      hasCustomAvatar: false,
    })

    act(() => root!.render(<FriendsSendControl />))
    await flush(4)

    expect(el.textContent).toContain('Default is your GitHub first name')
    expect(el.querySelector('.friends-settings__avatar-status')?.textContent).toBe('Custom photo')
    const previewImg = el.querySelector<HTMLImageElement>('.friends-settings__avatar-preview img')
    expect(previewImg?.getAttribute('src')).toBe('https://docs.yaseenarshad.com/api/friends/avatar/1?v=abc123')

    const resetBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Reset to GitHub photo')!
    expect(resetBtn).not.toBeNull()
    await act(async () => resetBtn.click())
    await flush(3)

    expect(friendsMock.deleteAvatar).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.friends-settings__avatar-status')?.textContent).toBe('From GitHub')
    expect(el.querySelector<HTMLImageElement>('.friends-settings__avatar-preview img')?.getAttribute('src')).toBe(
      'https://avatars.githubusercontent.com/u/1',
    )
    expect([...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Reset to GitHub photo')).toBeUndefined()
  })

  it('handles auto-accepted deep-link invites without reopening the Paste modal and maps error codes to plain words (YAZ-6372)', async () => {
    friendsMock.board.mockResolvedValue({ ok: true, board: makeBoard() })
    const onNotice = vi.fn()
    const onClearPendingInvite = vi.fn()

    act(() =>
      root!.render(
        <FriendsPane
          vaultRoot="/vault"
          onBack={vi.fn()}
          onNotice={onNotice}
          pendingInvite={{
            kind: 'group',
            code: 'p7m2s9m8ak',
            status: 'accepted',
            result: { kind: 'group', groupId: 'g1', status: 'active', name: 'Founders', alreadyMember: false },
          }}
          onClearPendingInvite={onClearPendingInvite}
        />,
      ),
    )
    await flush(6)

    expect(onNotice).toHaveBeenCalledWith('Joined Founders.')
    expect(onClearPendingInvite).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.fr-modal-backdrop')).toBeNull()

    expect(friendlyInviteSuccess({ kind: 'group', name: 'Founders', alreadyMember: true })).toBe('You are already in Founders.')
    expect(friendlyInviteSuccess({ kind: 'friend', friendId: 42, alreadyFriends: false })).toBe('Friend added!')
    expect(friendlyInviteSuccess({ kind: 'friend', friendId: 42, alreadyFriends: true })).toBe('You are already friends.')
    expect(friendlyInviteError('invite_not_found')).toBe('This invite link is no longer valid. Ask for a new one.')
    expect(friendlyInviteError('self_invite')).toBe('That is your own invite link.')
    expect(friendlyInviteError('banned')).toBe('You cannot join this group.')
  })
})
