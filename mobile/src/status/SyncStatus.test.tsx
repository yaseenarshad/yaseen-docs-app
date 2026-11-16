// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { loadAccount, saveAccount } from '../auth/account'
import { GOOD, mount, newPhone, NOW, signInWithForm, useTokenInstead, type Harness } from '../screens/testing'
import { clockTime } from './dot'
import { LAST_SYNC_STATE } from './lastSync'
import { DOT_TIMES } from './storeCheck'
import { fakeAnswers, lostAnswer, type FakeAnswers } from './testing'

// YAZ-5652: Friends is off in the app (`shared/features.ts`); this file tests today's behaviour with it on.
vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))

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
/**
 * What the dot says: its colour, its words (YAZ-5451: in the bar for amber and red, else only in its VoiceOver name),
 * whether the words show in the bar, and the name.
 */
const shown = (x: Harness) => {
  const b = status(x)
  const dot = b.querySelector('.sync-dot')!
  const label = b.getAttribute('aria-label')
  const inBar = b.querySelector('.sync-status__words--full, .sync-status__words')?.textContent ?? null
  return { colour: [...dot.classList].find((c) => c.startsWith('sync-dot--'))!.slice('sync-dot--'.length), words: inBar ?? label!.replace(/^Sync status: /, '').replace(/\. Sync now$/, ''), inBar: inBar !== null, label }
}
async function until(ok: () => boolean, ms = 1000) {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out')
    await act(async () => new Promise((r) => setTimeout(r, 20)))
  }
}
const answersDo = async (x: Harness, fn: () => void) => {
  await act(async () => fn())
  await x.settle()
}

