// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from './screens/testing'

describe('App', () => {
  it('starts on the sign-in when the phone has no vault (row F1)', async () => {
    const h = await mount()
    expect(h.host.querySelector('h1')?.textContent).toBe('Yaseen Docs')
    expect(h.button('Sign in with GitHub')).not.toBeNull()
    h.unmount()
  })
})
