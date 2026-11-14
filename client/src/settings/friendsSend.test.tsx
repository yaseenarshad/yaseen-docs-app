/**
 * Settings › Review › "Phone and friends" › Friends (YAZ-5086, decision 16): what the Mac sends and to whom, and why it
 * did not send, in plain words. No switch (decision 22). The bridge is mocked: no real main process, token or GitHub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type FriendsSendView } from '@shared/types'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { api } from '../api'
import { SettingsDialog } from './SettingsDialog'
import { resetGithubTokenStatus } from './githubToken'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    secrets: { has: vi.fn(async () => true), set: vi.fn() },
    phone: { code: vi.fn() },
    friends: { status: vi.fn() },
    state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() },
  },
}))

const status = vi.mocked(api.friends.status)
const NOW = Date.parse('2026-11-14T15:00:00Z')
const view = (patch: Partial<FriendsSendView>): FriendsSendView => ({ status: 'sent', lastSentAt: NOW - 4 * 60_000, retryAt: null, friends: 3, groups: 1, missing: 0, ...patch })

let root: Root | null = null
let el: HTMLElement
beforeEach(() => {
  resetGithubTokenStatus()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  status.mockReset()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
  vi.restoreAllMocks()
})

async function mount(v: FriendsSendView) {
  status.mockResolvedValue(v)
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<SettingsDialog ctx={{ settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), review: { settings: DEFAULT_REVIEW_SETTINGS, save: vi.fn() }, vaultRoot: '/v' }} onClose={vi.fn()} />))
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Review')?.click())
  await act(async () => void (await Promise.all([import('./GithubTokenControl'), import('./ConnectPhoneControl'), import('./FriendsSendControl')])))
  for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve())
}
const row = () => el.querySelector<HTMLElement>('[data-setting="friendsSend"]')!

describe('Settings › Phone and friends › Friends (YAZ-5086)', () => {
  it('says what is sent and to whom, and when; no switch (decision 22)', async () => {
    await mount(view({}))
    expect(status).toHaveBeenCalledTimes(1)
    expect(row().textContent).toContain('Only your numbers')
    expect(row().textContent).toContain('Never your cards or your pages')
    expect(row().textContent).toContain('Sent to 3 friends and 1 group')
    expect(row().textContent).toContain('4 minutes ago')
    expect(row().querySelector('input, [role="switch"], [aria-pressed]')).toBeNull()
  })

  it.each<[Partial<FriendsSendView>, string]>([
    [{ status: 'no-friends', friends: 0, groups: 0 }, 'No friends yet, so nothing is sent'],
    // YAZ-5254: no friends list on the token's account (round 13, item 4: one GitHub account for friends).
    [{ status: 'no-list', login: 'other', friends: 0, groups: 0 }, 'No friends list on @other'],
    [{ status: 'no-list', login: 'other', friends: 0, groups: 0 }, 'the GitHub account of the phone app'],
    [{ status: 'no-token' }, 'Save a GitHub token above first'],
    [{ status: 'missing-vaults', missing: 1 }, '1 vault that counts for friends is not open'],
    [{ status: 'phone-first' }, 'open the phone app once'],
    [{ status: 'no-gists' }, 'Gists (Read and write)'],
    [{ status: 'sign-in-again' }, 'GitHub does not accept the token'],
    [{ status: 'offline' }, 'no connection to GitHub'],
    [{ status: 'slowed', retryAt: NOW + 20 * 60_000 }, '100 changes an hour'],
    [{ status: 'needs-repair' }, 'notecards-friends.json'],
    [{ status: 'needs-newer-app' }, 'newer app'],
    [{ status: 'failed' }, 'tries again'],
  ])('%o: %s', async (patch, words) => {
    await mount(view(patch))
    expect(row().textContent).toContain(words)
  })

  it('one friend and no group: the words count right', async () => {
    await mount(view({ friends: 1, groups: 0, lastSentAt: null, status: 'idle' }))
    expect(row().textContent).toContain('Sent to 1 friend when your cards change')
  })
})
