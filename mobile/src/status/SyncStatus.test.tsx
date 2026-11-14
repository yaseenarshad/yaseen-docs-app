// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAccount, saveAccount } from '../auth/account'
import { GOOD, mount, newPhone, NOW, signInWithForm, type Harness } from '../screens/testing'
import { clockTime } from './dot'
import { fakeAnswers, lostAnswer, type FakeAnswers } from './testing'

/**
 * The dot in the top bar (YAZ-5080): the real app (4A) with the fake sync and a fake answer list. Each state, what a
 * tap shows, what VoiceOver reads.
 */

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
  setOnline(true)
})

function setOnline(on: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => on })
  window.dispatchEvent(new Event(on ? 'online' : 'offline'))
}

/** The app, signed in to `yaseen/vault`, with 3C's list given through the sync's `review()` (4B's link). */
async function signedIn(options: { phone?: Awaited<ReturnType<typeof newPhone>>; answers?: FakeAnswers | null } = {}) {
  const phone = options.phone ?? (await newPhone())
  const x = await mount({ phone })
  const answers = options.answers === undefined ? fakeAnswers() : options.answers
  ;(x.sync as unknown as { review?: () => Promise<unknown> }).review = async () => (answers === null ? null : { answers })
  if ((await phone.tokens.read('yaseen/vault@main')) === null) await signInWithForm(x, 'yaseen/vault', GOOD)
  else await x.syncSet({ status: 'synced', vault: 'yaseen/vault@main', ready: true })
  await x.settle()
  return { h: x, answers: answers! }
}

const status = (x: Harness) => x.host.querySelector<HTMLButtonElement>('.sync-status')!
const shown = (x: Harness) => {
  const b = status(x)
  const dot = b.querySelector('.sync-dot')!
  return { colour: [...dot.classList].find((c) => c.startsWith('sync-dot--'))!.slice('sync-dot--'.length), words: b.querySelector('.sync-status__words--full, .sync-status__words')!.textContent, label: b.getAttribute('aria-label') }
}
const answersDo = async (x: Harness, fn: () => void) => {
  await act(async () => fn())
  await x.settle()
}

describe('the dot in the top bar: always shown (decision 12)', () => {
  it('green "Synced" after sign-in, next to the vault name and before the gear', async () => {
    ;({ h } = await signedIn())
    expect(shown(h)).toEqual({ colour: 'synced', words: 'Synced', label: 'Sync status: Synced' })
    const bar = [...h.host.querySelector('.topbar')!.children].map((e) => e.className)
    expect(bar).toEqual(['topbar__title', 'sync-status', 'icon-btn'])
  })

  it('each engine state: blue while a pass runs, grey with no signal, amber on "slow down", red on 401', async () => {
    ;({ h } = await signedIn())
    await h.syncSet({ status: 'syncing' })
    expect(shown(h)).toMatchObject({ colour: 'syncing', words: 'Syncing…' })
    await h.syncSet({ status: 'off', problem: 'OFFLINE' })
    expect(shown(h)).toMatchObject({ colour: 'off', words: 'No signal' })
    await h.syncSet({ status: 'slowed', problem: 'RATE_LIMITED', retryAt: NOW + 120_000 })
    expect(shown(h)).toMatchObject({ colour: 'pending', words: 'Waiting for GitHub' })
    await h.syncSet({ status: 'attention', problem: 'UNAUTHORIZED', retryAt: null })
    expect(shown(h)).toMatchObject({ colour: 'attention', words: 'Sign in again', label: 'Sync status: Sign in again' })
    await h.syncSet({ status: 'synced', problem: null })
    expect(shown(h)).toMatchObject({ colour: 'synced', words: 'Synced' })
  })

  it('the answer list: amber "1 answer waiting", "3 answers waiting", blue while it sends, then green', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ waiting: 1 }))
    expect(shown(h)).toMatchObject({ colour: 'pending', words: '1 answer waiting' })
    await answersDo(h, () => answers.set({ waiting: 3 }))
    expect(shown(h)).toMatchObject({ colour: 'pending', words: '3 answers waiting' })
    await answersDo(h, () => answers.set({ sending: true }))
    expect(shown(h)).toMatchObject({ colour: 'syncing', words: 'Syncing…' })
    await answersDo(h, () => answers.set({ sending: false, waiting: 0 }))
    expect(shown(h)).toMatchObject({ colour: 'synced', words: 'Synced' })
  })

  it("the phone's own signal: grey at once when it goes offline; amber with both when answers wait; back again", async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => setOnline(false))
    expect(shown(h)).toMatchObject({ colour: 'off', words: 'No signal' })
    await answersDo(h, () => answers.set({ waiting: 2 }))
    expect(shown(h)).toMatchObject({ colour: 'pending', words: '2 answers waiting · no signal' })
    await answersDo(h, () => setOnline(true))
    expect(shown(h)).toMatchObject({ colour: 'pending', words: '2 answers waiting' })
  })

  it('with no answer list yet (4B not wired, or the engine still loads): the engine alone drives the dot', async () => {
    ;({ h } = await signedIn({ answers: null }))
    expect(shown(h)).toMatchObject({ colour: 'synced', words: 'Synced' })
    await h.syncSet({ status: 'syncing' })
    expect(shown(h)).toMatchObject({ colour: 'syncing' })
  })

  it('VoiceOver: one button that says the words, not only a colour; the dot itself is hidden from it', async () => {
    ;({ h } = await signedIn())
    const b = status(h)
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('aria-haspopup')).toBe('dialog')
    expect(b.querySelector('.sync-dot')!.getAttribute('aria-hidden')).toBe('true')
    await h.syncSet({ status: 'off', problem: 'OFFLINE' })
    expect(b.getAttribute('aria-label')).toBe('Sync status: No signal')
  })
})

