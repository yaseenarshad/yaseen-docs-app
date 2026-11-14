// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAccount } from '../auth/account'
import { formatScanCode } from '../auth/scanCode'
import { loadVaultList, PHONE, type VaultStore } from '../store'
import { UNIT_WORD_PATH } from '../app/unitWord'
import { REMOVE_QUEUE } from '../friends/removeQueue'
import { GOOD, mount, newPhone, NO_CONTENTS, READ_ONLY, SECOND, signInWithForm, WRONG, type Harness } from './testing'

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
})

const tabs = (x: Harness) => [...x.host.querySelectorAll('[role="tab"]')].map((t) => `${t.textContent}${t.getAttribute('aria-selected') === 'true' ? '*' : ''}`)
const storedNothing = async (store: VaultStore, x: Harness) => {
  expect((await loadVaultList(store)).vaults).toEqual([])
  expect(await x.tokens.read('yaseen/vault@main')).toBeNull()
}

describe('first open (row F1) and the typed sign-in (decision 13)', () => {
  it('shows the sign-in: two fields, one button, the guide link and Scan a code; no tabs and no call to GitHub', async () => {
    h = await mount()
    expect(h.text()).toContain('Connect the GitHub repo that holds your vault.')
    expect(h.host.querySelector('input[name="repo"]')?.getAttribute('placeholder')).toBe('owner/repo')
    expect(h.host.querySelector('input[name="token"]')?.getAttribute('type')).toBe('password')
    expect(h.button('Connect vault')).not.toBeNull()
    expect(h.button('How to make a token')).not.toBeNull()
    expect(h.button('Scan a code')).not.toBeNull()
    expect(tabs(h)).toEqual([])
    expect(h.github.calls).toEqual([])
  })

  it('a good token opens the vault on Review when there is no friend yet (decision 21)', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    expect(tabs(h)).toEqual(['Friends', 'Review*', 'Search'])
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('vault')
    // At start the phone has no vault: the sync opens none. Then the new vault.
    expect(h.sync.opened.map((v) => v?.repo ?? null)).toEqual([null, 'yaseen/vault'])
    expect(await h.tokens.read('yaseen/vault@main')).toBe(GOOD)
    // The token is never on screen.
    expect(h.host.innerHTML).not.toContain(GOOD)
  })

  it('opens on Friends when there is a friend (decision 21)', async () => {
    const phone = await newPhone()
    h = await mount({ phone })
    await signInWithForm(h, 'yaseen/vault', GOOD)
    h.unmount()
    h = await mount({ phone, hasFriends: true })
    expect(tabs(h)).toEqual(['Friends*', 'Review', 'Search'])
    h.unmount()
    h = await mount({ phone, hasFriends: false })
    expect(tabs(h)).toEqual(['Friends', 'Review*', 'Search'])
  })

  it('a tab tap moves to that tab; each tab draws its own slot', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Search')
    expect(tabs(h)).toEqual(['Friends', 'Review', 'Search*'])
    expect(h.host.querySelector('section[aria-label="Search"]')).not.toBeNull()
    await h.click('Friends')
    expect(h.host.querySelector('section[aria-label="Friends"]')).not.toBeNull()
  })
})

