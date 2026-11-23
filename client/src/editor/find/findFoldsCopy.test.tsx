/**
 * The fold menu's words (YAZ-5970): they name folded card sides only while the vault's cards are on; a card page's menu
 * says the choice is the card page's. Settings › Editor › Find says the same.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { DEFAULT_SETTINGS } from '@shared/types'
import { createFindChannel } from './findChannel'
import { FindBar, type FindBarProps } from './FindBar'
import { SettingsDialog } from '../../settings/SettingsDialog'
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})
const render = (node: React.ReactNode) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(node))
  return container
}

function Bar({ folds }: { folds: FindBarProps['folds'] }) {
  const host = useRef<HTMLDivElement>(null)
  const channel = useRef(createFindChannel()).current
  if (!channel.getState().open) channel.open()
  return (
    <div ref={host}>
      <FindBar channel={channel} scope="page" hostRef={host} folds={folds} />
    </div>
  )
}

const menuWords = (el: HTMLElement) => {
  act(() => el.querySelector<HTMLButtonElement>('.find-bar__btn--folds')?.click())
  const menu = el.querySelector('.find-folds') as HTMLElement
  return { head: menu.querySelector('.find-folds__head')?.textContent, hints: [...menu.querySelectorAll('.find-folds__hint')].map((h) => h.textContent), foot: menu.querySelector('.find-folds__foot')?.textContent, button: el.querySelector('.find-bar__btn--folds')?.getAttribute('aria-label') }
}

describe('the fold menu`s words', () => {
  it('cards off: today`s words', () => {
    const el = render(<Bar folds={{ own: null, app: 'current', onChange: vi.fn() }} />)
    const words = menuWords(el)
    expect(words.head).toBe('Folded bullets while finding')
    expect(words.button).toBe('Folded bullets')
    expect(words.hints.join(' ')).not.toMatch(/card/i)
    expect(words.foot).toMatch(/^For this page\./)
  })

  it('cards on, on a card page: folded card sides are named, and the choice is the card page`s', () => {
    const el = render(<Bar folds={{ own: null, app: 'current', onChange: vi.fn(), cards: true, cardPage: true }} />)
    const words = menuWords(el)
    expect(words.head).toBe('Folded bullets and card sides while finding')
    expect(words.button).toBe('Folded bullets and card sides')
    expect(words.hints).toContain('Every folded bullet or card side that holds a match opens.')
    expect(words.hints).toContain('Finds only what shows. Text in folded bullets or card sides does not count.')
    expect(words.foot).toBe('For this card page. The default is in Settings › Editor › Find.')
  })
})

describe('Settings › Editor › Find', () => {
  const row = (review: boolean) => {
    const el = render(<SettingsDialog ctx={{ settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), review: { settings: { ...DEFAULT_REVIEW_SETTINGS, enabled: review }, save: vi.fn() } }} onClose={vi.fn()} />)
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Editor')?.click())
    const r = el.querySelector('[data-setting="findFolds"]') as HTMLElement
    const words = [r.querySelector('.setting__label')?.textContent, r.querySelector('.setting__hint')?.textContent]
    act(() => root?.unmount())
    root = null
    return words
  }
  it('names card sides only with the vault`s cards on', () => {
    expect(row(false)).toEqual(['Folded bullets', 'Keep folded finds only the text that shows.'])
    expect(row(true)).toEqual(['Folded bullets and card sides', 'Folded card sides follow the same choice. Keep folded finds only the text that shows.'])
  })
})
