/**
 * The Columns list's drag picture (YAZ-4803 demo: "when i drag columns, the name is white or empty"): a drag of a row's
 * grip uses the WHOLE row (`li.view-prop`) as the drag image, held where it was grabbed — not the six-dot grip alone.
 * ViewsPane mounted in jsdom, the "Columns and view" popover opened as PropertiesTabs.test.tsx does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../../lib/storage', () => ({ storage: { getSettings: () => undefined, getViewGroups: () => [], setViewGroups: () => undefined } }))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount() {
  const parsed = parseViews('views:\n  - type: table\n    name: V\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<ViewsPane parsed={parsed} onChange={vi.fn()} root="/vault" folderPath="/vault/pillars.md" records={TEST_RECORDS} folder={testFolderHost()} onOpenFile={vi.fn()} />))
  act(() => void container!.querySelector<HTMLElement>('.view-toolbar [aria-label="Columns and view"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  return container.querySelector<HTMLElement>('.view-popover--properties')!
}

/** A dragstart with a stand-in `dataTransfer` (jsdom has no DragEvent), at a pointer point. */
function dragStart(target: Element, clientX: number, clientY: number) {
  const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'none', dropEffect: 'none', types: [] as string[] }
  const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true, clientX, clientY })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  act(() => void target.dispatchEvent(event))
  return dataTransfer
}

describe('YAZ-4803 demo: the Columns list drag picture', () => {
  it('YAZ-4803 demo: dragging a column row by its grip uses the whole row as the drag image, held where it was grabbed', () => {
    const pop = mount()
    const grip = pop.querySelector<HTMLElement>('[aria-label^="Reorder "]')!
    expect(grip).not.toBeNull()
    const li = grip.closest('li')!
    expect(li.classList.contains('view-prop')).toBe(true)
    li.getBoundingClientRect = () => ({ left: 100, top: 40, right: 340, bottom: 70, width: 240, height: 30, x: 100, y: 40, toJSON: () => ({}) }) as DOMRect
    const dt = dragStart(grip, 112, 55)
    expect(dt.setDragImage).toHaveBeenCalledTimes(1)
    const [image, x, y] = dt.setDragImage.mock.calls[0]
    expect(image).toBe(li)
    expect(image).not.toBe(grip)
    expect([x, y]).toEqual([12, 15])
    expect(dt.setData).toHaveBeenCalledWith('text/plain', expect.any(String))
    expect(dt.effectAllowed).toBe('move')
  })
})
