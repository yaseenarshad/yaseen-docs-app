/**
 * Settings › Appearance › Menus › Menu icons (YAZ-6571):
 * Master On/Off toggle (preserving custom picks across Off → On), collapsible Customize icons
 * 5-row picker, per-action Off, live mini context menu preview, and Reset to defaults.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MENU_ICON_ACTIONS, type MenuIconsSetting } from '@shared/menuIcons'
import { MENU_ICON_CHOICES } from '../views/view/menuIconShapes'
import { MenuIconsControl } from './MenuIconsControl'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let el: HTMLElement

afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

function mount(initial: MenuIconsSetting = 'on') {
  const onChange = vi.fn()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  const render = (next: MenuIconsSetting) => act(() => root!.render(<MenuIconsControl value={next} onChange={onChange} />))
  render(initial)
  return { onChange, render }
}

const masterButtons = () => [...el.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Menu icons"] button')]
const masterButton = (text: 'On' | 'Off') => masterButtons().find((b) => b.textContent === text)!
const disclosureButton = () => el.querySelector<HTMLButtonElement>('.menu-icons-control__disclosure')
const resetButton = () => el.querySelector<HTMLButtonElement>('.menu-icons-control__reset')
const panel = () => el.querySelector<HTMLElement>('.menu-icons-control__panel')
const tile = (action: string, variant: string) =>
  el.querySelector<HTMLButtonElement>(`[data-menu-icon-action="${action}"] button[data-variant="${variant}"]`)!
const previewMenu = () => el.querySelector<HTMLElement>('[data-preview="menu-icons"]')
const previewItem = (action: string) => el.querySelector<HTMLElement>(`[data-preview-action="${action}"]`)

describe('MenuIconsControl (YAZ-6571)', () => {
  it('renders On by default with Customize icons collapsed and no panel or Reset button', () => {
    mount('on')

    expect(masterButtons().map((b) => b.textContent)).toEqual(['On', 'Off'])
    expect(masterButton('On').getAttribute('aria-pressed')).toBe('true')
    expect(masterButton('Off').getAttribute('aria-pressed')).toBe('false')
    expect(masterButton('On').className).toContain('settings__option--active')

    const toggle = disclosureButton()
    expect(toggle).not.toBeNull()
    expect(toggle!.textContent).toBe('Customize icons')
    expect(toggle!.getAttribute('aria-expanded')).toBe('false')
    expect(panel()).toBeNull()
    expect(resetButton()).toBeNull()
  })

  it('toggles Off and hides the disclosure button; toggling back On restores custom picks', () => {
    const custom: MenuIconsSetting = { newWindow: 'win-plus', hideOthers: 'funnel' }
    const { onChange, render } = mount(custom)

    // Toggle Off.
    act(() => masterButton('Off').click())
    expect(onChange).toHaveBeenLastCalledWith('off')
    render('off')

    expect(masterButton('On').getAttribute('aria-pressed')).toBe('false')
    expect(masterButton('Off').getAttribute('aria-pressed')).toBe('true')
    expect(disclosureButton()).toBeNull()
    expect(panel()).toBeNull()

    // Clicking Off again is a no-op.
    act(() => masterButton('Off').click())
    expect(onChange).toHaveBeenCalledTimes(1)

    // Toggle back On: restores the remembered custom picks.
    act(() => masterButton('On').click())
    expect(onChange).toHaveBeenLastCalledWith(custom)
    render(custom)
    expect(masterButton('On').getAttribute('aria-pressed')).toBe('true')
    expect(disclosureButton()).not.toBeNull()
  })

  it('expands Customize icons into 5 action rows with SVG tiles + Off and the live preview menu', () => {
    mount('on')

    act(() => disclosureButton()!.click())
    expect(disclosureButton()!.textContent).toBe('Hide icon choices')
    expect(disclosureButton()!.getAttribute('aria-expanded')).toBe('true')
    expect(panel()).not.toBeNull()

    // 5 rows in order with exact labels.
    const rowLabels = [...el.querySelectorAll('.menu-icons-control__row-label')].map((n) => n.textContent)
    expect(rowLabels).toEqual(['New window', 'Duplicate tab', 'Open in new tab', 'Hide all others', 'Show in sidebar'])

    // Every action renders all choices from MENU_ICON_CHOICES (3 SVG glyphs + Off).
    for (const action of MENU_ICON_ACTIONS) {
      const choices = MENU_ICON_CHOICES[action]
      const tiles = [...el.querySelectorAll<HTMLButtonElement>(`[data-menu-icon-action="${action}"] .menu-icons-control__tile`)]
      expect(tiles.map((t) => t.dataset.variant)).toEqual(choices.map((c) => c.id))
      expect(tiles[0].getAttribute('aria-pressed')).toBe('true')
      for (const c of choices) {
        const btn = tile(action, c.id)
        expect(btn.title).toBe(c.label)
        if (c.shapes !== null) {
          expect(btn.querySelector('svg')).not.toBeNull()
        } else {
          expect(btn.querySelector('svg')).toBeNull()
          expect(btn.textContent).toBe('Off')
        }
      }
    }

    // Default state has no Reset to defaults button.
    expect(resetButton()).toBeNull()

    // Live preview renders all sample rows and dividers with default glyphs.
    const preview = previewMenu()!
    expect(preview).not.toBeNull()
    expect(preview.dataset.hasIcons).toBe('true')
    const previewLabels = [...preview.querySelectorAll('.menu-icons-preview__text')].map((n) => n.textContent)
    expect(previewLabels).toEqual([
      'Open in new tab',
      'Move to new window',
      'Duplicate tab',
      'Show in sidebar',
      'Copy path',
      'Add to focus',
      'Hide all others',
    ])
    expect(preview.querySelectorAll('.menu-icons-preview__divider')).toHaveLength(2)
    expect(previewItem('newWindow')?.querySelector('svg')).not.toBeNull()

    // Collapsing again closes the panel.
    act(() => disclosureButton()!.click())
    expect(disclosureButton()!.getAttribute('aria-expanded')).toBe('false')
    expect(panel()).toBeNull()
  })

  it('picks custom variants and per-action Off, updates live preview, and drops gutter when all icons are Off', () => {
    const { onChange, render } = mount('on')
    act(() => disclosureButton()!.click())

    // Pick Window + for New window.
    act(() => tile('newWindow', 'win-plus').click())
    expect(onChange).toHaveBeenLastCalledWith({ newWindow: 'win-plus' })
    render({ newWindow: 'win-plus' })

    expect(tile('newWindow', 'win-plus').getAttribute('aria-pressed')).toBe('true')
    expect(tile('newWindow', 'box-arrow').getAttribute('aria-pressed')).toBe('false')
    expect(previewItem('newWindow')?.dataset.previewVariant).toBe('win-plus')
    expect(previewItem('newWindow')?.querySelector('svg')).not.toBeNull()
    expect(resetButton()).not.toBeNull()

    // Pick per-action Off ('none') for Show in sidebar.
    act(() => tile('showInSidebar', 'none').click())
    expect(onChange).toHaveBeenLastCalledWith({ newWindow: 'win-plus', showInSidebar: 'none' })
    render({ newWindow: 'win-plus', showInSidebar: 'none' })

    expect(tile('showInSidebar', 'none').getAttribute('aria-pressed')).toBe('true')
    expect(previewItem('showInSidebar')?.querySelector('svg')).toBeNull()
    // Other icons are still active, so the preview keeps its alignment gutter.
    expect(previewMenu()!.dataset.hasIcons).toBe('true')
    expect(previewItem('showInSidebar')?.querySelector('.menu-icons-preview__slot')).not.toBeNull()

    // Turn every single action to 'none': preview renders clean text with no empty gutter.
    const allNone: MenuIconsSetting = {
      newWindow: 'none',
      duplicateTab: 'none',
      openNewTab: 'none',
      hideOthers: 'none',
      showInSidebar: 'none',
    }
    render(allNone)
    expect(previewMenu()!.dataset.hasIcons).toBe('false')
    expect(previewMenu()!.querySelectorAll('.menu-icons-preview__slot')).toHaveLength(0)
    expect(previewMenu()!.querySelectorAll('svg')).toHaveLength(0)
  })

  it('Reset to defaults restores "on" and hides the Reset button', () => {
    const custom: MenuIconsSetting = { duplicateTab: 'two-tabs', openNewTab: 'raised-tab' }
    const { onChange, render } = mount(custom)
    act(() => disclosureButton()!.click())

    const btn = resetButton()
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toBe('Reset to defaults')

    act(() => btn!.click())
    expect(onChange).toHaveBeenLastCalledWith('on')
    render('on')

    expect(resetButton()).toBeNull()
    expect(tile('duplicateTab', 'clone-plus').getAttribute('aria-pressed')).toBe('true')
    expect(tile('openNewTab', 'tab-bar-plus').getAttribute('aria-pressed')).toBe('true')

    // After resetting, toggling Off -> On stays at 'on' (not the old custom picks).
    act(() => masterButton('Off').click())
    render('off')
    act(() => masterButton('On').click())
    expect(onChange).toHaveBeenLastCalledWith('on')
  })
})
