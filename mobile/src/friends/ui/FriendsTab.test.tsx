// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIST_NEEDS_REPAIR } from '@shared/friendGists'
import { groupViewMessage, joinMessage } from '@shared/friendGroups'
import { saveAccount } from '../../auth/account'
import { mount, newPhone, NOW, type Harness } from '../../screens/testing'
import { saveVaultList, vaultId, type PhoneVault } from '../../store'
import type { Board } from './service'
import { demoBoard, demoFriend, demoGroup, fakeService, fakeServices, DEMO_AVATAR, type FakeService } from './demo'

/**
 * YAZ-5085 (4E4): the Friends tab and "You vs <friend>" in the real app (4A's shell, store and navigation), with a fake
 * friends service (no network). The rules are `board.ts`'s (its own tests); this file checks what the screens draw.
 */
/** Waits for the lazy "You vs" chunk (slow under load). */
const until = async (x: Harness, selector: string) => {
  for (let i = 0; i < 100 && x.host.querySelector(selector) === null; i++) await x.settle()
}

/** A name from a gist sits in a bidi isolate (U+2068 … U+2069, YAZ-5256): the tests read the words without it. */
const plain = (text: string | null | undefined) => (text ?? '').replace(/[\u2068\u2069]/g, '')
const named = (el: Element) =>
  plain(el.getAttribute('aria-label') ?? el.textContent)
    .replace(/\s+/g, ' ')
    .trim()
const btn = (x: Harness, name: string | RegExp) =>
  ([...x.host.querySelectorAll('button, a')].find((el) => (typeof name === 'string' ? named(el) === name : name.test(named(el)))) as
    | HTMLButtonElement
    | undefined) ?? null
/** Taps the button whose words (without the isolates) are `name`. */
const tap = async (x: Harness, name: string | RegExp) => {
  const el = btn(x, name)
  if (el === null) throw new Error(`No button "${name}" on: ${plain(x.text())}`)
  await act(async () => el.click())
  await x.settle()
}

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
  vi.unstubAllGlobals()
})

/** A phone with one vault (or two on two accounts) whose check is done: the app opens on Friends. */
async function phone(logins: string[] = ['demo']) {
  const p = await newPhone()
  const vaults: PhoneVault[] = logins.map((l, i) => ({
    repo: `${l}/vault${i}`,
    branch: 'main',
    addedAt: i + 1,
  }))
  for (const [i, v] of vaults.entries()) {
    await p.tokens.write(vaultId(v), 'github_pat_11FRIENDSUI0' + 'f'.repeat(72))
    await saveAccount(p.store, vaultId(v), {
      login: logins[i],
      name: logins[i],
      avatarUrl: '',
      gists: 'yes',
      expiresAt: null,
      checkedAt: 0,
    })
  }
  await saveVaultList(p.store, { vaults, open: vaultId(vaults[0]) })
  return p
}
async function open(board: Board, opts: { logins?: string[]; groups?: boolean } = {}): Promise<{ h: Harness; s: FakeService }> {
  const s = fakeService(board, { groups: opts.groups })
  const x = await mount({
    phone: await phone(opts.logins),
    friends: (store) => fakeServices(store, s),
  })
  // The tab is a lazy chunk: wait until it drew the board.
  for (let i = 0; i < 50 && x.host.querySelector('section[aria-label="Friends"]:not([aria-busy])') === null; i++) await x.settle()
  return { h: x, s }
}
/** A row's words as a person reads them (each piece of text, with a space between). */
const words = (el: Element): string => {
  const out: string[] = []
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) out.push(n.textContent ?? '')
  return out.join(' ').replace(/\s+/g, ' ').trim()
}
const rows = (x: Harness) => [...x.host.querySelectorAll('.fr-row')].map((r) => plain(words(r)))
const labels = (x: Harness) => [...x.host.querySelectorAll('.fr-row__tap')].map((b) => plain(b.getAttribute('aria-label')))
const statusText = (x: Harness) => plain([...x.host.querySelectorAll('[role="status"]')].map((e) => e.textContent).join(' | '))

