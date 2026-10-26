import { describe, expect, it } from 'vitest'
import { isRendererUrl, rendererUrlFor } from './rendererUrl'

describe('rendererUrlFor (YAZ-3357): a Files window has an origin of its own, so its zoom is its own', () => {
  it('moves the app host to files, and the dev server from localhost to [::1]; a full window keeps the base', () => {
    expect(rendererUrlFor('app://yaseen/index.html', false).toString()).toBe('app://yaseen/index.html')
    expect(rendererUrlFor('app://yaseen/index.html', true).toString()).toBe('app://files/index.html')
    expect(rendererUrlFor('http://localhost:5175/', true).toString()).toBe('http://[::1]:5175/')
    expect(new URL(rendererUrlFor('http://localhost:5175/', true)).origin).not.toBe(new URL('http://localhost:5175/').origin)
  })

  it('isRendererUrl takes either renderer, and nothing else', () => {
    expect(isRendererUrl('app://yaseen/index.html?win=a', 'app://yaseen/index.html')).toBe(true)
    expect(isRendererUrl('app://files/index.html?win=f', 'app://yaseen/index.html')).toBe(true)
    expect(isRendererUrl('app://drawio/index.html', 'app://yaseen/index.html')).toBe(false)
    expect(isRendererUrl('http://[::1]:5175/?win=f', 'http://localhost:5175/')).toBe(true)
    expect(isRendererUrl('https://example.com/', 'http://localhost:5175/')).toBe(false)
    expect(isRendererUrl('not a url', 'http://localhost:5175/')).toBe(false)
  })
})
