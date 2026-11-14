// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from './screens/testing'

describe('App', () => {
  it('starts on the sign-in when the phone has no vault (row F1)', async () => {
    const h = await mount()
    expect(h.host.querySelector('h1')?.textContent).toBe('Notecard')
    expect(h.button('Connect vault')).not.toBeNull()
    h.unmount()
  })
})