describe('a tap on the dot shows the time of the last sync (decision 12)', () => {
  it('green: "Last synced 2h ago" and the clock time; Close and Escape close it', async () => {
    ;({ h } = await signedIn())
    await h.syncSet({ lastSyncedAt: NOW - 2 * 3_600_000 })
    await h.click('Sync status: Synced')
    const sheet = h.host.querySelector('[role="dialog"]')!
    expect(sheet.getAttribute('aria-label')).toBe('Sync status')
    expect(sheet.textContent).toContain('Synced')
    expect(sheet.textContent).toContain(`Last synced 2h ago, at ${clockTime(NOW - 2 * 3_600_000)}`)
    expect(document.activeElement?.textContent).toBe('Close')
    await h.click('Close')
    expect(h.host.querySelector('[role="dialog"]')).toBeNull()
    await h.click('Sync status: Synced')
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(h.host.querySelector('[role="dialog"]')).toBeNull()
    // The focus goes back to the dot.
    expect(document.activeElement).toBe(status(h))
  })

  it('the last sync is the newer of the last pass and the last send that GitHub took', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await h.syncSet({ lastSyncedAt: NOW - 3 * 3_600_000 })
    await answersDo(h, () => answers.set({ lastSentAt: NOW - 5 * 60_000 }))
    await h.click('Sync status: Synced')
    expect(h.text()).toContain('Last synced 5 min ago')
  })

  it('no signal: the words say that review still works and the answers wait on the phone', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ waiting: 1 }))
    await answersDo(h, () => setOnline(false))
    await h.click('Sync status: 1 answer waiting · no signal')
    expect(h.text()).toContain('Your answers are safe on this phone. They go to GitHub when the signal is back.')
  })

  it('"slow down": the time when the app tries again; no button to act', async () => {
    ;({ h } = await signedIn())
    await h.syncSet({ status: 'slowed', problem: 'RATE_LIMITED', retryAt: NOW + 120_000 })
    await h.click('Sync status: Waiting for GitHub')
    expect(h.text()).toContain(`GitHub asked the app to slow down. It tries again at ${clockTime(NOW + 120_000)}.`)
    expect([...h.host.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent)).toEqual(['Close'])
  })

  it('red (401, N6): the reason and "Sign in again", which opens the token form; after a new token the dot is green', async () => {
    ;({ h } = await signedIn())
    await h.syncSet({ status: 'attention', problem: 'UNAUTHORIZED' })
    await h.click('Sync status: Sign in again')
    const sheet = h.host.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('GitHub does not accept the token for yaseen/vault.')
    await act(async () => [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Sign in again')!.click())
    await h.settle()
    expect(h.host.querySelector('input[name="token"]')).not.toBeNull()
    expect(h.host.querySelector('[role="dialog"]')).toBeNull()
    await h.syncSet({ status: 'synced', problem: null })
    await h.click('‹ Back')
    expect(shown(h)).toMatchObject({ colour: 'synced', words: 'Synced' })
  })
})

describe('a lost answer (round 12 item 9): the title, the answer, and Discard', () => {
  it('amber "1 answer could not be saved"; the sheet lists it with Discard; Discard removes it; then green', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ lost: [lostAnswer(5)] }))
    expect(shown(h)).toMatchObject({ colour: 'pending', words: '1 answer could not be saved' })
    await h.click('Sync status: 1 answer could not be saved')
    expect(h.text()).toContain('Speed of light')
    expect(h.text()).toContain('Remembered')
    await h.click('Discard the answer to Speed of light')
    await h.click('Discard answer')
    expect(answers.discarded).toEqual([5])
    expect(shown(h)).toMatchObject({ colour: 'synced', words: 'Synced' })
    expect(h.text()).not.toContain('Speed of light')
  })

  it('2 lost answers: "2 answers could not be saved", one row each, "Forgot" for again', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ lost: [lostAnswer(5), lostAnswer(6, 'Ohm', 'again', 'NC-2')] }))
    expect(shown(h)).toMatchObject({ words: '2 answers could not be saved' })
    await h.click('Sync status: 2 answers could not be saved')
    expect(h.host.querySelectorAll('[role="dialog"] li')).toHaveLength(2)
    expect(h.text()).toContain('Forgot')
  })

  it('red wins in the top bar, but the sheet still lists the lost answer', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ lost: [lostAnswer(5)] }))
    await h.syncSet({ status: 'attention', problem: 'UNAUTHORIZED' })
    await h.click('Sync status: Sign in again')
    expect(h.button('Discard the answer to Speed of light')).not.toBeNull()
  })
})

