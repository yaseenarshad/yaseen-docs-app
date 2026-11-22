// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeckSettingsPayload, GroupBoardItem } from '@shared/friendsApi'
import { mount, newPhone, type Harness } from '../../screens/testing'
import { PHONE, saveVaultList, vaultId } from '../../store'
import { addDays, localDay, vsBoard } from './board'
import { demoBoard, demoFriend, demoGroup, demoStats, fakeService, fakeServices, type FakeService } from './demo'
import { canonicalVaultRepo, type Board } from './service'

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0) // 2026-11-13 18:00 UTC

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/deck-asset')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  h?.unmount()
  h = null
})

async function readyPhone(repo = 'Yaseen/Med-Notes') {
  const p = await newPhone()
  const v = { repo, branch: 'main', addedAt: 0 }
  await saveVaultList(p.store, { vaults: [v], open: vaultId(v) })
  await p.tokens.write(vaultId(v), 'ghp_test_token')
  return p
}

async function openFriends(board: Board, patchService?: (s: FakeService) => void) {
  const s = fakeService(board)
  patchService?.(s)
  const p = await readyPhone()
  const mounted = await mount({
    phone: p,
    now: () => NOW,
    friends: (store) => fakeServices(store, s, true),
  })
  h = mounted
  await waitFor(() => mounted.host.querySelector('.fr-seg') !== null)
  return { h: mounted, s }
}

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('Timed out waiting for condition')
    await act(async () => void (await new Promise((r) => setTimeout(r, 15))))
  }
}