describe('the dot in the top bar: always shown (decision 12)', () => {
  it('green "Synced" after sign-in, next to the vault name and before the gear', async () => {
    ;({ h } = await signedIn())
    // YAZ-5451: green is the dot only; VoiceOver reads the state and what a tap does.
    expect(shown(h)).toEqual({ colour: 'synced', words: 'Synced', inBar: false, label: 'Sync status: Synced. Sync now' })
    const bar = [...h.host.querySelector('.topbar')!.children].map((e) => e.className)
    // YAZ-5415, YAZ-5501: on the Review tab the bar is one line: the Review count first, then the dot and the gear on
    // the right, as on every other screen; the vault's name stays for VoiceOver.
    expect(bar).toEqual(['topbar__title sr-only', 'topbar__review', 'sync-status sync-status--dot', 'icon-btn topbar__gear'])
  })

  it('each engine state: blue while a pass runs, grey with no signal, amber on "slow down", red on 401', async () => {
    ;({ h } = await signedIn())
    await h.syncSet({ status: 'syncing' })
    expect(shown(h)).toMatchObject({ colour: 'syncing', words: 'Syncing…' })
    await h.syncSet({ status: 'off', problem: 'OFFLINE' })
    expect(shown(h)).toMatchObject({ colour: 'off', words: 'No signal', inBar: false })
    await h.syncSet({ status: 'slowed', problem: 'RATE_LIMITED', retryAt: NOW + 120_000 })
    expect(shown(h)).toMatchObject({ colour: 'pending', words: 'Waiting for GitHub', inBar: true })
    await h.syncSet({ status: 'attention', problem: 'UNAUTHORIZED', retryAt: null })
    expect(shown(h)).toMatchObject({ colour: 'attention', words: 'Sign in again', inBar: true, label: 'Sync status: Sign in again' })
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

  it('a sync with no answer list at all (no `review()`): the engine alone drives the dot', async () => {
    const phone = await newPhone()
    const x = await mount({ phone })
    h = x
    await signInWithForm(x, 'yaseen/vault', GOOD)
    expect(shown(x)).toMatchObject({ colour: 'synced', words: 'Synced' })
    await x.syncSet({ status: 'syncing' })
    expect(shown(x)).toMatchObject({ colour: 'syncing' })
  })

  it('YAZ-5297: the list is not there yet (the engine chunk still loads): "Checking…", never "Synced"', async () => {
    ;({ h } = await signedIn({ answers: null }))
    expect(shown(h)).toMatchObject({ colour: 'off', words: 'Checking…' })
  })

  it('VoiceOver: one button that says the words, not only a colour; the dot itself is hidden from it', async () => {
    ;({ h } = await signedIn())
    const b = status(h)
    expect(b.tagName).toBe('BUTTON')
    // YAZ-5451: a green dot syncs now (no sheet); amber and red open the sheet.
    expect(b.getAttribute('aria-haspopup')).toBeNull()
    expect(b.querySelector('.sync-dot')!.getAttribute('aria-hidden')).toBe('true')
    await h.syncSet({ status: 'off', problem: 'OFFLINE' })
    expect(b.getAttribute('aria-label')).toBe('Sync status: No signal. Sync now')
    await h.syncSet({ status: 'attention', problem: 'UNAUTHORIZED' })
    expect(b.getAttribute('aria-label')).toBe('Sync status: Sign in again')
    expect(b.getAttribute('aria-haspopup')).toBe('dialog')
  })
})

describe('YAZ-5451: a tap on a green, blue or grey dot syncs now', () => {
  it('green: a tap calls syncNow, the dot is blue while it runs, no sheet opens; the 15 s checks are the engine\'s own', async () => {
    ;({ h } = await signedIn())
    let end!: () => void
    const calls = h.sync.syncNowCalls
    h.sync.syncNow = async () => {
      h!.sync.syncNowCalls++
      await new Promise<void>((r) => (end = r))
    }
    await h.click('Sync status: Synced. Sync now')
    expect(h.sync.syncNowCalls).toBe(calls + 1)
    expect(h.host.querySelector('[role="dialog"]')).toBeNull()
    expect(shown(h)).toMatchObject({ colour: 'syncing', words: 'Syncing…', inBar: false, label: 'Sync status: Syncing…' })
    await act(async () => end())
    await h.settle()
    expect(shown(h)).toMatchObject({ colour: 'synced', words: 'Synced' })
  })

  it('grey (no signal): a tap tries a sync now too', async () => {
    ;({ h } = await signedIn())
    await h.syncSet({ status: 'off', problem: 'OFFLINE' })
    const calls = h.sync.syncNowCalls
    await h.click('Sync status: No signal. Sync now')
    expect(h.sync.syncNowCalls).toBe(calls + 1)
  })
})

describe('YAZ-5469: a quiet toast after a tap on the dot', () => {
  const toast = (x: Harness) => x.host.querySelector('.toast')
  const diff = (added: string[], changed: string[] = []) => ({ added, changed, removed: [], renamed: [] })

  it('"Synced · 3 pages updated" with the files of the pass; role="status"; under the bar; gone after about 2 s', async () => {
    ;({ h } = await signedIn())
    h.sync.syncNow = async () => {
      h!.sync.emit({ type: 'changed', vault: 'yaseen/vault@main', settings: [], diff: diff(['Words/a.md', 'Words/b.md'], ['Notes/c.md']) })
    }
    await h.click('Sync status: Synced. Sync now')
    await until(() => toast(h!) !== null)
    expect(toast(h)!.textContent).toBe('Synced · 3 pages updated')
    expect(toast(h)!.getAttribute('role')).toBe('status')
    expect(toast(h)!.className).toBe('toast toast--top')
    await until(() => toast(h!) === null, 3000)
  })

  it('"Synced · up to date" when nothing came in; another vault\'s changes do not count', async () => {
    ;({ h } = await signedIn())
    h.sync.syncNow = async () => {
      h!.sync.emit({ type: 'changed', vault: 'other/vault@main', settings: [], diff: diff(['x.md']) })
    }
    await h.click('Sync status: Synced. Sync now')
    await until(() => toast(h!) !== null)
    expect(toast(h)!.textContent).toBe('Synced · up to date')
  })

  it('"No signal · will sync later" when the pass fails with no signal (grey dot)', async () => {
    ;({ h } = await signedIn())
    await h.syncSet({ status: 'off', problem: 'OFFLINE' })
    await h.click('Sync status: No signal. Sync now')
    await until(() => toast(h!) !== null)
    expect(toast(h)!.textContent).toBe('No signal · will sync later')
  })

  it('the problem in a few words when GitHub is down or the token stopped working', async () => {
    ;({ h } = await signedIn())
    h.sync.syncNow = async () => h!.sync.set({ status: 'off', problem: 'GITHUB_DOWN' })
    await h.click('Sync status: Synced. Sync now')
    await until(() => toast(h!) !== null)
    expect(toast(h)!.textContent).toBe('GitHub is down · will sync later')
    await h.syncSet({ status: 'synced', problem: null })
    h.sync.syncNow = async () => h!.sync.set({ status: 'attention', problem: 'UNAUTHORIZED' })
    await h.click('Sync status: Synced. Sync now')
    await until(() => toast(h!)?.textContent === 'Not synced · sign in again')
  })

  it('the automatic pass says nothing', async () => {
    ;({ h } = await signedIn())
    await h.syncSet({ status: 'syncing' })
    await act(async () => h!.sync.emit({ type: 'changed', vault: 'yaseen/vault@main', settings: [], diff: diff(['a.md']) }))
    await h.syncSet({ status: 'synced' })
    await new Promise((r) => setTimeout(r, 50))
    expect(toast(h)).toBeNull()
  })
})

describe('a tap on an amber or red dot shows what is wrong (decision 12)', () => {
  it('amber: the words stay in the bar; the sheet says why and the last sync; Close and Escape close it', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await h.syncSet({ lastSyncedAt: NOW - 2 * 3_600_000 })
    await answersDo(h, () => answers.set({ waiting: 1 }))
    expect(shown(h)).toMatchObject({ colour: 'pending', words: '1 answer waiting', inBar: true })
    const calls = h.sync.syncNowCalls
    await h.click('Sync status: 1 answer waiting')
    expect(h.sync.syncNowCalls).toBe(calls)
    const sheet = h.host.querySelector('[role="dialog"]')!
    expect(sheet.getAttribute('aria-label')).toBe('Sync status')
    expect(sheet.textContent).toContain('1 answer waiting')
    expect(sheet.textContent).toContain(`Last synced 2h ago, at ${clockTime(NOW - 2 * 3_600_000)}`)
    expect(document.activeElement?.textContent).toBe('Close')
    await h.click('Close')
    expect(h.host.querySelector('[role="dialog"]')).toBeNull()
    await h.click('Sync status: 1 answer waiting')
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(h.host.querySelector('[role="dialog"]')).toBeNull()
    // The focus goes back to the dot.
    expect(document.activeElement).toBe(status(h))
  })

  it('the last sync is the newer of the last pass and the last send that GitHub took', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await h.syncSet({ lastSyncedAt: NOW - 3 * 3_600_000 })
    await answersDo(h, () => answers.set({ lastSentAt: NOW - 5 * 60_000, waiting: 1 }))
    await h.click('Sync status: 1 answer waiting')
    expect(h.text()).toContain('Last synced 5 min ago')
  })

  it('"Can\'t sync now" (grey, the sync could not start) keeps its words and its sheet, which says what to do', async () => {
    const real = { ...DOT_TIMES }
    onTestFinished(() => void Object.assign(DOT_TIMES, real))
    Object.assign(DOT_TIMES, { checkMs: 40, probeMs: 40 })
    ;({ h } = await signedIn({ answers: null }))
    for (let i = 0; i < 60 && shown(h).words === 'Checking…'; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 50))))
    await h.settle()
    expect(shown(h)).toMatchObject({ colour: 'off', words: "Can't sync now", inBar: true, label: "Sync status: Can't sync now" })
    await h.click("Sync status: Can't sync now")
    expect(h.text()).toContain('The app could not start its sync.')
    expect(h.button('Try again')).not.toBeNull()
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
    // YAZ-5645: "Sign in with GitHub" first; the token form is one tap away.
    expect(h.button('Sign in with GitHub')).not.toBeNull()
    await useTokenInstead(h)
    expect(h.host.querySelector('input[name="token"]')).not.toBeNull()
    expect(h.host.querySelector('[role="dialog"]')).toBeNull()
    await h.syncSet({ status: 'synced', problem: null })
    await h.click('Back')
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

  it('YAZ-5245: a lost answer whose card has no title: the row and the ask name the card ID', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ lost: [lostAnswer(7, '', 'good', 'NC-40')] }))
    await h.click('Sync status: 1 answer could not be saved')
    expect(h.host.querySelector('[role="dialog"] li .row__main')?.textContent).toContain('NC-40')
    await h.click('Discard the answer to NC-40')
    expect(h.text()).toContain('Discard your answer "Remembered" to "NC-40"? It cannot be taken back.')
    expect(h.text()).not.toContain('to ""')
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
    await useTokenInstead(h)
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
    expect(ask.textContent).toContain('Discard your answer "Remembered" to "Speed of light"? It cannot be taken back.')
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

