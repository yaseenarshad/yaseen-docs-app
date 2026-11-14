// rename-note-to-page: skip-file (it tests the word choice "Note")
/**
 * "Call a page a …" (YAZ-4938): Page, Doc, Note, or the user's own word. YAZ-5036: Card is no choice, so a vault never
 * shows two "New card" rows; an own word "card" in a vault with cards still warns (YAZ-4946 D16).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_UNIT_WORD, UNIT_WORDS, type UnitWordSettings } from '../vault/unitWord'
import { UnitWordControl } from './UnitWordControl'

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
})

function show(settings: UnitWordSettings, hasCards: boolean): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const word = settings.unit === 'own' ? settings.own : UNIT_WORDS[settings.unit]
  act(() => root!.render(<UnitWordControl unitWord={{ settings, word, unit: ((t: string) => t) as never, save: () => {} }} hasCards={hasCards} />))
  return host
}

describe('the unit word row and cards', () => {
  it('the choices: Page (the default), Doc, Note, Your own word; no Card', () => {
    const el = show(DEFAULT_UNIT_WORD, true)
    expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Page', 'Doc', 'Note', 'Your own word'])
    expect(el.querySelector('[aria-label="Call a page a"]')).not.toBeNull()
  })

  it('warns only when a vault with cards calls its pages cards, with its own word', () => {
    expect(show({ ...DEFAULT_UNIT_WORD, unit: 'own', own: { one: 'Card', many: 'Cards' } }, true).textContent).toContain('Pages and cards would both be called cards.')
    act(() => root?.unmount())
    expect(show({ ...DEFAULT_UNIT_WORD, unit: 'own', own: { one: 'Card', many: 'Cards' } }, false).textContent).not.toContain('would both be called cards')
    act(() => root?.unmount())
    expect(show({ ...DEFAULT_UNIT_WORD, unit: 'page' }, true).textContent).not.toContain('would both be called cards')
  })
})
