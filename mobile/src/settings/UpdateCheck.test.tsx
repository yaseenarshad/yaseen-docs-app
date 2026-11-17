// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { keepDraft } from '../page/comments/unsentDrafts'
import type { CheckResult, Updates } from '../pwa/updates'
import { GOOD, mount, signInWithForm, type Harness } from '../screens/testing'
import { BUILD, buildLine, buildName, versionWords } from './buildInfo'
import { NEWEST_WORDS, UNREACHABLE_WORDS } from './UpdateCheck'

/**
 * YAZ-5593: Settings › under the build's line, the address the app runs from and "Check for updates": newest, a new
 * version ready (the same line and Restart, the same holds), the server out of reach, a busy state. Nothing reloads
 * by itself. A fake update; made-up builds.
 */

function fakeUpdates() {
  const fns = new Set<() => void>()
  let ready = false
  let answer: (r: CheckResult) => void = () => {}
  const u: Updates & { applied: number; checks: number; answer(r: CheckResult, nowReady?: boolean): Promise<void> } = {
    applied: 0,
    checks: 0,
    start: async () => {},
    ready: () => ready,
    tookOver: () => false,
    subscribe: (fn) => (fns.add(fn), () => void fns.delete(fn)),
    apply: () => void u.applied++,
    check: async () => {},
    checkNow: () => (u.checks++, new Promise<CheckResult>((resolve) => (answer = resolve))),
    async answer(r, nowReady = false) {
      await act(async () => {
        if (nowReady) {
          ready = true
          fns.forEach((f) => f())
        }
        answer(r)
      })
    },
  }
  return u
}

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
  keepDraft('notes/idea.md', '')
})

async function settings(updates?: Updates) {
  h = await mount({ updates })
  await signInWithForm(h, 'yaseen/vault', GOOD)
  await h.click('Settings')
  return h
}
const result = (x: Harness) => x.host.querySelector('.settings__check-result')?.textContent ?? null
const check = (x: Harness) => x.button(/^(Check for updates|Checking…)$/)!

describe('YAZ-5593: the address and Check for updates in Settings', () => {
  it('under the build line: the address the app runs from, muted; then a 44 pt "Check for updates"', async () => {
    const x = await settings(fakeUpdates())
    const build = x.host.querySelector('.settings__build')!
    const host = build.nextElementSibling!
    expect(host.className).toBe('muted settings__host')
    expect(host.textContent).toBe(location.host)
    expect(check(x).textContent).toBe('Check for updates')
    expect(check(x).classList.contains('btn')).toBe(true)
    expect(result(x)).toBeNull()
  })

  it('busy while it checks (a second tap does nothing), then "You have the newest build (<commit>)"', async () => {
    const u = fakeUpdates()
    const x = await settings(u)
    await x.click('Check for updates')
    expect(check(x).textContent).toBe('Checking…')
    expect(check(x).getAttribute('aria-busy')).toBe('true')
    expect(check(x).getAttribute('aria-disabled')).toBe('true')
    await act(async () => check(x).click())
    expect(u.checks).toBe(1)
    await u.answer('newest')
    await x.settle()
    expect(check(x).textContent).toBe('Check for updates')
    expect(check(x).getAttribute('aria-busy')).toBe('false')
    expect(result(x)).toBe(NEWEST_WORDS(buildName(BUILD)))
    expect(result(x)).toBe(`You have the newest build (${buildName(BUILD)})`)
    expect(u.applied).toBe(0)
  })

  it('a new version: "A new version is ready." with Restart in Settings; only the tap applies it', async () => {
    const u = fakeUpdates()
    const x = await settings(u)
    await x.click('Check for updates')
    await u.answer('ready', true)
    await x.settle()
    const line = x.host.querySelector('.settings__check .update-line--inline')!
    expect(line.textContent).toContain('A new version is ready.')
    expect(result(x)).toBeNull()
    // Nothing restarts by itself, even after a while.
    await new Promise((r) => setTimeout(r, 50))
    await x.settle()
    expect(u.applied).toBe(0)
    await x.click('Restart')
    expect(u.applied).toBe(1)
  })

  it('the same Restart rule: words in a comment box hold it (the line says why, no button)', async () => {
    const u = fakeUpdates()
    keepDraft('notes/idea.md', 'Half a thought')
    const x = await settings(u)
    await x.click('Check for updates')
    await u.answer('ready', true)
    await x.settle()
    expect(x.text()).toContain('A new version is ready. Restart after you send or clear your comment.')
    expect(x.button('Restart')).toBeNull()
    expect(u.applied).toBe(0)
  })

  it('offline or the host gone: "Can\'t reach the server. Open the app from docs.yaseenarshad.com."', async () => {
    const u = fakeUpdates()
    const x = await settings(u)
    await x.click('Check for updates')
    await u.answer('unreachable')
    await x.settle()
    expect(result(x)).toBe(UNREACHABLE_WORDS)
    expect(result(x)).toBe("Can't reach the server. Open the app from docs.yaseenarshad.com.")
    expect(u.applied).toBe(0)
    // A second check clears the last answer while it runs.
    await x.click('Check for updates')
    expect(result(x)).toBeNull()
    await u.answer('newest')
    await x.settle()
    expect(result(x)).toBe(NEWEST_WORDS(buildName(BUILD)))
  })

  it('no service worker here (dev, tests): the address shows, no button', async () => {
    const x = await settings()
    expect(x.host.querySelector('.settings__host')!.textContent).toBe(location.host)
    expect(x.button('Check for updates')).toBeNull()
  })

  it('the build at the top and in the Version row name the same commit text, as /version.txt does', async () => {
    const x = await settings(fakeUpdates())
    const commit = 'bb8a4aa30'
    expect(buildLine({ version: '0.7.0', built: '', commit })).toBe(`Build ${commit}`)
    expect(versionWords({ version: '0.7.0', built: '', commit })).toBe(`Version 0.7.0 · Build ${commit}`)
    const top = x.host.querySelector('.settings__build')!.textContent!
    const row = x.host.querySelector('.settings__version')!.textContent!
    const name = buildName(BUILD)
    expect(top.startsWith(`Build ${name}`)).toBe(true)
    expect(row).toContain(`Build ${name}`)
  })
})
