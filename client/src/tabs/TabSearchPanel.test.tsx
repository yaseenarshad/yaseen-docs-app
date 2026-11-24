/** TabSearchPanel inline drawing picking (YAZ-6468): never opens a broken file path for inline drawings. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SearchCandidate } from '../search/searchCandidates'
import { TabSearchPanel } from './TabSearchPanel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mockResults = vi.hoisted(() => ({ current: [] as SearchCandidate[] }))

vi.mock('../lib/treeFeed', () => ({ fetchTree: vi.fn().mockResolvedValue(null), latestTree: () => null, onTree: () => () => undefined }))
vi.mock('../search/useSearchResults', () => ({ useSearchResults: () => mockResults.current }))

let root: Root | null = null
let container: HTMLElement | null = null

function mount(props: { onPick: ReturnType<typeof vi.fn>; onPickInlineDrawing?: ReturnType<typeof vi.fn> }) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <TabSearchPanel
        places={[{ root: '/v' }]}
        label="Main"
        at={{ left: 0, top: 0 }}
        watchOf={() => undefined}
        onPick={props.onPick}
        onPickInlineDrawing={props.onPickInlineDrawing}
        onClose={vi.fn()}
      />,
    )
  })
  const input = container.querySelector<HTMLInputElement>('.sidebar__search-input')!
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, 'arch')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  mockResults.current = []
})

describe('TabSearchPanel inline drawing picking (YAZ-6468)', () => {
  const drawingHit: SearchCandidate = {
    kind: 'file',
    name: 'Architecture',
    lower: 'architecture',
    label: 'Architecture',
    path: '/v/Notes.md#drawing-2',
    folder: '',
    inlineDrawing: true,
    page: '/v/Notes.md',
    index: 2,
  }
  const pageHit: SearchCandidate = {
    kind: 'file',
    name: 'Architecture Notes',
    lower: 'architecture notes',
    label: 'Architecture Notes',
    path: '/v/Architecture Notes.md',
    folder: '',
  }

  it('invokes onPickInlineDrawing(page, index) when provided and renders the drawing icon with clean title', () => {
    mockResults.current = [drawingHit, pageHit]
    const onPick = vi.fn()
    const onPickInlineDrawing = vi.fn()
    const el = mount({ onPick, onPickInlineDrawing })
    const rows = [...el.querySelectorAll<HTMLLIElement>('.search-results__row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector<HTMLElement>('.file-icon')?.dataset.kind).toBe('drawing')
    expect(rows[0].getAttribute('title')).toBe('/v/Notes.md')

    act(() => rows[0].click())
    expect(onPickInlineDrawing).toHaveBeenCalledExactlyOnceWith('/v/Notes.md', 2)
    expect(onPick).not.toHaveBeenCalled()

    act(() => rows[1].click())
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v/Architecture Notes.md')
  })

  it('preserves canonical synthetic inline drawing path via onPick when onPickInlineDrawing is omitted', () => {
    mockResults.current = [drawingHit]
    const onPick = vi.fn()
    const el = mount({ onPick })
    act(() => el.querySelector<HTMLLIElement>('.search-results__row')?.click())
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v/Notes.md#drawing-2')
  })
})
