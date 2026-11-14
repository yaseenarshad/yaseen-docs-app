import type { Root } from 'react-dom/client'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import { saveAccount, type VaultAccount } from '../auth/account'
import type { FetchLike } from '../github/client'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, vaultId, type PhoneVault } from '../store'
import { fakeFriends, fakeScanner, fakeSync } from './fakes'
import { isReaderFixture, mountReaderFixture } from './readerFixtures'

/**
 * The screen fixtures: each screen of 4A with made-up data, for the screenshots (`#fixture=settings`). Only a
 * `vite build --mode fixtures` build has this file (`main.tsx`); the real build does not. Nothing here calls GitHub:
 * `fetch` answers 401 to every call.
 */

const VAULTS: PhoneVault[] = [
  { repo: 'demo/demo-vault', branch: 'main', addedAt: 1 },
  { repo: 'demo/work-wiki', branch: 'main', addedAt: 2 },
]
const ACCOUNT: VaultAccount = { login: 'demo', name: 'Demo Person', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 }
const FAKE_TOKEN = 'github_pat_11FIXTURE0' + 'f'.repeat(72)

const refuseAll: FetchLike = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
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
  // The status dot's own fixtures (4D, YAZ-5080).
  if (name.startsWith('dot')) return (await import('../status/fixtures')).mountDotFixture(root, name)
  // 4C (YAZ-5079): Search, a page and a card, on a made-up vault (`readerFixtures.tsx`).
  if (isReaderFixture(name)) return mountReaderFixture(root, name)
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  const signedIn = name !== 'sign-in' && name !== 'sign-in-error' && name !== 'guide' && name !== 'scan'
  if (signedIn) {
    for (const v of name === 'settings' || name === 'erase' ? VAULTS : VAULTS.slice(0, 1)) {
      await tokens.write(vaultId(v), FAKE_TOKEN)
      await saveAccount(store, vaultId(v), ACCOUNT)
    }
    await saveVaultList(store, { vaults: name === 'settings' || name === 'erase' ? VAULTS : VAULTS.slice(0, 1), open: vaultId(VAULTS[0]) })
  }
  const sync = fakeSync({ download: name === 'download' })
  const services: AppServices = { store, tokens, sync, friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: refuseAll }
  root.render(<App services={services} />)
  await wait(50)

  switch (name) {
    case 'sign-in-error':
      fill('repo', 'demo/demo-vault')
      fill('token', FAKE_TOKEN)
      await wait(10)
      press('Connect vault')
      break
    case 'guide':
      press('How to make a token')
      break
    case 'scan':
      press('Scan a code')
      break
    case 'download':
      sync.set({ progress: { done: 240, total: 611 } })
      break
    case 'token-ended':
      sync.set({ status: 'attention', problem: 'UNAUTHORIZED' })
      break
    case 'settings':
      press('Settings')
      break
    case 'erase':
      press('Settings')
      await wait(20)
      press('Sign out and erase this phone')
      break
  }
  await wait(50)
  document.documentElement.dataset.fixtureReady = name
}