describe('each sign-in result has plain words and a way forward', () => {
  const cases: { name: string; repo: string; token: string; setup?: (x: Harness) => void; words: string; forward: string }[] = [
    { name: 'bad-repo', repo: 'not a repo', token: GOOD, words: 'Type the repo as owner/name', forward: 'Change the repo' },
    { name: 'bad-token', repo: 'yaseen/vault', token: 'short', words: 'That is not a GitHub token.', forward: 'How to make a token' },
    { name: 'unauthorized (F3)', repo: 'yaseen/vault', token: WRONG, words: 'GitHub does not accept this token.', forward: 'How to make a token' },
    { name: 'repo-not-found (F4)', repo: 'yaseen/missing', token: GOOD, words: "Can't find yaseen/missing, or your token can't read it.", forward: 'How to make a token' },
    { name: 'no-vault (round 16)', repo: 'yaseen/code', token: GOOD, words: 'yaseen/code has no Yaseen Docs vault at its top', forward: 'How to set up the repo' },
    { name: 'no-contents', repo: 'yaseen/vault', token: NO_CONTENTS, words: 'set Contents to "Read and write"', forward: 'How to make a token' },
    { name: 'read-only', repo: 'yaseen/vault', token: READ_ONLY, words: 'Your token can read yaseen/vault but not change it.', forward: 'How to make a token' },
    { name: 'offline', repo: 'yaseen/vault', token: GOOD, setup: (x) => void (x.github.offline = true), words: 'No internet connection.', forward: 'Try again' },
    { name: 'github-down', repo: 'yaseen/vault', token: GOOD, setup: (x) => void (x.github.down = true), words: 'GitHub is not answering right now.', forward: 'Try again' },
    {
      name: 'rate-limited (N4)',
      repo: 'yaseen/vault',
      token: GOOD,
      setup: (x) => void (x.github.rateLimitedUntil = Date.UTC(2026, 10, 13, 13) / 1000),
      words: 'GitHub asks us to slow down. Try again after',
      forward: 'Try again',
    },
  ]
  for (const c of cases)
    it(`${c.name}: shows the words, a way forward, and stores nothing`, async () => {
      h = await mount()
      c.setup?.(h)
      await signInWithForm(h, c.repo, c.token)
      const alert = h.host.querySelector('[role="alert"]')
      expect(alert?.textContent).toContain(c.words)
      expect(alert?.querySelector('button')?.textContent).toBe(c.forward)
      expect(h.text()).not.toMatch(/\b(401|403|404|422|503)\b/)
      await storedNothing(h.store, h)
    })

  it('"Try again" runs the check again: it works when the connection is back', async () => {
    h = await mount()
    h.github.offline = true
    await signInWithForm(h, 'yaseen/vault', GOOD)
    h.github.offline = false
    await h.click('Try again')
    expect(tabs(h)).toEqual(['Friends', 'Review*', 'Search'])
  })

  it('already-added: "Open it" opens that vault', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    // From Settings › Add vault, the same vault again.
    await h.click('Settings')
    await h.click('Add vault')
    await signInWithForm(h, 'yaseen/vault', GOOD)
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain('yaseen/vault (main) is already on this phone.')
    await h.click('Open it')
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('vault')
  })

  it('"How to make a token" opens "Set up your phone" with the two permissions and the supported setup; Back returns', async () => {
    h = await mount()
    await h.click('How to make a token')
    const text = h.text()
    expect(text).toContain('Set up your phone')
    expect(text).toContain('one GitHub account and one token')
    expect(text).toContain('Contents: Read and write')
    expect(text).toContain('Gists: Read and write')
    expect(text).toContain('Add to Home Screen')
    await h.click('‹ Back')
    expect(h.button('Connect vault')).not.toBeNull()
  })
})

describe('Scan a code (round 11, item 23), with a fake camera', () => {
  const code = (over: Partial<{ repo: string; branch: string; token: string; expiresAt: string | null }> = {}) =>
    formatScanCode({ repo: 'yaseen/vault', branch: 'phone', token: GOOD, expiresAt: '2026-11-20T00:00:00.000Z', ...over })

  it('a code from the Mac signs in with its repo, branch and end date, and never shows the token', async () => {
    h = await mount()
    await h.click('Scan a code')
    expect(h.scanner.on).toBe(true)
    await h.scan(code())
    expect(h.scanner.on).toBe(false)
    expect(tabs(h)).toEqual(['Friends', 'Review*', 'Search'])
    expect(await h.tokens.read('yaseen/vault@phone')).toBe(GOOD)
    expect((await loadAccount(h.store, 'yaseen/vault@phone'))?.expiresAt).toBe('2026-11-20T00:00:00.000Z')
    expect(h.host.innerHTML).not.toContain(GOOD)
  })

  it('a code that is not ours: plain words, and the camera keeps reading', async () => {
    h = await mount()
    await h.click('Scan a code')
    await h.scan('https://example.com/menu')
    expect(h.text()).toContain('This is not a Notecard code.')
    expect(h.scanner.on).toBe(true)
    await h.scan(code())
    expect(tabs(h)).toEqual(['Friends', 'Review*', 'Search'])
  })

  it('a code whose token GitHub refuses: the sign-in words and a way forward, then "Scan again"', async () => {
    h = await mount()
    await h.click('Scan a code')
    await h.scan(code({ token: WRONG }))
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain('GitHub does not accept this token.')
    expect(h.button('How to make a token')).not.toBeNull()
    await h.click('Scan again')
    expect(h.scanner.on).toBe(true)
    await storedNothing(h.store, h)
  })

  it('no camera permission: plain words, and the typed form is the way forward', async () => {
    h = await mount()
    h.scanner.failWith = 'denied'
    await h.click('Scan a code')
    expect(h.text()).toContain('Notecard may not use the camera.')
    await h.click('Type the repo and token')
    expect(h.button('Connect vault')).not.toBeNull()
  })
})

