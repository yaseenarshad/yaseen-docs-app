/**
 * The "Read only" chip and its "Allow edits?" box (YAZ-3076 D4, cases S45-S48; the time choices and the "Editing ·
 * mm:ss" chip of YAZ-4939). The host keeps whether the box is open (`asking`) and what each choice does; the chip
 * only shows, asks and counts down.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { editingLabel, ReadOnlyChip } from './ReadOnlyChip'
import { tellReadOnlyEdit } from './readOnlyEdit'
import { ALLOW_MS, type AllowFor } from './useTimedUnlock'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let allowed: ReturnType<typeof vi.fn<(choice: AllowFor) => void>>
let turnedOff: ReturnType<typeof vi.fn<() => void>>
let locked: ReturnType<typeof vi.fn<() => void>>

/**
 * A host as the editors are: a time choice unlocks the page for that long (the chip stays, as "Editing"), "Turn Read
 * only off" takes the chip away, and "Lock now" locks again.
 */
function mount({ turnOff = true }: { turnOff?: boolean } = {}) {
  allowed = vi.fn()
  turnedOff = vi.fn()
  locked = vi.fn()
  function Harness() {
    const [readOnly, setReadOnly] = useState(true)
    const [asking, setAsking] = useState(false)
    const [until, setUntil] = useState<number | null>(null)
    return <>
      {readOnly && (
        <ReadOnlyChip
          asking={asking}
          onAsk={() => setAsking(true)}
          onAllow={(choice) => { allowed(choice); setAsking(false); setUntil(choice === 'close' ? Infinity : Date.now() + ALLOW_MS[choice]) }}
          onCancel={() => setAsking(false)}
          onTurnOff={turnOff ? () => { turnedOff(); setAsking(false); setReadOnly(false) } : undefined}
          editingUntil={until}
          onLock={() => { locked(); setUntil(null) }}
        />
      )}
      <button data-outside>Outside</button>
    </>
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.useRealTimers()
})

