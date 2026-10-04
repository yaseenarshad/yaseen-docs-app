/**
 * The 5 confirm sheets' markup, pinned (YAZ-2201): the shared shell must leave every sheet's DOM
 * byte-identical, plus the one mechanic every sheet shares — focus lands on Cancel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmDeleteComment } from '../comments/ConfirmDeleteComment'
import { ConfirmDelete } from '../sidebar/ConfirmDelete'
import { ConfirmRename } from '../sidebar/ConfirmRename'
import { TEST_RECORDS } from '../views/testRecords'
import { ConfirmDeleteColumn } from '../views/view/ConfirmDeleteColumn'
import { ConfirmDeleteView } from '../views/view/ConfirmDeleteView'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function render(sheet: ReactElement): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(sheet))
  return host
}

const cb = { onConfirm: vi.fn(), onCancel: vi.fn() }

/** Where each sheet hears its keys: `window`, its own overlay (`sheet`), or its overlay without letting keys or clicks escape (`contained`). */
type Keys = 'window' | 'sheet' | 'contained'
const KEYS: Record<string, Keys> = {
  ConfirmDelete: 'window',
  ConfirmRename: 'sheet',
  ConfirmDeleteComment: 'window',
  ConfirmDeleteColumn: 'contained',
  ConfirmDeleteView: 'window',
}

const SHEETS: Array<[string, () => ReactElement]> = [
  ['ConfirmDelete', () => <ConfirmDelete target={{ path: '/v/Projects', kind: 'dir', children: { notes: 3, folders: 1 }, backlinks: 2 }} {...cb} />],
  ['ConfirmRename', () => <ConfirmRename oldPath="/v/Old.md" newPath="/v/New.md" kind="file" count={2} {...cb} />],
  ['ConfirmDeleteComment', () => <ConfirmDeleteComment label="#3" replies={2} {...cb} />],
  ['ConfirmDeleteColumn', () => <ConfirmDeleteColumn columnKey="note.status" def={{ views: [], properties: { status: { displayName: 'Status' } } }} records={TEST_RECORDS} {...cb} />],
  ['ConfirmDeleteView', () => <ConfirmDeleteView view={{ type: 'table', name: 'All notes' }} {...cb} />],
]

describe('the confirm sheets (YAZ-2201)', () => {
  it.each(SHEETS)('%s: markup pinned, focus on Cancel', (_name, sheet) => {
    const el = render(sheet())
    expect(el.innerHTML).toMatchSnapshot()
    expect(document.activeElement?.textContent).toBe('Cancel')
  })

  it.each(SHEETS)('%s: Esc cancels, Enter confirms, click-away cancels, a click inside does nothing — heard where it always was', (name, sheet) => {
    cb.onConfirm.mockClear()
    cb.onCancel.mockClear()
    const el = render(sheet())
    const outside = vi.fn()
    document.body.addEventListener('keydown', outside)
    document.body.addEventListener('mousedown', outside)
    try {
      const key = (target: EventTarget, k: string) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
      const cancel = el.querySelector('.confirm__btn') as HTMLElement
      key(window, 'Escape')
      expect(cb.onCancel).toHaveBeenCalledTimes(KEYS[name] === 'window' ? 1 : 0)
      cb.onCancel.mockClear()
      key(cancel, 'Escape')
      key(cancel, 'Enter')
      expect([cb.onCancel.mock.calls.length, cb.onConfirm.mock.calls.length]).toEqual([1, 1])
      expect(outside.mock.calls.length > 0).toBe(KEYS[name] !== 'contained')
      outside.mockClear()
      cb.onCancel.mockClear()
      act(() => void el.querySelector('.confirm')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      expect(cb.onCancel).not.toHaveBeenCalled()
      act(() => void el.querySelector('.confirm-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      expect(cb.onCancel).toHaveBeenCalledTimes(1)
      expect(outside.mock.calls.length > 0).toBe(KEYS[name] !== 'contained')
    } finally {
      document.body.removeEventListener('keydown', outside)
      document.body.removeEventListener('mousedown', outside)
    }
  })
})
