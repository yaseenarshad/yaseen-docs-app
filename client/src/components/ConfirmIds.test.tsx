/**
 * The box that asks whether a vault's notes get IDs (YAZ-2523 🔒 V2). The copy is LOCKED, so it is
 * pinned character for character; the sheet has two answers and a way out that gives neither.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmIds, idsAskMessage } from './ConfirmIds'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const WITH = ' With IDs, links keep working when a note is renamed or moved. Without them, the app leaves every file exactly as it is.'
const EMPTY_START = "Should this vault's notes have IDs? With IDs, the app names each note's file and links keep working when a note is renamed or moved."
const EMPTY_END = ' Without them, notes are plain files named as you type them, and the app writes nothing extra.'

describe('the LOCKED copy (V2, V11)', () => {
  it('notes to write, no folders: the count, one note in the singular', () => {
    expect(idsAskMessage({ notes: 854, folders: 0, foreign: 0 })).toBe(`Give this vault's notes IDs? The app would write an ID into 854 notes.${WITH}`)
    expect(idsAskMessage({ notes: 1, folders: 0, foreign: 0 })).toBe(`Give this vault's notes IDs? The app would write an ID into 1 note.${WITH}`)
  })

  it('notes and folders to write: the folders are counted too, one folder in the singular', () => {
    expect(idsAskMessage({ notes: 854, folders: 61, foreign: 0 })).toBe(`Give this vault's notes IDs? The app would write an ID into 854 notes and add a hidden settings file to 61 folders.${WITH}`)
    expect(idsAskMessage({ notes: 2, folders: 1, foreign: 0 })).toBe(`Give this vault's notes IDs? The app would write an ID into 2 notes and add a hidden settings file to 1 folder.${WITH}`)
  })

  it('notes that hold another tool’s ID: how many would be replaced, "has" for one and "have" for more', () => {
    expect(idsAskMessage({ notes: 9, folders: 0, foreign: 1 })).toBe(`Give this vault's notes IDs? The app would write an ID into 9 notes. 1 of them already has an ID from another tool, which would be replaced.${WITH}`)
    expect(idsAskMessage({ notes: 9, folders: 2, foreign: 3 })).toBe(
      `Give this vault's notes IDs? The app would write an ID into 9 notes and add a hidden settings file to 2 folders. 3 of them already have an ID from another tool, which would be replaced.${WITH}`,
    )
  })

  it('no notes to write: what the two kinds of vault are', () => {
    expect(idsAskMessage({ notes: 0, folders: 0, foreign: 0 })).toBe(`${EMPTY_START}${EMPTY_END}`)
  })

  it('no notes to write, folders that would be: the folders are counted, one in the singular', () => {
    expect(idsAskMessage({ notes: 0, folders: 4, foreign: 0 })).toBe(`${EMPTY_START} Saying yes adds a hidden settings file to 4 folders.${EMPTY_END}`)
    expect(idsAskMessage({ notes: 0, folders: 1, foreign: 0 })).toBe(`${EMPTY_START} Saying yes adds a hidden settings file to 1 folder.${EMPTY_END}`)
  })
})

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('ConfirmIds', () => {
  const onAnswer = vi.fn()
  const onDismiss = vi.fn()
  const mount = (): HTMLElement => {
    onAnswer.mockClear()
    onDismiss.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<ConfirmIds ask={{ notes: 3, folders: 1, foreign: 0 }} onAnswer={onAnswer} onDismiss={onDismiss} />))
    return container
  }
  const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  it('shows the copy for what a yes would write, with the two answers as its buttons', () => {
    const el = mount()
    expect(el.querySelector('.confirm__text')?.textContent).toBe(idsAskMessage({ notes: 3, folders: 1, foreign: 0 }))
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Not for this vault', 'Give IDs'])
  })

  it('"Give IDs" answers yes, "Not for this vault" answers no', () => {
    const el = mount()
    act(() => btn(el, 'Give IDs')?.click())
    expect(onAnswer.mock.calls).toEqual([[true]])
    act(() => btn(el, 'Not for this vault')?.click())
    expect(onAnswer.mock.calls).toEqual([[true], [false]])
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('Esc and Enter answer nothing: Esc closes the box, Enter does nothing', () => {
    mount()
    const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
    key('Enter')
    expect(onDismiss).not.toHaveBeenCalled()
    key('Escape')
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onAnswer).not.toHaveBeenCalled()
  })
})
