/**
 * The numbered list (YAZ-3998), pinned like the table of contents (YAZ-3704 demo, 4J): its rows, numbered, with the
 * change word by word; a click goes to that change. Pinned, it sits left of the note with **Unpin**; unpinned, the bar's
 * count opens the same rows as a dropdown with **Pin**. A real channel with a stub controller bound, as the plugin binds
 * its own, and the page's boxes (`section.editor`, the scroller, the text) laid out by hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { OutsideChangesBar } from './OutsideChangesBar'
import { OutsideChangesList } from './OutsideChangesList'
import { createOutsideChangesChannel, type OutsideChangeRow, type OutsideChangesController } from './outsideChangesChannel'
import outsideCss from './outsideChanges.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let section: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  section?.remove()
  root = null
  section = null
})

const ROWS: OutsideChangeRow[] = [
  { id: 7, number: 1, active: false, parts: [{ kind: 'same', text: 'Owner is ' }, { kind: 'del', text: 'Sam' }, { kind: 'ins', text: 'Alex' }] },
  { id: 3, number: 3, active: true, parts: [{ kind: 'same', text: 'Removed: ' }, { kind: 'del', text: 'Ask about parking' }] },
]

const stubController = (rowsOf: () => OutsideChangeRow[]): OutsideChangesController => ({ next: vi.fn(), go: vi.fn(), rows: rowsOf, clear: vi.fn(), markWholeNote: vi.fn(), setGlow: vi.fn() })

/** The bar and the list as `Editor.tsx` renders them: the list only while pinned. */
function mount(pinned: boolean) {
  const channel = createOutsideChangesChannel()
  let rows: OutsideChangeRow[] = []
  const controller = stubController(() => rows)
  channel.bind(controller)
  const onPin = vi.fn()
  section = document.createElement('section')
  section.className = 'editor'
  const scroller = document.createElement('div')
  scroller.className = 'editor-host'
  const host = document.createElement('div')
  scroller.appendChild(host)
  const mountPoint = document.createElement('div')
  section.append(mountPoint, scroller)
  document.body.appendChild(section)
  const hostRef = createRef<HTMLElement>()
  ;(hostRef as { current: HTMLElement | null }).current = host
  root = createRoot(mountPoint)
  act(() =>
    root?.render(
      <>
        <OutsideChangesBar channel={channel} pinned={pinned} onPin={onPin} />
        {pinned && <OutsideChangesList channel={channel} hostRef={hostRef} onPin={onPin} />}
      </>,
    ),
  )
  const show = (next: OutsideChangeRow[]): void => {
    rows = next
    act(() => channel.sync({ count: next.length, wholeNote: false }, channel.getVersion() + 1))
  }
  const list = () => section?.querySelector<HTMLElement>('.outside-list:not(.outside-list--dropdown)') ?? null
  const dropdown = () => section?.querySelector<HTMLElement>('.outside-list--dropdown') ?? null
  const count = () => section?.querySelector<HTMLButtonElement>('.outside-changes-bar__count') ?? null
  return { channel, controller, onPin, show, list, dropdown, count }
}

const numbers = (el: HTMLElement | null): (string | null)[] => [...(el?.querySelectorAll('.outside-list__number') ?? [])].map((n) => n.textContent)