const chip = () => container.querySelector<HTMLButtonElement>('.read-only-chip__button')
const lockNow = () => container.querySelector<HTMLButtonElement>('.read-only-chip__lock')
const box = () => container.querySelector<HTMLElement>('.read-only-chip__ask')
const button = (name: string) => [...(box()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === name)!
const click = (element: Element) => act(() => void element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const press = (element: Element, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => void element.dispatchEvent(event))
  return event
}

describe('ReadOnlyChip', () => {
  it('says "Read only" with a lock, and its tooltip says what a click does', () => {
    mount()
    expect(chip()?.textContent).toBe('Read only')
    expect(chip()?.querySelector('svg')).not.toBeNull()
    expect(chip()?.title).toBe('Click to allow edits')
    expect(chip()?.getAttribute('aria-expanded')).toBe('false')
    expect(box()).toBeNull()
    expect(lockNow()).toBeNull()
  })

  it('S45: a click opens the "Allow edits?" box under it, with the three times, "Turn Read only off" and Cancel; a second click closes it', () => {
    mount()
    click(chip()!)
    expect(box()?.getAttribute('role')).toBe('dialog')
    expect(box()?.querySelector('p')?.textContent).toBe('Allow edits?')
    expect([...box()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Allow edits for 15 minutes', '1 hour', 'Until I close this tab', 'Turn Read only off', 'Cancel'])
    expect(chip()?.getAttribute('aria-expanded')).toBe('true')
    click(chip()!)
    expect(box()).toBeNull()
    expect(allowed).not.toHaveBeenCalled()
  })

  it('YAZ-4939: a page with no switch of its own to turn (a read-only vault, a code tab) has no "Turn Read only off"', () => {
    mount({ turnOff: false })
    click(chip()!)
    expect([...box()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Allow edits for 15 minutes', '1 hour', 'Until I close this tab', 'Cancel'])
  })

  it('S46: the focus goes to "Allow edits for 15 minutes", so Enter takes it', () => {
    mount()
    click(chip()!)
    expect(document.activeElement).toBe(button('Allow edits for 15 minutes'))
  })

  it('S46: Esc cancels, keeps the key from the page, and puts the focus on the chip', () => {
    mount()
    click(chip()!)
    const beyond = vi.fn()
    document.addEventListener('keydown', beyond)
    const esc = press(button('Allow edits for 15 minutes'), 'Escape')
    document.removeEventListener('keydown', beyond)
    expect(box()).toBeNull()
    expect(esc.defaultPrevented).toBe(true)
    expect(beyond).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(chip())
    expect(allowed).not.toHaveBeenCalled()
  })

  it('S46: a press outside cancels; Cancel cancels', () => {
    mount()
    click(chip()!)
    act(() => void container.querySelector('[data-outside]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(box()).toBeNull()
    click(chip()!)
    click(button('Cancel'))
    expect(box()).toBeNull()
    expect(allowed).not.toHaveBeenCalled()
    expect(chip()).not.toBeNull()
  })

  it('a press inside the box is not "outside"', () => {
    mount()
    click(chip()!)
    act(() => void box()!.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(box()).not.toBeNull()
  })

  it('S46: a press on a canvas that cancels its pointerdown (Excalidraw’s view mode pans on it, so no mousedown follows) still cancels', () => {
    mount()
    click(chip()!)
    const canvas = container.querySelector('[data-outside]')!
    canvas.addEventListener('pointerdown', (e) => e.preventDefault())
    act(() => void canvas.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true })))
    expect(box()).toBeNull()
    expect(allowed).not.toHaveBeenCalled()
  })

  it('S46: the window losing focus cancels — a press inside the draw.io frame never reaches this document', () => {
    mount()
    click(chip()!)
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(box()).toBeNull()
    expect(allowed).not.toHaveBeenCalled()
  })

  it('S48: "Turn Read only off" turns the page\'s own switch off, and the chip goes', () => {
    mount()
    click(chip()!)
    click(button('Turn Read only off'))
    expect(turnedOff).toHaveBeenCalledTimes(1)
    expect(allowed).not.toHaveBeenCalled()
    expect(chip()).toBeNull()
    expect(box()).toBeNull()
  })

  it('YAZ-4939: each time choice tells the host which, and the box closes', () => {
    mount()
    for (const [label, choice] of [['Allow edits for 15 minutes', 'fifteen'], ['1 hour', 'hour'], ['Until I close this tab', 'close']] as const) {
      click(chip()!)
      click(button(label))
      expect(allowed).toHaveBeenLastCalledWith(choice)
      expect(box()).toBeNull()
    }
  })

  it('YAZ-4939: while an unlock runs the chip reads "Editing · mm:ss" in amber with a pencil, ticks once a second, and "Lock now" locks', () => {
    // Only intervals and the clock are faked, so the count below is the chip's interval alone (React's scheduler keeps its own timers).
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-11-11T10:00:00Z'))
    mount()
    expect(vi.getTimerCount()).toBe(0)
    click(chip()!)
    click(button('Allow edits for 15 minutes'))
    expect(chip()?.textContent).toBe('Editing · 15:00')
    expect(chip()?.classList.contains('read-only-chip__button--editing')).toBe(true)
    expect(chip()?.title).toBe('Edits are allowed for now. Click for another time.')
    expect(lockNow()?.textContent).toBe('Lock now')
    // The 1-second clock: one interval, in the chip, and the chip alone renders for it.
    expect(vi.getTimerCount()).toBe(1)
    act(() => void vi.advanceTimersByTime(1000))
    expect(chip()?.textContent).toBe('Editing · 14:59')
    act(() => void vi.advanceTimersByTime(60_000))
    expect(chip()?.textContent).toBe('Editing · 13:59')
    click(lockNow()!)
    expect(locked).toHaveBeenCalledTimes(1)
    expect(chip()?.textContent).toBe('Read only')
    expect(lockNow()).toBeNull()
    // Locked again: the clock is gone.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('YAZ-4939: "Until I close this tab" shows no clock and arms none', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    mount()
    click(chip()!)
    click(button('Until I close this tab'))
    expect(chip()?.textContent).toBe('Editing · until close')
    expect(vi.getTimerCount()).toBe(0)
    expect(lockNow()).not.toBeNull()
  })

  it('YAZ-4939: the chip\'s click while editing opens the box again, for another time', () => {
    mount()
    click(chip()!)
    click(button('1 hour'))
    click(chip()!)
    expect(box()).not.toBeNull()
    click(button('Until I close this tab'))
    expect(allowed).toHaveBeenLastCalledWith('close')
  })

  it('the words of the clock', () => {
    expect(editingLabel(Infinity, 0)).toBe('Editing · until close')
    expect(editingLabel(ALLOW_MS.hour, 0)).toBe('Editing · 60:00')
    expect(editingLabel(ALLOW_MS.fifteen, 0)).toBe('Editing · 15:00')
    expect(editingLabel(ALLOW_MS.fifteen, 1)).toBe('Editing · 15:00')
    expect(editingLabel(ALLOW_MS.fifteen, 1000)).toBe('Editing · 14:59')
    expect(editingLabel(9_000, 0)).toBe('Editing · 0:09')
    expect(editingLabel(0, 5_000)).toBe('Editing · 0:00')
  })

  it('Esc with the box closed is not the chip’s: the page keeps it', () => {
    mount()
    const esc = press(chip()!, 'Escape')
    expect(esc.defaultPrevented).toBe(false)
  })
})

/**
 * The message of an edit attempt (YAZ-4446, D33 of YAZ-4278): a Read only guard tells its pane (`tellReadOnlyEdit`), and
 * the pane's chip shows a small card under it, a red arrow pointing up at it, and pulses once.
 */
describe('the edit-attempt message (YAZ-4446)', () => {
  /** Two panes, as a split view has: each a `section.editor` with its own chip and its own body. */
  function mountPanes() {
    function Pane({ id }: { id: string }) {
      const [asking, setAsking] = useState(false)
      return <section className="editor" data-pane={id}>
        <ReadOnlyChip asking={asking} onAsk={() => setAsking(true)} onAllow={() => setAsking(false)} onCancel={() => setAsking(false)} />
        <div data-body={id} />
        <div role="dialog"><div data-popup={id} /></div>
      </section>
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<><Pane id="a" /><Pane id="b" /></>))
  }
  const pane = (id: string) => container.querySelector<HTMLElement>(`[data-pane="${id}"]`)!
  const card = (id: string) => pane(id).querySelector<HTMLElement>('.read-only-message__card')
  const status = (id: string) => pane(id).querySelector<HTMLElement>('[role="status"]')
  const paneChip = (id: string) => pane(id).querySelector<HTMLButtonElement>('.read-only-chip__button')!
  const attempt = (selector: string, what: 'note' | 'drawing' = 'note') => act(() => tellReadOnlyEdit(container.querySelector(selector)!, what))

  afterEach(() => vi.useRealTimers())

  it('an attempt shows the card in plain words, as a status, under the chip; the chip pulses', () => {
    vi.useFakeTimers()
    mountPanes()
    expect(card('a')).toBeNull()
    expect(paneChip('a').classList.contains('read-only-chip__button--pulse')).toBe(false)
    attempt('[data-body="a"]')
    expect(card('a')?.textContent).toBe('This note is Read only.Click Read only to allow edits.')
    expect(status('a')?.contains(card('a'))).toBe(true)
    expect(card('a')?.querySelector('.read-only-message__arrow svg')).not.toBeNull()
    expect(paneChip('a').classList.contains('read-only-chip__button--pulse')).toBe(true)
    // It is the chip's own: the card sits in the chip's box, so nothing in the page moves.
    expect(pane('a').querySelector('.read-only-chip')?.contains(card('a'))).toBe(true)
  })

  it('a drawing says "drawing"', () => {
    vi.useFakeTimers()
    mountPanes()
    attempt('[data-body="a"]', 'drawing')
    expect(card('a')?.querySelector('strong')?.textContent).toBe('This drawing is Read only.')
  })

  it('it shows only in the pane typed in (a split view), and not for a popup in that pane', () => {
    vi.useFakeTimers()
    mountPanes()
    attempt('[data-body="b"]')
    expect(card('a')).toBeNull()
    expect(card('b')).not.toBeNull()
    expect(paneChip('a').classList.contains('read-only-chip__button--pulse')).toBe(false)
    attempt('[data-popup="a"]', 'drawing')
    expect(card('a')).toBeNull()
  })

  it('more attempts keep ONE card up and start its time again; it goes about 2.5 s after the last one', () => {
    vi.useFakeTimers()
    mountPanes()
    attempt('[data-body="a"]')
    for (let i = 0; i < 5; i++) {
      act(() => vi.advanceTimersByTime(2000))
      attempt('[data-body="a"]')
      expect(pane('a').querySelectorAll('.read-only-message__card')).toHaveLength(1)
    }
    act(() => vi.advanceTimersByTime(2400))
    expect(card('a')).not.toBeNull()
    act(() => vi.advanceTimersByTime(200))
    expect(card('a')).toBeNull()
    expect(paneChip('a').classList.contains('read-only-chip__button--pulse')).toBe(false)
  })

  it('it shows at most once a second: closed early by the chip, the next attempt within 1 s shows nothing', () => {
    vi.useFakeTimers()
    mountPanes()
    attempt('[data-body="a"]')
    click(paneChip('a'))
    // The "Allow edits?" box answers the chip now: the card goes.
    expect(card('a')).toBeNull()
    click(paneChip('a'))
    act(() => vi.advanceTimersByTime(500))
    attempt('[data-body="a"]')
    expect(card('a')).toBeNull()
    act(() => vi.advanceTimersByTime(600))
    attempt('[data-body="a"]')
    expect(card('a')).not.toBeNull()
  })
})
