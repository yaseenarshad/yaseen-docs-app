/**
 * The sidebar's inline create box. Since YAZ-1604 it can start with a SEED (`09_14- `): the seed
 * is shown as the value with the caret at its end, and Enter on the untouched seed is a no-op —
 * the box stays open — so a bare date folder is never born by accident (🔒 D3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CreateInline } from './CreateInline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount(seed?: string, kind: 'dir' | 'file' | 'drawing' | 'diagram' = 'dir') {
  const onSubmit = vi.fn(() => Promise.resolve())
  const onCancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<CreateInline kind={kind} seed={seed} indent={0} onSubmit={onSubmit} onCancel={onCancel} />))
  const field = container.querySelector<HTMLInputElement>('.create-inline__input')
  if (field === null) throw new Error('the create input did not mount')
  return { field, onSubmit }
}

const enter = (field: HTMLInputElement) => act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

describe('CreateInline seed (YAZ-1604)', () => {
  it('mounts empty with the placeholder when no seed is given — the pre-YAZ-1604 box, unchanged', () => {
    const { field } = mount()
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('')
    expect(field.placeholder).toBe('New folder')
  })

  it('shows the seed with the caret at its end, right after the dash', () => {
    const { field } = mount('06_22- ')
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('06_22- ')
    expect(field.selectionStart).toBe(7)
    expect(field.selectionEnd).toBe(7)
  })

  it('Enter on the untouched seed is a no-op; Enter after a title submits the trimmed name', async () => {
    const { field, onSubmit } = mount('06_22- ')
    await enter(field)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(container?.querySelector('.create-inline__input')).not.toBeNull()
    field.value = '06_22- Launch '
    await enter(field)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('06_22- Launch')
  })

  it.each(['Q3/Q4', '.hidden'])('a folder\'s title is free text: %s is submitted, the name rules guard no title (YAZ-2420 D6)', async (title) => {
    const { field, onSubmit } = mount()
    field.value = title
    await enter(field)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(title)
  })
})

/** The board boxes (YAZ-3028 D9): they name their kind, and an empty box — or the seed alone — is "Untitled". */
describe('CreateInline for a board (YAZ-3028 D9)', () => {
  it('says "New drawing" and "New diagram"', () => {
    expect(mount(undefined, 'drawing').field.placeholder).toBe('New drawing')
    act(() => root?.unmount())
    expect(mount(undefined, 'diagram').field.placeholder).toBe('New diagram')
  })

  it('Enter on an empty box, or on the seed alone, submits "" (the caller names it Untitled); a typed name goes as typed', async () => {
    const empty = mount(undefined, 'drawing')
    await act(async () => enter(empty.field))
    expect(empty.onSubmit).toHaveBeenCalledExactlyOnceWith('')
    act(() => root?.unmount())
    const dated = mount('10_20- ', 'drawing')
    await act(async () => enter(dated.field))
    expect(dated.onSubmit).toHaveBeenCalledExactlyOnceWith('')
    act(() => root?.unmount())
    const named = mount(undefined, 'diagram')
    named.field.value = '  Flow  '
    await act(async () => enter(named.field))
    expect(named.onSubmit).toHaveBeenCalledExactlyOnceWith('Flow')
  })
})
