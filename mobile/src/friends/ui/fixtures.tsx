import { FRIEND_LINK_BASE } from '@shared/friendsList'
import type { Root } from 'react-dom/client'
import { App } from '../../App'
import type { AppServices } from '../../app/AppState'
import { saveAccount } from '../../auth/account'
import { fakeScanner, fakeSync } from '../../dev/fakes'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, vaultId, type PhoneVault } from '../../store'
import { gistText } from './board'
import type { Board } from './service'
import { demoBoard, demoFriend, demoGroup, fakeService, fakeServices } from './demo'

/**
 * The Friends screens with made-up data, for the screenshots (`#fixture=friends-…`, a `--mode fixtures` build only).
 * Nothing calls GitHub.
 */
const NOW = Date.now()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Waits until the page shows `selector` (the lazy chunks load first), at most 3 s. */
const until = async (selector: string) => {
  for (let i = 0; i < 60 && document.querySelector(selector) === null; i++) await wait(50)
}
const press = (name: string | RegExp) => {
  const el = [...document.querySelectorAll<HTMLElement>('button, a')].find((b) => {
    const n = (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/[\u2068\u2069]/g, '').trim()
    return typeof name === 'string' ? n === name : name.test(n)
  })
  el?.click()
}

function boardOf(name: string): Board {
  switch (name) {
    case 'friends-empty':
      return demoBoard(NOW, { friends: [] })
    case 'friends-states':
      return demoBoard(NOW, {
        friends: [
          demoFriend(NOW, 'Sam', { days: [[0, { cards: 44, seconds: 3960, done: true }]] }),
          demoFriend(NOW, 'Ana', { state: 'waiting', label: 'Waiting for Ana to add you' }),
          demoFriend(NOW, 'Ben', { state: 'gone', label: 'No longer shares with you', stats: null }),
          demoFriend(NOW, 'Cy', { state: 'newer-app', label: 'Needs a newer app', stats: null }),
        ],
        shared: [{ mine: 'a'.repeat(32), link: `${FRIEND_LINK_BASE}#` + 'a'.repeat(32), at: new Date(NOW - 3 * 3600_000).toISOString() }],
      })
    case 'friends-removing':
      return demoBoard(NOW, {
        friends: [
          demoFriend(NOW, 'Sam', { days: [[0, { cards: 44, seconds: 3960, done: true }]] }),
          { ...demoFriend(NOW, 'Ann'), theirs: '', state: 'removing', label: 'Removing…', stats: null },
          demoFriend(NOW, 'Zoe', { state: 'stopped', label: 'This link stopped working. Share a new one.', stats: null }),
          demoFriend(NOW, 'Ben', { state: 'gone', label: 'No longer shares with you', stats: null }),
          demoFriend(NOW, '\u202eevil\nsecond line ' + 'W'.repeat(200), {
            state: 'waiting',
            label: `Waiting for ${gistText('\u202eevil\nsecond line ' + 'W'.repeat(200))} to add you`,
          }),
        ],
        groups: [{ kind: 'removing', group: '7'.repeat(32), name: 'Old group' }],
      })
    case 'friends-repair':
      return { kind: 'needs-repair' }
    case 'friends-offline':
      return demoBoard(NOW, { offline: true })
    case 'friends-nosignal':
      return { kind: 'offline' }
    case 'friends-hostile':
      return demoBoard(NOW, {
        friends: [
          demoFriend(NOW, '<img src=x onerror=alert(1)>'),
          demoFriend(NOW, 'W'.repeat(39) + '…'),
          demoFriend(NOW, 'سارة ‮abc'.replace('‮', '')),
          demoFriend(NOW, '👩‍👩‍👧‍👦 Family'),
        ],
      })
    case 'friends-group':
    case 'friends-group-member':
      return demoBoard(NOW, { groups: [demoGroup(NOW, name === 'friends-group' ? {} : { iAmAdmin: false, admin: 'mina' })] })
    default:
      return demoBoard(NOW)
  }
}

export async function mountFriendsFixture(root: Root, name: string): Promise<void> {
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  const two = name === 'friends-alert'
  const vaults: PhoneVault[] = [{ repo: 'demo/demo-vault', branch: 'main', addedAt: 1 }, ...(two ? [{ repo: 'work/notes', branch: 'main', addedAt: 2 }] : [])]
  for (const [i, v] of vaults.entries()) {
    await tokens.write(vaultId(v), 'github_pat_11FIXTURE0' + 'f'.repeat(72))
    await saveAccount(store, vaultId(v), { login: i === 0 ? 'demo' : 'work', name: 'Demo Person', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 })
  }
  await saveVaultList(store, { vaults, open: vaultId(vaults[0]) })
  const service = fakeService(boardOf(name))
  if (name === 'friends-cheer-wait')
    service.markAnswer = async (_m, kind) => ({ kind: 'waiting', mark: { kind, at: '' }, why: 'marks-limit', retryAt: NOW + 12 * 60_000 })
  const services: AppServices = { store, tokens, sync: fakeSync(), friends: fakeServices(store, service), scanner: fakeScanner(), now: () => NOW }
  root.render(<App services={services} />)
  await until('section[aria-label="Friends"]:not([aria-busy])')
  await wait(50)
  switch (name) {
    case 'friends-add':
      press('Add a friend or a group')
      await wait(30)
      press('Share my link')
      break
    case 'friends-paste':
      press('Add a friend or a group')
      await wait(30)
      press("Paste a friend's link")
      break
    case 'friends-vs':
    case 'friends-cheer-wait':
      press(/^Number 1, Sam/)
      await until('.fr-week')
      if (name === 'friends-cheer-wait') {
        press('Nudge')
        await wait(50)
        const screen = document.querySelector('.screen')
        if (screen !== null) screen.scrollTop = screen.scrollHeight
      }
      break
    case 'friends-group':
    case 'friends-group-member':
      press('Study group')
      break
    case 'friends-remove':
      press(/^Number 1, Sam/)
      await until('.fr-week')
      press('Remove friend')
      break
  }
  await wait(100)
  document.documentElement.dataset.fixtureReady = name
}
