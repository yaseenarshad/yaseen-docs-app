/**
 * Settings › Notifications (YAZ-3303): the page under Appearance, its rows, the sound switch that plays
 * the land sound once when turned On, and "Hear them", which plays with the switch Off. The bridge is
 * mocked: no row may reach a real main process or play a real sound.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { api } from '../api'
import { playGestureSound } from '../lib/gestureSound'
import { storage } from '../lib/storage'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    app: { sound: vi.fn(async () => undefined) },
    // Settings opens on General (YAZ-3276 D7), whose Settings folder row asks main where the settings are.
    state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() },
  },
}))

const sound = vi.mocked(api.app.sound)
let root: Root | null = null
let el: HTMLElement
const onChange = vi.fn()

beforeEach(() => {
  sound.mockClear()
  onChange.mockReset()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
  vi.restoreAllMocks()
})

async function mountNotifications(settings: SettingsState = { ...DEFAULT_SETTINGS }) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange }} onClose={vi.fn()} />))
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Notifications')?.click())
  await act(async () => await Promise.resolve())
}
const row = (id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`)!
const button = (id: string, label: string) => [...row(id).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!

describe('Settings › Notifications (YAZ-3303)', () => {
  it('D4, D5, D6: the page under Appearance holds Show for, the three toast types and the sounds; a choice writes its field (S3)', async () => {
    await mountNotifications()
    expect([...el.querySelectorAll('.settings-nav__item')].map((b) => b.textContent).slice(0, 4)).toEqual(['General', 'Appearance', 'Notifications', 'Editor'])
    expect([...el.querySelectorAll<HTMLElement>('[data-setting]')].map((r) => r.dataset.setting)).toEqual(['noticeLength', 'noticeUndo', 'noticeClipboard', 'noticeLists', 'gestureSounds', 'hearSounds'])
    expect([...row('noticeLength').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['4 s', '8 s', '15 s', 'Until closed'])
    act(() => button('noticeLength', 'Until closed').click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, noticeLength: 'closed' })
    act(() => button('noticeClipboard', 'Off').click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, noticeClipboard: false })
  })

  it('D7: turning "Play sounds" On plays the land sound once; Off plays nothing (S24)', async () => {
    await mountNotifications({ ...DEFAULT_SETTINGS, gestureSounds: false })
    act(() => button('gestureSounds', 'Off').click())
    expect(sound).not.toHaveBeenCalled()
    act(() => button('gestureSounds', 'On').click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, gestureSounds: true })
    expect(sound.mock.calls).toEqual([['land']])
  })

  it('D7 amended: "▶ Land" and "▶ Trash" play their sound with "Play sounds" Off (S25)', async () => {
    vi.spyOn(storage, 'getSettings').mockReturnValue({ ...DEFAULT_SETTINGS, gestureSounds: false })
    await mountNotifications({ ...DEFAULT_SETTINGS, gestureSounds: false })
    act(() => button('hearSounds', '▶ Land').click())
    act(() => button('hearSounds', '▶ Trash').click())
    expect(sound.mock.calls).toEqual([['land'], ['trash']])
  })

  it('D3: with "Play sounds" Off, a gesture asks main for no sound; On, it asks once (S23)', () => {
    const settings = vi.spyOn(storage, 'getSettings').mockReturnValue({ ...DEFAULT_SETTINGS, gestureSounds: false })
    playGestureSound('land')
    expect(sound).not.toHaveBeenCalled()
    settings.mockReturnValue({ ...DEFAULT_SETTINGS })
    playGestureSound('trash')
    expect(sound.mock.calls).toEqual([['trash']])
  })
})