describe('the Friends tab (decisions 21, 24, 25)', () => {
  it('opens on Friends: rows sorted by cards, my own row bold, the mark, minutes, "cheered you · 2h ago"', async () => {
    ;({ h } = await open(demoBoard(NOW)))
    expect(plain(h.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent)).toBe('Friends')
    expect(rows(h)).toEqual([
      '1 S Sam cheered you · 2h ago ✓ 44 cards 66 min',
      '2 D You ◐ 31 cards 55 min',
      '3 P Priya 43m ago ◐ 12 cards 49 min',
      '4 L Leo no update yet ○ 0 cards 0 min',
    ])
    expect(plain(h.host.querySelector('.fr-name--you')?.textContent)).toBe('You')
    // VoiceOver reads the mark as words, with the rank and the numbers.
    expect(labels(h)[0]).toBe('Number 1, Sam, 44 cards, 66 minutes, Finished the due cards, cheered you, 2h ago')
    expect(labels(h)[1]).toBe('Number 2, You, 31 cards, 55 minutes, Started, due cards left')
    expect([...h.host.querySelectorAll('.fr-mark')].map((m) => m.getAttribute('aria-label'))).toContain('Not started today')
  })

  it('Today, Yesterday, Week and Month change the numbers; Week and Month have no mark', async () => {
    ;({ h } = await open(demoBoard(NOW)))
    await tap(h, 'Yesterday')
    expect(rows(h)[0]).toBe('1 P Priya ✓ 51 cards 0 min')
    expect(plain(h.host.querySelector('[aria-pressed="true"]')?.textContent)).toBe('Yesterday')
    await tap(h, 'Week')
    expect(h.host.querySelectorAll('.fr-mark')).toHaveLength(0)
    await tap(h, 'Month')
    expect(h.host.querySelectorAll('.fr-mark')).toHaveLength(0)
  })

  it('a cheer on the screen is "seen" (decision 24): the phone keeps it', async () => {
    const board = demoBoard(NOW)
    let s: FakeService
    ;({ h, s } = await open(board))
    expect(s.calls.see).toEqual([`${board.friends[0].theirs}:${board.friends[0].mark!.at}`])
  })

  it('a cheer seen two days ago is gone; an unseen old one still shows', async () => {
    const board = demoBoard(NOW)
    const sam = board.friends[0]
    ;({ h } = await open({
      ...board,
      seen: {
        [sam.theirs]: { at: sam.mark!.at, seenAt: NOW - 2 * 86_400_000 },
      },
    }))
    expect(plain(h.text())).not.toContain('cheered you')
    h.unmount()
    const old = {
      ...board,
      friends: [
        {
          ...sam,
          mark: {
            kind: 'nudge' as const,
            at: new Date(NOW - 9 * 86_400_000).toISOString(),
          },
        },
      ],
    }
    ;({ h } = await open(old))
    expect(plain(h.text())).toContain('nudged you')
  })

  it('no friend yet: the two steps and what a friend sees', async () => {
    ;({ h } = await open({ ...demoBoard(NOW), friends: [] }))
    expect(plain(h.text())).toContain('Add a friend in two steps:')
    expect(plain(h.text())).toContain('Share your link with your friend.')
    expect(plain(h.text())).toContain('Paste the link that your friend sends you.')
    expect(plain(h.text())).toContain('Never your cards or your pages.')
  })

  it('"Waiting…", "No longer shares with you", a newer app, a file that cannot be read', async () => {
    const board = demoBoard(NOW, {
      friends: [
        demoFriend(NOW, 'Ana', {
          state: 'waiting',
          label: 'Waiting for Ana to add you',
          sendBack: 'https://notecards.yaseenarshad.com/friend#' + 'c'.repeat(32),
        }),
        demoFriend(NOW, 'Ben', {
          state: 'gone',
          label: 'No longer shares with you',
          stats: null,
        }),
        demoFriend(NOW, 'Cy', {
          state: 'newer-app',
          label: 'Needs a newer app',
          stats: null,
        }),
        demoFriend(NOW, 'Di', {
          state: 'unreadable',
          label: "Can't read their numbers",
          stats: null,
        }),
      ],
    })
    let s: FakeService
    ;({ h, s } = await open(board))
    expect(rows(h)).toEqual([
      '1 D You ◐ 31 cards 55 min',
      '2 A Ana Waiting for Ana to add you · 2h ago ◐ 10 cards 10 min',
      'B Ben No longer shares with you Remove',
      'C Cy Needs a newer app',
      "D Di Can't read their numbers",
    ])
    expect(h.host.querySelector('.fr-row--gone')?.textContent).toContain('Ben')
    // Remove asks first, in plain words; Cancel has the focus and changes nothing.
    await tap(h, 'Remove')
    expect(plain(h.host.querySelector('[role="alertdialog"]')?.textContent)).toContain('Remove Ben? They no longer share with you.')
    expect(plain(document.activeElement?.textContent)).toBe('Cancel')
    await tap(h, 'Cancel')
    expect(s.calls.remove).toEqual([])
    await tap(h, 'Remove')
    await act(async () => (h!.host.querySelector('.btn--danger') as HTMLButtonElement).click())
    await h.settle()
    expect(s.calls.remove).toEqual([board.friends[1].mine])
  })

  it('the list needs repair; no Gists permission; a newer app; no signal with nothing read', async () => {
    ;({ h } = await open({ kind: 'needs-repair' }))
    expect(plain(h.text())).toContain(LIST_NEEDS_REPAIR)
    h.unmount()
    ;({ h } = await open({ kind: 'no-gists' }))
    expect(plain(h.text())).toContain('Friends needs the Gists permission on your token.')
    expect(btn(h, 'How to make a token')).not.toBeNull()
    h.unmount()
    ;({ h } = await open({ kind: 'newer-app' }))
    expect(plain(h.text())).toContain('Update this app')
    h.unmount()
    ;({ h } = await open({ kind: 'offline' }))
    expect(plain(h.text())).toContain('No connection. Your friends show when you are online.')
  })

  it('no signal: the last numbers, each with "updated … ago"', async () => {
    ;({ h } = await open(demoBoard(NOW, { offline: true })))
    expect(plain(h.text())).toContain('No connection. These are the last numbers the app read.')
    expect(rows(h)[0]).toContain('2h ago')
  })

  it('the wrong setup: vaults on two GitHub accounts (round 13, item 4)', async () => {
    ;({ h } = await open(demoBoard(NOW), { logins: ['demo', 'work'] }))
    expect(plain(h.text())).toContain('Your vaults are on two GitHub accounts. Friends use @demo.')
    await tap(h, 'Change')
    expect(plain(h.host.querySelector('.topbar__title')?.textContent)).toBe('Settings')
  })

  it('a hostile name is text: no HTML, bounded, no bidi trick; avatars come only from GitHub', async () => {
    const evil = '<img src=x onerror="window.hacked=1">'
    const board = demoBoard(NOW, {
      friends: [
        demoFriend(NOW, evil, { avatar: null }),
        demoFriend(NOW, 'x'.repeat(39) + '…', { avatar: DEMO_AVATAR }),
        demoFriend(NOW, 'abc‮def', { avatar: null }),
        demoFriend(NOW, '😀 Emoji', { avatar: null }),
      ],
    })
    ;({ h } = await open(board))
    expect(h.host.querySelectorAll('img')).toHaveLength(1)
    expect(h.host.querySelector('img')?.getAttribute('src')).toBe(DEMO_AVATAR)
    expect(plain(h.text())).toContain(evil)
    expect((window as { hacked?: number }).hacked).toBeUndefined()
    // A picture that fails: the plain avatar (the first letter).
    await act(async () => h!.host.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(h.host.querySelectorAll('img')).toHaveLength(0)
    expect(plain(h.text())).toContain('😀')
  })
})

describe('"+ Add" (decision 20)', () => {
  let shared: ShareData[]
  beforeEach(() => {
    shared = []
  })

  it('Share my link: the share sheet gets the link; what a friend sees is said', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      share: async (d: ShareData) => void shared.push(d),
    })
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    await tap(h, 'Add a friend or a group')
    expect(btn(h, 'Share my link')).not.toBeNull()
    expect(btn(h, "Paste a friend's link")).not.toBeNull()
    expect(btn(h, 'New group')).not.toBeNull()
    await tap(h, 'Share my link')
    expect(plain(h.text())).toContain('Friends see your review numbers only')
    const go = [...h.host.querySelectorAll('.fr-panel button')].find((b) => b.textContent === 'Share my link') as HTMLButtonElement
    await act(async () => {
      go.click()
      go.click()
    })
    await h.settle()
    expect(s.calls.share).toBe(1)
    expect(shared).toEqual([
      {
        title: 'Notecards friend link',
        text: 'Add me as a friend on Notecards.',
        url: s.shareAnswer.kind === 'ok' ? s.shareAnswer.link : '',
      },
    ])
    expect(statusText(h)).toContain('Link sent.')
  })

  it('no share sheet: the clipboard; neither: the link shows to copy', async () => {
    const copied: string[] = []
    vi.stubGlobal('navigator', {
      ...navigator,
      share: undefined,
      clipboard: {
        writeText: async (t: string) => void copied.push(t),
        readText: async () => '',
      },
    })
    ;({ h } = await open(demoBoard(NOW)))
    await tap(h, 'Add a friend or a group')
    await tap(h, 'Share my link')
    await act(async () => ([...h!.host.querySelectorAll('.fr-panel button')].find((b) => b.textContent === 'Share my link') as HTMLButtonElement).click())
    await h.settle()
    expect(copied).toHaveLength(1)
    expect(statusText(h)).toContain('Link copied.')
    vi.stubGlobal('navigator', {
      ...navigator,
      share: undefined,
      clipboard: undefined,
    })
    await act(async () => ([...h!.host.querySelectorAll('.fr-panel button')].find((b) => b.textContent === 'Share my link') as HTMLButtonElement).click())
    await h.settle()
    expect((h.host.querySelector('.fr-panel input') as HTMLInputElement).value).toContain('notecards.yaseenarshad.com/friend#')
  })

  it('Paste: the clipboard is refused, so the field takes the link; after an add that is not paired, "Send my link back"', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        readText: async () => Promise.reject(new Error('NotAllowedError')),
      },
      share: async (d: ShareData) => void shared.push(d),
    })
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    await tap(h, 'Add a friend or a group')
    await tap(h, "Paste a friend's link")
    await tap(h, 'Paste from the clipboard')
    expect(statusText(h)).toContain('Paste the link in the field below.')
    expect(document.activeElement?.getAttribute('name')).toBe('friend-link')
    const back = 'https://notecards.yaseenarshad.com/friend#' + 'd'.repeat(32)
    s.pasteAnswer = {
      kind: 'added',
      name: 'Sam',
      paired: false,
      sendBack: back,
      handle: null as never,
    }
    await h.type('Or paste the link here', 'https://notecards.yaseenarshad.com/friend#' + 'e'.repeat(32))
    await tap(h, 'Add')
    expect(statusText(h)).toContain('Sam is added. Send them your link, so they can add you too.')
    await tap(h, 'Send my link back')
    expect(shared.at(-1)?.url).toBe(back)
  })

  it("a group link and a join request in the same paste box use 4E3's words", async () => {
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    await tap(h, 'Add a friend or a group')
    await tap(h, "Paste a friend's link")
    const joined = {
      kind: 'joined' as const,
      name: 'Study group',
      group: 'a'.repeat(32),
      sendToAdmin: 'https://notecards.yaseenarshad.com/join#x',
      handle: null as never,
    }
    s.pasteAnswer = joined
    await h.type('Or paste the link here', 'https://notecards.yaseenarshad.com/group#' + 'a'.repeat(32))
    await tap(h, 'Add')
    expect(statusText(h)).toContain(joinMessage(joined))
    expect(btn(h, 'Send my join link to the admin')).not.toBeNull()
    s.pasteAnswer = {
      kind: 'request',
      group: 'a'.repeat(32),
      groupName: 'Study group',
      pointer: 'b'.repeat(32),
      login: 'mina',
      name: 'Mina',
    }
    await tap(h, 'Add')
    expect(statusText(h)).toContain('Mina asks to join Study group.')
    await tap(h, 'Add Mina')
    expect(s.calls.groups.some((c) => c.startsWith('add:'))).toBe(true)
    expect(statusText(h)).toContain('Mina is in Study group now.')
  })

  it('New group: a name, then the group link to share', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      share: async (d: ShareData) => void shared.push(d),
    })
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    await tap(h, 'Add a friend or a group')
    await tap(h, 'New group')
    await h.type('Group name', 'Study group')
    await tap(h, 'Make the group')
    expect(s.calls.groups).toContain('create:Study group')
    expect(shared.at(-1)?.url).toContain('/group#')
    expect(statusText(h)).toContain('Group made.')
  })
})

