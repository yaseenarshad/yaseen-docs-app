/**
 * The numbered list (YAZ-3998): its rows, numbered, with the change word by word; a click goes to that change;
 * it hides with no change and with too little room left of the text. A real channel with a stub controller bound,
 * as the plugin binds its own, and the page's three boxes (`section.editor`, the scroller, the text) laid out by hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LIST_MIN_ROOM, OutsideChangesList } from './OutsideChangesList'
import { createOutsideChangesChannel, type OutsideChangeRow, type OutsideChangesController } from './outsideChangesChannel'

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

/** `textLeft`: where the note's text starts, from the section's left edge. */
function mount(textLeft: number) {
  const channel = createOutsideChangesChannel()
  let rows: OutsideChangeRow[] = []
  const controller: OutsideChangesController = { next: vi.fn(), go: vi.fn(), rows: () => rows, clear: vi.fn(), markWholeNote: vi.fn(), setGlow: vi.fn() }
  channel.bind(controller)
  section = document.createElement('section')
  section.className = 'editor'
  const scroller = document.createElement('div')
  scroller.className = 'editor-host'
  const host = document.createElement('div')
  const text = document.createElement('div')
  text.className = 'ProseMirror'
  text.getBoundingClientRect = () => ({ left: textLeft }) as DOMRect
  host.appendChild(text)
  scroller.appendChild(host)
  const mountPoint = document.createElement('div')
  section.append(mountPoint, scroller)
  document.body.appendChild(section)
  const hostRef = createRef<HTMLElement>()
  ;(hostRef as { current: HTMLElement | null }).current = host
  root = createRoot(mountPoint)
  act(() => root?.render(<OutsideChangesList channel={channel} hostRef={hostRef} />))
  const show = (next: OutsideChangeRow[]): void => {
    rows = next
    act(() => channel.sync({ count: next.length, wholeNote: false }, channel.getVersion() + 1))
  }
  const list = () => section?.querySelector<HTMLElement>('.outside-list') ?? null
  return { channel, controller, show, list }
}

describe('OutsideChangesList (YAZ-3998)', () => {
  it('shows nothing with no change', () => {
    const { list } = mount(300)
    expect(list()).toBeNull()
  })

  it('shows each change numbered, word by word, with the ring on the active one', () => {
    const { show, list } = mount(300)
    show(ROWS)
    const rows = [...(list()?.querySelectorAll('.outside-list__row') ?? [])]
    expect(rows.map((row) => row.querySelector('.outside-list__number')?.textContent)).toEqual(['1', '3'])
    expect(rows.map((row) => row.querySelector('.outside-list__text')?.textContent)).toEqual(['Owner is SamAlex', 'Removed: Ask about parking'])
    expect([...rows[0].querySelectorAll('del')].map((el) => el.textContent)).toEqual(['Sam'])
    expect([...rows[0].querySelectorAll('ins')].map((el) => el.textContent)).toEqual(['Alex'])
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, 'true'])
    // As wide as the room left of the text, the gap kept, at most 280.
    expect(list()?.style.width).toBe('280px')
    show([])
    expect(list()).toBeNull()
  })

  it('a click on a row goes to that change, and its mousedown keeps the focus in the note', () => {
    const { controller, show, list } = mount(300)
    show(ROWS)
    const row = list()?.querySelectorAll<HTMLButtonElement>('.outside-list__row')[1]
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    row?.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    act(() => row?.click())
    expect(controller.go).toHaveBeenCalledWith(3)
  })

  it('hides with too little room left of the text', () => {
    const { show, list } = mount(LIST_MIN_ROOM + 16 - 1)
    show(ROWS)
    expect(list()).toBeNull()
  })
})