describe('Settings: vaults (decision 7)', () => {
  async function twoVaults(): Promise<Harness> {
    const x = await mount()
    await signInWithForm(x, 'yaseen/vault', GOOD)
    await x.click('Settings')
    await x.click('Add vault')
    expect(x.text()).toContain('Add a vault')
    await signInWithForm(x, 'yaseen/second', SECOND)
    return x
  }

  it('Add vault uses the same form, then the new vault opens', async () => {
    h = await twoVaults()
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('second')
    expect((await loadVaultList(h.store)).vaults.map((v) => v.repo)).toEqual(['yaseen/vault', 'yaseen/second'])
    expect(h.sync.opened.at(-1)?.repo).toBe('yaseen/second')
  })

  it('a tap on a vault switches the open vault; only the open vault is open in the sync', async () => {
    h = await twoVaults()
    await h.click('Settings')
    expect(h.button('yaseen/second, open')).not.toBeNull()
    await h.click('Open yaseen/vault')
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('vault')
    expect((await loadVaultList(h.store)).open).toBe('yaseen/vault@main')
    expect(h.sync.opened.at(-1)?.repo).toBe('yaseen/vault')
  })

  it('Remove asks first, then removes the vault, its token and its files; the other vault opens', async () => {
    h = await twoVaults()
    await h.store.write('yaseen/second@main', 'a.md', '# A')
    await h.click('Settings')
    await h.click('More for yaseen/second')
    await h.click('Remove from this phone')
    expect(h.text()).toContain('Remove yaseen/second from this phone?')
    await h.click('Remove')
    expect((await loadVaultList(h.store)).vaults.map((v) => v.repo)).toEqual(['yaseen/vault'])
    expect(await h.tokens.read('yaseen/second@main')).toBeNull()
    expect(await h.store.list('yaseen/second@main')).toEqual([])
    expect(h.sync.opened.at(-1)?.repo).toBe('yaseen/vault')
  })

  it('removing the last vault goes back to the sign-in (F1)', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.click('More for yaseen/vault')
    await h.click('Remove from this phone')
    await h.click('Remove')
    expect(h.button('Connect vault')).not.toBeNull()
    expect(h.sync.opened.at(-1)).toBeNull()
  })

  it('Replace token checks the new token for the same repo; a refused one changes nothing', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.click('More for yaseen/vault')
    await h.click('Replace token')
    expect(h.text()).toContain('GitHub needs a new token for yaseen/vault.')
    await h.type('Token', WRONG)
    await h.click('Save token')
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain('GitHub does not accept this token.')
    expect(await h.tokens.read('yaseen/vault@main')).toBe(GOOD)
  })

  it('Reset local copy asks first, keeps the token, and downloads again', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.store.write('yaseen/vault@main', 'a.md', '# A')
    await h.click('Settings')
    await h.click('More for yaseen/vault')
    await h.click('Reset local copy')
    await h.click('Reset local copy')
    expect(await h.store.list('yaseen/vault@main')).toEqual([])
    expect(await h.tokens.read('yaseen/vault@main')).toBe(GOOD)
    expect(h.sync.opened.map((v) => v?.repo ?? null)).toEqual([null, 'yaseen/vault', null, 'yaseen/vault'])
  })
})

