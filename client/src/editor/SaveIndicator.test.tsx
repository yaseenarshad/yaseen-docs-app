/** The save chip (YAZ-2131 1E, YAZ-2172): one label and one state class per `SaveStatus`, announced politely. */
import { afterEach, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SaveStatus } from '../lib/autosave'
import { SaveIndicator } from './SaveIndicator'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

it.each<[SaveStatus, string]>([
  ['saved', 'Saved'],
  ['unsaved', 'Unsaved'],
  ['saving', 'Saving…'],
  ['error', 'Save failed'],
])('%s reads "%s" in a polite live region with its state class', (status, label) => {
  const container = document.createElement('div')
  root = createRoot(container)
  act(() => root?.render(<SaveIndicator status={status} />))
  const chip = container.querySelector('.save-indicator')!
  expect(chip.className).toBe(`save-indicator save-indicator--${status}`)
  expect(chip.textContent).toBe(label)
  expect(chip.getAttribute('role')).toBe('status')
  expect(chip.getAttribute('aria-live')).toBe('polite')
  expect(chip.querySelector('.save-indicator__dot')).not.toBeNull()
})
