import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { api, BridgeRequestError } from '../../api'
import { PageActions } from '../../lib/pageActions'
import { OtherFilesMove } from './otherFilesMove'
import { applyMenuIcons, resetMenuIconsForTest } from './menuIconsStore'
import { PageContextMenu } from './PageContextMenu'
import { ShortcutActions } from './shortcutDoors'

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
        path="/vault/page.md"
        title="page"
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
  expect(onOpenRight).toHaveBeenCalledExactlyOnceWith('/vault/page.md')
  expect(onOpenBackground).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledOnce()

  act(() => {
    root.render(
      <PageContextMenu x={12} y={34} path="/vault/page.md" title="page" onOpenBackground={onOpenBackground} onClose={onClose} />,
    )
  })
  expect(mainItems(host)).toEqual(['Open in new tab', 'Open in', 'Copy path'])
  expect(openIn(host).map((item) => item.textContent)).toEqual(['Reveal in Finder']) // no right panel handed: none offered
  act(() => (host.querySelector('[role="menuitem"]') as HTMLButtonElement).click())
  expect(onOpenBackground).toHaveBeenCalledExactlyOnceWith('/vault/page.md')
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
  act(() => root.render(<PageContextMenu x={12} y={34} path="/vault/page.md" title="page" onOpen={onOpen} onOpenBackground={vi.fn()} onClose={onClose} />))
  const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  expect(items.map((item) => item.textContent)).toEqual(['Open', 'Open in new tab', 'Open in', 'Copy path'])
  act(() => items[0].click())
  expect(onOpen).toHaveBeenCalledExactlyOnceWith('/vault/page.md')
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
      Delete page…
    </button>
  )
  const extra = [
    <button key="a" type="button" role="menuitem" className="ctx-menu__item">
      Fill cell
    </button>,
  ]
  act(() => root.render(<PageContextMenu x={12} y={34} path="/vault/page.md" title="page" onOpenBackground={vi.fn()} onClose={vi.fn()} extra={extra} danger={danger} />))
  const groups = [...host.querySelectorAll('.ctx-menu__group')].map((g) => [...g.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent))
  // The open group, the surface's group, the page's own group (Copy path, YAZ-3746 13AW), then the destructive one.
  expect(groups).toEqual([['Open in new tab', 'Open in'], ['Fill cell'], ['Copy path'], ['Delete page…']])
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
      root.render(<PageContextMenu x={12} y={34} path="/vault/page.md" title="page" onNotice={onNotice} onClose={onClose} />)
    })
    const copy = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Copy path')
    act(() => copy?.click())
    await act(async () => Promise.resolve())

    expect(writeText).toHaveBeenCalledExactlyOnceWith('/vault/page.md')
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