describe('YAZ-5297: a cold open with no signal and a stored waiting answer', () => {
  it('the dot counts the stored answer once the list is there; the sheet gives the stored last sync; never "Synced" while it waits', async () => {
    const phone = await newPhone()
    ;({ h } = await signedIn({ phone }))
    h.unmount()
    // The app was closed. The last sync of the last run is on the phone; the engine of the new run has none.
    await phone.store.setState('yaseen/vault@main', LAST_SYNC_STATE, NOW - 3 * 3_600_000)
    setOnline(false)
    const answers = fakeAnswers()
    answers.set({ waiting: 1 })
    let engineLoaded = false
    const x = await mount({ phone })
    h = x
    // As lazySync: `review()` gives null until the engine chunk has loaded (it first reads the checkpoint).
    ;(x.sync as unknown as { review?: () => Promise<unknown> }).review = async () => (engineLoaded ? { answers } : null)
    await x.syncSet({ status: 'syncing', vault: 'yaseen/vault@main', ready: true, lastSyncedAt: null })
    expect(shown(x).words).not.toBe('Synced')
    engineLoaded = true
    await x.syncSet({ status: 'off', problem: 'OFFLINE' })
    expect(shown(x)).toMatchObject({ colour: 'pending', words: '1 answer waiting · no signal' })
    await x.click('Sync status: 1 answer waiting · no signal')
    expect(x.text()).toContain(`Last synced 3h ago, at ${clockTime(NOW - 3 * 3_600_000)}`)
    await x.click('Close')
    // The signal comes back: the engine's pass ends before the list sends. Not green while the answer waits.
    await answersDo(x, () => setOnline(true))
    await x.syncSet({ status: 'syncing', problem: null })
    await x.syncSet({ status: 'synced', lastSyncedAt: NOW })
    expect(shown(x)).toMatchObject({ colour: 'pending', words: '1 answer waiting' })
    await answersDo(x, () => answers.set({ sending: true }))
    await answersDo(x, () => answers.set({ sending: false, waiting: 0, lastSentAt: NOW }))
    expect(shown(x)).toMatchObject({ colour: 'synced', words: 'Synced' })
    // The newer time is kept for the next run.
    expect(await phone.store.getState('yaseen/vault@main', LAST_SYNC_STATE)).toBe(NOW)
  })
})

