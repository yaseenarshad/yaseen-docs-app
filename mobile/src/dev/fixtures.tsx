import type { Root } from 'react-dom/client'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import { saveAccount, type VaultAccount } from '../auth/account'
import type { FetchLike } from '../github/client'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, vaultId, type PhoneVault } from '../store'
import { fakeGithub } from '../github/testing'
import { fakeFriends, fakeSync, reviewOnTabs } from './fakes'
import { isReaderFixture, mountReaderFixture } from './readerFixtures'
import { setAppearance } from '../settings/appearance'
import type { CheckResult, Updates } from '../pwa/updates'

/**
 * The screen fixtures: each screen of 4A with made-up data, for the screenshots (`#fixture=settings`). Only a
 * `vite build --mode fixtures` build has this file (`main.tsx`); the real build does not. Nothing here calls GitHub:
 * `fetch` answers 401 to every call.
 */

const VAULTS: PhoneVault[] = [
  { repo: 'demo/demo-vault', branch: 'main', addedAt: 1 },
  { repo: 'demo/work-wiki', branch: 'main', addedAt: 2 },
]
/** YAZ-5659 (`settings-vaults-light`, `-dark`): four vaults, one with a long name and path, the second open. */
const MANY_VAULTS: PhoneVault[] = [
  ...VAULTS,
  { repo: 'demo/notecards-scratch-vault', branch: 'main', addedAt: 3 },
  { repo: 'demo-person-with-a-long-name/research-notes-archive-twenty-twenty-six-vault', branch: 'phone-drafts', addedAt: 4 },
]
const ACCOUNT: VaultAccount = { login: 'demo', name: 'Demo Person', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 }
const FAKE_TOKEN = 'github_pat_11FIXTURE0' + 'f'.repeat(72)

const refuseAll: FetchLike = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })

/** YAZ-5408: the repo picker's made-up GitHub (`repo-*` fixtures): a token that reaches 3 repos, 14, or none. */
const PICK_REPOS = [
  { fullName: 'demo/demo-vault', pushedAt: '2026-11-10T00:00:00Z' },
  { fullName: 'demo/work-wiki', pushedAt: '2026-10-02T00:00:00Z' },
  { fullName: 'demo/a-rather-long-repository-name-for-the-narrow-screen', vault: false, pushedAt: '2026-11-12T00:00:00Z' },
  { fullName: 'demo/website', vault: false, private: false, pushedAt: '2026-11-11T00:00:00Z' },
  ...['budget', 'recipes', 'scripts', 'dotfiles', 'talks', 'thesis', 'photos', 'garden', 'letters', 'old-notes'].map((n, i) => ({ fullName: `demo/${n}`, vault: false, pushedAt: `2026-0${(i % 9) + 1}-01T00:00:00Z` })),
]
/** YAZ-5645: the access token of a made-up "Sign in with GitHub" (a GitHub App user token). */
const FAKE_GH = 'ghu_' + 'f'.repeat(36)
const pickGithub = (name: string) =>
  fakeGithub({
    tokens: {
      [FAKE_GH]: { login: 'demo', repos: Object.fromEntries(PICK_REPOS.slice(0, 3).map((r) => [r.fullName, 'write' as const])), installations: [{ id: 1, account: 'demo', repos: PICK_REPOS.slice(0, 3).map((r) => r.fullName) }] },
      [FAKE_TOKEN]: {
        login: 'demo',
        repos: Object.fromEntries((name === 'repo-none' ? [] : name === 'repo-pick-many' ? PICK_REPOS : PICK_REPOS.slice(0, 4)).map((r) => [r.fullName, 'write' as const])),
      },
    },
    repos: PICK_REPOS,
  })

