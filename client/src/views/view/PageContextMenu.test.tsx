import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { api, BridgeRequestError } from '../../api'
import { PageContextMenu } from './PageContextMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The main menu's rows, the flyout's left out (it opens beside them). */
const mainItems = (host: ParentNode): (string | null)[] => [...host.querySelectorAll('[role="menuitem"]')].filter((item) => item.closest('.ctx-menu__sub') === null).map((item) => item.textContent)
/** Opens "Open in ›" (YAZ-3746 13AW, 13AZ) and returns its rows: the app's ways, other apps, then Reveal in Finder. */
function openIn(host: ParentNode): HTMLButtonElement[] {
  act(() => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Open in')!.click())
  return [...host.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub [role="menuitem"]')]
}

it('exports reusable page actions through PageContextMenu', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onOpenRight = vi.fn()
  const onOpenBackground = vi.fn()
  const onClose = vi.fn()

  act(() => {
    root.render(
      <PageContextMenu
        x={12}
        y={34}
        path="/vault/note.md"
        title="note"
        onOpenRight={onOpenRight}
        onOpenBackground={onOpenBackground}
        onClose={onClose}
      />,
    )
  })

  // The ways to open first; the rarer ones fold into "Open in ›", the right panel first there (YAZ-3746 13AW, 13AZ).
  expect(mainItems(host)).toEqual(['Open in new tab', 'Open in', 'Copy path'])
  const flyout = openIn(host)
  expect(flyout.map((item) => item.textContent)).toEqual(['Right panel', 'Reveal in Finder'])
  act(() => flyout[0].click())
  expect(onOpenRight).toHaveBeenCalledExactlyOnceWith('/vault/note.md')
  expect(onOpenBackground).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledOnce()

  act(() => {
    root.render(
      <PageContextMenu x={12} y={34} path="/vault/note.md" title="note" onOpenBackground={onOpenBackground} onClose={onClose} />,
    )
  })
  expect(mainItems(host)).toEqual(['Open in new tab', 'Open in', 'Copy path'])
  expect(openIn(host).map((item) => item.textContent)).toEqual(['Reveal in Finder']) // no right panel handed: none offered
  act(() => (host.querySelector('[role="menuitem"]') as HTMLButtonElement).click())
  expect(onOpenBackground).toHaveBeenCalledExactlyOnceWith('/vault/note.md')
  expect(onClose).toHaveBeenCalledTimes(2)

  act(() => root.unmount())
  host.remove()
})

it('"Open" leads the menu of a surface that hands one: it opens the page in the current tab (YAZ-2420 D26)', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onOpen = vi.fn()
  const onClose = vi.fn()
  act(() => root.render(<PageContextMenu x={12} y={34} path="/vault/note.md" title="note" onOpen={onOpen} onOpenBackground={vi.fn()} onClose={onClose} />))
  const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  expect(items.map((item) => item.textContent)).toEqual(['Open', 'Open in new tab', 'Open in', 'Copy path'])
  act(() => items[0].click())
  expect(onOpen).toHaveBeenCalledExactlyOnceWith('/vault/note.md')
  expect(onClose).toHaveBeenCalledOnce()
  act(() => root.unmount())
  host.remove()
})

it('`danger` is the LAST group, after the surface\'s own groups (YAZ-4608 C8)', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const danger = (
    <button type="button" role="menuitem" className="ctx-menu__item ctx-menu__item--danger">
      Delete note…
    </button>
  )
  const extra = [
    <button key="a" type="button" role="menuitem" className="ctx-menu__item">
      Fill cell
    </button>,
  ]
  act(() => root.render(<PageContextMenu x={12} y={34} path="/vault/note.md" title="note" onOpenBackground={vi.fn()} onClose={vi.fn()} extra={extra} danger={danger} />))
  const groups = [...host.querySelectorAll('.ctx-menu__group')].map((g) => [...g.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent))
  // The open group, the surface's group, the page's own group (Copy path, YAZ-3746 13AW), then the destructive one.
  expect(groups).toEqual([['Open in new tab', 'Open in'], ['Fill cell'], ['Copy path'], ['Delete note…']])
  act(() => root.unmount())
  host.remove()
})

it('reports a clipboard rejection passively without leaving an unhandled promise', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const writeText = vi.fn().mockRejectedValue(new Error('clipboard permission denied'))
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onNotice = vi.fn()
  const onClose = vi.fn()

  try {
    act(() => {
      root.render(<PageContextMenu x={12} y={34} path="/vault/note.md" title="note" onNotice={onNotice} onClose={onClose} />)
    })
    const copy = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Copy path')
    act(() => copy?.click())
    await act(async () => Promise.resolve())

    expect(writeText).toHaveBeenCalledExactlyOnceWith('/vault/note.md')
    expect(onClose).toHaveBeenCalledOnce()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith("Can't copy path: clipboard permission denied")
  } finally {
    act(() => root.unmount())
    host.remove()
    if (descriptor === undefined) delete (navigator as unknown as Record<string, unknown>).clipboard
    else Object.defineProperty(navigator, 'clipboard', descriptor)
  }
})

it('E: a page that is gone is named by its title in the notice (YAZ-2420 D14)', async () => {
  const reveal = vi.spyOn(api.shell, 'reveal').mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'gone'))
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onNotice = vi.fn()

  try {
    act(() => {
      root.render(<PageContextMenu x={12} y={34} path="/vault/up-001-abdul-k3m9x2pq7abc.md" title="UP-001 - Abdul" onNotice={onNotice} onClose={vi.fn()} />)
    })
    const revealItem = openIn(host).find((item) => item.textContent === 'Reveal in Finder')!
    act(() => revealItem.click())
    await act(async () => Promise.resolve())
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t reveal "UP-001 - Abdul" — it is no longer there')
  } finally {
    act(() => root.unmount())
    host.remove()
    reveal.mockRestore()
  }
})