describe('YAZ-5302 (4D5): the phone\'s store never opens (IndexedDB blocked, full, or held by another tab)', () => {
  const real = { ...DOT_TIMES }
  afterEach(() => Object.assign(DOT_TIMES, real))
  const pause = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
  /** Waits (up to 3 s) until the dot leaves "Checking…": a busy machine runs the 40 ms timers late. */
  const settled = async (x: Harness) => {
    for (let i = 0; i < 60 && shown(x).words === 'Checking…'; i++) await pause(50)
    await x.settle()
  }

  it('the dot does not stay on "Checking…": it ends red "Phone can\'t save", with the words and the way forward', async () => {
    Object.assign(DOT_TIMES, { checkMs: 40, probeMs: 40 })
    const phone = await newPhone()
    // The list never reads its stored answers: its state is never the open vault's.
    ;({ h } = await signedIn({ phone, answers: fakeAnswers('') }))
    expect(shown(h)).toMatchObject({ colour: 'off', words: 'Checking…' })
    // The store stops answering (a version change held by another tab, or a blocked IndexedDB).
    phone.store.getState = () => new Promise(() => {})
    await settled(h)
    expect(shown(h)).toMatchObject({ colour: 'attention', words: "Phone can't save", label: "Sync status: Phone can't save" })
    await h.click("Sync status: Phone can't save")
    expect(h.text()).toContain('This browser does not let Yaseen Docs keep your vault. Turn off Private Browsing, or allow site data for this site.')
    expect(h.button('Try again')).not.toBeNull()
  })

  it('a store that fails (rejects) gives the same end state', async () => {
    Object.assign(DOT_TIMES, { checkMs: 40, probeMs: 40 })
    const phone = await newPhone()
    ;({ h } = await signedIn({ phone, answers: fakeAnswers('') }))
    phone.store.getState = () => Promise.reject(new Error('QuotaExceededError'))
    await settled(h)
    expect(shown(h)).toMatchObject({ colour: 'attention', words: "Phone can't save" })
  })

  it('the store answers but the list never comes (the sync could not start): grey "Can\'t sync now", never green', async () => {
    Object.assign(DOT_TIMES, { checkMs: 40, probeMs: 40 })
    ;({ h } = await signedIn({ answers: null }))
    await settled(h)
    expect(shown(h)).toMatchObject({ colour: 'off', words: "Can't sync now" })
  })
})

