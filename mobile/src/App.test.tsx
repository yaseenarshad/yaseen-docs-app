// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { App } from './App'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('App (the placeholder until the screens of 4A)', () => {
  it('draws one bare page with the app name', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    expect(host.querySelector('h1')?.textContent).toBe('Notecards')
    act(() => root.unmount())
  })
})
