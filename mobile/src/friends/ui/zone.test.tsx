// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { GOOD, mount, signInWithForm, type Harness } from '../../screens/testing'

/** B3 (YAZ-5251) in plain words: what the home time zone does, and when a change shows. */
let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
})

describe('"Home time zone" in Settings', () => {
  it('says what it does and that a change shows from the next day', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.click('Home time zone')
    expect(h.text()).toContain('Your friends see your days in this time zone. Friends do not see the zone.')
    const select = h.host.querySelector('select')!
    expect(select.getAttribute('aria-label')).toBe('Home time zone')
    await act(async () => {
      select.value = 'Asia/Tokyo'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await h.settle()
    expect(h.text()).toContain('Saved. Your days use the new time zone from your next day. Days already sent do not change.')
  })
})