describe('YAZ-5524 (sweep3 S-2): one change not sent never hides the rest', () => {
  const orphan = { id: 'a1b2c3d4', path: 'notes/Old plan.md', body: 'Made-up words', at: '2026-11-15T09:00:00Z', madeAt: 0, notBefore: 0, refused: 'gone' as const }

  it('dot_notSent_plusWaitingOffline_saysBoth_andSheetListsWaiting', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ notSent: [orphan], comments: 3 }))
    await answersDo(h, () => setOnline(false))
    expect(shown(h)).toMatchObject({ colour: 'pending', words: '1 not sent · 3 waiting', inBar: true })
    expect(status(h).getAttribute('aria-label')).toBe("Sync status: 1 comment couldn't be sent: its page is gone · 3 comments waiting · no signal")
    await h.click(/^Sync status: 1 comment couldn't be sent/)
    const sheet = h.host.querySelector('[role="dialog"]')!.textContent!
    // Every group: what was not sent (with its words), what waits and why, and GitHub's state.
    expect(sheet).toContain('Made-up words')
    expect(sheet).toContain('3 comments waiting · no signal')
    expect(sheet).toContain('They go to GitHub when the signal is back.')
  })

  it('GitHub is down: the sheet says so beside what was not sent', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ notSent: [orphan], comments: 1 }))
    await h.syncSet({ status: 'off', problem: 'GITHUB_DOWN' })
    expect(shown(h).words).toBe('1 not sent · 1 waiting')
    await h.click(/^Sync status: 1 comment couldn't be sent/)
    expect(h.host.querySelector('[role="dialog"]')!.textContent).toContain('GitHub is down.')
  })

  it('statusSheet_loud_hasSyncNow: the loud sheet can ask for a sync (and a send) now', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ notSent: [orphan] }))
    await h.click(/^Sync status: 1 comment couldn't be sent/)
    const [syncs, sends] = [h.sync.syncNowCalls, answers.sendNowCalls]
    await h.click('Sync now')
    expect(h.sync.syncNowCalls).toBe(syncs + 1)
    expect(answers.sendNowCalls).toBe(sends + 1)
  })

  it('discardAsk_back_closesAskOnly (sweep3 N-4): Back on the Discard ask closes the ask; the sheet stays', async () => {
    let answers: FakeAnswers
    ;({ h, answers } = await signedIn())
    await answersDo(h, () => answers.set({ notSent: [orphan] }))
    await h.click(/^Sync status: 1 comment couldn't be sent/)
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
    await h.click('Discard: Made-up words')
    expect(h.host.querySelector('.status-sheet .confirm')).not.toBeNull()
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
    await act(async () => {
      history.back()
      await new Promise((r) => setTimeout(r, 60))
    })
    expect(h.host.querySelector('.status-sheet .confirm')).toBeNull()
    expect(h.host.querySelector('.status-sheet')).not.toBeNull()
    expect(h.button('Discard: Made-up words')).not.toBeNull()
    // A second Back closes the sheet.
    await act(async () => {
      history.back()
      await new Promise((r) => setTimeout(r, 60))
    })
    expect(h.host.querySelector('.status-sheet')).toBeNull()
  })
})