describe('Sign out and erase this phone (row N7)', () => {
  it('asks first; Cancel keeps all', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.click('Sign out and erase this phone')
    expect(h.text()).toContain('This phone loses the pages and cards it keeps. It also loses your tokens and its settings.')
    expect(h.text()).toContain('Nothing on GitHub is deleted. Your vaults stay there.')
    expect(h.text()).not.toContain('not sent yet')
    expect(h.text()).not.toContain('friends list')
    // Cancel is the default: it has the focus.
    expect(document.activeElement?.textContent).toBe('Cancel')
    await h.click('Cancel')
    expect(await h.tokens.read('yaseen/vault@main')).toBe(GOOD)
  })

  it('B7: with 3 answers not sent and with friends, the ask says both, and what stays on GitHub', async () => {
    const phone = await newPhone()
    h = await mount({ phone })
    await signInWithForm(h, 'yaseen/vault', GOOD)
    h.unmount()
    const waiting = [1, 1, 2, 3].map((group, i) => ({ seq: i + 1, group, op: { kind: 'next', id: `NC-${group}`, on: false }, path: 'a.md', title: 'T', madeAt: 0 }))
    await phone.store.setState('yaseen/vault@main', 'answers', { v: 1, next: 9, waiting, lost: [] })
    h = await mount({ phone, hasFriends: true })
    await h.click('Settings')
    await h.click('Sign out and erase this phone')
    expect(h.text()).toContain('3 answers are not sent yet. They will be lost.')
    expect(h.text()).toContain('To stop that, remove each friend and leave each group in the Friends tab first.')
    expect(document.activeElement?.textContent).toBe('Cancel')
  })

  it('YAZ-5343: a friends remove that waits on the phone: the ask names it, and "Finish it in Friends" opens the Friends tab', async () => {
    const phone = await newPhone()
    h = await mount({ phone })
    await signInWithForm(h, 'yaseen/vault', GOOD)
    h.unmount()
    await phone.store.setState(PHONE, REMOVE_QUEUE, [{ mine: 'gist-for-bea', at: 1 }])
    h = await mount({ phone, hasFriends: true })
    await h.click('Settings')
    await h.click('Sign out and erase this phone')
    expect(h.text()).toContain('1 remove in Friends is not done yet. If you erase now, that friend or group can still see your numbers.')
    await h.click('Finish it in Friends')
    expect(h.host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(h.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Friends')
    expect(await phone.store.getState(PHONE, REMOVE_QUEUE)).toHaveLength(1)
  })

  it('YAZ-5344: Escape closes the ask as Cancel does; nothing is erased', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.click('Sign out and erase this phone')
    expect(h.host.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await h.settle()
    expect(h.host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(await h.tokens.read('yaseen/vault@main')).toBe(GOOD)
  })

  it('removes every token and every stored file and state, then shows the sign-in', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.click('Add vault')
    await signInWithForm(h, 'yaseen/second', SECOND)
    await h.store.write('yaseen/vault@main', 'a.md', '# A')
    await h.store.setState('yaseen/vault@main', 'answers', [{ id: 'X' }])
    await h.services.friends.saveSettings({ vaults: null, nickname: 'Yas' })
    await h.click('Settings')
    await h.click('Sign out and erase this phone')
    await h.click('Erase this phone')
    expect(await h.tokens.read('yaseen/vault@main')).toBeNull()
    expect(await h.tokens.read('yaseen/second@main')).toBeNull()
    expect(await h.store.list('yaseen/vault@main')).toEqual([])
    expect(await h.store.getState('yaseen/vault@main', 'answers')).toBeUndefined()
    expect(await h.store.getState(PHONE, 'friendsSettings')).toBeUndefined()
    expect((await loadVaultList(h.store)).vaults).toEqual([])
    expect(h.button('Connect vault')).not.toBeNull()
    expect(h.sync.opened.at(-1)).toBeNull()
  })
})

describe('Settings: Friends (decision 22; round 13, item 4)', () => {
  it('shows "Friends use @login", "Vaults that count" and "Name", and no sharing switch', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    const text = h.text()
    expect(text).toContain('Friends use @yaseen')
    expect(text).toContain('Vaults that count')
    expect(text).toContain('All vaults')
    expect(text).toMatch(/Name\s*Yaseen/)
    expect(h.host.querySelector('input[type="checkbox"]')).toBeNull()
    expect(text).not.toMatch(/share my numbers|sharing/i)
  })

  it('"Vaults that count" and "Name" are saved', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.click('Add vault')
    await signInWithForm(h, 'yaseen/second', SECOND)
    await h.click('Settings')
    await h.click('Vaults that count')
    const second = [...h.host.querySelectorAll('label')].find((l) => l.textContent === 'yaseen/second')!.querySelector('input')!
    await (await import('react')).act(async () => second.click())
    await h.settle()
    expect((await h.services.friends.settings()).vaults).toEqual(['yaseen/vault@main'])
    await h.click('Name')
    await h.type('The name your friends see. Leave it empty to use your GitHub name.', '  Yas  ')
    await h.click('Save name')
    expect((await h.services.friends.settings()).nickname).toBe('Yas')
    expect(h.text()).toMatch(/Name\s*Yas/)
  })

  it('YAZ-5251: "Home time zone" shows this phone`s zone until one is chosen, and a choice is saved', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    const own = new Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(h.text()).toContain(`Home time zone${own}`)
    await h.click('Home time zone')
    const select = h.host.querySelector('select')!
    const { act } = await import('react')
    await act(async () => {
      select.value = 'Asia/Tokyo'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await h.settle()
    expect((await h.services.friends.settings()).zone).toBe('Asia/Tokyo')
    expect(h.text()).toContain('Home time zoneAsia/Tokyo')
  })

  it('a token with no Gists permission: the alert of 3E, with the guide as the way forward', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    const account = (await loadAccount(h.store, 'yaseen/vault@main'))!
    await h.store.setState('yaseen/vault@main', 'account', { ...account, gists: 'no' })
    h.unmount()
    h = await mount({ phone: { store: h.store, tokens: h.tokens } })
    await h.click('Settings')
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain('Friends needs the Gists permission on your token.')
    await h.click('How to make a token')
    expect(h.text()).toContain('Set up your phone')
  })
})

