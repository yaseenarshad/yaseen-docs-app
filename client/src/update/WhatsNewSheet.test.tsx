/**
 * The "What's new" sheet (YAZ-2976 D5): the notes as sanitised HTML with lazy images (S16), links
 * through `window.open` (S17), the failure text (S18), the buttons for each state (S13–S15), and
 * the ways to close it (S19).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReleaseNote, UpdateState } from '@shared/types'
import WhatsNewSheet from './WhatsNewSheet'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NOTES: ReleaseNote[] = [
  { version: '1.0.14', title: 'Faster tabs', date: '2026-10-20T10:00:00Z', body: '**Bold** news\n\n![demo](https://github.com/x/demo.gif)\n\n[the docs](https://example.com/docs)' },
  { version: '1.0.13', title: '', date: '2026-10-17T10:00:00Z', body: 'Signed builds.<script>alert(1)</script>' },
]

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

function installBridge(notes: () => Promise<ReleaseNote[]>) {
  const bridge = { update: { state: vi.fn(), onState: vi.fn(), notes: vi.fn(notes), restart: vi.fn(async () => undefined) } }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

async function render(update: UpdateState, notes: () => Promise<ReleaseNote[]> = async () => NOTES) {
  const bridge = installBridge(notes)
  const onClose = vi.fn()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root?.render(<WhatsNewSheet update={update} onClose={onClose} />))
  const el = host
  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.whats-new__actions button')]
  return { el, bridge, onClose, buttons, labels: () => buttons().map((b) => b.textContent) }
}

describe('WhatsNewSheet: the notes', () => {
  it('renders each release in order: its title, else its version, and its body as sanitised HTML', async () => {
    const { el } = await render({ kind: 'idle' })
    const releases = [...el.querySelectorAll('.whats-new__release')]
    expect(releases.map((r) => r.querySelector('h3')?.textContent)).toEqual(['Faster tabs', '1.0.13'])
    expect(releases[0].querySelector('.whats-new__body strong')?.textContent).toBe('Bold')
    expect(releases[1].querySelector('.whats-new__body')?.textContent).toContain('Signed builds.')
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('whats-new-title')
  })

  it('S16: every image loads lazily', async () => {
    const { el } = await render({ kind: 'idle' })
    const imgs = [...el.querySelectorAll('img')]
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('loading')).toBe('lazy')
    expect(imgs[0].getAttribute('src')).toBe('https://github.com/x/demo.gif')
  })

  it('S17: a link click opens through window.open and does not navigate', async () => {
    const { el } = await render({ kind: 'idle' })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => void el.querySelector('a')!.dispatchEvent(click))
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/docs')
    expect(click.defaultPrevented).toBe(true)
  })

  it('says "Loading…" while it waits', async () => {
    const { el } = await render({ kind: 'idle' }, () => new Promise(() => undefined))
    expect(el.querySelector('.whats-new__msg')?.textContent).toBe('Loading…')
  })

  it('S18: a failed read says so, and the action button still works', async () => {
    const { el, bridge, buttons } = await render({ kind: 'ready', version: '1.0.14' }, async () => Promise.reject(new Error('offline')))
    expect(el.querySelector('.whats-new__msg')?.textContent).toBe("Can't load the notes. Check your connection.")
    act(() => buttons()[1].click())
    expect(bridge.update.restart).toHaveBeenCalledTimes(1)
  })
})

describe('WhatsNewSheet: the buttons', () => {
  it('S14 ready: "Later" and "Restart to update", which asks main to restart', async () => {
    const { bridge, onClose, buttons, labels } = await render({ kind: 'ready', version: '1.0.14' })
    expect(labels()).toEqual(['Later', 'Restart to update'])
    act(() => buttons()[1].click())
    expect(bridge.update.restart).toHaveBeenCalledTimes(1)
    act(() => buttons()[0].click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('S13 manual: "Later" and "Download", which asks main for the release page and closes the sheet', async () => {
    const { bridge, onClose, buttons, labels } = await render({ kind: 'manual', version: '1.0.14' })
    expect(labels()).toEqual(['Later', 'Download'])
    act(() => buttons()[1].click())
    expect(bridge.update.restart).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each([{ kind: 'updated', version: '1.0.14' }, { kind: 'idle' }] as const)('S15 $kind: one "Close", which closes', async (update) => {
    const { bridge, onClose, buttons, labels } = await render(update)
    expect(labels()).toEqual(['Close'])
    act(() => buttons()[0].click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(bridge.update.restart).not.toHaveBeenCalled()
  })

  it('the first button has the focus on open, and the element before gets it back on close', async () => {
    const opener = document.body.appendChild(document.createElement('button'))
    opener.focus()
    const { buttons } = await render({ kind: 'ready', version: '1.0.14' })
    expect(document.activeElement).toBe(buttons()[0])
    act(() => root?.render(null))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('WhatsNewSheet: S19 closing', () => {
  it('Esc on the sheet closes it', async () => {
    const { el, onClose } = await render({ kind: 'idle' })
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void el.querySelector('.whats-new__actions button')!.dispatchEvent(esc))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(esc.defaultPrevented).toBe(true)
  })

  it('Esc elsewhere in the window is not the sheet\'s', async () => {
    const { onClose } = await render({ kind: 'idle' })
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a click on the backdrop closes it; a click in the sheet does not', async () => {
    const { el, onClose } = await render({ kind: 'idle' })
    act(() => void el.querySelector('.whats-new')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()
    act(() => void el.querySelector('.whats-new-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
