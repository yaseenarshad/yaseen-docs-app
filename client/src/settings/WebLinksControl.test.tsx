/**
 * Settings › Links & IDs › Web links (YAZ-6584):
 * Tests presets, B/I/U underline toggle, text colour + custom hex, box shape/fill/strength,
 * mark place/icon/custom emoji/colour/size, hover modes/colour/strength, Reset, Show hover,
 * live preview CSS vars, and SettingsDialog / scope integration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  DEFAULT_WEB_LINKS,
  WEB_LINK_CUSTOM_MAX,
  WEB_LINK_MARKS,
  WEB_LINK_PRESETS,
  type WebLinksStyle,
} from '@shared/webLinks'
import { DEFAULT_SETTINGS } from '@shared/types'
import { NO_LINK_PILLS } from '@shared/linkPills'
import { cardSurfaceStyleOf } from '../review/cardLook'
import { WebLinksControl } from './WebLinksControl'
import { SettingsDialog } from './SettingsDialog'
import type { SettingsCtx } from './registry'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mountControl(initial: WebLinksStyle = DEFAULT_WEB_LINKS) {
  const onChange = vi.fn()
  let latest: WebLinksStyle = initial
  function Harness() {
    const [val, setVal] = useState<WebLinksStyle>(initial)
    return (
      <WebLinksControl
        value={val}
        onChange={(next) => {
          latest = next
          onChange(next)
          setVal(next)
        }}
      />
    )
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Harness />))
  return { el: container, onChange, getValue: () => latest }
}

const click = (el: Element | null) => {
  expect(el).not.toBeNull()
  act(() => (el as HTMLElement).click())
}
const btnByLabel = (rootEl: ParentNode, label: string) =>
  [...rootEl.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  ) ?? null
const sectionRow = (rootEl: ParentNode, groupAria: string) =>
  rootEl.querySelector<HTMLElement>(`[aria-label="${groupAria}"]`)
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
const typeInput = (input: HTMLInputElement, value: string) =>
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('WebLinksControl (YAZ-6584)', () => {
  it('renders ready presets, live preview with sample links, Show hover toggle, and hides Reset on default', () => {
    const { el } = mountControl(DEFAULT_WEB_LINKS)
    const presetButtons = [...el.querySelectorAll<HTMLButtonElement>('.web-links-presets button')]
    expect(presetButtons.map((b) => b.textContent)).toEqual(WEB_LINK_PRESETS.map((p) => p.label))
    expect(presetButtons[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(btnByLabel(el, 'Reset')).toBeNull()

    const preview = el.querySelector<HTMLElement>('.web-links-preview')!
    expect(preview).not.toBeNull()
    expect(preview.querySelector('u')?.textContent).toBe('Docs:')
    expect([...preview.querySelectorAll('.web-links-preview__link')].map((a) => a.textContent)).toEqual([
      'Kubernetes',
      'CNCF',
    ])

    const showHover = preview.querySelector<HTMLButtonElement>('.link-pills-preview__hover-toggle')!
    expect(showHover.getAttribute('aria-pressed')).toBe('false')
    expect(preview.classList.contains('web-links-preview--hover')).toBe(false)
    click(showHover)
    expect(showHover.getAttribute('aria-pressed')).toBe('true')
    expect(preview.classList.contains('web-links-preview--hover')).toBe(true)
    click(showHover)
    expect(preview.classList.contains('web-links-preview--hover')).toBe(false)
  })

  it('applies each preset cleanly and Reset restores Classic underline', () => {
    const { el, onChange } = mountControl(DEFAULT_WEB_LINKS)
    click(btnByLabel(el, 'Clean + arrow ↗'))
    expect(onChange).toHaveBeenLastCalledWith({
      underline: false,
      mark: { place: 'after', color: 'muted' },
      hover: { style: 'underline' },
    })
    const preview = el.querySelector<HTMLElement>('.web-links-preview')!
    expect(preview.style.getPropertyValue('--ext-link-decoration')).toBe('none')
    expect(preview.style.getPropertyValue('--ext-link-mark-place')).toBe('after')
    expect(preview.style.getPropertyValue('--ext-link-mark-kind')).toBe('svg')
    expect(preview.style.getPropertyValue('--ext-link-hover-mode')).toBe('underline')

    click(btnByLabel(el, 'Custom emoji 🔗'))
    expect(onChange).toHaveBeenLastCalledWith({
      underline: false,
      mark: { place: 'after', custom: '🔗' },
    })
    expect(preview.style.getPropertyValue('--ext-link-mark-kind')).toBe('text')
    expect(preview.style.getPropertyValue('--ext-link-mark-text')).toBe('"🔗"')

    const reset = btnByLabel(el, 'Reset')
    expect(reset).not.toBeNull()
    click(reset)
    expect(onChange).toHaveBeenLastCalledWith({})
    expect(btnByLabel(el, 'Reset')).toBeNull()
  })

  it('toggles B, I, U (U pressed by default, turns underline off/on) and edits text colour + custom hex', () => {
    const { el, onChange } = mountControl(DEFAULT_WEB_LINKS)
    const uBtn = btnByLabel(el, 'Underline')!
    expect(uBtn.getAttribute('aria-pressed')).toBe('true')

    click(uBtn)
    expect(onChange).toHaveBeenLastCalledWith({ underline: false })
    expect(uBtn.getAttribute('aria-pressed')).toBe('false')

    click(btnByLabel(el, 'Bold'))
    click(btnByLabel(el, 'Italic'))
    expect(onChange).toHaveBeenLastCalledWith({ bold: true, italic: true, underline: false })

    // Turn underline back on -> drops `underline: false`
    click(uBtn)
    expect(onChange).toHaveBeenLastCalledWith({ bold: true, italic: true })
    expect(uBtn.getAttribute('aria-pressed')).toBe('true')

    const textColourGroup = sectionRow(el, 'Text colour')!
    click(btnByLabel(textColourGroup, 'Same as text'))
    expect(onChange).toHaveBeenLastCalledWith({ bold: true, italic: true, color: 'same' })
    click(textColourGroup.querySelector('[role="radio"][title="Teal"]'))
    expect(onChange).toHaveBeenLastCalledWith({ bold: true, italic: true, color: 'teal' })

    // Custom hex via shared ColourBox
    const customBtn = textColourGroup.querySelector<HTMLButtonElement>('.pill-toolbar__custom')!
    click(customBtn)
    const rgbFields = [...textColourGroup.querySelectorAll<HTMLInputElement>('.colour-box__rgb input')]
    act(() => {
      ;['17', '34', '51'].forEach((v, i) => {
        setter?.call(rgbFields[i], v)
        rgbFields[i].dispatchEvent(new Event('input', { bubbles: true }))
      })
      rgbFields[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith({ bold: true, italic: true, color: '#112233' })
    expect(el.querySelector<HTMLElement>('.web-links-preview')!.style.getPropertyValue('--ext-link-fg')).toBe('#112233')
  })

  it('configures Box shape (None / Round / Square), Fill (Tint / None / palette), and Strength (palette/custom only)', () => {
    const { el, onChange } = mountControl(DEFAULT_WEB_LINKS)
    expect(sectionRow(el, 'Box fill')).toBeNull()
    expect(sectionRow(el, 'Box fill strength')).toBeNull()

    const boxShapeGroup = sectionRow(el, 'Box shape')!
    click(btnByLabel(boxShapeGroup, 'Round'))
    expect(onChange).toHaveBeenLastCalledWith({ box: { shape: 'round' } })
    expect(sectionRow(el, 'Box fill')).not.toBeNull()
    expect(sectionRow(el, 'Box fill strength')).toBeNull()

    const boxFillGroup = sectionRow(el, 'Box fill')!
    click(boxFillGroup.querySelector('[role="radio"][title="Blue"]'))
    expect(onChange).toHaveBeenLastCalledWith({ box: { shape: 'round', fill: 'blue' } })
    expect(sectionRow(el, 'Box fill strength')).not.toBeNull()

    click(btnByLabel(sectionRow(el, 'Box fill strength')!, 'Strong'))
    expect(onChange).toHaveBeenLastCalledWith({ box: { shape: 'round', fill: 'blue', strength: 'strong' } })

    click(btnByLabel(boxShapeGroup, 'Square'))
    expect(onChange).toHaveBeenLastCalledWith({ box: { shape: 'square', fill: 'blue', strength: 'strong' } })

    click(btnByLabel(boxFillGroup, 'No fill'))
    expect(onChange).toHaveBeenLastCalledWith({ box: { shape: 'square', fill: 'none' } })
    expect(sectionRow(el, 'Box fill strength')).toBeNull()

    click(btnByLabel(boxShapeGroup, 'None'))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('configures Mark position, all 9 SVG icons including Globe, custom emoji input, colour, and size', () => {
    const { el, onChange } = mountControl(DEFAULT_WEB_LINKS)
    expect(sectionRow(el, 'Mark icon')).toBeNull()

    const placeGroup = sectionRow(el, 'Mark position')!
    click(btnByLabel(placeGroup, 'After text'))
    expect(onChange).toHaveBeenLastCalledWith({ mark: { place: 'after' } })

    const iconGroup = sectionRow(el, 'Mark icon')!
    const iconButtons = [...iconGroup.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    expect(iconButtons).toHaveLength(WEB_LINK_MARKS.length)
    expect(iconButtons.map((b) => b.getAttribute('aria-label'))).toContain('Globe')

    click(btnByLabel(iconGroup, 'Globe'))
    expect(onChange).toHaveBeenLastCalledWith({ mark: { place: 'after', icon: 'globe' } })

    // Custom mark input
    const customInput = el.querySelector<HTMLInputElement>('input[aria-label="Custom mark"]')!
    expect(customInput.maxLength).toBe(WEB_LINK_CUSTOM_MAX)
    expect(customInput.placeholder).toBe('🔗')
    typeInput(customInput, '🌐')
    expect(onChange).toHaveBeenLastCalledWith({ mark: { place: 'after', custom: '🌐' } })
    expect(el.querySelector<HTMLElement>('.web-links-preview')!.style.getPropertyValue('--ext-link-mark-text')).toBe(
      '"🌐"',
    )
    // Built-in radios are unchecked while custom is active
    expect(iconGroup.querySelector('[role="radio"][aria-checked="true"]')).toBeNull()

    // Clicking a built-in SVG icon clears custom mark and custom input draft
    click(btnByLabel(iconGroup, 'Link'))
    expect(onChange).toHaveBeenLastCalledWith({ mark: { place: 'after', icon: 'link' } })
    expect(customInput.value).toBe('')

    // Mark colour & size & Before text
    click(btnByLabel(sectionRow(el, 'Mark colour')!, 'Muted'))
    click(btnByLabel(sectionRow(el, 'Mark size')!, 'Normal'))
    click(btnByLabel(placeGroup, 'Before text'))
    expect(onChange).toHaveBeenLastCalledWith({
      mark: { place: 'before', icon: 'link', color: 'muted', size: 'normal' },
    })

    // Mark Off removes mark completely
    click(btnByLabel(placeGroup, 'Off'))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('configures Hover style (Wash / Underline / Text colour / Off), Colour, and Strength', () => {
    const { el, onChange } = mountControl(DEFAULT_WEB_LINKS)
    const hoverStyleGroup = sectionRow(el, 'Hover style')!
    expect(sectionRow(el, 'Hover colour')).not.toBeNull()
    expect(sectionRow(el, 'Hover strength')).not.toBeNull()

    click(sectionRow(el, 'Hover colour')!.querySelector('[role="radio"][title="Purple"]'))
    click(btnByLabel(sectionRow(el, 'Hover strength')!, 'Strong'))
    expect(onChange).toHaveBeenLastCalledWith({ hover: { color: 'purple', strength: 'strong' } })

    click(btnByLabel(hoverStyleGroup, 'Text colour'))
    expect(onChange).toHaveBeenLastCalledWith({ hover: { style: 'text', color: 'purple' } })
    expect(sectionRow(el, 'Hover colour')).not.toBeNull()
    expect(sectionRow(el, 'Hover strength')).toBeNull()

    click(btnByLabel(hoverStyleGroup, 'Underline'))
    expect(onChange).toHaveBeenLastCalledWith({ hover: { style: 'underline' } })
    expect(sectionRow(el, 'Hover colour')).toBeNull()
    expect(sectionRow(el, 'Hover strength')).toBeNull()

    click(btnByLabel(hoverStyleGroup, 'Off'))
    expect(onChange).toHaveBeenLastCalledWith({ hover: { style: 'off' } })
    expect(el.querySelector<HTMLElement>('.web-links-preview')!.style.getPropertyValue('--ext-link-hover-mode')).toBe(
      'off',
    )
  })

  it('mounts lazily inside SettingsDialog › Links & IDs right after Link pills and calls onChange', async () => {
    const onChange = vi.fn()
    const ctx: SettingsCtx = {
      settings: { ...DEFAULT_SETTINGS },
      onChange,
      linkPills: { pills: NO_LINK_PILLS, save: vi.fn() },
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<SettingsDialog ctx={ctx} onClose={vi.fn()} initialPage="linksIds" />)
      await import('./WebLinksControl')
    })
    const rows = [...container.querySelectorAll<HTMLElement>('.setting')].map((r) => r.dataset.setting)
    expect(rows).toEqual(['linkPills', 'webLinks'])
    const webRow = container.querySelector<HTMLElement>('[data-setting="webLinks"]')!
    expect(webRow.querySelector('.setting__label')?.textContent).toBe('Web links')
    click(btnByLabel(webRow, 'Subtle pill'))
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      webLinks: { underline: false, box: { shape: 'round' }, mark: { place: 'after' } },
    })
  })

  it('YAZ-6588 & YAZ-6589: preview isolates from .app vars with resetDefaults, and cardSurfaceStyleOf carries resolved webLinks', () => {
    const { el } = mountControl(DEFAULT_WEB_LINKS)
    const preview = el.querySelector<HTMLElement>('.web-links-preview')!
    expect(preview.style.getPropertyValue('--ext-link-decoration')).toBe('initial')
    expect(preview.style.getPropertyValue('--ext-link-mark-place')).toBe('initial')
    expect(preview.style.getPropertyValue('--ext-link-hover-mode')).toBe('initial')

    const styled = cardSurfaceStyleOf(NO_LINK_PILLS, {}, { underline: false, mark: { place: 'after', custom: '🔗' } }) as Record<string, string>
    expect(styled['--ext-link-decoration']).toBe('none')
    expect(styled['--ext-link-mark-text']).toBe('"🔗"')

    const reset = cardSurfaceStyleOf(NO_LINK_PILLS, {}, DEFAULT_WEB_LINKS) as Record<string, string>
    expect(reset['--ext-link-decoration']).toBe('initial')
    expect(reset['--ext-link-mark-place']).toBe('initial')
  })
})
