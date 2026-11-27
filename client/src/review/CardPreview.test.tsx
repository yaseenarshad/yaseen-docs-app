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
const REVIEWS = [{ at: '2026-11-01T09:00:00.000Z', rating: 'good' as const }, { at: '2026-11-06T09:00:00.000Z', rating: 'again' as const }]

let root: Root | null = null
let el: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

function mount(text = TEXT, title = '', notitle = false, titleAt?: 'always' | 'click' | 'side2', settings = DEFAULT_REVIEW_SETTINGS) {
  const wikilinks = createWikilinkResolveSource()
  const vault = { root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never, viewOnlyLinks: createViewOnlyLinkSource() }
  const onClose = vi.fn()
  const onLeave = vi.fn()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  act(() => root?.render(<CardPreview card={{ path: PATH, id: 'WIKI-9', text, title, notitle, ...(titleAt !== undefined && { titleAt }), reviews: REVIEWS }} vault={vault} settings={settings} doors={{ openLayer: vi.fn(), openTab: vi.fn(), onNotice: vi.fn() }} onNotice={vi.fn()} onClose={onClose} leaveOn=".tabbar-row, .sidebar" onLeave={onLeave} />))
  return { onClose, onLeave }
}
const press = (key: string) => act(() => void (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
const shown = () => [...el.querySelectorAll('.card__hidden')].map((s) => s.textContent)
const sides = () => el.querySelectorAll('.card__side').length

describe('Preview a card (YAZ-5152)', () => {
  it('YAZ-5430: To fix never shows: no "To fix" on the head, no Fix later', () => {
    mount()
    expect(el.querySelector('.card__fix')).toBeNull()
    expect(el.textContent).not.toMatch(/To fix|Fix later/)
  })

  it('is the Inbox\'s card: the front with its hidden word, Space through the words and the sides, "Side n of 2", the Reviews strip from the last side; no answer buttons', () => {
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
  })

  it('YAZ-5152 A: a quiet "Preview" bar on top: "Preview · <the card> · nothing is saved", and Close (Esc), which closes and gives the keyboard back', () => {
    const editor = document.createElement('div')
    editor.tabIndex = -1
    document.body.append(editor)
    editor.focus()
    const { onClose } = mount(TEXT, 'Capital of France')
    const bar = el.querySelector('.card-preview__bar')!
    expect(bar.querySelector('.card-preview__label')?.textContent).toBe('Preview')
    expect(bar.querySelector('.card-preview__what')?.textContent).toBe('· Capital of France · nothing is saved')
    const close = bar.querySelector<HTMLButtonElement>('.card-preview__close')!
    expect(close.textContent).toBe('Close (Esc)')
    act(() => close.click())
    expect(onClose).toHaveBeenCalledOnce()
    act(() => root?.unmount())
    root = null
    expect(document.activeElement).toBe(editor)
    editor.remove()
  })

  it('YAZ-5695: a title hidden in review is the Inbox\'s: no title at any step, fully shown too (Title room Always, YAZ-5880: an empty band; Only when it shows: none); the bar names the card by its ID', () => {
    mount(TEXT, 'Secret title', true)
    const band = () => el.querySelector('.card-inbox__panel > .card-band')
    expect([band()?.textContent, band()?.getAttribute('aria-hidden')]).toEqual(['', 'true'])
    press(' ')
    expect(band()?.textContent).toBe('')
    press(' ')
    expect(sides()).toBe(2)
    press(' ')
    expect(band()?.textContent).toBe('')
    act(() => root?.unmount())
    el.remove()
    mount(TEXT, 'Secret title', true, undefined, { ...DEFAULT_REVIEW_SETTINGS, titleRoom: 'shown' })
    expect(band()).toBeNull()
    press(' ')
    press(' ')
    press(' ')
    expect(band()).toBeNull()
    expect(el.querySelector('.card-preview__what')?.textContent).toBe('· WIKI-9 · nothing is saved')
    expect(el.textContent).not.toContain('Secret title')
  })

  it('YAZ-5696, YAZ-5709, YAZ-5857: the Preview follows "when the title shows": no band while the title waits; the global choice, and the card\'s own over it', () => {
    const band = () => el.querySelector('.card-inbox__panel > .card-band')
    mount(TEXT, 'Secret title', false, undefined, { ...DEFAULT_REVIEW_SETTINGS, titleAt: 'side2', titleRoom: 'shown' })
    expect(band()).toBeNull()
    press(' ')
    expect(band()).toBeNull()
    // YAZ-5709 Before Side 2: the title is its own Space, just before Side 2.
    press(' ')
    expect(sides()).toBe(1)
    expect(band()).not.toBeNull()
    expect(band()?.textContent).toBe('Secret title')
    press(' ')
    expect(sides()).toBe(2)
    act(() => root?.unmount())
    el.remove()
    mount(TEXT, 'Secret title', false, 'click', { ...DEFAULT_REVIEW_SETTINGS, titleRoom: 'shown' })
    expect(band()).toBeNull()
    // YAZ-5709 After the first click: the first Space is the title, by itself.
    press(' ')
    expect(band()).not.toBeNull()
    expect(el.querySelectorAll('.card__hidden').length).toBe(0)
  })

  it('YAZ-5880: Title room Always (the default): the band is there while the title waits, its title unseen and unread, and fades in when it shows', () => {
    const band = () => el.querySelector('.card-inbox__panel > .card-band')
    mount(TEXT, 'Secret title', false, 'click')
    expect([band()?.className, band()?.getAttribute('aria-hidden'), band()?.textContent]).toEqual(['card-band card-band--waiting', 'true', 'Secret title'])
    // YAZ-5995 (D4 4B): while Title is the next step, the title blank wears `data-next` and body blanks wear none.
    expect(band()?.hasAttribute('data-next')).toBe(true)
    expect(band()?.querySelector('.card-band__blank')?.hasAttribute('data-next')).toBe(true)
    expect(el.querySelectorAll('.card__blank[data-next]')).toHaveLength(0)
    press(' ')
    expect([band()?.className, band()?.getAttribute('aria-hidden'), band()?.textContent]).toEqual(['card-band card-band--fade', null, 'Secret title'])
    expect(band()?.hasAttribute('data-next')).toBe(false)
    expect(el.querySelectorAll('.card__blank[data-next]')).toHaveLength(1)
  })

  it('YAZ-5995: clicking the highlighted waiting title blank reveals the title; Before Side 2 shows grey waiting blank until Title is next', () => {
    const band = () => el.querySelector<HTMLElement>('.card-inbox__panel > .card-band')
    mount(TEXT, 'Secret title', false, 'click')
    act(() => band()!.querySelector<HTMLElement>('.card-band__blank')!.click())
    expect(band()?.className).toBe('card-band card-band--fade')
    expect(el.querySelectorAll('.card__blank[data-next]')).toHaveLength(1)
    act(() => root?.unmount())
    el.remove()

    mount(TEXT, 'Secret title', false, 'side2')
    // Front word comes first: title blank waits (grey, no data-next), body blank 0 has data-next.
    expect(band()?.querySelector('.card-band__blank')).not.toBeNull()
    expect(band()?.hasAttribute('data-next')).toBe(false)
    expect(band()?.querySelector('.card-band__blank')?.hasAttribute('data-next')).toBe(false)
    expect(el.querySelectorAll('.card__blank[data-next]')).toHaveLength(1)
    // Clicking the grey waiting title blank before its turn does nothing.
    act(() => band()!.querySelector<HTMLElement>('.card-band__blank')!.click())
    expect(band()?.className).toBe('card-band card-band--waiting')
    // Reveal Side 1's word -> now Title is next!
    press(' ')
    expect(band()?.hasAttribute('data-next')).toBe(true)
    expect(band()?.querySelector('.card-band__blank')?.hasAttribute('data-next')).toBe(true)
    expect(el.querySelectorAll('.card__blank[data-next]')).toHaveLength(0)
    // Clicking reveals the title directly.
    act(() => band()!.querySelector<HTMLElement>('.card-band__blank')!.click())
    expect(band()?.className).toBe('card-band card-band--fade')
  })

  it('YAZ-5152 A: no title: the bar names the card by its ID', () => {
    mount()
    expect(el.querySelector('.card-preview__what')?.textContent).toBe('· WIKI-9 · nothing is saved')
  })

  it('YAZ-5152 A: ONE click on a tab or in the sidebar leaves the preview and the click still does its job; the keyboard is not pulled back under it', () => {
    const editor = document.createElement('div')
    editor.tabIndex = -1
    document.body.append(editor)
    editor.focus()
    const row = document.createElement('div')
    row.className = 'tabbar-row'
    const tab = document.createElement('button')
    const tabClick = vi.fn(() => tab.focus())
    tab.addEventListener('click', tabClick)
    row.append(tab)
    const side = document.createElement('aside')
    side.className = 'sidebar'
    const sideRow = document.createElement('button')
    side.append(sideRow)
    document.body.append(row, side)
    const { onClose, onLeave } = mount()
    // A press inside the preview is the preview's own.
    act(() => void el.querySelector('.card-inbox__card')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(onLeave).not.toHaveBeenCalled()
    act(() => void tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })))
    expect(onLeave).toHaveBeenCalledOnce()
    act(() => tab.click())
    expect(tabClick).toHaveBeenCalledOnce()
    act(() => root?.unmount())
    root = null
    expect(document.activeElement).toBe(tab)
    expect(onClose).not.toHaveBeenCalled()
    // The sidebar, the same.
    const second = mount()
    act(() => void sideRow.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })))
    expect(second.onLeave).toHaveBeenCalledOnce()
    row.remove()
    side.remove()
    editor.remove()
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

  it('YAZ-6598: Preview honors settings.spaceBehavior (scroll step-scrolls and chains rapid Space; jump skips directly to blank)', () => {
    const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 800, width: 800, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
    let blankTop = 1000
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('card-inbox')) return box(0, 600)
      if (this.dataset.hidden === '0') return box(blankTop, blankTop + 20)
      return box(150, 170)
    })
    try {
      // Default ('scroll'): Space walks down in ~35% viewport steps (210px) and chains rapid presses without stalling.
      mount(TEXT, '', false, undefined, { ...DEFAULT_REVIEW_SETTINGS, spaceBehavior: 'scroll' })
      const scrollView = el.querySelector<HTMLElement>('.card-inbox')!
      const scrollTo = vi.fn()
      scrollView.scrollTo = scrollTo as never
      Object.defineProperty(scrollView, 'clientHeight', { value: 600, configurable: true })
      Object.defineProperty(scrollView, 'scrollHeight', { value: 2600, configurable: true })
      scrollView.scrollTop = 0

      press(' ')
      expect(shown()).toEqual([])
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 210, behavior: 'smooth' })
      // Second rapid Space while scrollTop is still 0 chains to 420.
      press(' ')
      expect(shown()).toEqual([])
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 420, behavior: 'smooth' })

      act(() => root?.unmount())
      root = null
      el.remove()

      // 'jump': Space jumps straight to put the blank at 1/3 down (200px -> delta 800px).
      blankTop = 1000
      mount(TEXT, '', false, undefined, { ...DEFAULT_REVIEW_SETTINGS, spaceBehavior: 'jump' })
      const jumpView = el.querySelector<HTMLElement>('.card-inbox')!
      const jumpScrollTo = vi.fn()
      jumpView.scrollTo = jumpScrollTo as never
      Object.defineProperty(jumpView, 'clientHeight', { value: 600, configurable: true })
      Object.defineProperty(jumpView, 'scrollHeight', { value: 2600, configurable: true })
      jumpView.scrollTop = 0

      press(' ')
      expect(shown()).toEqual([])
      expect(jumpScrollTo).toHaveBeenCalledExactlyOnceWith({ top: 800, behavior: 'smooth' })
    } finally {
      spy.mockRestore()
    }
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
