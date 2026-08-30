import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RightPanel, type RightPanelProps } from './RightPanel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

const base = (): RightPanelProps => ({
  items: ['/v/Alpha.md', '/v/Beta.md'],
  expanded: '/v/Alpha.md',
  width: 440,
  overlay: false,
  canBack: false,
  canForward: false,
  onBack: vi.fn(),
  onForward: vi.fn(),
  onToggle: vi.fn(),
  onClose: vi.fn(),
  onHide: vi.fn(),
  onResizeCommit: vi.fn(),
  children: <div data-viewer>Viewer</div>,
})

function mount(props: RightPanelProps): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<RightPanel {...props} />))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

describe('RightPanel', () => {
  it('renders one labelled complementary region, compact headers, toolbar state, and one stable viewer', () => {
    const el = mount(base())
    const panel = el.querySelector('[role="complementary"][aria-label="Right panel"]')
    expect(panel).not.toBeNull()
    expect([...el.querySelectorAll<HTMLButtonElement>('.right-panel__header')].map((button) => [button.textContent, button.getAttribute('aria-expanded')])).toEqual([
      ['Alpha', 'true'],
      ['Beta', 'false'],
    ])
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Back in right panel"]')?.disabled).toBe(true)
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Forward in right panel"]')?.disabled).toBe(true)
    expect(el.querySelectorAll('[data-viewer]')).toHaveLength(1)
    expect(el.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('440')
  })

  it('routes header, navigation, close, and hide gestures without coupling state', () => {
    const props = { ...base(), canBack: true, canForward: true }
    const el = mount(props)
    act(() => el.querySelector<HTMLButtonElement>('.right-panel__header')?.click())
    expect(props.onToggle).toHaveBeenCalledWith('/v/Alpha.md')
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Back in right panel"]')?.click())
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Forward in right panel"]')?.click())
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close Alpha"]')?.click())
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Hide right panel"]')?.click())
    expect(props.onBack).toHaveBeenCalledTimes(1)
    expect(props.onForward).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledWith('/v/Alpha.md')
    expect(props.onHide).toHaveBeenCalledTimes(1)
  })

  it('keeps focus on collapse and hands close focus to the next header', async () => {
    const props = base()
    const el = mount(props)
    const headers = [...el.querySelectorAll<HTMLButtonElement>('.right-panel__header')]
    headers[0].focus()
    act(() => headers[0].click())
    expect(document.activeElement).toBe(headers[0])
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close Alpha"]')?.click())
    await act(async () => {})
    expect(document.activeElement).toBe(headers[1])
  })

  it('commits keyboard resize in 16px steps and clamps to the approved bounds', () => {
    const props = base()
    const el = mount(props)
    const separator = el.querySelector<HTMLElement>('[role="separator"]')!
    act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(vi.mocked(props.onResizeCommit).mock.calls.map(([width]) => width)).toEqual([456, 424, 320, 720])
  })

  it('previews pointer resize locally, commits once on mouseup, and hides below 192 without overwriting width', () => {
    const props = base()
    const el = mount(props)
    const separator = el.querySelector<HTMLElement>('[role="separator"]')!
    act(() => separator.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true, cancelable: true })))
    act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 420 })))
    expect((el.querySelector('.right-panel') as HTMLElement).style.getPropertyValue('--right-panel-width')).toBe('520px')
    act(() => window.dispatchEvent(new MouseEvent('mouseup')))
    expect(props.onResizeCommit).toHaveBeenCalledOnce()
    expect(props.onResizeCommit).toHaveBeenCalledWith(520)

    vi.mocked(props.onResizeCommit).mockClear()
    act(() => separator.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true, cancelable: true })))
    act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 760 })))
    act(() => window.dispatchEvent(new MouseEvent('mouseup')))
    expect(props.onHide).toHaveBeenCalledOnce()
    expect(props.onResizeCommit).not.toHaveBeenCalled()
  })

  it('Escape hides only overlay mode and the empty shell stays useful', () => {
    const overlay = { ...base(), items: [], expanded: null, overlay: true, children: undefined }
    const el = mount(overlay)
    const panel = el.querySelector<HTMLElement>('[aria-label="Right panel"]')!
    act(() => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(overlay.onHide).toHaveBeenCalledOnce()
    expect(el.textContent).toContain('Open a page in the right panel')
  })
})
