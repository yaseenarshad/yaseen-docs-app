/**
 * Settings › Link pills (YAZ-4924): the group in Files & Links with a vault open, its rows writing one field each
 * through the vault's `save`, the live preview, Plain and Reset. Nothing of it without a vault.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type IdsState } from '@shared/types'
import { NO_LINK_PILLS, type LinkPills } from '@shared/linkPills'
import { SettingsDialog } from './SettingsDialog'
import type { SettingsCtx } from './registry'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(pills: LinkPills | undefined, ids = false) {
  const save = vi.fn()
  const ctx: SettingsCtx = { settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), linkPills: pills === undefined ? undefined : { pills, save }, textFormatting: { vaults: [{ root: '/v', name: 'Mine', state: { formatting: {}, save: vi.fn() } }], activeRoot: '/v' } }
  if (ids) ctx.ids = { enabled: true, held: true, ask: undefined, set: vi.fn(), check: vi.fn(async () => ''), old: 0, unfinished: false, state: () => new Promise<IdsState>(() => undefined), reletter: vi.fn(), backfill: vi.fn() }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<SettingsDialog ctx={ctx} onClose={vi.fn()} initialPage="files" />))
  return { el: container, save }
}

const row = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`)
const button = (el: ParentNode, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label) as HTMLButtonElement
const click = (b: HTMLButtonElement) => act(() => b.click())

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('Settings › Link pills (YAZ-4924)', () => {
  it('is there with a vault open, every row on today\'s choice; ID only in an ID vault; nothing without a vault', () => {
    const { el } = mount(NO_LINK_PILLS)
    for (const id of ['linkPills', 'linkPillBackground', 'linkPillTextColour', 'linkPillIcon', 'linkPillStyle', 'linkPillBeforeAfter', 'linkPillVault', 'linkPillFolder', 'linkPillShape']) expect(row(el, id), id).not.toBeNull()
    expect(row(el, 'linkPillId')).toBeNull()
    const pressed = [...el.querySelectorAll<HTMLButtonElement>('[data-setting^="linkPill"] .settings__option--active')].map((b) => b.textContent)
    expect(pressed).toEqual(['Accent', 'Accent', 'Show', 'Other vaults only', 'After', 'Off', 'Pill'])
    expect(row(el, 'linkPills')?.querySelector('button[aria-pressed="true"]')).toBeNull() // Plain is off
    expect(button(row(el, 'linkPills') as HTMLElement, 'Reset')).toBeUndefined()
    // The preview: four pills, the one into another vault named, the missing one dim.
    const preview = el.querySelector('.link-pills-preview') as HTMLElement
    expect([...preview.querySelectorAll('.wikilink')].map((p) => [p.textContent, p.classList.contains('wikilink--unresolved')])).toEqual([['Roadmap', false], ['Q3 plan', false], ['Budget (Wiki)', false], ['Old plan', true]])
    expect(row(mount(NO_LINK_PILLS, true).el, 'linkPillId')).not.toBeNull()
    expect(row(mount(undefined).el, 'linkPills')).toBeNull()
  })

  it('each row writes one field through save, a default field dropped; Colour starts on blue with the swatches and the strength', () => {
    const { el, save } = mount(NO_LINK_PILLS, true)
    click(button(row(el, 'linkPillBackground') as HTMLElement, 'None'))
    expect(save).toHaveBeenLastCalledWith({ background: 'none' })
    click(button(row(el, 'linkPillBackground') as HTMLElement, 'Colour'))
    expect(save).toHaveBeenLastCalledWith({ background: 'blue' })
    click(button(row(el, 'linkPillTextColour') as HTMLElement, 'Same as text'))
    expect(save).toHaveBeenLastCalledWith({ text: 'same' })
    click(button(row(el, 'linkPillIcon') as HTMLElement, 'Hide'))
    expect(save).toHaveBeenLastCalledWith({ icon: 'hide' })
    click(button(row(el, 'linkPillStyle') as HTMLElement, 'Bold'))
    expect(save).toHaveBeenLastCalledWith({ bold: true })
    click(button(row(el, 'linkPillBeforeAfter') as HTMLElement, 'Quick pick ( )'))
    expect(save).toHaveBeenLastCalledWith({ before: '(', after: ')' })
    click(button(row(el, 'linkPillVault') as HTMLElement, 'Always'))
    expect(save).toHaveBeenLastCalledWith({ vault: 'always' })
    click(button(row(el, 'linkPillVault') as HTMLElement, 'Before'))
    expect(save).toHaveBeenLastCalledWith({ vaultPlace: 'before' })
    click(button(row(el, 'linkPillId') as HTMLElement, 'Show'))
    expect(save).toHaveBeenLastCalledWith({ id: 'show' })
    click(button(row(el, 'linkPillFolder') as HTMLElement, 'Full path'))
    expect(save).toHaveBeenLastCalledWith({ folder: 'full' })
    click(button(row(el, 'linkPillShape') as HTMLElement, 'Underline only'))
    expect(save).toHaveBeenLastCalledWith({ shape: 'underline' })
  })

  it('a colour background shows its swatches and strength; a pick of a swatch or a strength keeps the colour; Medium drops the strength', () => {
    const { el, save } = mount({ background: 'red', strength: 'light' })
    const bg = row(el, 'linkPillBackground') as HTMLElement
    expect(bg.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('title')).toBe('Red')
    expect(bg.querySelector('.settings__option--active')?.textContent).toBe('Colour')
    click(bg.querySelector('[role="radio"][title="Teal"]') as HTMLButtonElement)
    expect(save).toHaveBeenLastCalledWith({ background: 'teal', strength: 'light' })
    click(button(bg, 'Medium'))
    expect(save).toHaveBeenLastCalledWith({ background: 'red' })
    click(button(bg, 'Accent'))
    expect(save).toHaveBeenLastCalledWith({})
  })

  it('Plain strips the background, the colour and the icon and keeps the rest; pressed again it brings those three back; Reset saves today', () => {
    const { el, save } = mount({ bold: true, before: '(' })
    const top = row(el, 'linkPills') as HTMLElement
    click(button(top, 'Plain'))
    expect(save).toHaveBeenLastCalledWith({ background: 'none', text: 'same', icon: 'hide', bold: true, before: '(' })
    click(button(top, 'Reset'))
    expect(save).toHaveBeenLastCalledWith({})
    const plain = mount({ background: 'none', text: 'same', icon: 'hide', after: ')' })
    const plainButton = button(row(plain.el, 'linkPills') as HTMLElement, 'Plain')
    expect(plainButton.getAttribute('aria-pressed')).toBe('true')
    click(plainButton)
    expect(plain.save).toHaveBeenLastCalledWith({ after: ')' })
  })

  it('the preview wears the look: the variables on it, the pieces on each pill, the ID in an ID vault', () => {
    const { el } = mount({ background: 'none', before: '[', after: ']', vault: 'always', vaultPlace: 'before', id: 'show', folder: 'parent' }, true)
    const preview = el.querySelector('.link-pills-preview') as HTMLElement
    expect(preview.style.getPropertyValue('--pill-bg')).toBe('transparent')
    expect([...preview.querySelectorAll('.wikilink')].map((p) => p.textContent)).toEqual(['[Mine › RoadmapYAS-12Plans]', '[Mine › Q3 planBoards]', '[Wiki › Budget]', '[Mine › Old plan]'])
  })

  it('Before and After take up to 8 characters, kept on Enter or blur; an empty field is today', async () => {
    const { el, save } = mount({ after: ')' })
    const before = row(el, 'linkPillBeforeAfter')?.querySelector<HTMLInputElement>('input[aria-label="Text before a link pill"]') as HTMLInputElement
    expect(before.maxLength).toBe(8)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(before, '→ ')
      before.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void before.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(save).toHaveBeenLastCalledWith({ before: '→ ', after: ')' })
    const after = row(el, 'linkPillBeforeAfter')?.querySelector<HTMLInputElement>('input[aria-label="Text after a link pill"]') as HTMLInputElement
    act(() => {
      setter?.call(after, '')
      after.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void after.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(save).toHaveBeenLastCalledWith({})
  })
})
