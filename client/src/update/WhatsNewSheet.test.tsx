/**
 * The "What's new" sheet (YAZ-2976 D5, YAZ-2988 D9–D12): the list of releases with the two tags, the
 * release it opens on for each state, a row click and ↑ / ↓, only the selected release in the
 * document, the notes as sanitised HTML with lazy images (S16), a picture that opens the lightbox with
 * the release's pictures (D12), links through `window.open` (S17), the failure text (S18), the
 * buttons for each state (S13–S15), the update from the Latest row (YAZ-4371), and the ways to close it,
 * Esc layered under the lightbox (S19).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReleaseNote, ReleaseNotes, UpdateState } from '@shared/types'
import WhatsNewSheet, { shortTitle } from './WhatsNewSheet'

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

function installBridge(notes: () => Promise<ReleaseNotes>, check: () => Promise<UpdateState>) {
  const bridge = { update: { state: vi.fn(), onState: vi.fn(), notes: vi.fn(notes), check: vi.fn(check), restart: vi.fn(async () => undefined) } }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

/** Mounts the sheet; the app runs `current` (1.0.13 by default: one release behind). */
async function render(update: UpdateState, notes: () => Promise<ReleaseNotes> = async () => ({ current: '1.0.13', checks: true, releases: RELEASES }), check: () => Promise<UpdateState> = () => new Promise(() => undefined)) {
  const bridge = installBridge(notes, check)
  const onClose = vi.fn()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root?.render(<WhatsNewSheet update={update} onClose={onClose} />))
  const el = host
  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.whats-new__actions button')]
  const rows = () => [...el.querySelectorAll<HTMLElement>('.whats-new__row')]
  const selected = () => el.querySelector('.whats-new__row[aria-selected="true"]')?.getAttribute('data-version')
  /** Main's push of a new state: App renders the sheet again with it. */
  const push = (next: UpdateState) => act(() => root?.render(<WhatsNewSheet update={next} onClose={onClose} />))
  const line = () => el.querySelector('.whats-new__check-line')?.textContent ?? null
  return { el, bridge, onClose, buttons, rows, selected, push, line, labels: () => buttons().map((b) => b.textContent) }
}

const tagsOf = (row: Element) => [...row.querySelectorAll('.whats-new__tag')].map((t) => t.textContent)
const key = (target: Element, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void target.dispatchEvent(e))
  return e
}

describe('shortTitle (D17)', () => {
  it('keeps one feature as it is, and turns several into the first one and a count', () => {
    expect(shortTitle('Scroll Without the Pop-Up')).toBe('Scroll Without the Pop-Up')
    expect(shortTitle('Tab Names / Copies Keep Your Place / Table of Contents Stays Off')).toBe('Tab Names +2 more')
    expect(shortTitle('A / B')).toBe('A +1 more')
  })
})

