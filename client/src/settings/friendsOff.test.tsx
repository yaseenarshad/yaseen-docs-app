/**
 * YAZ-5652: Friends is off for now (`shared/features.ts`). Settings › Cards › GitHub keeps the token row (Mac sync
 * uses it) and shows no Friends row; nothing asks main for the friends send. `friendsSend.test.tsx` turns it on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FRIENDS_ENABLED } from '@shared/features'
import { DEFAULT_SETTINGS } from '@shared/types'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { api } from '../api'
import { SettingsDialog } from './SettingsDialog'
import { resetGithubTokenStatus } from './githubToken'
import { isAvailable, type SettingsCtx } from './registry'
import { searchSettings, settingCandidates } from './searchSettings'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    secrets: { has: vi.fn(async () => true), set: vi.fn() },
    friends: { status: vi.fn() },
    state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() },
  },
}))

const ctx = (): SettingsCtx => ({ settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), review: { settings: DEFAULT_REVIEW_SETTINGS, save: vi.fn() } })

let root: Root | null = null
let el: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

describe('Friends off (YAZ-5652)', () => {
  it('the switch is off in the app', () => {
    expect(FRIENDS_ENABLED).toBe(false)
  })

  it('Settings › Cards › GitHub: the token row stays, no Friends row, and no friends:status call', async () => {
    resetGithubTokenStatus()
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    act(() => root?.render(<SettingsDialog ctx={ctx()} onClose={vi.fn()} />))
    act(() => [...el!.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Cards')?.click())
    await act(async () => void (await import('./GithubTokenControl')))
    for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve())
    expect(el.querySelector('[data-setting="githubToken"]')).not.toBeNull()
    expect(el.querySelector('[data-setting="friendsSend"]')).toBeNull()
    expect(el.textContent).not.toMatch(/friend/i)
    expect(api.friends.status).not.toHaveBeenCalled()
  })

  it('a search for "friends" shows no row (the dialog shows the hits that are available)', () => {
    const c = ctx()
    expect(searchSettings(settingCandidates(c), 'friends').filter((h) => isAvailable(h.item, c)).map((h) => h.item.id)).toEqual([])
  })
})