describe('OutsideChangesList, pinned (YAZ-3998; 4J)', () => {
  it('shows nothing with no change', () => {
    const { list } = mount(true)
    expect(list()).toBeNull()
  })

  it('shows each change numbered, word by word, with the ring on the active one; the count is plain text', () => {
    const { show, list, count } = mount(true)
    show(ROWS)
    const rows = [...(list()?.querySelectorAll('.outside-list__row') ?? [])]
    expect(numbers(list())).toEqual(['1', '3'])
    expect(rows.map((row) => row.querySelector('.outside-list__text')?.textContent)).toEqual(['Owner is SamAlex', 'Removed: Ask about parking'])
    expect([...rows[0].querySelectorAll('del')].map((el) => el.textContent)).toEqual(['Sam'])
    expect([...rows[0].querySelectorAll('ins')].map((el) => el.textContent)).toEqual(['Alex'])
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, 'true'])
    expect(count()).toBeNull()
    show([])
    expect(list()).toBeNull()
  })

  it('a click on a row goes to that change, and its mousedown keeps the focus in the note', () => {
    const { controller, show, list } = mount(true)
    show(ROWS)
    const row = list()?.querySelectorAll<HTMLButtonElement>('.outside-list__row')[1]
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    row?.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    act(() => row?.click())
    expect(controller.go).toHaveBeenCalledWith(3)
  })

  it('Unpin writes the setting off', () => {
    const { onPin, show, list } = mount(true)
    show(ROWS)
    const unpin = list()?.querySelector<HTMLButtonElement>('.toc__pin')
    expect(unpin?.textContent).toBe('Unpin')
    act(() => unpin?.click())
    expect(onPin).toHaveBeenCalledWith(false)
  })

  it('the stylesheet: the pinned list makes the note give it room, as the table of contents does; its header takes clicks', () => {
    expect(outsideCss).toMatch(/\.editor:has\(> \.outside-list:not\(\.outside-list--dropdown\)\) > \.editor-host \{\s*padding-left: var\(--outside-list-width\);/)
    expect(outsideCss).toMatch(/\.outside-list__header \{[^}]*pointer-events: auto;/)
  })
})

describe('OutsideChangesList, unpinned: the dropdown (4J)', () => {
  it('no list beside the note; the count opens the rows as a dropdown, Pin at its top', () => {
    const { onPin, show, list, dropdown, count } = mount(false)
    show(ROWS)
    expect(list()).toBeNull()
    expect(count()?.textContent).toBe('2 outside changes in this note ▾')
    expect(dropdown()).toBeNull()
    act(() => count()?.click())
    expect(numbers(dropdown())).toEqual(['1', '3'])
    act(() => dropdown()?.querySelector<HTMLButtonElement>('.toc__pin')?.click())
    expect(onPin).toHaveBeenCalledWith(true)
    expect(dropdown()).toBeNull()
  })

  it('a row goes to its change and closes the dropdown; Escape closes it too', () => {
    const { controller, show, dropdown, count } = mount(false)
    show(ROWS)
    act(() => count()?.click())
    act(() => dropdown()?.querySelectorAll<HTMLButtonElement>('.outside-list__row')[0].click())
    expect(controller.go).toHaveBeenCalledWith(7)
    expect(dropdown()).toBeNull()
    act(() => count()?.click())
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(dropdown()).toBeNull()
  })

  it('4J1: a dropdown open when the list empties, or when the whole note changes, does not open by itself on the next change', () => {
    const { channel, show, dropdown, count } = mount(false)
    show(ROWS)
    act(() => count()?.click())
    show([])
    show(ROWS)
    expect(dropdown()).toBeNull()
    act(() => count()?.click())
    act(() => channel.sync({ count: 0, wholeNote: true }, channel.getVersion() + 1))
    act(() => channel.sync({ count: 0, wholeNote: false }, channel.getVersion() + 1))
    show(ROWS)
    expect(dropdown()).toBeNull()
  })
})

describe('the channel: a new editor on the same channel (4K)', () => {
  it('the list reads the new rows although the new plugin counts its version from 0 again', () => {
    const { channel, show, list } = mount(true)
    show(ROWS)
    expect(numbers(list())).toEqual(['1', '3'])
    // The page's editor starts again (React's double start, or Back): its plugin binds and counts from 0.
    let rows: OutsideChangeRow[] = []
    act(() => {
      channel.bind(stubController(() => rows))
    })
    rows = [{ id: 9, number: 1, active: false, parts: [{ kind: 'ins', text: 'New' }] }]
    act(() => channel.sync({ count: 1, wholeNote: false }, 1))
    expect(numbers(list())).toEqual(['1'])
    expect(list()?.querySelector('ins')?.textContent).toBe('New')
  })
})