describe('the first download (row F2; round 10, item 8)', () => {
  it('shows a progress bar, then the open tab', async () => {
    h = await mount({ download: true })
    await signInWithForm(h, 'yaseen/vault', GOOD)
    expect(h.text()).toContain('Downloading your pages')
    expect(tabs(h)).toEqual([])
    await h.syncSet({ progress: { done: 150, total: 600 } })
    expect(h.host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25')
    expect(h.text()).toContain('150 of 600 files')
    await h.syncSet({ status: 'synced', progress: null, ready: true })
    expect(tabs(h)).toEqual(['Friends', 'Review*', 'Search'])
  })

  it('a stop says why and how it goes on: no signal, the rate limit with its time, a vault too large, a repo gone', async () => {
    h = await mount({ download: true })
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.syncSet({ status: 'off', problem: 'OFFLINE' })
    expect(h.text()).toContain('No internet connection. The download goes on when you are back online.')
    await h.syncSet({ status: 'slowed', problem: 'RATE_LIMITED', retryAt: Date.UTC(2026, 10, 13, 13, 5) })
    expect(h.text()).toContain('The download goes on after')
    await h.syncSet({ status: 'attention', problem: 'TREE_TRUNCATED', retryAt: null })
    expect(h.text()).toContain('yaseen/vault is too large for the phone.')
    await h.syncSet({ problem: 'NOT_FOUND' })
    expect(h.text()).toContain("Can't find yaseen/vault (branch main) on GitHub.")
    await h.click('Open Settings')
    expect(h.text()).toContain('Vaults')
  })
})

describe('a problem that needs the person, once the vault is ready', () => {
  it('N6: the token stopped working: "Sign in again" asks for a new token; the pages stay readable', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.syncSet({ status: 'attention', problem: 'UNAUTHORIZED' })
    const notice = h.host.querySelector('.notice')
    expect(notice?.textContent).toContain('GitHub does not accept the token for yaseen/vault.')
    expect(notice?.textContent).toContain('The pages on this phone stay readable.')
    await h.click('Sign in again')
    expect(h.text()).toContain('GitHub needs a new token for yaseen/vault.')
  })

  it('no signal once ready: no notice (the status dot of 4D says it)', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.syncSet({ status: 'off', problem: 'OFFLINE' })
    expect(h.host.querySelector('.notice')).toBeNull()
  })

  it('the open vault has no token at start: the sign-in again, for that repo', async () => {
    const phone = await newPhone()
    h = await mount({ phone })
    await signInWithForm(h, 'yaseen/vault', GOOD)
    h.unmount()
    await phone.tokens.clear('yaseen/vault@main')
    h = await mount({ phone })
    expect(h.text()).toContain('GitHub needs a new token for yaseen/vault.')
    await h.type('Token', GOOD)
    await h.click('Save token')
    expect(tabs(h)).toEqual(['Friends', 'Review*', 'Search'])
  })
})