/** `repo-gone`: @demo took demo/work-wiki off the app's list on GitHub. */
function repoFetch(name: string): FetchLike {
  const github = pickGithub(name)
  if (name === 'repo-gone') github.takeOff(FAKE_GH, 'demo/work-wiki')
  return github.fetch
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * YAZ-5593: Settings › Check for updates with a made-up update (no service worker in the fixture build): the button,
 * and after a tap (`settings-check-<answer>`) its answer; `busy` never answers.
 */
function fixtureUpdates(answer: CheckResult | 'busy' | null): Updates {
  const fns = new Set<() => void>()
  let ready = false
  return {
    start: async () => {},
    ready: () => ready,
    tookOver: () => false,
    subscribe: (fn) => (fns.add(fn), () => void fns.delete(fn)),
    apply: () => {},
    check: async () => {},
    checkNow: () =>
      answer === 'busy' || answer === null
        ? new Promise<CheckResult>(() => {})
        : wait(30).then(() => {
            if (answer === 'ready') (ready = true), fns.forEach((fn) => fn())
            return answer
          }),
  }
}
const press = (name: string) => {
  const el = [...document.querySelectorAll<HTMLElement>('button, a')].find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name)
  el?.click()
}
const fill = (name: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
  if (input === null) return
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export async function mountFixture(root: Root, hash: string): Promise<void> {
  const name = /fixture=([\w-]+)/.exec(hash)?.[1] ?? 'sign-in'
  // 4C (YAZ-5242): Review with a card of the 90 attack vectors, for a net log in headless Chrome.
  if (name === 'attack-review') return (await import('../page/attackFixtures')).mountAttackFixture(root)
  if (name.startsWith('c4erase')) return (await import('./check4Fixtures')).mountCheck4Erase(root, name)
  if (name.startsWith('c4-')) return (await import('./check4Fixtures')).mountCheck4Fixture(root, name)
  if (name.startsWith('c3-')) return (await import('../review/check3Fixtures')).mountCheck3Fixture(root, name)
  // 4B (YAZ-5078): the Review tab's fixtures run the real engine and answer list on the fake GitHub.
  if (name.startsWith('review-'))
    return (await import('../review/fixtures')).mountReviewFixture(root, name).catch((err: unknown) => {
      document.body.dataset.fixtureError = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    })
  // The Friends screens (4E4, YAZ-5085).
  if (name.startsWith('friends-')) return (await import('../friends/ui/fixtures')).mountFriendsFixture(root, name)
  // The status dot's own fixtures (4D, YAZ-5080).
  if (name.startsWith('dot')) return (await import('../status/fixtures')).mountDotFixture(root, name)
  // YAZ-5470: the Today button (`daily/fixtures.tsx`).
  if (name.startsWith('today')) return (await import('../daily/fixtures')).mountTodayFixture(root, name)
  // YAZ-5472: Explore's sheets over a page and over Search.
  if (name.startsWith('explore-')) return (await import('../explore/exploreFixtures')).mountExploreFixture(root, name)
  // 4C (YAZ-5079): Search, a page and a card, on a made-up vault (`readerFixtures.tsx`).
  if (isReaderFixture(name)) return mountReaderFixture(root, name)
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  // The install hint as Safari on an iPhone shows it (the steps, the ☰ picture, the data note).
  if (name === 'sign-in-iphone')
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' })
  // YAZ-5645: back from GitHub with "demo" signed in: the repos chosen for the app (the Setup URL's return).
  if (name === 'repo-pick-github') {
    await tokens.savePair({ login: 'demo', access: FAKE_GH, accessEndsAt: null, refresh: null, refreshEndsAt: null })
    history.replaceState(null, '', `/auth/installed${location.hash}`)
  }
  const signedIn = !['repo-pick-github', 'sign-in', 'sign-in-iphone', 'sign-in-error', 'sign-in-typed', 'guide', 'repo-pick', 'repo-pick-many', 'repo-none'].includes(name)
  // YAZ-5645 slice 2: vaults on "Sign in with GitHub" (@demo): Settings › GitHub, and a repo taken off the app's list.
  const many = name.startsWith('settings-vaults')
  const onGithub = name === 'settings-github' || name === 'repo-gone' || many
  if (onGithub) await tokens.savePair({ login: 'demo', access: FAKE_GH, accessEndsAt: null, refresh: null, refreshEndsAt: null })
  const vaults = many ? MANY_VAULTS : name === 'settings' || name === 'erase' || onGithub ? VAULTS : VAULTS.slice(0, 1)
  if (signedIn) {
    for (const v of vaults) {
      if (onGithub) await tokens.link(vaultId(v), 'demo')
      else await tokens.write(vaultId(v), FAKE_TOKEN)
      await saveAccount(store, vaultId(v), ACCOUNT)
    }
    await saveVaultList(store, { vaults, open: vaultId(VAULTS[name === 'repo-gone' || many ? 1 : 0]) })
  }
  // YAZ-5559: the open vault's settings files, made up: all but the table look and the icons, and a link clicks file
  // that is not JSON (Vault health then says "Using defaults: link clicks, table look, icons").
  if (name === 'settings-health')
    for (const { file, label } of (await import('@shared/vaultSettingsFiles')).VAULT_SETTINGS_FILES)
      if (label !== 'table look' && label !== 'icons') await store.write(vaultId(VAULTS[0]), `.yaseendocs/${file}`, label === 'link clicks' ? '{ not json' : '{"version":1}')
  const sync = fakeSync({ download: name === 'download' })
  const services: AppServices = { store, tokens, vaultTabs: reviewOnTabs, sync, friends: fakeFriends(store, false), fetch: name.startsWith('repo-') ? repoFetch(name) : refuseAll }
  const check = /^settings-check-(newest|ready|unreachable|busy)$/.exec(name)?.[1] as CheckResult | 'busy' | undefined
  root.render(<App services={services} updates={name.startsWith('settings') ? fixtureUpdates(check ?? null) : null} />)
  await wait(50)

  // YAZ-5645: the token steps are behind "Use a token instead" (the first step is "Sign in with GitHub").
  if (['sign-in-typed', 'repo-pick', 'repo-pick-many', 'repo-none', 'sign-in-error', 'guide'].includes(name)) {
    press('Use a token instead')
    await wait(10)
  }
  switch (name) {
    case 'repo-pick-github':
      for (let i = 0; i < 100 && document.querySelector('.repo-row, .problem') === null; i++) await wait(20)
      break
    case 'sign-in-typed':
      press('Type the repo name')
      break
    case 'repo-pick':
    case 'repo-pick-many':
    case 'repo-none':
      fill('token', FAKE_TOKEN)
      await wait(10)
      press('Show my repos')
      for (let i = 0; i < 100 && document.querySelector('.repo-row, .problem') === null; i++) await wait(20)
      break
    case 'sign-in-error':
      press('Type the repo name')
      await wait(10)
      fill('repo', 'demo/demo-vault')
      fill('token', FAKE_TOKEN)
      await wait(10)
      press('Connect vault')
      break
    case 'guide':
      press('How to make a token')
      // Its own chunk (YAZ-5446): wait until it draws.
      for (let i = 0; i < 100 && document.querySelector('.guide-steps') === null; i++) await wait(20)
      break
    case 'download':
      sync.set({ progress: { done: 240, total: 611 } })
      break
    case 'token-ended':
      sync.set({ status: 'attention', problem: 'UNAUTHORIZED' })
      break
    case 'repo-gone':
      // YAZ-5645 slice 2: the repo answers 404; the app asks the installations, then names it.
      sync.set({ status: 'attention', problem: 'NOT_FOUND', vault: vaultId(VAULTS[1]), ready: true })
      for (let i = 0; i < 100 && !(document.body.textContent ?? '').includes('taken off the list'); i++) await wait(20)
      break
    case 'settings-github':
      press('Settings')
      for (let i = 0; i < 100 && document.querySelector('.github-account') === null; i++) await wait(20)
      break
    case 'settings-dark':
    case 'settings-light':
    case 'settings-vaults-dark':
    case 'settings-vaults-light':
      // YAZ-5565: Settings › Appearance chosen against the iPhone's own setting.
      setAppearance(name.endsWith('-dark') ? 'dark' : 'light')
    // falls through
    case 'settings':
    case 'erase':
      press('Settings')
      // Its own chunk (makes room in the first load): wait until it draws.
      for (let i = 0; i < 100 && document.querySelector('.settings__version') === null; i++) await wait(20)
      if (name === 'erase') press('Sign out and erase this phone')
      break
    case 'settings-check-newest':
    case 'settings-check-ready':
    case 'settings-check-unreachable':
    case 'settings-check-busy':
      // YAZ-5593: Check for updates, tapped, and its answer (or its busy state).
      press('Settings')
      for (let i = 0; i < 100 && document.querySelector('.settings__check button') === null; i++) await wait(20)
      document.querySelector<HTMLButtonElement>('.settings__check button')?.click()
      await wait(check === 'busy' ? 20 : 120)
      break
    case 'settings-health': {
      // YAZ-5559: Settings › Vault health, its list open.
      press('Settings')
      for (let i = 0; i < 100 && document.querySelector('.vault-health__toggle') === null; i++) await wait(20)
      document.querySelector<HTMLButtonElement>('.vault-health__toggle')?.click()
      for (let i = 0; i < 100 && document.querySelector('#vault-health-list') === null; i++) await wait(20)
      document.querySelector('.vault-health')?.scrollIntoView({ block: 'start' })
      break
    }
  }
  await wait(50)
  document.documentElement.dataset.fixtureReady = name
}