it('handles inline card rows safely: resolves <page>:<line> on Copy path, targets parent file for OS verbs, adds Copy card ID/link, and omits mutating actions (YAZ-6469)', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const readFile = vi.spyOn(api, 'readFile').mockResolvedValue({
    path: '/vault/Geo/Europe trip.md',
    content: '---\ntitle: Europe trip\n---\nIntro\n```card\nMadrid\n```\n<!-- card: GEO-1 -->\n',
    mtime: 1,
    size: 1,
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const openNewWindow = vi.fn()
  const openVsCode = vi.fn()
  const openDefault = vi.fn()
  const reveal = vi.fn()
  const toggleFavorite = vi.fn()
  const toggleFocus = vi.fn()
  const moveToTray = vi.fn()
  const onOpen = vi.fn()
  const onOpenWindow = vi.fn()
  const onClose = vi.fn()
  const inlinePath = '/vault/Geo/Europe trip.md#GEO-1'
  const diskPath = '/vault/Geo/Europe trip.md'

  const renderMenu = () =>
    act(() => {
      root.render(
        <PageActions.Provider
          value={{
            listState: () => ({ favorite: false, focus: false }),
            toggleFavorite,
            toggleFocus,
            openNewWindow,
            openVsCode,
            openDefault,
            reveal,
          }}
        >
          <OtherFilesMove.Provider value={moveToTray}>
            <ShortcutActions.Provider
              value={{
                pageName: 'Geo',
                homeOf: () => null,
                locked: () => false,
                holders: () => new Set(),
                folders: () => [{ dir: '/vault/Other', name: 'Other', path: 'Other' }],
                goHome: vi.fn(),
                add: vi.fn(),
                remove: vi.fn(),
              }}
            >
              <PageContextMenu
                x={12}
                y={34}
                path={inlinePath}
                title="Capital of Spain"
                onOpen={onOpen}
                onOpenWindow={onOpenWindow}
                onClose={onClose}
                danger={
                  <button type="button" role="menuitem" className="ctx-menu__item ctx-menu__item--danger">
                    Delete page…
                  </button>
                }
              />
            </ShortcutActions.Provider>
          </OtherFilesMove.Provider>
        </PageActions.Provider>,
      )
    })

  try {
    renderMenu()
    const items = mainItems(host)
    expect(items).toEqual(['Open', 'Open in new window', 'Open in mini window', 'Open in', 'Copy path', 'Copy card ID', 'Copy card link'])
    for (const forbidden of ['Add to favorites', 'Add to focus', 'Add shortcut to', 'Move to Other files', 'Delete page…']) {
      expect(items).not.toContain(forbidden)
    }

    // Copy card ID has hint and copies GEO-1
    const copyIdBtn = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Copy card ID')!
    expect(copyIdBtn.dataset.hint).toBe('GEO-1')
    act(() => copyIdBtn.click())
    await act(async () => Promise.resolve())
    expect(writeText).toHaveBeenLastCalledWith('GEO-1')

    // Copy card link copies [[GEO-1]]
    const copyLinkBtn = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Copy card link')!
    act(() => copyLinkBtn.click())
    await act(async () => Promise.resolve())
    expect(writeText).toHaveBeenLastCalledWith('[[GEO-1]]')

    // Copy path resolves <pagePath>:<1-based line> (line 5)
    const copyPathBtn = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Copy path')!
    act(() => copyPathBtn.click())
    await vi.waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${diskPath}:5`))
    expect(readFile).toHaveBeenCalledExactlyOnceWith(diskPath)

    // Open in new window operates on diskPath, never #GEO-1
    const newWinBtn = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Open in new window')!
    act(() => newWinBtn.click())
    expect(openNewWindow).toHaveBeenCalledExactlyOnceWith(diskPath)

    // Open in › VS Code, Default app, Reveal in Finder all operate on diskPath
    const flyout = openIn(host)
    expect(flyout.map((b) => b.textContent)).toEqual(['VS Code', 'Default app', 'Reveal in Finder'])
    act(() => flyout[0].click())
    act(() => flyout[1].click())
    act(() => flyout[2].click())
    expect(openVsCode).toHaveBeenCalledExactlyOnceWith(diskPath)
    expect(openDefault).toHaveBeenCalledExactlyOnceWith(diskPath)
    expect(reveal).toHaveBeenCalledExactlyOnceWith(diskPath)
    expect(toggleFavorite).not.toHaveBeenCalled()
    expect(toggleFocus).not.toHaveBeenCalled()
    expect(moveToTray).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    host.remove()
    readFile.mockRestore()
    if (descriptor === undefined) delete (navigator as unknown as Record<string, unknown>).clipboard
    else Object.defineProperty(navigator, 'clipboard', descriptor)
  }
})

it('places Focus directly above Favorites in the page group (YAZ-6550)', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const toggleFocus = vi.fn()
  const toggleFavorite = vi.fn()
  const onClose = vi.fn()

  try {
    act(() => {
      root.render(
        <PageActions.Provider value={{ listState: () => ({ focus: false, favorite: true }), toggleFocus, toggleFavorite }}>
          <PageContextMenu x={12} y={34} path="/vault/page.md" title="page" onOpen={vi.fn()} onClose={onClose} />
        </PageActions.Provider>,
      )
    })
    const items = mainItems(host)
    expect(items).toEqual(['Open', 'Open in', 'Add to focus', 'Remove from favorites', 'Copy path'])
    expect(items.indexOf('Add to focus')).toBe(items.indexOf('Remove from favorites') - 1)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('YAZ-6567: carries ctx-menu--glyphs and wires customizable Open in new tab / Open in new window icons', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const buttonOf = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === label)!

  try {
    act(() => {
      root.render(
        <PageActions.Provider value={{ openNewWindow: vi.fn() }}>
          <PageContextMenu x={12} y={34} path="/vault/page.md" title="page" onOpen={vi.fn()} onOpenBackground={vi.fn()} onClose={vi.fn()} />
        </PageActions.Provider>,
      )
    })
    expect(host.querySelector('.ctx-menu')?.classList.contains('ctx-menu--glyphs')).toBe(true)
    const defaultTabSvg = buttonOf('Open in new tab').querySelector('svg')?.innerHTML
    const defaultWinSvg = buttonOf('Open in new window').querySelector('svg')?.innerHTML
    expect(defaultTabSvg).toBeTruthy()
    expect(defaultWinSvg).toBeTruthy()
    expect(buttonOf('Open').querySelector('.ctx-menu__label')).toBeNull()

    act(() => applyMenuIcons({ openNewTab: 'raised-tab', newWindow: 'win-arrow' }))
    expect(buttonOf('Open in new tab').querySelector('svg')?.innerHTML).not.toBe(defaultTabSvg)
    expect(buttonOf('Open in new window').querySelector('svg')?.innerHTML).not.toBe(defaultWinSvg)

    act(() => applyMenuIcons({ openNewTab: 'none', newWindow: 'none' }))
    expect(buttonOf('Open in new tab').querySelector('svg')).toBeNull()
    expect(buttonOf('Open in new tab').querySelector('.ctx-menu__label')).toBeNull()
    expect(buttonOf('Open in new window').querySelector('svg')).toBeNull()
    expect(buttonOf('Open in new window').querySelector('.ctx-menu__label')).toBeNull()

    act(() => applyMenuIcons('off'))
    expect(document.documentElement.dataset.menuIcons).toBe('off')
    expect(buttonOf('Open in new tab').querySelector('svg')).toBeNull()
    expect(buttonOf('Open in new window').querySelector('svg')).toBeNull()
  } finally {
    resetMenuIconsForTest()
    act(() => root.unmount())
    host.remove()
  }
})