describe("the vault's word for page (round 15, item 5)", () => {
  it('the screens say the vault\'s word, and change when the Mac changes it', async () => {
    const phone = await newPhone()
    await phone.store.write('yaseen/vault@main', UNIT_WORD_PATH, JSON.stringify({ unit: 'doc' }))
    h = await mount({ phone, download: true })
    await signInWithForm(h, 'yaseen/vault', GOOD)
    expect(h.text()).toContain('Downloading your docs')
    await phone.store.write('yaseen/vault@main', UNIT_WORD_PATH, JSON.stringify({ unit: 'own', own: { one: 'Entry', many: 'Entries' } }))
    await h.syncEmit({ type: 'changed', vault: 'yaseen/vault@main', settings: [UNIT_WORD_PATH] })
    expect(h.text()).toContain('Downloading your entries')
    await h.syncSet({ ready: true, status: 'synced' })
    await h.click('Search')
    // 4C (YAZ-5079) put the real Search tab in the slot: its box and its empty vault say the vault's word.
    expect(h.host.querySelector('input[type="search"]')?.getAttribute('placeholder')).toBe('Search cards and entries')
    expect(h.text()).toContain('No entries yet.')
  })
})

describe('home-screen basics (VoiceOver names)', () => {
  it('the gear, the tabs and the vault rows have names', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    expect(h.host.querySelector('button[aria-label="Settings"]')).not.toBeNull()
    expect(h.host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Tabs')
    await h.click('Settings')
    expect(h.host.querySelector('button[aria-label="More for yaseen/vault"]')).not.toBeNull()
  })
})

describe('checker round 1 (YAZ-5177, YAZ-5178)', () => {
  it('no status code reaches the screen for an answer we did not expect', async () => {
    h = await mount()
    h.github.interrupt = (c) => (c.url.endsWith('/user') ? new Response('{}', { status: 418 }) : undefined)
    await signInWithForm(h, 'yaseen/vault', GOOD)
    expect(h.host.querySelector('[role="alert"]')?.textContent ?? '').not.toMatch(/\(\d{3}\)/)
  })

  it('a double tap on Connect vault runs ONE check', async () => {
    h = await mount()
    await h.type('Repo', 'yaseen/vault')
    await h.type('Token', GOOD)
    const btn = h.button('Connect vault')!
    await act(async () => {
      btn.click()
      btn.click()
    })
    await h.settle()
    expect(h.github.calls.filter((c) => c.url.endsWith('/user')).length).toBe(1)
  })
})

describe('the erase waits for a running pass (YAZ-5175)', () => {
  it('clears the phone only after the pass ends', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    let end!: () => void
    h.sync.running = new Promise<void>((r) => (end = r))
    await h.click('Settings')
    await h.click('Sign out and erase this phone')
    const erasing = h.click('Erase this phone')
    await new Promise((r) => setTimeout(r, 20))
    expect(await h.tokens.read('yaseen/vault@main')).toBe(GOOD)
    end()
    await erasing
    await h.settle()
    expect(await h.tokens.read('yaseen/vault@main')).toBeNull()
    expect(h.button('Connect vault')).not.toBeNull()
  })
})

describe('another tab erased the phone (YAZ-5194)', () => {
  it('this tab stops its sync and shows the sign-in', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    // Tab 1 erased the database (the same rows), then told the other tabs.
    await h.tokens.clearAll()
    await h.store.eraseAll()
    const other = new BroadcastChannel('notecards-tabs')
    other.postMessage({ type: 'erased' })
    other.close()
    await new Promise((r) => setTimeout(r, 30))
    await h.settle()
    expect(h.sync.opened.at(-1)).toBeNull()
    expect(h.button('Connect vault')).not.toBeNull()
  })
})

