/**
 * The "What's new" sheet (YAZ-2976 D5, YAZ-2988 D9–D12): the list of releases with the two tags, the
 * release it opens on for each state, a row click and ↑ / ↓, only the selected release in the
 * document, the notes as sanitised HTML with lazy images (S16), a picture that opens the lightbox with
 * the release's pictures (D12), links through `window.open` (S17), the failure text (S18), the
 * buttons for each state (S13–S15), and the ways to close it, Esc layered under the lightbox (S19).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReleaseNote, ReleaseNotes, UpdateState } from '@shared/types'
import WhatsNewSheet from './WhatsNewSheet'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const RELEASES: ReleaseNote[] = [
  { version: '1.0.14', title: 'v1.0.14 — Faster tabs', date: '2026-10-20T10:00:00Z', body: '**Bold** news\n\n![one](https://github.com/x/one.gif)\n\n[the docs](https://example.com/docs)\n\n![two](https://github.com/x/two.png)\n\n[![three](https://github.com/x/three.png)](https://github.com/x/three.png)' },
  { version: '1.0.13', title: '', date: '2026-10-17T10:00:00Z', body: 'Signed builds.<script>alert(1)</script>' },
  { version: '1.0.12', title: 'Tab names', date: '2026-10-16T10:00:00Z', body: 'Tab names.\n\n![old](https://github.com/x/old.png)' },
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

function installBridge(notes: () => Promise<ReleaseNotes>) {
  const bridge = { update: { state: vi.fn(), onState: vi.fn(), notes: vi.fn(notes), restart: vi.fn(async () => undefined) } }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

/** Mounts the sheet; the app runs `current` (1.0.13 by default: one release behind). */
async function render(update: UpdateState, notes: () => Promise<ReleaseNotes> = async () => ({ current: '1.0.13', releases: RELEASES })) {
  const bridge = installBridge(notes)
  const onClose = vi.fn()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root?.render(<WhatsNewSheet update={update} onClose={onClose} />))
  const el = host
  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.whats-new__actions button')]
  const rows = () => [...el.querySelectorAll<HTMLElement>('.whats-new__row')]
  const selected = () => el.querySelector('.whats-new__row[aria-selected="true"] .whats-new__row-version')?.textContent
  return { el, bridge, onClose, buttons, rows, selected, labels: () => buttons().map((b) => b.textContent) }
}

const tagsOf = (row: Element) => [...row.querySelectorAll('.whats-new__tag')].map((t) => t.textContent)
const key = (target: Element, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void target.dispatchEvent(e))
  return e
}

describe('WhatsNewSheet: the list of releases (D10)', () => {
  it('lists every release newest first: the version, and the title without the version it starts with', async () => {
    const { rows } = await render({ kind: 'idle' })
    expect(rows().map((r) => r.querySelector('.whats-new__row-version')?.textContent)).toEqual(['1.0.14', '1.0.13', '1.0.12'])
    expect(rows().map((r) => r.querySelector('.whats-new__row-title')?.textContent ?? null)).toEqual(['Faster tabs', null, 'Tab names'])
    expect(rows()[0].getAttribute('role')).toBe('option')
  })

  it('"Latest" on the newest row, "Your current version" on the running app\'s row, nothing on the others', async () => {
    const { rows } = await render({ kind: 'ready', version: '1.0.14' })
    expect(rows().map(tagsOf)).toEqual([['Latest'], ['Your current version'], []])
    expect(rows().map((r) => r.classList.contains('whats-new__row--current'))).toEqual([false, true, false])
  })

  it('up to date: the newest row has both tags', async () => {
    const { rows } = await render({ kind: 'idle' }, async () => ({ current: '1.0.14', releases: RELEASES }))
    expect(rows().map(tagsOf)).toEqual([['Latest', 'Your current version'], [], []])
  })

  it('a running version that is not in the list (a dev build) has no tag of its own', async () => {
    const { rows } = await render({ kind: 'idle' }, async () => ({ current: '0.0.1', releases: RELEASES }))
    expect(rows().map(tagsOf)).toEqual([['Latest'], [], []])
  })

  it('a row click shows that release\'s notes, and only the selected release is in the document', async () => {
    const { el, rows, selected } = await render({ kind: 'idle' })
    expect(el.querySelectorAll('.whats-new__release')).toHaveLength(1)
    act(() => rows()[2].click())
    expect(selected()).toBe('1.0.12')
    expect(el.querySelectorAll('.whats-new__release')).toHaveLength(1)
    expect(el.querySelector('.whats-new__release-title')?.textContent).toBe('Tab names')
    expect(el.querySelector('.whats-new__body')?.textContent).toContain('Tab names.')
    expect(el.querySelector('[role="listbox"]')?.getAttribute('aria-activedescendant')).toBe(rows()[2].id)
  })

  it('↑ and ↓ on the list move the selection, and stop at the ends', async () => {
    const { el, selected } = await render({ kind: 'idle' })
    const list = el.querySelector('[role="listbox"]')!
    expect(selected()).toBe('1.0.13')
    expect(key(list, 'ArrowDown').defaultPrevented).toBe(true)
    expect(selected()).toBe('1.0.12')
    key(list, 'ArrowDown')
    expect(selected()).toBe('1.0.12')
    key(list, 'ArrowUp')
    key(list, 'ArrowUp')
    key(list, 'ArrowUp')
    expect(selected()).toBe('1.0.14')
  })
})

