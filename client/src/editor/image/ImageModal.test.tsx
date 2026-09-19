/**
 * The image lightbox (YAZ-1656 / YAZ-1665), DrawingModal.test's shape: React in jsdom, nothing
 * mocked — a viewer has no engine and no write. Pinned here: the resolved src and the caption,
 * Esc / backdrop / ✕ as ONE close gesture, a click inside the figure NOT closing, the key scope
 * (⚡ YAZ-888: an Escape outside the overlay is nobody's), and focus coming BACK to the editor on
 * unmount. The double-click that opens it belongs to the node view (`imageView.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ImageModal } from './ImageModal'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const SRC = 'app://vault/%2Fv/images/a.png?from=notes'

let root: Root | null = null
let container: HTMLElement | null = null
/** Stands in for the ProseMirror element: focused when the double-click opens the modal. */
let editor: HTMLElement | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  editor = document.createElement('div')
  editor.tabIndex = 0
  document.body.appendChild(editor)
  editor.focus()
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  editor?.remove()
  editor = null
})

function open(alt = 'alt'): { overlay: HTMLElement; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  act(() => root?.render(<ImageModal src={SRC} alt={alt} onClose={onClose} />))
  const overlay = container?.querySelector<HTMLElement>('.image-modal-overlay')
  if (overlay === null || overlay === undefined) throw new Error('missing .image-modal-overlay')
  return { overlay, onClose }
}

const escOn = (el: Node): void => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}
const mousedownOn = (el: Node): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
}

describe('what it shows', () => {
  it('the RESOLVED src, the alt as caption and label, and focus on the overlay so Esc lands', () => {
    const { overlay } = open('A caption')
    expect(container?.querySelector<HTMLImageElement>('.image-modal__img')?.getAttribute('src')).toBe(SRC)
    expect(container?.querySelector('.image-modal__caption')?.textContent).toBe('A caption')
    expect(container?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('A caption')
    expect(document.activeElement).toBe(overlay)
  })

  it('an empty alt has no caption and a generic label', () => {
    open('')
    expect(container?.querySelector('.image-modal__caption')).toBeNull()
    expect(container?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Image')
  })
})

describe('closing', () => {
  it('Esc on the overlay closes', () => {
    const { overlay, onClose } = open()
    escOn(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a mousedown on the backdrop closes; one inside the figure does not', () => {
    const { overlay, onClose } = open()
    mousedownOn(overlay.querySelector('.image-modal__img') as Node)
    expect(onClose).not.toHaveBeenCalled()
    mousedownOn(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('✕ is the same gesture', () => {
    const { onClose } = open()
    act(() => container?.querySelector<HTMLButtonElement>('.image-modal__close')?.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an Escape dispatched OUTSIDE the overlay does nothing (⚡ the YAZ-888 lesson)', () => {
    const { onClose } = open()
    escOn(editor as Node)
    escOn(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('focus', () => {
  it('returns to the element that had it — the editor — when the modal unmounts', () => {
    const { overlay, onClose } = open()
    expect(document.activeElement).toBe(overlay)
    escOn(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
    // The host drops the modal on close; the caret's element gets its focus back.
    act(() => root?.render(null))
    expect(document.activeElement).toBe(editor)
  })
})
