/**
 * The settings cog's Appearance row (Desktop K, GRO-2218): Obsidian's control — System,
 * Light, Dark in that order — writing through the same onChange as every other row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { SettingsCog } from './SettingsPanel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(settings: SettingsState) {
  const onChange = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<SettingsCog settings={settings} onChange={onChange} />))
  act(() => container?.querySelector<HTMLButtonElement>('.settings__cog')?.click())
  return { onChange, el: container }
}

/** The Appearance row: first labelled row of the panel. */
const appearanceButtons = (el: HTMLElement) => [...el.querySelectorAll('.settings__row')[0].querySelectorAll('button')]

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('SettingsCog Appearance row (Desktop K, GRO-2218)', () => {
  it('offers System · Light · Dark in that order, with the current value active', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS })
    expect(el.querySelectorAll('.settings__label')[0].textContent).toBe('Appearance')
    const buttons = appearanceButtons(el)
    expect(buttons.map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false, false])
  })

  it('clicking Dark writes the whole settings object with theme flipped, nothing else touched', () => {
    const { onChange, el } = mount({ ...DEFAULT_SETTINGS })
    appearanceButtons(el)[2].click()
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('marks Dark active when the stored theme is dark', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(appearanceButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([false, false, true])
  })
})
