// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FRIENDS_ENABLED } from '@shared/features'
import { openingTab, tabIn, tabsOf } from './app/nav'
import { checkSignIn } from './auth/check'
import { fakeGithub } from './github/testing'
import { GOOD, mount, signInWithForm, type Harness } from './screens/testing'

/**
 * YAZ-5652: Friends is off for now (`shared/features.ts`): the phone shows no Friends tab and no Friends part in
 * Settings; the sign-in makes no Gists check; a friend link opens "Friends is off for now". The files that test
 * Friends itself turn it on (`vi.mock('@shared/features', …)`) and show today's behaviour.
 */
const NOW = Date.UTC(2026, 10, 13, 12)
const ID = 'aa5a315d61ae9438b18d'
const CARDS = { review: true, daily: false }

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
  document.body.innerHTML = ''
})

const tabs = (x: Harness) => [...x.host.querySelectorAll('[role="tab"]')].map((t) => `${t.textContent}${t.getAttribute('aria-selected') === 'true' ? '*' : ''}`)

describe('Friends off on the phone (YAZ-5652)', () => {
  it('the switch is off in the app', () => {
    expect(FRIENDS_ENABLED).toBe(false)
  })

  it('no Friends tab, even with Review on; a way to Friends lands on Review or Search', () => {
    expect(tabsOf(CARDS).map((t) => t.label)).toEqual(['Review', 'Search'])
    expect(openingTab(true, CARDS)).toBe('review')
    expect(tabIn('friends', CARDS)).toBe('search')
  })

  it('the app: the tabs are Review and Search, even with a friend; Settings has no Friends part', async () => {
    h = await mount({ hasFriends: true })
    await signInWithForm(h, 'yaseen/vault', GOOD)
    expect(tabs(h)).toEqual(['Review*', 'Search'])
    await h.click('Settings')
    expect(h.host.querySelector('h2.section')).not.toBeNull()
    expect([...h.host.querySelectorAll('h2.section')].map((s) => s.textContent)).not.toContain('Friends')
    expect(h.text()).not.toContain('Friends use @')
    expect(h.github.calls.some((c) => c.url.includes('/gists'))).toBe(false)
  })

  it('"Set up your phone" asks for Contents only, not Gists', async () => {
    h = await mount()
    await h.click('How to make a token')
    await h.waitText('Set up your phone')
    expect(h.text()).toContain('Give the token one permission: Contents.')
    expect(h.text()).not.toContain('Gists')
  })

  it('the sign-in check makes no Gists call (no POST /gists): the account says "unknown"', async () => {
    const fake = fakeGithub({ tokens: { [GOOD]: { login: 'yaseen', repos: { 'yaseen/vault': 'write' }, gists: true } }, repos: [{ fullName: 'yaseen/vault' }] })
    const result = await checkSignIn({ repo: 'yaseen/vault', token: GOOD }, { fetch: fake.fetch, now: () => NOW })
    expect(result.ok && result.vault.account.gists).toBe('unknown')
    expect(fake.calls.some((c) => c.url.includes('/gists'))).toBe(false)
  })

  it.each(['/friend', '/group', '/join'])('a %s link opens "Friends is off for now": no code, no Copy, no steps', async (path) => {
    const body = readFileSync(join(import.meta.dirname, '../friend.html'), 'utf8').replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '')
    history.replaceState(null, '', `${path}#${ID}`)
    document.body.innerHTML = body
    vi.resetModules()
    await import('./pwa/landing')
    expect(document.title).toBe('Friends is off for now')
    expect(document.querySelector('h1')!.textContent).toBe('Friends is off for now')
    expect(document.getElementById('code')).toBeNull()
    expect(document.getElementById('copy')).toBeNull()
    expect(document.body.textContent).not.toContain(ID)
    expect(document.querySelector<HTMLAnchorElement>('main a')!.getAttribute('href')).toBe('/')
  })
})