describe('WhatsNewSheet: the ✕ at the top right (D16)', () => {
  it('closes the sheet, like Esc and Later', async () => {
    const { onClose } = await render({ kind: 'ready', version: '1.0.14' })
    const x = document.querySelector<HTMLButtonElement>('.whats-new__head .whats-new__close')!
    expect(x.getAttribute('aria-label')).toBe('Close')
    act(() => x.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('WhatsNewSheet: the list of releases (D10)', () => {
  it('lists every release newest first: the version, a date with no year, the short title, and the year once (D15, D17)', async () => {
    const { rows } = await render({ kind: 'idle' })
    expect(rows().map((r) => r.getAttribute('data-version'))).toEqual(['1.0.14', '1.0.13', '1.0.12'])
    expect(rows().map((r) => r.querySelector('.whats-new__row-title')?.textContent ?? null)).toEqual(['Faster tabs', null, 'Tab names'])
    // D17: the version leads each row; D15: a short date with no year, and the year once as the heading
    expect(rows().map((r) => r.querySelector('.whats-new__row-version')?.textContent)).toEqual(['1.0.14', '1.0.13', '1.0.12'])
    expect(rows()[0].querySelector('.whats-new__row-date')?.textContent).not.toMatch(/2026/)
    expect([...document.querySelectorAll('.whats-new__year')].map((y) => y.textContent)).toEqual(['2026'])
    expect(rows()[0].getAttribute('role')).toBe('option')
  })

  it('"Latest" on the newest row, "Your current version" on the running app\'s row, nothing on the others', async () => {
    const { rows } = await render({ kind: 'ready', version: '1.0.14' })
    expect(rows().map(tagsOf)).toEqual([['Latest'], ['Your current version'], []])
    expect(rows().map((r) => r.classList.contains('whats-new__row--current'))).toEqual([false, true, false])
  })

  it('up to date: the newest row has both tags', async () => {
    const { rows } = await render({ kind: 'idle' }, async () => ({ current: '1.0.14', checks: true, releases: RELEASES }))
    expect(rows().map(tagsOf)).toEqual([['Latest', 'Your current version'], [], []])
  })

  it('a running version that is not in the list (a dev build) has no tag of its own', async () => {
    const { rows } = await render({ kind: 'idle' }, async () => ({ current: '0.0.1', checks: true, releases: RELEASES }))
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
    [{ kind: 'idle' }, '1.0.13'],
    [{ kind: 'downloading', version: '1.0.14' }, '1.0.13'],
  ] as const)('%o opens on %s', async (update, version) => {
    const { selected, el } = await render(update)
    expect(selected()).toBe(version)
    expect(el.querySelector('.whats-new__meta')?.textContent).toMatch(new RegExp(`^${version.replaceAll('.', '\\.')} · `))
  })

  it('a current version that is not in the list opens on the latest', async () => {
    const { selected } = await render({ kind: 'idle' }, async () => ({ current: '0.0.1', checks: true, releases: RELEASES }))
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
    const { el, rows } = await render({ kind: 'idle' }, async () => ({ current: '1.0.13', checks: true, releases: [] }))
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

  it('S15 idle: one "Close", which closes', async () => {
    const { bridge, onClose, buttons, labels } = await render({ kind: 'idle' })
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

describe('WhatsNewSheet: update from the Latest row (YAZ-4371)', () => {
  const enabled = (b: HTMLButtonElement) => !b.disabled

  it('idle on a newer Latest row: "Update to v1.0.14" asks main for one check, and the button then follows the pushed state', async () => {
    let answer!: (s: UpdateState) => void
    const { bridge, rows, buttons, labels, push } = await render({ kind: 'idle' }, undefined, () => new Promise((r) => (answer = r)))
    act(() => rows()[0].click())
    expect(labels()).toEqual(['Later', 'Update to v1.0.14'])
    act(() => buttons()[1].click())
    expect(bridge.update.check).toHaveBeenCalledTimes(1)
    expect(buttons()[1].disabled).toBe(true) // one click is one check: not clickable until it answers
    act(() => buttons()[1].click())
    expect(bridge.update.check).toHaveBeenCalledTimes(1)
    // `downloading` is pushed before the check answers it (S6)
    push({ kind: 'downloading', version: '1.0.14' })
    await act(async () => answer({ kind: 'downloading', version: '1.0.14' }))
    expect(labels()).toEqual(['Close', 'Downloading v1.0.14…'])
    expect(buttons().map(enabled)).toEqual([true, false])
    push({ kind: 'ready', version: '1.0.14' })
    expect(labels()).toEqual(['Later', 'Restart to update'])
    act(() => buttons()[1].click())
    expect(bridge.update.restart).toHaveBeenCalledTimes(1)
    push({ kind: 'manual', version: '1.0.14' })
    expect(labels()).toEqual(['Later', 'Download'])
  })

  it('no update button on another row, when up to date, or in a dev run with no feed (S7); ready and manual keep theirs on every row', async () => {
    const behind = await render({ kind: 'idle' })
    expect(behind.selected()).toBe('1.0.13')
    expect(behind.labels()).toEqual(['Close'])
    behind.push({ kind: 'downloading', version: '1.0.14' })
    expect(behind.labels()).toEqual(['Close'])
    act(() => behind.rows()[2].click())
    behind.push({ kind: 'ready', version: '1.0.14' })
    expect(behind.labels()).toEqual(['Later', 'Restart to update'])
    act(() => root?.unmount())
    host?.remove()

    const upToDate = await render({ kind: 'idle' }, async () => ({ current: '1.0.14', checks: true, releases: RELEASES }))
    expect(upToDate.selected()).toBe('1.0.14')
    expect(upToDate.labels()).toEqual(['Close'])
    act(() => root?.unmount())
    host?.remove()

    const dev = await render({ kind: 'idle' }, async () => ({ current: '1.0.13', checks: false, releases: RELEASES }))
    act(() => dev.rows()[0].click())
    expect(dev.labels()).toEqual(['Close'])
    dev.push({ kind: 'downloading', version: '1.0.14' })
    expect(dev.labels()).toEqual(['Close'])
    expect(dev.bridge.update.check).not.toHaveBeenCalled()
  })

  it('a failed check says so in one line, and the button stays to try again; a check with no download yet (S2) says that', async () => {
    const answers: Array<() => Promise<UpdateState>> = [async () => Promise.reject(new Error('offline')), async () => ({ kind: 'idle' })]
    const { bridge, rows, buttons, labels, line, push } = await render({ kind: 'idle' }, undefined, () => answers.shift()!())
    act(() => rows()[0].click())
    expect(line()).toBeNull()
    await act(async () => buttons()[1].click())
    expect(line()).toBe("Can't check for updates. Check your connection.")
    expect(labels()).toEqual(['Later', 'Update to v1.0.14'])
    expect(enabled(buttons()[1])).toBe(true)
    await act(async () => buttons()[1].click())
    expect(bridge.update.check).toHaveBeenCalledTimes(2)
    expect(line()).toBe('v1.0.14 is not ready to download yet. Try again in a few minutes.')
    expect(enabled(buttons()[1])).toBe(true)
    // The line belongs to the button: another row, or a download, has neither.
    push({ kind: 'downloading', version: '1.0.14' })
    expect(line()).toBeNull()
  })

  it('a download that fails after Update to v… says so in one line, and the button stays to try again (YAZ-4384)', async () => {
    const { bridge, rows, buttons, labels, line, push } = await render({ kind: 'idle' }, undefined, async () => ({ kind: 'downloading', version: '1.0.14' }))
    act(() => rows()[0].click())
    await act(async () => buttons()[1].click())
    push({ kind: 'downloading', version: '1.0.14' })
    expect(line()).toBeNull()
    // Main puts the state back (S9: a wrong sha256, or a stalled download) and names the version.
    push({ kind: 'idle', failed: '1.0.14' })
    expect(line()).toBe('The download of v1.0.14 failed. Click Update to try again.')
    expect(labels()).toEqual(['Later', 'Update to v1.0.14'])
    expect(enabled(buttons()[1])).toBe(true)
    await act(async () => buttons()[1].click())
    expect(bridge.update.check).toHaveBeenCalledTimes(2)
    push({ kind: 'downloading', version: '1.0.14' })
    expect(line()).toBeNull()
    // A failure of an older version is not this row's.
    push({ kind: 'idle', failed: '1.0.12' })
    expect(line()).toBeNull()
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
