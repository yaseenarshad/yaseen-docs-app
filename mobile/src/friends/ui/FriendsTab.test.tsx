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

// YAZ-5652: Friends is off in the app (`shared/features.ts`); this file tests today's behaviour with it on.
vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))

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

/** Sets value on an `<input>` by selector and fires an input event. */
const typeInput = async (x: Harness, selector: string, value: string) => {
  const input = x.host.querySelector(selector) as HTMLInputElement | null
  if (input === null) throw new Error(`No input "${selector}" on: ${plain(x.text())}`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
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
  // The tab is a lazy chunk: wait reliably (wall-clock + microtasks) until it drew the board.
  await vi.waitFor(
    async () => {
      await x.settle()
      expect(x.host.querySelector('section[aria-label="Friends"]:not([aria-busy])')).not.toBeNull()
    },
    { timeout: 5000, interval: 10 },
  )
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

describe('the Friends tab (decisions 21, 25; YAZ-6271..6274)', () => {
  it('opens on Friends: tiered sort, gold medal + green check for finishers, streak + duration, my own row bold', async () => {
    ;({ h } = await open(demoBoard(NOW)))
    expect(plain(h.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent)).toBe('Friends')
    expect(rows(h)).toEqual([
      '🥇 S Sam 2h ago ✓ 44 cards 8d 🔥 · 1hr 6min',
      'D Demo Person now 31 cards 2d 🔥 · 55 min',
      'P Priya 43m ago 12 cards 49 min',
      'L Leo no update yet 0 cards 0 min',
    ])
    expect(plain(h.host.querySelector('.fr-name--you')?.textContent)).toBe('Demo Person')
    expect(labels(h)[0]).toBe('Sam, 44 cards, 66 minutes, Finished the due cards, 2h ago')
    expect(labels(h)[1]).toBe('You, 31 cards, 55 minutes, Started, due cards left, now')
  })

  it('Today, Yesterday, Week and Month change the numbers; Week and Month have no medal or mark', async () => {
    ;({ h } = await open(demoBoard(NOW)))
    await tap(h, 'Yesterday')
    expect(rows(h)[0]).toBe('🥇 P Priya ✓ 51 cards 0 min')
    expect(plain(h.host.querySelector('[aria-pressed="true"]')?.textContent)).toBe('Yesterday')
    await tap(h, 'Week')
    expect(h.host.querySelectorAll('.fr-mark')).toHaveLength(0)
    expect(h.host.querySelectorAll('.fr-rank--medal')).toHaveLength(0)
    expect([...h.host.querySelectorAll('.fr-rank')].map((el) => el.textContent)).toEqual(['1', '2', '3', '4'])
    await tap(h, 'Month')
    expect(h.host.querySelectorAll('.fr-mark')).toHaveLength(0)
    expect(h.host.querySelectorAll('.fr-rank--medal')).toHaveLength(0)
    expect([...h.host.querySelectorAll('.fr-rank')].map((el) => el.textContent)).toEqual(['1', '2', '3', '4'])
  })

  it('no friend yet: centered empty state card and what a friend sees', async () => {
    ;({ h } = await open({ ...demoBoard(NOW), friends: [] }))
    expect(plain(h.text())).toContain('Study together with friends')
    expect(plain(h.text())).toContain('Add a friend or create a group')
    expect(plain(h.text())).toContain('Never your cards or your pages.')
    expect(btn(h, 'Add friend or group')).not.toBeNull()
  })

  it('"Waiting…", "No longer shares with you", a newer app, a file that cannot be read', async () => {
    const board = demoBoard(NOW, {
      friends: [
        demoFriend(NOW, 'Ana', {
          state: 'waiting',
          label: 'Waiting for Ana to add you',
          sendBack: 'https://notecard.yaseenarshad.com/friend#' + 'c'.repeat(32),
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
      'D Demo Person now 31 cards 2d 🔥 · 55 min',
      'A Ana Waiting for Ana to add you · 2h ago 10 cards 10 min',
      'B Ben No longer shares with you Remove',
      'C Cy Needs a newer app',
      "D Di Can't read their numbers Remove",
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

  it('YAZ-5274: a link that stopped working has its row and one action; a friend who added me back is said one time', async () => {
    const board = demoBoard(NOW, {
      friends: [demoFriend(NOW, 'Sam'), demoFriend(NOW, 'Zoe', { state: 'stopped', label: 'This link stopped working. Share a new one.', stats: null })],
      newlyPaired: ['\u2068Sam\u2069'],
    })
    ;({ h } = await open(board))
    expect(rows(h)).toContain('Z Zoe This link stopped working. Share a new one. New link')
    expect(statusText(h)).toContain('Sam added you back. You are friends now.')
    await tap(h, 'Share a new link')
    expect(h.host.querySelector('[role="dialog"][aria-label="Share your friend link"]')).not.toBeNull()
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

  it('YAZ-5399: the vault of the list is gone: plain words, the way out for each other vault, its effect asked first', async () => {
    const o = await open({ kind: 'home-gone', home: 'ali/vault', vaults: ['ali/notes'] })
    h = o.h
    const s = o.s
    expect(plain(h.text())).toContain('Your friends list was in the vault ali/vault. GitHub does not have that vault for your account any more')
    await tap(h, 'Start the friends list again in ali/notes')
    expect(plain(h.text())).toContain('This stops sharing with everyone.')
    expect(s.calls.restart).toEqual([])
    await tap(h, 'Start again')
    expect(s.calls.restart).toEqual(['ali/notes'])
  })

  it('no signal: the last numbers, each with "updated … ago"', async () => {
    ;({ h } = await open(demoBoard(NOW, { offline: true })))
    expect(plain(h.text())).toContain('No connection. These are the last numbers the app read.')
    expect(rows(h)[0]).toContain('2h ago')
  })

  it("this phone's send of my numbers: shows error line when not sent, hides healthy last-sent line", async () => {
    ;({ h } = await open(demoBoard(NOW, { sending: { status: 'no-gists', lastSentAt: null, retryAt: null, remade: false } })))
    expect(plain(h.text())).toContain('Not sent: the token has no Gists permission.')
    h.unmount()
    ;({ h } = await open(demoBoard(NOW, { sending: { status: 'sent', lastSentAt: NOW - 5 * 60_000, retryAt: null, remade: false } })))
    expect(plain(h.text())).not.toContain('Your numbers were last sent')
  })

  it('the wrong setup: vaults on two GitHub accounts (round 13, item 4)', async () => {
    ;({ h } = await open(demoBoard(NOW), { logins: ['demo', 'work'] }))
    expect(plain(h.text())).toContain('Your vaults are on two GitHub accounts. Friends use @demo.')
    await tap(h, 'Change')
    // Settings is a lazy chunk: wait for it to draw.
    for (const end = Date.now() + 3000; h.host.querySelector('.settings__version') === null && Date.now() < end; ) await h.settle()
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

describe('"+ Add" (decision 20; StepUp action sheet)', () => {
  let shared: ShareData[]
  beforeEach(() => {
    shared = []
  })

  it('Add friends: auto-loads QR SVG + share link; tapping Share link invokes Web Share', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      share: async (d: ShareData) => void shared.push(d),
    })
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    await tap(h, 'Add a friend or a group')
    expect(btn(h, 'Add friends')).not.toBeNull()
    expect(btn(h, 'Create new group')).not.toBeNull()
    expect(btn(h, 'Enter link to add friend/group')).not.toBeNull()
    await tap(h, 'Add friends')
    for (let i = 0; i < 10 && h.host.querySelector('.fr-qr-sheet__box svg') === null; i++) await h.settle()
    expect(h.host.querySelector('.fr-qr-sheet__box svg')).not.toBeNull()
    expect(s.calls.share).toBe(1)
    await tap(h, 'Share link')
    expect(shared).toEqual([
      {
        title: 'Yaseen Docs friend link',
        text: 'Add me as a friend on Yaseen Docs.',
        url: s.shareAnswer.kind === 'ok' ? s.shareAnswer.link : '',
      },
    ])
  })

  it('Enter link: clipboard refused falls back to input field; unpaired add offers "Send my link back"', async () => {
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
    await tap(h, 'Enter link to add friend/group')
    await tap(h, 'Paste from clipboard')
    expect(statusText(h)).toContain('Paste the link in the field below.')
    expect(document.activeElement?.getAttribute('name')).toBe('friend-link')
    const back = 'https://notecard.yaseenarshad.com/friend#' + 'd'.repeat(32)
    s.pasteAnswer = {
      kind: 'added',
      name: 'Sam',
      paired: false,
      sendBack: back,
      handle: null as never,
    }
    await typeInput(h, 'input[name="friend-link"]', 'https://notecard.yaseenarshad.com/friend#' + 'e'.repeat(32))
    await tap(h, 'Submit')
    expect(statusText(h)).toContain('Sam is added. Send them your link, so they can add you too.')
    await tap(h, 'Send my link back')
    expect(shared.at(-1)?.url).toBe(back)
  })

  it("a group link and a join request in the same paste box use 4E3's words", async () => {
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    await tap(h, 'Add a friend or a group')
    await tap(h, 'Enter link to add friend/group')
    const joined = {
      kind: 'joined' as const,
      name: 'Study group',
      group: 'a'.repeat(32),
      sendToAdmin: 'https://notecard.yaseenarshad.com/join#x',
      handle: null as never,
    }
    s.pasteAnswer = joined
    await typeInput(h, 'input[name="friend-link"]', 'https://notecard.yaseenarshad.com/group#' + 'a'.repeat(32))
    await tap(h, 'Submit')
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
    await tap(h, 'Submit')
    expect(statusText(h)).toContain('Mina asks to join Study group.')
    await tap(h, 'Add Mina')
    expect(s.calls.groups.some((c) => c.startsWith('add:'))).toBe(true)
    expect(statusText(h)).toContain('Mina is in Study group now.')
  })

  it('Create new group: a name, then the group link to share', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      share: async (d: ShareData) => void shared.push(d),
    })
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    await tap(h, 'Add a friend or a group')
    await tap(h, 'Create new group')
    await typeInput(h, '[role="dialog"][aria-label="Create new group"] input', 'Study group')
    await tap(h, 'Create')
    expect(s.calls.groups).toContain('create:Study group')
    expect(shared.at(-1)?.url).toContain('/group#')
    expect(statusText(h)).toContain('Group made.')
  })
})

describe('groups (decision 18; YAZ-6267..6274)', () => {
  const base = (g: Board extends infer B ? B : never) => g
  it('a group: its streak footer row + 30-day detail screen, its members sorted; admin deletes via Group Settings', async () => {
    const group = demoGroup(NOW)
    let s: FakeService
    ;({ h, s } = await open(base({ ...demoBoard(NOW), groups: [group] })))
    await tap(h, 'Study group')
    expect(plain(h.text())).toContain('Group streak')
    expect(plain(h.text())).toContain('4d 🔥')
    expect(rows(h).map((r) => r.replace(/^🥇\s*/, '').split(' ').slice(0, 2).join(' '))).toEqual(['S Sam', 'M Mina', 'D Demo'])
    // Clicking the Group streak footer row opens the 30-day detail view
    await tap(h, /Group streak/)
    expect(plain(h.text())).toContain('4d group streak')
    expect(h.host.querySelectorAll('.fr-strip30__col')).toHaveLength(30)
    await tap(h, '← Back')
    // Active group pill opens Manage group sheet -> Group Settings -> Delete group
    await tap(h, 'Study group ▾')
    await tap(h, 'Group Settings')
    await tap(h, 'Delete group')
    expect(plain(h.host.querySelector('[role="alertdialog"]')?.textContent)).toContain('Delete Study group? The group is gone for each person in it.')
    await act(async () => (h!.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    await h.settle()
    expect(s.calls.groups).toContain(`delete:${group.group}`)
  })

  it('a member leaves via Manage group sheet; the admin removes a member who left', async () => {
    const member = demoGroup(NOW, { iAmAdmin: false, admin: 'mina' })
    let s: FakeService
    ;({ h, s } = await open({ ...demoBoard(NOW), groups: [member] }))
    await tap(h, 'Study group')
    await tap(h, 'Study group ▾')
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
        sendToAdmin: 'https://notecard.yaseenarshad.com/join#x',
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
  })
})

describe('"You vs <friend>" (decision 23; YAZ-6269..6274)', () => {
  it('a tap on a friend opens it: buddy streak, 30-day horizontal strip, numbers side by side, their vault', async () => {
    ;({ h } = await open(demoBoard(NOW)))
    await tap(h, /^Sam,/)
    await until(h, '.fr-strip30')
    await h.settle()
    expect(plain(h.host.querySelector('.topbar__title')?.textContent)).toBe('Sam')
    const lines = [...h.host.querySelectorAll('li.fr-vs')].map((l) => plain(l.getAttribute('aria-label')))
    expect(lines.slice(0, 3)).toEqual(['cards today: you 31, Sam 44', 'due cards: you 22, Sam 30', 'new cards: you 9, Sam 14'])
    expect(lines).toContain('remembered: you 91%, Sam 92%')
    expect(lines).toContain('days reviewed of 30: you 7, Sam 7')
    expect(h.host.querySelectorAll('.fr-strip30__col')).toHaveLength(30)
    expect(h.host.querySelectorAll('.fr-day--both')).toHaveLength(4)
    expect(btn(h, 'Settings')).not.toBeNull()
    await tap(h, 'Back')
    expect(plain(h.host.querySelector('.topbar__title')?.textContent)).not.toBe('Sam')
  })

  it('YAZ-5261: "You vs" says which column is you', async () => {
    ;({ h } = await open(demoBoard(NOW)))
    await tap(h, /^Sam,/)
    await until(h, '.fr-strip30')
    const heads = [...h.host.querySelectorAll('.fr-vs__who')].map((e) => plain(e.textContent))
    expect(heads).toEqual(['You', 'Sam'])
    expect(plain(h.host.querySelector('.fr-vs--who')?.getAttribute('aria-label'))).toBe('You vs Sam')
  })

  it('Remove friend asks first', async () => {
    const board = demoBoard(NOW)
    let s: FakeService
    ;({ h, s } = await open(board))
    await tap(h, /^Sam,/)
    await until(h, '.fr-strip30')
    await tap(h, 'Remove friend')
    expect(plain(h.host.querySelector('[role="alertdialog"]')?.textContent)).toContain('Remove Sam? Sam stops seeing your numbers, and you stop seeing theirs.')
    await act(async () => (h!.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    await h.settle()
    expect(s.calls.remove).toEqual([board.friends[0].mine])
  })

  it('a member of a group: admin can remove them from VS', async () => {
    const group = demoGroup(NOW)
    ;({ h } = await open({ ...demoBoard(NOW), groups: [group] }))
    await tap(h, 'Study group')
    await tap(h, /^Mina,/)
    await until(h, '.fr-strip30')
    expect(plain(h.host.querySelector('.topbar__title')?.textContent)).toBe('Mina')
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
    await tap(h, /^Sam,/)
    await until(h, '.fr-strip30')
    await tap(h, 'Remove friend')
    await yes(h)
    expect(statusText(h)).toContain('Not removed yet: no connection. It finishes by itself when you are online.')
    expect(plain(h.host.querySelector('.topbar__title')?.textContent)).toBe('Sam')
  })
  it('Remove a member, Leave group and Delete group each say why they did not finish', async () => {
    let s: FakeService
    const admin = demoGroup(NOW)
    admin.members[1] = { ...admin.members[1], state: 'left', read: null, label: 'Left the group' }
    ;({ h, s } = await open({ ...demoBoard(NOW), groups: [admin] }))
    s.answers.remove = async () => ({ kind: 'offline' })
    await tap(h, 'Study group')
    await tap(h, 'Remove')
    await yes(h)
    expect(statusText(h)).toContain('No connection. Try again when you are online.')
    s.answers.delete = async () => ({ kind: 'paused', why: 'rate-limited', retryAt: null })
    await tap(h, 'Study group ▾')
    await tap(h, 'Group Settings')
    await tap(h, 'Delete group')
    await yes(h)
    expect(statusText(h)).toContain('Not removed yet: GitHub asks the app to wait. It finishes by itself.')
    h.unmount()
    ;({ h, s } = await open({ ...demoBoard(NOW), groups: [demoGroup(NOW, { iAmAdmin: false, admin: 'mina' })] }))
    s.answers.leave = async () => ({ kind: 'needs-repair' })
    await tap(h, 'Study group')
    await tap(h, 'Study group ▾')
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
    await tap(h, 'New group')
    expect(plain(h.text())).toContain('The admin did not add you. Send them your join link again, or tap Leave.')
  })
  it('YAZ-5265: two taps on "Add <name>" add once; a duplicate and an unverified request say so', async () => {
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    let release!: (v: unknown) => void
    s.answers.add = () => new Promise((r) => (release = r))
    await tap(h, 'Add a friend or a group')
    await tap(h, 'Enter link to add friend/group')
    s.pasteAnswer = { kind: 'request', group: 'a'.repeat(32), groupName: 'Study group', pointer: 'b'.repeat(32), login: 'zed', name: 'Zed' }
    await typeInput(h, 'input[name="friend-link"]', 'https://notecard.yaseenarshad.com/join#x')
    await tap(h, 'Submit')
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
    await tap(h, 'Submit')
    expect(statusText(h)).toContain('The app cannot check who sent this join link.')
  })
})

describe('the states of the friends list v2 (round 3) on the tab', () => {
  it('B8: a member who joined today: one quiet line, the name cleaned', async () => {
    const group = demoGroup(NOW)
    group.members[1] = { ...group.members[1], name: '\u2068Mina\u2069', joinedToday: true }
    ;({ h } = await open({ ...demoBoard(NOW), groups: [group] }))
    await tap(h, 'Study group')
    expect(plain(h.text())).toContain('Mina joined today. The group streak counts them from tomorrow.')
  })

  it('a remove that waits because the token lost the Gists permission says so, with the way forward', async () => {
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    s.answers.friend = async () => ({ kind: 'paused', why: 'refused', retryAt: null })
    await tap(h, /^Sam,/)
    await until(h, '.fr-strip30')
    await tap(h, 'Remove friend')
    await act(async () => (h!.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    for (let i = 0; i < 4; i++) await h.settle()
    expect(statusText(h)).toContain('Not removed yet: your token has no Gists permission. Add it on GitHub; then the remove finishes by itself.')
  })

  it('a friend whose numbers cannot be read can be removed; a friend not read yet with no signal says so', async () => {
    const board = demoBoard(NOW, {
      friends: [
        demoFriend(NOW, 'Di', { state: 'unreadable', label: "Can't read their numbers", stats: null }),
        demoFriend(NOW, 'Ed', { state: 'offline', label: null, stats: null }),
      ],
    })
    let s: FakeService
    ;({ h, s } = await open(board))
    expect(rows(h)).toContain('E Ed No connection. Not read yet.')
    await tap(h, 'Remove')
    expect(plain(h.host.querySelector('[role="alertdialog"]')?.textContent)).toContain('Remove Di? You cannot read their numbers now.')
    await act(async () => (h!.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    await h.settle()
    expect(s.calls.remove).toEqual([board.friends[0].mine])
  })
})

describe('YAZ-6218..6275: D1 Friends UI additions', () => {
  it('shows Buddy Streak pill and shared card count on VS screen', async () => {
    const base = demoBoard(NOW)
    const sam = { ...base.friends[0], userId: 101, login: 'sam', buddyStreak: 5, since: new Date(NOW - 30 * 86_400_000).toISOString(), sharedCardCount: 12 }
    const priya = { ...base.friends[1], userId: 102, login: 'priya', buddyStreak: 0, since: new Date(NOW - 5 * 86_400_000).toISOString(), sharedCardCount: 2 }
    ;({ h } = await open({ ...base, friends: [sam, priya] }))

    // Buddy streak pill renders next to Sam (waiting on today -> pending pill)
    expect(h.host.querySelector('.fr-buddy-pill')?.textContent).toContain('5d')

    // You vs Sam shows buddy streak + shared card count
    await tap(h, /^Sam,/)
    await until(h, '.fr-strip30')
    expect(plain(h.text())).toContain('5d buddy streak')
    expect(plain(h.text())).toContain('12 cards shared together')
  })

  it('shows local QR SVG on Add friends', async () => {
    vi.stubGlobal('navigator', { ...navigator, share: async () => undefined })
    ;({ h } = await open(demoBoard(NOW)))
    await tap(h, 'Add a friend or a group')
    await tap(h, 'Add friends')
    for (let i = 0; i < 10 && h.host.querySelector('.fr-qr-sheet__box svg') === null; i++) await h.settle()
    expect(h.host.querySelector('.fr-qr-sheet__box svg')).not.toBeNull()
  })

  it('shows unified Shared (1) flat list with AcceptCardSheet and two-tap Dismiss', async () => {
    const card = {
      id: 'card-1',
      folderId: null,
      senderId: 101,
      senderLogin: 'sam',
      title: 'Spaced Repetition',
      markdown: 'What is FSRS?\n---\nFree Spaced Repetition Scheduler',
      note: 'Great card!',
      attachments: [],
      status: 'pending' as const,
      createdAt: new Date(NOW).toISOString(),
    }
    const board = demoBoard(NOW, { incomingCards: [card] })
    const accepted: { folder: string; upNext?: boolean }[] = []
    const states: { id: string; status: string }[] = []
    let s: FakeService
    ;({ h, s } = await open(board))
    s.vaultFolders = async () => ['Biology', 'History']
    s.acceptCardToVault = async (input) => {
      accepted.push({ folder: input.folder, upNext: input.upNext })
      return { ok: true, path: `${input.folder}/spaced-repetition-SH-100001.md` }
    }
    s.setCardState = async (id, status) => {
      states.push({ id, status })
      return { ok: true }
    }

    await tap(h, 'Shared (1)')
    expect(plain(h.text())).toContain('Spaced Repetition')

    await tap(h, 'Add')
    expect(h.host.querySelector('[role="dialog"][aria-label="Where should we save this card?"]')).not.toBeNull()
    await tap(h, 'Add to Shared Cards')
    expect(accepted).toEqual([{ folder: 'Shared Cards', upNext: false }])

    // Two-tap Dismiss works (× -> Dismiss?)
    await tap(h, 'Dismiss')
    await tap(h, 'Dismiss?')
    expect(states).toEqual([{ id: 'card-1', status: 'dismissed' }])
  })

  it('shows shared folder inside unified Shared (1) with 1-shot Import modal', async () => {
    const folder = {
      id: 'folder-1',
      name: 'Anatomy Week 1',
      senderId: 101,
      senderLogin: 'sam',
      createdAt: new Date(NOW).toISOString(),
      cards: [
        {
          id: 'gc-1',
          folderId: 'folder-1',
          senderId: 101,
          senderLogin: 'sam',
          title: 'Femur',
          markdown: 'Longest bone',
          note: null,
          attachments: [],
          status: 'pending' as const,
          createdAt: new Date(NOW).toISOString(),
        },
      ],
    }
    const grp = demoGroup(NOW, { name: 'Study Group' })
    const d1Grp = {
      id: grp.group,
      name: 'Study Group',
      adminId: 1,
      isAdmin: true,
      myStatus: 'active' as const,
      inviteCode: 'grp23def45',
      members: [],
      pending: [],
      sharedFolders: [folder],
      sharedCards: [],
    }
    const board = demoBoard(NOW, { groups: [grp], d1Groups: [d1Grp] })
    const imported: string[] = []
    let s: FakeService
    ;({ h, s } = await open(board))
    s.vaultFolders = async () => ['Med School']
    s.importFolderToVault = async (input) => {
      imported.push(`${input.targetDir}/${input.folder.name}`)
      return { ok: true, paths: ['Shared Cards/Anatomy Week 1/femur-SH-100001.md'] }
    }

    await tap(h, 'Shared (1)')
    expect(plain(h.text())).toContain('Anatomy Week 1')
    await tap(h, 'Import (1)')
    await tap(h, 'Add to Shared Cards')
    expect(imported).toEqual(['Shared Cards/Anatomy Week 1'])
  })

  it('shows Delete my Friends data in Settings with confirmation calling deleteMe()', async () => {
    let deleted = false
    let s: FakeService
    ;({ h, s } = await open(demoBoard(NOW)))
    s.deleteMe = async () => {
      deleted = true
      return { ok: true, deleted: true }
    }
    await tap(h, 'Settings')
    await tap(h, 'Delete my Friends data')
    expect(plain(h.host.querySelector('[role="alertdialog"]')?.textContent)).toContain('Delete all your Friends data?')
    await act(async () => (h!.host.querySelector('[role="alertdialog"] .btn--danger') as HTMLButtonElement).click())
    await h.settle()
    expect(deleted).toBe(true)
    expect(statusText(h)).toContain('Your Friends data has been deleted.')
  })
})
