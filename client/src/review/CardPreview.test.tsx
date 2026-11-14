/**
 * Preview a card (YAZ-5152): the Inbox's own card, with Space, the sides and the Reviews strip, and NOTHING saved — no
 * answer buttons, no write of any kind. Space at the end starts again from the front; Esc closes and gives the keyboard
 * back where it was.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { createViewOnlyLinkSource } from '../editor/wikilink/viewOnlyLinkSource'
import { CardPreview } from './CardPreview'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Every write the app can make: the preview must call none of them. */
const writes = vi.hoisted(() => ({ writeFile: vi.fn(), createFile: vi.fn(), transformFile: vi.fn() }))
vi.mock('../api', () => ({ api: { shell: { openLink: vi.fn() }, writeFile: writes.writeFile, createFile: writes.createFile } }))
vi.mock('../views/writeProperty', () => ({ transformFile: writes.transformFile }))

const PATH = '/v/cards.md'
const TEXT = 'Capital of {{France}}\n---\n{{Paris}} on the {{Seine}}'
const REVIEWS = [{ at: '2026-11-01T09:00Z', rating: 'good' as const }, { at: '2026-11-06T09:00Z', rating: 'again' as const }]

let root: Root | null = null
let el: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

function mount(text = TEXT) {
  const wikilinks = createWikilinkResolveSource()
  const vault = { root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never, viewOnlyLinks: createViewOnlyLinkSource() }
  const onClose = vi.fn()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  act(() => root?.render(<CardPreview card={{ path: PATH, id: 'WIKI-9', text, notitle: false, reviews: REVIEWS }} vault={vault} settings={DEFAULT_REVIEW_SETTINGS} doors={{ openLayer: vi.fn(), openTab: vi.fn(), onNotice: vi.fn() }} onNotice={vi.fn()} onClose={onClose} />))
  return { onClose }
}
const press = (key: string) => act(() => void (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
const shown = () => [...el.querySelectorAll('.card__hidden')].map((s) => s.textContent)
const sides = () => el.querySelectorAll('.card__side').length

describe('Preview a card (YAZ-5152)', () => {
  it('is the Inbox\'s card: the front with its hidden word, Space through the words and the sides, "Side n of 2", the Reviews strip from the last side; no answer buttons; "Preview · Esc to close"', () => {
    mount()
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Preview card')
    expect(el.querySelector('.card-inbox--preview .card-inbox__panel .card.card-screen.card-inbox__card')).not.toBeNull()
    expect([sides(), shown()]).toEqual([1, []])
    expect(el.querySelector('.card-inbox__sides')?.textContent).toBe('Side 1 of 2')
    expect(el.querySelector('.card-reviews')).toBeNull()
    press(' ')
    expect(shown()).toEqual(['France'])
    press(' ')
    expect(sides()).toBe(2)
    expect(el.querySelector('.card-inbox__sides')?.textContent).toBe('Side 2 of 2')
    // The last side shows: the strip, closed, with no delete.
    expect(el.querySelector('.card-reviews .backlinks__title')?.textContent).toBe('2 Reviews')
    act(() => el.querySelector<HTMLButtonElement>('.card-reviews__toggle')!.click())
    expect(el.querySelector('.card-reviews__delete')).toBeNull()
    expect(el.querySelector('.card-inbox__answer, .card-inbox__actions')).toBeNull()
    expect(el.querySelector('.card-preview__foot')?.textContent).toBe('Preview · Esc to close')
  })

  it('Space at the end starts again from the front; a click on the card is a Space too', () => {
    mount()
    for (let i = 0; i < 4; i++) press(' ')
    expect(shown()).toEqual(['France', 'Paris', 'Seine'])
    press(' ')
    expect([sides(), shown()]).toEqual([1, []])
    act(() => el.querySelector<HTMLElement>('.card-inbox__card')!.click())
    expect(shown()).toEqual(['France'])
  })

  it('NOTHING IS SAVED: through every step, the start again, the strip and Esc, no write of any kind', () => {
    const { onClose } = mount()
    for (let i = 0; i < 6; i++) press(' ')
    act(() => el.querySelector<HTMLButtonElement>('.card-reviews__toggle')?.click())
    press('Escape')
    expect(onClose).toHaveBeenCalledOnce()
    expect(writes.writeFile).not.toHaveBeenCalled()
    expect(writes.createFile).not.toHaveBeenCalled()
    expect(writes.transformFile).not.toHaveBeenCalled()
  })

  it('Esc closes, ahead of what is under it, and the keyboard goes back where it was (Edit card\'s editor, its caret kept)', () => {
    const editor = document.createElement('div')
    editor.tabIndex = -1
    document.body.append(editor)
    editor.focus()
    const under = vi.fn()
    window.addEventListener('keydown', under)
    const { onClose } = mount()
    expect(document.activeElement).toBe(el.querySelector('.card-inbox--preview'))
    press('Escape')
    expect(onClose).toHaveBeenCalledOnce()
    expect(under).not.toHaveBeenCalled()
    act(() => root?.unmount())
    root = null
    expect(document.activeElement).toBe(editor)
    window.removeEventListener('keydown', under)
    editor.remove()
  })
})
