import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { KeySheet } from './KeySheet'
import { onKeySheetRequest, requestKeySheet } from './keySheetRequest'

/** The keys of this tab (YAZ-3564 K11): the place's keys as they are now, then the App keys that fire on it. */
let root: Root | null = null
let el: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

function mount(props: Partial<Parameters<typeof KeySheet>[0]> = {}) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  const onClose = vi.fn()
  act(() => root?.render(<KeySheet place="drawing" overrides={{}} aside={{}} onChangeKeys={() => undefined} onClose={onClose} {...props} />))
  return { onClose }
}
const rows = () => [...el.querySelectorAll('.key-sheet__row')].map((r) => `${r.querySelector('dt')?.textContent} ${r.querySelector('dd')?.textContent}`)

it("lists a drawing's keys with the user's changes, leaves out a blocked one, and the App keys less the ones that let drawings keep theirs", () => {
  mount({ overrides: { 'drawing.duplicate': 'CmdOrCtrl+Alt+D' } })
  expect(rows()).toContain('⌥⌘D Duplicate')
  expect(rows()).not.toContain('⌘D Duplicate')
  // ⌘K is Search the vault's on a drawing: Add link never fires, so the sheet does not offer it.
  expect(rows().some((r) => r.endsWith('Add link'))).toBe(false)
  expect(rows()).toContain('⌘K Search the vault')
  // Go to your place lets drawings keep ⌘D (K9): it is no App key on a drawing.
  expect(rows().some((r) => r.endsWith('Go to your place'))).toBe(false)
})

it('Esc closes it; ? on a drawing asks for it through one request', () => {
  const { onClose } = mount()
  act(() => el.querySelector('.key-sheet')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(onClose).toHaveBeenCalledOnce()
  const listener = vi.fn()
  const off = onKeySheetRequest(listener)
  requestKeySheet()
  off()
  requestKeySheet()
  expect(listener).toHaveBeenCalledOnce()
})