describe('the token end date (round 10 item 18; 3E)', () => {
  it('3 days before the end: amber "Token ends in 3 days"; the sheet has the date and "Replace token"', async () => {
    const phone = await newPhone()
    ;({ h } = await signedIn({ phone }))
    h.unmount()
    const account = (await loadAccount(phone.store, 'yaseen/vault@main'))!
    const endsAt = new Date(NOW + 2.5 * 86_400_000).toISOString()
    await saveAccount(phone.store, 'yaseen/vault@main', { ...account, expiresAt: endsAt })
    ;({ h } = await signedIn({ phone }))
    expect(shown(h)).toMatchObject({ colour: 'pending', words: 'Token ends in 3 days' })
    await h.click('Sync status: Token ends in 3 days')
    expect(h.text()).toContain('Your GitHub token ends on')
    await h.click('Replace token')
    expect(h.host.querySelector('input[name="token"]')).not.toBeNull()
  })

  it('after the end date: red "Sign in again", also before GitHub answers 401', async () => {
    const phone = await newPhone()
    ;({ h } = await signedIn({ phone }))
    h.unmount()
    const account = (await loadAccount(phone.store, 'yaseen/vault@main'))!
    await saveAccount(phone.store, 'yaseen/vault@main', { ...account, expiresAt: new Date(NOW - 60_000).toISOString() })
    ;({ h } = await signedIn({ phone }))
    expect(shown(h)).toMatchObject({ colour: 'attention', words: 'Sign in again' })
  })
})

describe("YAZ-5214: the answer list's long wait (its own state)", () => {
  for (const problem of ['RATE_LIMITED', 'STALE_HEAD'] as const)
    it(`${problem}: the sheet says when the answers go, not "in a few seconds"`, async () => {
      let answers: FakeAnswers
      ;({ h, answers } = await signedIn())
      await answersDo(h, () => answers.set({ waiting: 2, problem, ...({ retryAt: NOW + 45 * 60_000 } as object) }))
      await h.click('Sync status: 2 answers waiting')
      const text = h.host.querySelector('[role="dialog"]')!.textContent!
      expect(text).not.toContain('in a few seconds')
      expect(text).toContain(clockTime(NOW + 45 * 60_000))
      expect(text).toContain('Next try in about 45 minutes')
      expect(text).toContain('Nothing is lost')
    })

  it('"Try now" asks the list to send at once', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ waiting: 1, problem: 'STALE_HEAD', retryAt: NOW + 4 * 60_000 }))
    await h.click('Sync status: 1 answer waiting')
    expect(h.text()).toContain('Next try in about 4 minutes')
    await h.click('Try now')
    expect(answers.sendNowCalls).toBe(1)
  })

  it('a send that failed (GitHub down) waits for the next sync: the sheet says so, with "Try now"', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ waiting: 1, problem: 'GITHUB_DOWN', retryAt: null }))
    await h.click('Sync status: 1 answer waiting')
    expect(h.text()).not.toContain('in a few seconds')
    expect(h.text()).toContain('The last send did not reach GitHub.')
    expect(h.button('Try now')).not.toBeNull()
  })
})

describe('YAZ-5215: Discard asks first', () => {
  it('asks before it removes the answer for good', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ lost: [lostAnswer(5)] }))
    await h.click('Sync status: 1 answer could not be saved')
    await h.click('Discard the answer to Speed of light')
    expect(answers.discarded).toEqual([])
    const ask = h.host.querySelector('[role="alertdialog"]')!
    expect(ask.textContent).toContain('Discard your answer "Remembered" to Speed of light? It cannot be taken back.')
    // Cancel is the default: it has the focus, and it keeps the answer.
    expect(document.activeElement?.textContent).toBe('Cancel')
    await h.click('Cancel')
    expect(answers.discarded).toEqual([])
    expect(h.text()).toContain('Speed of light')
    await h.click('Discard the answer to Speed of light')
    await h.click('Discard answer')
    expect(answers.discarded).toEqual([5])
  })
})

describe('YAZ-5216: the words are never cut', () => {
  it('a short form for a narrow top bar that says both facts; VoiceOver reads the full words', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => setOnline(false))
    await answersDo(h, () => answers.set({ waiting: 3 }))
    const b = status(h)
    expect(b.querySelector('.sync-status__words--full')!.textContent).toBe('3 answers waiting · no signal')
    expect(b.querySelector('.sync-status__words--short')!.textContent).toBe('3 waiting · offline')
    expect(b.getAttribute('aria-label')).toBe('Sync status: 3 answers waiting · no signal')
    for (const span of b.querySelectorAll('.sync-status__words')) expect(span.getAttribute('aria-hidden')).toBe('true')
  })
})
