// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { GOOD, mount, signInWithForm, type Harness } from '../screens/testing'
import { APPEARANCE_KEY } from '../store/appearancePref'
import { appearance, setAppearance } from './appearance'

/** YAZ-5565: the Appearance part of the phone's Settings. */
let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
  setAppearance('system')
  localStorage.clear()
})

describe('Settings › Appearance (YAZ-5565)', () => {
  it('three choices, System first and checked; a tap on Dark paints the page dark and saves it on the phone', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    const group = h.host.querySelector('[role="radiogroup"][aria-label="Theme"]')!
    expect(group.previousElementSibling?.textContent).toBe('Appearance')
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(radios.map((r) => r.checked)).toEqual([true, false, false])
    await act(async () => radios[2].click())
    expect(radios.map((r) => r.checked)).toEqual([false, false, true])
    expect([appearance(), document.documentElement.dataset.scheme, localStorage.getItem(APPEARANCE_KEY)]).toEqual(['dark', 'dark', 'dark'])
  })

  it('YAZ-5667: one segmented row, an icon over each word, the Mac\'s order; no stacked rows or radio dots', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    const group = h.host.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Theme"]')!
    expect(group.classList.contains('segmented')).toBe(true)
    expect(group.querySelectorAll('.row, .check')).toHaveLength(0)
    const options = [...group.children] as HTMLLabelElement[]
    expect(options.map((o) => [o.tagName, o.className])).toEqual(Array(3).fill(['LABEL', 'segmented__option']))
    // The icon (drawn, not an emoji, hidden from VoiceOver) above the word; the radio itself is the one VoiceOver reads.
    expect(options.map((o) => [...o.children].map((c) => c.tagName.toLowerCase() + (c.getAttribute('aria-hidden') === 'true' ? ':hidden' : '')))).toEqual(
      Array(3).fill(['input', 'svg:hidden', 'span']),
    )
    expect(options.map((o) => o.querySelector('span')!.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(new Set(options.map((o) => o.querySelector('svg')!.innerHTML)).size).toBe(3)
    // One tap: Light at once, saved.
    await act(async () => options[1].querySelector('input')!.click())
    expect([appearance(), localStorage.getItem(APPEARANCE_KEY)]).toEqual(['light', 'light'])
  })
})
