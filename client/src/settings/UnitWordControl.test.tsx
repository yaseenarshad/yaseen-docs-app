/** "Call a note a …" in a vault with note cards (YAZ-4946 D16): the word Card warns; Note card keeps its name. */
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

function show(settings: UnitWordSettings, hasNoteCards: boolean): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const word = settings.unit === 'own' ? settings.own : UNIT_WORDS[settings.unit]
  act(() => root!.render(<UnitWordControl unitWord={{ settings, word, unit: ((t: string) => t) as never, save: () => {} }} hasNoteCards={hasNoteCards} />))
  return host
}

describe('the unit word row and note cards', () => {
  it('warns only when a vault with note cards calls its pages cards', () => {
    expect(show({ ...DEFAULT_UNIT_WORD, unit: 'card' }, true).textContent).toContain('This vault has note cards')
    act(() => root?.unmount())
    expect(show({ ...DEFAULT_UNIT_WORD, unit: 'own', own: { one: 'Card', many: 'Cards' } }, true).textContent).toContain('This vault has note cards')
    act(() => root?.unmount())
    expect(show({ ...DEFAULT_UNIT_WORD, unit: 'card' }, false).textContent).not.toContain('note cards')
    act(() => root?.unmount())
    expect(show({ ...DEFAULT_UNIT_WORD, unit: 'page' }, true).textContent).not.toContain('note cards')
  })
})
