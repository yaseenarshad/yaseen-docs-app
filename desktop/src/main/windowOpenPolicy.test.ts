import { describe, expect, it, vi } from 'vitest'
import { FILES_PREVIEW_FRAME } from '@shared/types'
import { FILES_PREVIEW_OPTIONS, blockFileNavigation, createWindowOpenHandler } from './windowOpenPolicy'

describe('createWindowOpenHandler', () => {
  it.each(['https://example.com', 'http://example.com', 'mailto:yasin@example.com', 'tel:+14805551212', 'ftp://example.com/file']) (
    'routes a safe absolute external URL to the OS and still denies the child window: %s',
    (url) => {
      const open = vi.fn(async () => undefined)
      const handler = createWindowOpenHandler(open)

      expect(handler({ url } as never)).toEqual({ action: 'deny' })
      expect(open).toHaveBeenCalledExactlyOnceWith({ href: url })
    },
  )

  it.each(['app://yaseen/index.html', 'file:///tmp/a.txt', 'javascript:alert(1)', 'not a url'])(
    'denies a non-external popup without routing it: %s',
    (url) => {
      const open = vi.fn(async () => undefined)
      const handler = createWindowOpenHandler(open)

      expect(handler({ url } as never)).toEqual({ action: 'deny' })
      expect(open).not.toHaveBeenCalled()
    },
  )

  it('denies synchronously even when OS routing rejects', async () => {
    const open = vi.fn(async () => {
      throw new Error('OS rejected')
    })
    const handler = createWindowOpenHandler(open)

    expect(handler({ url: 'https://example.com' } as never)).toEqual({ action: 'deny' })
    await expect(open.mock.results[0]?.value).rejects.toThrow('OS rejected')
  })
})

describe('the Files window preview popup (YAZ-3357 D9)', () => {
  it('a Files window may open exactly about:blank in the preview frame, frameless, clear, unfocusable and hidden', () => {
    const open = vi.fn(async () => undefined)
    const answer = createWindowOpenHandler(open, true)({ url: 'about:blank', frameName: FILES_PREVIEW_FRAME } as never)
    expect(answer).toEqual({ action: 'allow', overrideBrowserWindowOptions: FILES_PREVIEW_OPTIONS })
    expect(FILES_PREVIEW_OPTIONS).toMatchObject({ frame: false, transparent: true, hasShadow: false, focusable: false, show: false, skipTaskbar: true, resizable: false })
    expect(open).not.toHaveBeenCalled()
  })

  it.each([
    ['a normal window', false, 'about:blank', FILES_PREVIEW_FRAME],
    ['another frame name', true, 'about:blank', 'other'],
    ['another URL', true, 'app://yaseen/index.html', FILES_PREVIEW_FRAME],
  ])('denies %s', (_what, files, url, frameName) => {
    expect(createWindowOpenHandler(vi.fn(async () => undefined), files)({ url, frameName } as never)).toEqual({ action: 'deny' })
  })
})

describe('blockFileNavigation (YAZ-3253 S21)', () => {
  it('stops the window from opening a dropped file, and lets every other navigation go', () => {
    const go = (url: string, legacy = false) => {
      const event = { ...(legacy ? {} : { url }), preventDefault: vi.fn() }
      blockFileNavigation(event, legacy ? url : undefined)
      return event.preventDefault.mock.calls.length === 1
    }
    expect([go('file:///Users/yasin/Downloads/Note.md'), go('file:///tmp/a%20b.pdf', true)]).toEqual([true, true])
    expect([go('app://yaseen/index.html?win=w1'), go('http://localhost:5173/'), go('not a url')]).toEqual([false, false, false])
  })

  it("names the dropped file it stopped, so main can tell a drag out that landed in this window (YAZ-3263); null for every other navigation", () => {
    const block = (url: string) => blockFileNavigation({ url, preventDefault: vi.fn() })
    expect([block('file:///Users/yasin/vault/a%20b.md'), block('file:///Users/yasin/vault/Plans/')]).toEqual(['/Users/yasin/vault/a b.md', '/Users/yasin/vault/Plans'])
    expect([block('app://yaseen/index.html'), block('not a url')]).toEqual([null, null])
  })
})