describe('groups (decision 18; round 10, item 13; round 14)', () => {
  const base = (g: Board extends infer B ? B : never) => g
  it('a group: its streak, its members sorted; the admin deletes it after an ask', async () => {
    const group = demoGroup(NOW)
    let s: FakeService
    ;({ h, s } = await open(base({ ...demoBoard(NOW), groups: [group] })))
    await tap(h, 'Study group')
    expect(plain(h.text())).toContain('Group streak: 4 days that everyone finished')
    expect(rows(h).map((r) => r.split(' ').slice(0, 3).join(' '))).toEqual(['1 S Sam', '2 M Mina', '3 D You'])
    await tap(h, 'Delete group')
    expect(plain(h.host.querySelector('[role="alertdialog"]')?.textContent)).toContain('Delete Study group? The group is gone for each person in it.')
    await act(async () => (h!.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    await h.settle()
    expect(s.calls.groups).toContain(`delete:${group.group}`)
  })

  it('a member leaves after an ask; the admin removes a member who left', async () => {
    const member = demoGroup(NOW, { iAmAdmin: false, admin: 'mina' })
    let s: FakeService
    ;({ h, s } = await open({ ...demoBoard(NOW), groups: [member] }))
    await tap(h, 'Study group')
    await tap(h, 'Leave group')
    expect(plain(h.host.querySelector('[role="alertdialog"]')?.textContent)).toContain('Leave Study group? The others stop seeing your numbers.')
    await act(async () => (h!.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    await h.settle()
    expect(s.calls.groups).toContain(`leave:${member.group}`)
    h.unmount()
    const admin = demoGroup(NOW)
    admin.members[1] = {
      ...admin.members[1],
      state: 'left',
      read: null,
      label: 'Left the group',
    }
    ;({ h, s } = await open({ ...demoBoard(NOW), groups: [admin] }))
    await tap(h, 'Study group')
    expect(plain(h.text())).toContain('Left the group')
    await tap(h, 'Remove')
    expect(plain(h.host.querySelector('[role="alertdialog"]')?.textContent)).toContain('Remove Mina from Study group?')
    await act(async () => (h!.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    await h.settle()
    expect(s.calls.groups).toContain(`remove:${admin.group},${admin.members[1].pointer}`)
  })

  it("each state of a group shows 4E3's words", async () => {
    const id = (n: number) => String(n).repeat(32)
    const views = [
      {
        kind: 'waiting' as const,
        group: id(1),
        name: 'G1',
        sendToAdmin: 'https://notecards.yaseenarshad.com/join#x',
      },
      { kind: 'removed' as const, group: id(2), name: 'G2' },
      { kind: 'gone' as const, group: id(3), name: 'G3' },
      { kind: 'needs-repair' as const, group: id(4), name: 'G4' },
      { kind: 'newer-app' as const, group: id(5), name: 'G5' },
      { kind: 'offline' as const, group: id(6), name: 'G6' },
    ]
    ;({ h } = await open({ ...demoBoard(NOW), groups: views }))
    for (const v of views) {
      await tap(h, v.name)
      expect(plain(h.text())).toContain(groupViewMessage(v)!)
    }
    await tap(h, 'G1')
    expect(btn(h, 'Send my join link to the admin')).not.toBeNull()
  })
})

describe('"You vs <friend>" (decision 23) and Cheer and Nudge (decision 24)', () => {
  it('a tap on a friend opens it: the numbers side by side, their vault, the last 7 days', async () => {
    ;({ h } = await open(demoBoard(NOW)))
    await tap(h, /^Number 1, Sam/)
    await until(h, '.fr-week')
    await h.settle()
    expect(plain(h.host.querySelector('.topbar__title')?.textContent)).toBe('Sam')
    const lines = [...h.host.querySelectorAll('li.fr-vs')].map((l) => plain(l.getAttribute('aria-label')))
    expect(lines.slice(0, 3)).toEqual(['cards today: you 31, Sam 44', 'due cards: you 22, Sam 30', 'new cards: you 9, Sam 14'])
    expect(lines).toContain('remembered: you 91%, Sam 92%')
    expect(lines).toContain('days reviewed of 30: you 7, Sam 7')
    expect(plain(h.text())).toContain('Sam cheered you')
    // You: ✓ on -6 -5 -3 -2 -1; Sam: ✓ on -6 -5 -4 -2 -1 0 → both on -6 -5 -2 -1.
    expect(plain(h.text())).toContain('You both won 4 days of 7.')
    expect(h.host.querySelectorAll('.fr-day--both')).toHaveLength(4)
    expect(plain(h.host.querySelector('.fr-week li')?.getAttribute('aria-label'))).toMatch(/: you finished, Sam finished\. You both win\.$/)
    // The dot stays in the top bar (4D), with the gear.
    expect(btn(h, 'Settings')).not.toBeNull()
    await tap(h, '‹ Back')
    expect(plain(h.host.querySelector('.topbar__title')?.textContent)).not.toBe('Sam')
  })

  it('Cheer: one tap, one send (a double tap sends once), then an honest "sent"', async () => {
    let release!: () => void
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    s.markAnswer = (_m, kind) =>
      new Promise(
        (r) =>
          (release = () =>
            r({
              kind: 'sent',
              mark: { kind, at: new Date(NOW).toISOString() },
            })),
      )
    await tap(h, /^Number 1, Sam/)
    await until(h, '.fr-week')
    const cheer = btn(h, 'Cheer')!
    await act(async () => {
      cheer.click()
      cheer.click()
    })
    expect(btn(h, 'Sending…')).not.toBeNull()
    await act(async () => release())
    await h.settle()
    expect(s.calls.mark).toHaveLength(1)
    expect(statusText(h)).toMatch(/Cheer sent at .+\. Sam sees it in Friends\./)
  })

  it('the budget is used up: the nudge waits, with the time it goes; no signal: it goes when online', async () => {
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    s.markAnswer = async (_m, kind) => ({
      kind: 'waiting',
      mark: { kind, at: '' },
      why: 'budget',
      retryAt: NOW + 10 * 60_000,
    })
    await tap(h, /^Number 1, Sam/)
    await until(h, '.fr-week')
    await tap(h, 'Nudge')
    expect(statusText(h)).toMatch(/GitHub lets the app write only so often\. Your nudge goes at .+\./)
    s.markAnswer = async (_m, kind) => ({
      kind: 'waiting',
      mark: { kind, at: '' },
      why: 'offline',
      retryAt: null,
    })
    await tap(h, 'Cheer')
    expect(statusText(h)).toContain('No connection. Your cheer goes when you are online.')
  })

  it('YAZ-5258: a second cheer of the day makes no write and says so; the hourly cap of marks says when it goes', async () => {
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    s.markAnswer = async (_m, kind) => ({ kind: 'already', mark: { kind, at: new Date(NOW).toISOString() } })
    await tap(h, /^Number 1, Sam/)
    await until(h, '.fr-week')
    await tap(h, 'Cheer')
    expect(statusText(h)).toContain('You cheered Sam today. One cheer a day.')
    s.markAnswer = async (_m, kind) => ({ kind: 'waiting', mark: { kind, at: '' }, why: 'marks-limit', retryAt: NOW + 600_000 })
    await tap(h, 'Nudge')
    expect(statusText(h)).toMatch(/Cheers and nudges go out 5 an hour\. Your nudge goes at .+\./)
  })

  it('a cheer that waits from before shows its state when the screen opens', async () => {
    const board = demoBoard(NOW)
    const sam = board.friends[0]
    ;({ h } = await open({
      ...board,
      outbox: {
        [sam.mine]: {
          mark: { kind: 'cheer', at: new Date(NOW).toISOString() },
          state: 'waiting',
          why: 'budget',
          retryAt: NOW + 60_000,
        },
      },
    }))
    await tap(h, /^Number 1, Sam/)
    await until(h, '.fr-week')
    expect(statusText(h)).toMatch(/Your cheer goes at/)
  })

  it('Remove friend asks first', async () => {
    const board = demoBoard(NOW)
    let s: FakeService
    ;({ h, s } = await open(board))
    await tap(h, /^Number 1, Sam/)
    await until(h, '.fr-week')
    await tap(h, 'Remove friend')
    expect(plain(h.host.querySelector('[role="alertdialog"]')?.textContent)).toContain('Remove Sam? Sam stops seeing your numbers, and you stop seeing theirs.')
    await act(async () => (h!.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    await h.settle()
    expect(s.calls.remove).toEqual([board.friends[0].mine])
  })

  it('a member of a group: no Cheer or Nudge; the admin can remove them', async () => {
    const group = demoGroup(NOW)
    ;({ h } = await open({ ...demoBoard(NOW), groups: [group] }))
    await tap(h, 'Study group')
    await tap(h, /^Number 2, Mina/)
    await until(h, '.fr-week')
    expect(plain(h.host.querySelector('.topbar__title')?.textContent)).toBe('Mina')
    expect(btn(h, 'Cheer')).toBeNull()
    expect(btn(h, 'Remove from group')).not.toBeNull()
  })
})

describe('an action that cannot finish now says so (YAZ-5257)', () => {
  const paused = async () => ({ kind: 'paused', why: 'offline', retryAt: null })
  const yes = async (x: Harness) => {
    await act(async () => (x.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    for (let i = 0; i < 4; i++) await x.settle()
  }
  it('Remove friend on "You vs": the words, and the screen stays open', async () => {
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    s.answers.friend = paused
    await tap(h, /^Number 1, Sam/)
    await until(h, '.fr-week')
    await tap(h, 'Remove friend')
    await yes(h)
    expect(statusText(h)).toContain('Not removed yet: no connection. It finishes by itself when you are online.')
    expect(plain(h.host.querySelector('.topbar__title')?.textContent)).toBe('Sam')
  })
  it('Cancel link, Remove a member, Leave group and Delete group each say why they did not finish', async () => {
    const board = demoBoard(NOW, { shared: [{ mine: 'c'.repeat(32), link: 'x', at: new Date(NOW).toISOString() }] })
    let s: FakeService
    ;({ h, s } = await open(board))
    s.answers.friend = async () => ({ kind: 'paused', why: 'budget', retryAt: NOW + 600_000 })
    await tap(h, 'Cancel link')
    await yes(h)
    expect(statusText(h)).toMatch(/Not removed yet: GitHub lets the app write only so often\. It finishes by itself at .+\./)
    h.unmount()
    const admin = demoGroup(NOW)
    admin.members[1] = { ...admin.members[1], state: 'left', read: null, label: 'Left the group' }
    ;({ h, s } = await open({ ...demoBoard(NOW), groups: [admin] }))
    s.answers.remove = async () => ({ kind: 'offline' })
    await tap(h, 'Study group')
    await tap(h, 'Remove')
    await yes(h)
    expect(statusText(h)).toContain('No connection. Try again when you are online.')
    s.answers.delete = async () => ({ kind: 'paused', why: 'rate-limited', retryAt: null })
    await tap(h, 'Delete group')
    await yes(h)
    expect(statusText(h)).toContain('Not removed yet: GitHub asks the app to wait. It finishes by itself.')
    h.unmount()
    ;({ h, s } = await open({ ...demoBoard(NOW), groups: [demoGroup(NOW, { iAmAdmin: false, admin: 'mina' })] }))
    s.answers.leave = async () => ({ kind: 'needs-repair' })
    await tap(h, 'Study group')
    await tap(h, 'Leave group')
    await yes(h)
    expect(statusText(h)).toContain('Your friends list on GitHub cannot be read')
  })
  it('a row whose remove waits says "Removing…" and has no tap; a group that is leaving says so', async () => {
    const board = demoBoard(NOW, {
      friends: [demoFriend(NOW, 'Sam'), { ...demoFriend(NOW, 'Ann'), theirs: '', state: 'removing', label: 'Removing…', stats: null }],
      groups: [
        { kind: 'removing', group: '7'.repeat(32), name: 'Old group' },
        { kind: 'not-added', group: '8'.repeat(32), name: 'New group', sendToAdmin: 'https://x.test/join#a' },
      ],
    })
    ;({ h } = await open(board))
    expect(rows(h)).toContain('A Ann Removing…')
    expect(btn(h, /Ann/)?.disabled).toBe(true)
    await tap(h, 'Old group')
    expect(plain(h.text())).toContain('Removing…')
    expect(btn(h, 'Leave group')).toBeNull()
    await tap(h, 'New group')
    expect(plain(h.text())).toContain('The admin did not add you. Send them your join link again, or tap Leave.')
    expect(btn(h, 'Send my join link to the admin')).not.toBeNull()
    expect(btn(h, 'Leave group')).not.toBeNull()
  })
  it('YAZ-5265: two taps on "Add <name>" add once; a duplicate and an unverified request say so', async () => {
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    let release!: (v: unknown) => void
    s.answers.add = () => new Promise((r) => (release = r))
    await tap(h, 'Add a friend or a group')
    await tap(h, "Paste a friend's link")
    s.pasteAnswer = { kind: 'request', group: 'a'.repeat(32), groupName: 'Study group', pointer: 'b'.repeat(32), login: 'zed', name: 'Zed' }
    await h.type('Or paste the link here', 'https://notecards.yaseenarshad.com/join#x')
    await tap(h, 'Add')
    const add = btn(h, 'Add Zed')!
    await act(async () => {
      add.click()
      add.click()
    })
    expect(btn(h, 'Adding…')).not.toBeNull()
    await act(async () => release({ kind: 'duplicate', login: 'zed' }))
    await h.settle()
    expect(s.calls.groups.filter((c) => c.startsWith('add:'))).toHaveLength(1)
    expect(statusText(h)).toContain('zed is already in the group.')
    s.pasteAnswer = { kind: 'unverified' } as never
    await tap(h, 'Add')
    expect(statusText(h)).toContain('The app cannot check who sent this join link.')
  })
})