describe('YAZ-6284 Friends v2 (Phone)', () => {
  it('removes "Links you shared" from FriendsTab and "mature cards" from VsScreen', async () => {
    const board = demoBoard(NOW, {
      shared: [{ mine: 'a'.repeat(32), link: 'https://docs.yaseenarshad.com/friend#abc', at: new Date(NOW).toISOString() }],
    })
    const { h: mounted } = await openFriends(board)
    expect(mounted.text()).not.toContain('Links you shared')
    expect(mounted.text()).not.toContain('Cancel link')

    await mounted.click(/Sam/)
    await waitFor(() => mounted.host.querySelector('.fr-strip30') !== null)
    expect(mounted.text()).not.toContain('mature cards')
  })

  it('clamps VS 30-day strip to friend.since and hides red X on missing history days', async () => {
    const today = localDay(NOW)
    const sinceIso = `${addDays(today, -3)}T12:00:00.000Z`
    const sam = demoFriend(NOW, 'Sam', {
      userId: 2,
      login: 'sam',
      since: sinceIso,
      days: [
        [0, { cards: 20, done: true }],
        [-1, { cards: 15, done: false }],
        // -2 and -3 have NO day entry at all -> should NOT show red ✕
      ],
    })
    const board = demoBoard(NOW, { friends: [sam] })
    const { h: mounted } = await openFriends(board)
    await mounted.click(/Sam/)
    await waitFor(() => mounted.host.querySelector('.fr-strip30') !== null)

    const cols = mounted.host.querySelectorAll('.fr-strip30 > li')
    // Clamped to 4 days: -3, -2, -1, 0
    expect(cols.length).toBe(4)
    // On day -3 (first col), Sam has no day entry so their ring should NOT be marked missed
    const firstColRings = cols[0].querySelectorAll('.fr-ring-av')
    expect(firstColRings[1].classList.contains('fr-ring-av--missed')).toBe(false)
    // On day -1 (third col), Sam has done: false entry so their ring IS marked missed
    const thirdColRings = cols[2].querySelectorAll('.fr-ring-av')
    expect(thirdColRings[1].classList.contains('fr-ring-av--missed')).toBe(true)
  })

  it('clamps GroupStreakScreen strip, excludes late joiners from blame, and uses eligible days count', async () => {
    const today = localDay(NOW)
    const createdAt = `${addDays(today, -4)}T10:00:00.000Z`
    const lateSince = `${addDays(today, -1)}T10:00:00.000Z`

    const group = demoGroup(NOW, { group: 'grp_clamp', name: 'Med Study', streak: 1 })
    const d1Group: GroupBoardItem = {
      id: 'grp_clamp',
      name: 'Med Study',
      adminId: 1,
      isAdmin: true,
      myStatus: 'active',
      inviteCode: 'abc',
      createdAt,
      members: [
        {
          id: 1,
          login: 'demo',
          name: 'Demo Person',
          avatarUrl: null,
          since: createdAt,
          stats: demoStats(NOW, 'Demo Person', [
            [0, { cards: 20, done: true }],
            [-1, { cards: 20, done: true }],
            [-2, { cards: 10, done: false }],
            [-3, { cards: 20, done: true }],
            [-4, { cards: 20, done: true }],
          ]),
          statsAt: new Date(NOW).toISOString(),
        },
        {
          id: 2,
          login: 'mina',
          name: 'Mina',
          avatarUrl: null,
          since: lateSince, // Joined on day -1! Should NOT be blamed for day -2!
          stats: demoStats(NOW, 'Mina', [
            [0, { cards: 30, done: true }],
            [-1, { cards: 30, done: true }],
          ]),
          statsAt: new Date(NOW).toISOString(),
        },
      ],
      pending: [],
      sharedFolders: [],
      sharedCards: [],
    }
    group.members = [
      { ...group.members[0], pointer: '1', me: true, read: { kind: 'ok', stats: d1Group.members[0].stats!, pointer: { v: 1, stats: '' }, updatedAt: NOW } },
      { ...group.members[1], pointer: '2', me: false, read: { kind: 'ok', stats: d1Group.members[1].stats!, pointer: { v: 1, stats: '' }, updatedAt: NOW } },
    ]

    const board = demoBoard(NOW, { groups: [group], d1Groups: [d1Group] })
    board.me.stats = d1Group.members[0].stats
    const { h: mounted } = await openFriends(board)

    await mounted.click(/Med Study/)
    await mounted.click(/Group streak/)
    await waitFor(() => mounted.host.querySelector('.fr-strip30') !== null)

    const cols = mounted.host.querySelectorAll('.fr-strip30 > li')
    // Clamped to 5 days (-4..0), NOT 30
    expect(cols.length).toBe(5)
    // Late joiner Mina should NOT be blamed on day -2
    const txt = mounted.text()
    const brokenLine = [...mounted.host.querySelectorAll('.fr-hype-sub')].find((el) =>
      el.textContent?.includes('Last broken on'),
    )
    expect(brokenLine?.textContent).toContain('Last broken on')
    expect(brokenLine?.textContent).toContain('Demo Person')
    expect(brokenLine?.textContent).not.toContain('Mina')
    // Eligible days: Mina joined on -1 so has 2 eligible days, Demo Person has 5 eligible days
    expect(txt).toContain('2 of 2 days finished')
    expect(txt).toContain('4 of 5 days finished')
  })

  it('uses average7Day in vsBoard (no /7 penalty for new users or unstarted today)', () => {
    const newUser = demoStats(NOW, 'NewUser', [
      [0, { cards: 0, done: false }],
      [-1, { cards: 40, done: true }],
      [-2, { cards: 20, done: true }],
    ])
    const vs = vsBoard(newUser, newUser, NOW)
    const avgRow = vs.side.find((l) => l.label === '7 day average')
    // 2 active prior days (40 + 20) / 2 = 30, ignoring unstarted today
    expect(avgRow?.you).toBe(30)
  })

  it('strips @branch to canonical lowercase owner/repo and triggers syncVaultExclusion on toggle in Settings', async () => {
    expect(canonicalVaultRepo('Yaseen/Med-Notes@main')).toBe('yaseen/med-notes')
    expect(canonicalVaultRepo('Owner/Repo')).toBe('owner/repo')

    const syncSpy = vi.fn(async () => undefined)
    const s = fakeService(demoBoard(NOW))
    const p = await readyPhone('Yaseen/Med-Notes')
    const mounted = await mount({
      phone: p,
      now: () => NOW,
      friends: (store) => ({
        ...fakeServices(store, s, true),
        syncVaultExclusion: syncSpy,
      }),
    })
    h = mounted
    await mounted.click('Settings')
    await waitFor(() => mounted.host.querySelector('input[type="checkbox"]') !== null)

    const checkbox = [...mounted.host.querySelectorAll<HTMLInputElement>('label.row input[type="checkbox"]')].find((el) =>
      el.closest('label')?.textContent?.includes('Count this vault in Friends'),
    )
    expect(checkbox).toBeTruthy()
    await act(async () => {
      checkbox!.click()
    })
    await waitFor(() => syncSpy.mock.calls.length === 1)
    const saved = await mounted.store.getState<string[]>(PHONE, 'yaseendocs.friends.excludedVaults')
    expect(saved).toEqual(['Yaseen/Med-Notes'])
  })

  it('shows Browse deck permissions in Settings and saves mode + vault with installationId', async () => {
    let savedPayload: DeckSettingsPayload | null = null
    const s = fakeService(demoBoard(NOW, {
      friends: [demoFriend(NOW, 'Maya', { userId: 2, login: 'maya' })],
    }))
    s.getDeckSettings = async () => ({ mode: 'none', vaults: [], allowedFriendIds: [] })
    s.saveDeckSettings = async (input) => {
      savedPayload = input
      return { ok: true, ...input }
    }
    s.findRepoInstallationId = async () => 4242

    const p = await readyPhone('Yaseen/Med-Notes')
    const mounted = await mount({
      phone: p,
      now: () => NOW,
      friends: (store) => fakeServices(store, s, true),
    })
    h = mounted
    await mounted.click('Settings')
    await waitFor(() => mounted.button(/Browse deck permissions/) !== null)
    await mounted.click(/Browse deck permissions/)
    await waitFor(() => mounted.text().includes('Who can browse my deck'))

    const allFriendsRadio = [...mounted.host.querySelectorAll<HTMLInputElement>('input[name="deck-share-mode"]')][1]
    await act(async () => {
      allFriendsRadio.click()
    })
    await waitFor(() => savedPayload?.mode === 'all')

    const allowVaultCb = [...mounted.host.querySelectorAll<HTMLInputElement>('label.row input[type="checkbox"]')].find((el) =>
      el.closest('label')?.textContent?.includes('Allow friends to browse this vault'),
    )
    expect(allowVaultCb).toBeTruthy()
    await act(async () => {
      allowVaultCb!.click()
    })
    await waitFor(() => savedPayload?.vaults.length === 1)
    expect(savedPayload!.vaults[0]).toEqual({
      repo: 'yaseen/med-notes',
      installationId: 4242,
      name: 'Med Notes',
    })
  })

  it('opens draggable Browse deck Explore panels from VsScreen, searches, stacks preview, and adds card with images', async () => {
    const acceptedCalls: unknown[] = []
    const maya = demoFriend(NOW, 'Maya', {
      userId: 2,
      login: 'maya',
      canBrowseDeck: true,
      browsableVaults: [{ repo: 'maya/med-notes', name: 'Med Notes' }],
    })
    const { h: mounted } = await openFriends(demoBoard(NOW, { friends: [maya] }), (s) => {
      s.browseDeckTree = async () => ({
        repo: 'maya/med-notes',
        name: 'Med Notes',
        files: [
          { path: 'Biochem/ATP Synthase.md', title: 'ATP Synthase', kind: 'md' },
          { path: 'Spanish/Subjunctive.md', title: 'Subjunctive', kind: 'md' },
          { path: 'assets/atp.png', title: 'atp.png', kind: 'asset' },
        ],
      })
      s.browseDeckFile = async (_ownerId, _repo, path) => ({
        path,
        title: 'ATP Synthase',
        markdown: 'Complex V makes ATP\n\n![diagram](../assets/atp.png)',
        assetPaths: ['assets/atp.png'],
      })
      s.browseDeckAsset = async () => ({
        bytes: new Uint8Array([137, 80, 78, 71]),
        contentType: 'image/png',
      })
      s.vaultFolders = async () => ['Biochem']
      s.acceptCardToVault = async (input) => {
        acceptedCalls.push(input)
        return { ok: true, path: 'Shared Cards/ATP Synthase.md' }
      }
    })

    await mounted.click(/Maya/)
    await waitFor(() => mounted.button('Browse deck') !== null)
    await mounted.click('Browse deck')
    await waitFor(() => document.querySelector('.fr-deck-tree') !== null)

    // Search filters tree
    const searchInput = document.querySelector<HTMLInputElement>('input[name="deck-search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(searchInput, 'ATP')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitFor(() => !document.querySelector('.fr-deck-tree')?.textContent?.includes('Subjunctive'))
    expect(document.querySelector('.fr-deck-tree')?.textContent).toContain('ATP Synthase')

    // Tap file -> pushes stacked draggable Explore sheet
    const fileBtn = [...document.querySelectorAll<HTMLButtonElement>('.fr-deck-tree__row--file')].find((b) =>
      b.textContent?.includes('ATP Synthase'),
    )!
    await act(async () => {
      fileBtn.click()
    })
    await waitFor(() => document.querySelectorAll('.explore-sheet').length === 2)
    await waitFor(() => document.body.textContent?.includes('Add to my deck') === true)

    // Tap "Add to my deck" -> opens AcceptCardSheet and commits card + image bytes
    const addBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Add to my deck')!
    await act(async () => {
      addBtn.click()
    })
    await waitFor(() => document.querySelector('.fr-modal-card') !== null)
    const confirmAdd = [...document.querySelectorAll<HTMLButtonElement>('.fr-modal-card button')].find((b) =>
      b.textContent?.includes('Add to Shared Cards'),
    )!
    await act(async () => {
      confirmAdd.click()
    })
    await waitFor(() => acceptedCalls.length === 1)
    expect(acceptedCalls[0]).toMatchObject({
      folder: 'Shared Cards',
      skipMarkAccepted: true,
      assetFiles: [{ path: 'assets/atp.png', bytes: new Uint8Array([137, 80, 78, 71]) }],
    })
  })
})