describe('WhatsNewSheet: the release it opens on (D11)', () => {
  it.each([
    [{ kind: 'ready', version: '1.0.14' }, '1.0.14'],
    [{ kind: 'manual', version: '1.0.14' }, '1.0.14'],
    [{ kind: 'updated', version: '1.0.13' }, '1.0.13'],
    [{ kind: 'idle' }, '1.0.13'],
    [{ kind: 'downloading', version: '1.0.14' }, '1.0.13'],
  ] as const)('%o opens on %s', async (update, version) => {
    const { selected, el } = await render(update)
    expect(selected()).toBe(version)
    expect(el.querySelector('.whats-new__meta')?.textContent).toMatch(new RegExp(`^${version.replaceAll('.', '\\.')} · `))
  })

  it('a current version that is not in the list opens on the latest', async () => {
    const { selected } = await render({ kind: 'idle' }, async () => ({ current: '0.0.1', releases: RELEASES }))
    expect(selected()).toBe('1.0.14')
  })
})

describe('WhatsNewSheet: the notes', () => {
  it('renders the body as sanitised HTML; a release with no title shows its version', async () => {
    const { el } = await render({ kind: 'idle' })
    expect(el.querySelector('.whats-new__release-title')?.textContent).toBe('1.0.13')
    expect(el.querySelector('.whats-new__body')?.textContent).toContain('Signed builds.')
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('whats-new-title')
  })

  it('S16: every image loads lazily', async () => {
    const { el } = await render({ kind: 'ready', version: '1.0.14' })
    const imgs = [...el.querySelectorAll('.whats-new__body img')]
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['https://github.com/x/one.gif', 'https://github.com/x/two.png', 'https://github.com/x/three.png'])
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['lazy', 'lazy', 'lazy'])
    expect(el.querySelector('.whats-new__body strong')?.textContent).toBe('Bold')
  })

  it('S17: a link click opens through window.open and does not navigate', async () => {
    const { el } = await render({ kind: 'ready', version: '1.0.14' })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => void el.querySelector('a[href="https://example.com/docs"]')!.dispatchEvent(click))
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/docs')
    expect(click.defaultPrevented).toBe(true)
  })

  it('says "Loading…" while it waits', async () => {
    const { el } = await render({ kind: 'idle' }, () => new Promise(() => undefined))
    expect(el.querySelector('.whats-new__msg')?.textContent).toBe('Loading…')
  })

  it('an empty list says so', async () => {
    const { el, rows } = await render({ kind: 'idle' }, async () => ({ current: '1.0.13', releases: [] }))
    expect(el.querySelector('.whats-new__msg')?.textContent).toBe('No release notes.')
    expect(rows()).toHaveLength(0)
  })

  it('S18: a failed read says so, and the action button still works', async () => {
    const { el, bridge, buttons } = await render({ kind: 'ready', version: '1.0.14' }, async () => Promise.reject(new Error('offline')))
    expect(el.querySelector('.whats-new__msg')?.textContent).toBe("Can't load the notes. Check your connection.")
    act(() => buttons()[1].click())
    expect(bridge.update.restart).toHaveBeenCalledTimes(1)
  })
})

describe('WhatsNewSheet: D12 a picture opens big', () => {
  const lightbox = (el: HTMLElement) => ({
    src: el.querySelector('.image-modal__img')?.getAttribute('src'),
    count: el.querySelector('.image-modal__count')?.textContent ?? null,
  })

  it('a click on a picture opens ImageModal with every picture of the release, at the one clicked', async () => {
    const { el } = await render({ kind: 'ready', version: '1.0.14' })
    expect(el.querySelector('.image-modal-overlay')).toBeNull()
    act(() => el.querySelectorAll<HTMLElement>('.whats-new__body img')[1].click())
    expect(lightbox(el)).toEqual({ src: 'https://github.com/x/two.png', count: '2 / 3' })
    key(el.querySelector('.image-modal-overlay')!, 'ArrowLeft')
    expect(lightbox(el)).toEqual({ src: 'https://github.com/x/one.gif', count: '1 / 3' })
  })

  it('a picture inside a link opens the lightbox, not the browser', async () => {
    const { el } = await render({ kind: 'ready', version: '1.0.14' })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    act(() => el.querySelectorAll<HTMLElement>('.whats-new__body img')[2].click())
    expect(lightbox(el)).toEqual({ src: 'https://github.com/x/three.png', count: '3 / 3' })
    expect(open).not.toHaveBeenCalled()
  })

  it('the pictures are the selected release\'s only', async () => {
    const { el, rows } = await render({ kind: 'ready', version: '1.0.14' })
    act(() => rows()[2].click())
    act(() => el.querySelector<HTMLElement>('.whats-new__body img')!.click())
    expect(lightbox(el)).toEqual({ src: 'https://github.com/x/old.png', count: null }) // one picture: no gallery bar
  })

  it('Esc closes the lightbox first, then the sheet', async () => {
    const { el, onClose } = await render({ kind: 'ready', version: '1.0.14' })
    act(() => el.querySelector<HTMLElement>('.whats-new__body img')!.click())
    const overlay = el.querySelector('.image-modal-overlay')!
    expect(document.activeElement).toBe(overlay)
    key(overlay, 'Escape')
    expect(el.querySelector('.image-modal-overlay')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    key(el.querySelector('.whats-new__actions button')!, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a click on the lightbox\'s backdrop closes the lightbox, not the sheet', async () => {
    const { el, onClose } = await render({ kind: 'ready', version: '1.0.14' })
    act(() => el.querySelector<HTMLElement>('.whats-new__body img')!.click())
    act(() => void el.querySelector('.image-modal-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(el.querySelector('.image-modal-overlay')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(el.querySelector('.whats-new')).not.toBeNull()
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
    const esc = key(el.querySelector('.whats-new__actions button')!, 'Escape')
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
