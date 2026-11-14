import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import type { FriendsPort } from '../app/friendsPort'
import { fakeFriends, fakeScanner, fakeSync, type FakeScanner, type FakeSync } from '../dev/fakes'
import { fakeGithub, type FakeGithub, type FakeRepo, type FakeToken } from '../github/testing'
import { memoryBackend, openVaultStore, tokenStoreOn, type TokenStore, type VaultStore } from '../store'

/**
 * Test help for the screens (jsdom): the real app with the real store (in memory) and the real sign-in logic, and fakes
 * for GitHub, the sync, Friends and the camera. A test file that uses it says `// @vitest-environment jsdom`.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export const NOW = Date.UTC(2026, 10, 13, 12)
export const GOOD = 'github_pat_11GOODGOOD0goodgoodgood_' + 'g'.repeat(59)
export const SECOND = 'github_pat_11SECONDXX0secondsecondse_' + 's'.repeat(59)
export const READ_ONLY = 'github_pat_11READONLY0readonlyreadonl_' + 'r'.repeat(59)
export const NO_CONTENTS = 'github_pat_11NOCONTENT0nocontentnocont_' + 'c'.repeat(59)
export const WRONG = 'github_pat_11WRONGWRONG0wrongwrongwron_' + 'x'.repeat(59)

export const TOKENS: Record<string, FakeToken> = {
  [GOOD]: { login: 'yaseen', name: 'Yaseen', repos: { 'yaseen/vault': 'write', 'yaseen/second': 'write', 'yaseen/code': 'write' }, gists: true },
  [SECOND]: { login: 'yaseen', name: 'Yaseen', repos: { 'yaseen/second': 'write' }, gists: true },
  [READ_ONLY]: { login: 'yaseen', repos: { 'yaseen/vault': 'read' }, gists: true },
  [NO_CONTENTS]: { login: 'yaseen', repos: { 'yaseen/vault': 'none' }, gists: true },
}
export const REPOS: FakeRepo[] = [{ fullName: 'yaseen/vault', branches: ['main', 'phone'] }, { fullName: 'yaseen/second' }, { fullName: 'yaseen/code', vault: false }]

export interface Harness {
  host: HTMLElement
  store: VaultStore
  tokens: TokenStore
  github: FakeGithub
  sync: FakeSync
  scanner: FakeScanner
  services: AppServices
  /** The text on screen, spaces collapsed. */
  text(): string
  /** Clicks the button or link whose name (VoiceOver label, else text) is `name`. */
  click(name: string | RegExp): Promise<void>
  /** Types into the field with this label. */
  type(label: string, value: string): Promise<void>
  /** The fake sync changes its state (as 3B's engine does), and the screens follow. */
  syncSet(next: Parameters<FakeSync['set']>[0]): Promise<void>
  syncEmit(event: Parameters<FakeSync['emit']>[0]): Promise<void>
  /** The fake camera reads a code with this text. */
  scan(text: string): Promise<void>
  /** Lets the app's promises and renders finish. */
  settle(): Promise<void>
  button(name: string | RegExp): HTMLButtonElement | null
  unmount(): void
}

export async function newPhone(): Promise<{ store: VaultStore; tokens: TokenStore }> {
  const backend = memoryBackend()
  return { store: await openVaultStore(backend, { now: () => NOW }), tokens: tokenStoreOn(backend) }
}

const named = (el: Element) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
const matches = (el: Element, name: string | RegExp) => (typeof name === 'string' ? named(el) === name : name.test(named(el)))

export async function mount(options: { phone?: { store: VaultStore; tokens: TokenStore }; hasFriends?: boolean; download?: boolean; friends?: (store: VaultStore) => FriendsPort } = {}): Promise<Harness> {
  const { store, tokens } = options.phone ?? (await newPhone())
  const github = fakeGithub({ tokens: TOKENS, repos: REPOS })
  const sync = fakeSync({ download: options.download })
  const scanner = fakeScanner()
  const services: AppServices = {
    store,
    tokens,
    sync,
    scanner,
    friends: options.friends?.(store) ?? fakeFriends(store, options.hasFriends ?? false),
    fetch: github.fetch,
    now: () => NOW,
    keepStorage: async () => 'kept',
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const settle = async () => {
    for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
  }
  const button = (name: string | RegExp) => ([...host.querySelectorAll('button, a')].find((el) => matches(el, name)) as HTMLButtonElement | undefined) ?? null
  await act(async () => root.render(createElement(App, { services })))
  await settle()
  return {
    host,
    store,
    tokens,
    github,
    sync,
    scanner,
    services,
    settle,
    button,
    text: () => (host.textContent ?? '').replace(/\s+/g, ' '),
    async click(name) {
      const el = button(name)
      if (el === null) throw new Error(`No button "${name}" on: ${host.textContent}`)
      await act(async () => el.click())
      await settle()
    },
    async syncSet(next) {
      await act(async () => sync.set(next))
      await settle()
    },
    async syncEmit(event) {
      await act(async () => sync.emit(event))
      await settle()
    },
    async scan(text) {
      await act(async () => scanner.read(text))
      await settle()
    },
    async type(label, value) {
      const field = [...host.querySelectorAll('label')].find((l) => l.querySelector('.field__label')?.textContent === label)?.querySelector('input')
      if (!field) throw new Error(`No field "${label}"`)
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
    },
    unmount() {
      act(() => root.unmount())
      host.remove()
    },
  }
}

/** Signs in a vault through the form, as a person does. */
export async function signInWithForm(h: Harness, repo: string, token: string): Promise<void> {
  await h.type('Repo', repo)
  await h.type('Token', token)
  await h.click('Connect vault')
}
