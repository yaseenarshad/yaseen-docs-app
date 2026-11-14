import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { DEFAULT_SETTINGS } from '@shared/types'
import { SettingsDialog } from '../settings/SettingsDialog'
import { COURSE } from './script'
import { courseMinutes } from './courseTime'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let el: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  el?.remove()
  root = null
  el = null
})

function mount(enabled: boolean, settings = { ...DEFAULT_SETTINGS }) {
  const openCourse = vi.fn()
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange: vi.fn(), review: { settings: { ...DEFAULT_REVIEW_SETTINGS, enabled }, save: vi.fn() }, openCourse }} initialPage="review" onClose={vi.fn()} />))
  return { openCourse, row: el.querySelector<HTMLElement>('[data-setting="cardCourse"]') }
}

describe('Settings › Review › Card course (YAZ-5120)', () => {
  it('has "Open the course", which opens it; its hint says the script`s minutes', () => {
    const { openCourse, row } = mount(true)
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('Card course')
    expect(row!.textContent).toContain(`About ${courseMinutes(COURSE)} minutes.`)
    const open = [...row!.querySelectorAll('button')].find((b) => b.textContent === 'Open the course')!
    act(() => open.click())
    expect(openCourse).toHaveBeenCalledOnce()
    // The guided tour's marks (YAZ-5123): the button, the Review page in the list, the card skill's switch.
    expect(open.dataset.tour).toBe('settings-course')
    expect(el!.querySelector('.settings-nav__item[data-tour="settings-review"]')?.textContent).toBe('Review')
    expect(el!.querySelectorAll('.settings-nav__item[data-tour]')).toHaveLength(1)
    expect(el!.querySelector('[data-tour="settings-card-skill"]')).not.toBeNull()
  })

  it('always shows: with Review off, and with Card tips off', () => {
    expect(mount(false).row).not.toBeNull()
    act(() => root?.unmount())
    el?.remove()
    expect(mount(true, { ...DEFAULT_SETTINGS, cardTips: false } as typeof DEFAULT_SETTINGS).row).not.toBeNull()
  })
})
