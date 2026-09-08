import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SortMenu } from './SortMenu'
import type { Mutate, SortSpec, ViewSet } from '../viewSchema'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
const INITIAL: SortSpec[] = [
  { property: 'note.status', direction: 'DESC' },
  { property: 'file.name', direction: 'ASC' },
  { property: 'note.priority', direction: 'DESC' },
]

function mount() {
  let def: ViewSet = { views: [{ name: 'Table', type: 'table', sort: structuredClone(INITIAL) }] }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onUpdate = vi.fn<Mutate>((mutate) => {
    def = structuredClone(def)
    mutate(def)
    render()
  })
  const render = () => root!.render(<SortMenu def={def} view={def.views[0]} viewIndex={0} records={TEST_RECORDS} onUpdate={onUpdate} />)
  act(render)
  const el = container
  const grip = (index: number, label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="Reorder sort ${index}: ${label}"]`)!
  const replace = (sort: SortSpec[]) => act(() => {
    def = { ...def, views: [{ ...def.views[0], sort: structuredClone(sort) }] }
    render()
  })
  return { el, grip, replace, onUpdate, sort: () => def.views[0].sort! }
}

function drag(target: HTMLElement, type: string, clientY = 0) {
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })) })
}
function press(target: HTMLElement, key: string) {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })) })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('SortMenu external settings refresh', () => {
  it('discards an in-flight drag after changed sort settings arrive, then reorders the replacement safely', () => {
    const { el, grip, replace, sort, onUpdate } = mount()
    drag(grip(1, 'status'), 'dragstart')
    drag(grip(3, 'priority').closest('li')!, 'dragover', 5)
    expect(el.querySelector('.view-prop--dragging')).not.toBeNull()
    const replacement: SortSpec[] = [
      { property: 'note.priority', direction: 'ASC' },
      { property: 'file.name', direction: 'DESC' },
    ]
    replace(replacement)
    expect(el.querySelector('.view-prop--dragging, .view-prop--insert-after')).toBeNull()
    drag(grip(2, 'file.name').closest('li')!, 'drop', 5)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(sort()).toEqual(replacement)

    const last = grip(2, 'file.name')
    last.focus()
    press(last, 'ArrowUp')
    expect(sort()).toEqual([replacement[1], replacement[0]])
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(grip(1, 'file.name'))
  })

  it('retains rule DOM identity and focused control across an equivalent freshly parsed sort array', () => {
    const { grip, replace, sort, onUpdate } = mount()
    const focused = grip(2, 'file.name')
    const row = focused.closest('li')
    focused.focus()
    replace(INITIAL)
    expect(grip(2, 'file.name')).toBe(focused)
    expect(grip(2, 'file.name').closest('li')).toBe(row)
    expect(document.activeElement).toBe(focused)
    expect(onUpdate).not.toHaveBeenCalled()

    press(focused, 'ArrowDown')
    expect(sort()).toEqual([INITIAL[0], INITIAL[2], INITIAL[1]])
    expect(grip(3, 'file.name')).toBe(focused)
    expect(document.activeElement).toBe(focused)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})
