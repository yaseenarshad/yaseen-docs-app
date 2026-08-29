import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { PageContextMenu } from './PageContextMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

it('exports reusable page actions through PageContextMenu', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onOpenBackground = vi.fn()
  const onClose = vi.fn()

  act(() => {
    root.render(
      <PageContextMenu
        x={12}
        y={34}
        path="/vault/note.md"
        onOpenBackground={onOpenBackground}
        onClose={onClose}
      />,
    )
  })

  expect([...host.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
    'Open in new tab',
    'Copy path',
    'Reveal in Finder',
  ])
  act(() => (host.querySelector('[role="menuitem"]') as HTMLButtonElement).click())
  expect(onOpenBackground).toHaveBeenCalledExactlyOnceWith('/vault/note.md')
  expect(onClose).toHaveBeenCalledOnce()

  act(() => root.unmount())
  host.remove()
})
