/**
 * Settings › Editor › Selection toolbar (YAZ-3806 T5, T7): the row in the real Settings dialog, its show boxes and
 * Reset, and the order rules a drag writes. A drag's pointer moves need real layout, so the drag itself is in the
 * demo; the drop it writes is `moveGroup` / `moveButton`, tested here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, DEFAULT_TOOLBAR, TOOLBAR_BUTTONS, type SettingsState } from '@shared/types'
import { SettingsDialog } from './SettingsDialog'
import { groupButtons } from '../editor/toolbarPrefs'
import { moveButton, moveGroup, toggleButton } from './ToolbarArrange'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() } },
}))

let root: Root | null = null
let el: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

async function mountEditorPage(settings: SettingsState, onChange: (next: SettingsState) => void) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange }} onClose={vi.fn()} />))
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Editor')?.click())
  await act(async () => await Promise.resolve())
}

const row = () => el.querySelector<HTMLElement>('[data-setting="selectionToolbar"]')!

const squares = (group: string) => [...row().querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] .toolbar-arrange__square`)]
const square = (button: string) => row().querySelector<HTMLButtonElement>(`.toolbar-arrange__square[data-button="${button}"]`)!
/** The preview strip, as the toolbar draws it: each button's name, a divider as '|'. */
const preview = () =>
  [...row().querySelectorAll<HTMLElement>('.toolbar-arrange__preview-button, .toolbar-arrange__divider')].map((el) => (el.classList.contains('toolbar-arrange__divider') ? '|' : el.title))

describe('Settings › Editor › Selection toolbar (YAZ-3806 T7, 4B YAZ-3856)', () => {
  it('a preview of the strip, then a row of squares per group, and Reset; the group title alone names the row', async () => {
    await mountEditorPage({ ...DEFAULT_SETTINGS }, vi.fn())
    expect(preview()).toEqual([
      'Heading 1', 'Heading 2', 'Heading 3', 'Text', '|',
      'Checklist', 'Bullet list', 'Numbered list', '|',
      'Bold', 'Italic', 'Underline', 'Strikethrough', 'Highlight', 'Highlight green', 'Highlight blue', 'Highlight pink', '|',
      'Inline code', 'Link',
    ])
    expect([...row().querySelectorAll('.toolbar-arrange__group-name')].map((n) => n.textContent)).toEqual(['Line type', 'Lists', 'Text style', 'Code and link'])
    expect(squares('lists').map((b) => b.getAttribute('aria-label'))).toEqual(['Show Checklist', 'Show Bullet list', 'Show Numbered list'])
    expect(square('bulletList').querySelector('svg')).not.toBeNull()
    expect(square('bulletList').getAttribute('aria-checked')).toBe('true')
    // A bare row: no second "Selection toolbar" label under the group title.
    expect(row().querySelector('.setting__label')).toBeNull()
    expect([...row().querySelectorAll('button')].some((b) => b.textContent === 'Reset to default')).toBe(true)
  })

  it('the preview follows the setting: a hidden button leaves it, a group with none shown takes its divider, the order is the strip\'s', async () => {
    const prefs = { ...DEFAULT_TOOLBAR, groups: ['insert', 'lineType', 'lists', 'textStyle'] as typeof DEFAULT_TOOLBAR.groups, hidden: ['checklist', 'bulletList', 'numberedList', 'bold'] as typeof DEFAULT_TOOLBAR.hidden }
    await mountEditorPage({ ...DEFAULT_SETTINGS, selectionToolbar: prefs }, vi.fn())
    expect(preview()).toEqual(['Inline code', 'Link', '|', 'Heading 1', 'Heading 2', 'Heading 3', 'Text', '|', 'Italic', 'Underline', 'Strikethrough', 'Highlight', 'Highlight green', 'Highlight blue', 'Highlight pink'])
    expect(square('bold').classList.contains('toolbar-arrange__square--off')).toBe(true)
    expect(square('bold').getAttribute('aria-checked')).toBe('false')
  })

  it('a click on a square hides its button, a click on a hidden one shows it in its place; Reset writes the default', async () => {
    const onChange = vi.fn()
    const hidden = { ...DEFAULT_TOOLBAR, hidden: ['bold' as const] }
    await mountEditorPage({ ...DEFAULT_SETTINGS, selectionToolbar: hidden }, onChange)
    act(() => square('italic').click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, selectionToolbar: { ...hidden, hidden: ['bold', 'italic'] } })
    act(() => square('bold').click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, selectionToolbar: DEFAULT_TOOLBAR })
    act(() => [...row().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Reset to default')!.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, selectionToolbar: DEFAULT_TOOLBAR })
  })

  it('a drag shows the tab strip\'s drop line where the square lands, moves nothing on the way, and writes once on release', async () => {
    const onChange = vi.fn()
    await mountEditorPage({ ...DEFAULT_SETTINGS }, onChange)
    // jsdom has no layout: the Code and link squares stand at x 0–38 and 44–82.
    squares('insert').forEach((el, i) => (el.getBoundingClientRect = () => ({ left: i * 44, width: 38, top: 0, height: 38 }) as DOMRect))
    const [code, link] = squares('insert')
    const at = (type: string, x: number, el: HTMLElement) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, button: 0 }))
    act(() => at('pointerdown', 10, code))
    act(() => at('pointermove', 90, code))
    expect(code.classList.contains('toolbar-arrange--dragging')).toBe(true)
    expect(link.classList.contains('toolbar-arrange--gap-right')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    act(() => at('pointerup', 90, code))
    expect(code.classList.contains('toolbar-arrange--dragging')).toBe(false)
    expect(link.classList.contains('toolbar-arrange--gap-right')).toBe(false)
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, selectionToolbar: moveButton(DEFAULT_TOOLBAR, 'insert', 0, 1) })
    // The click of the release does not also hide the square.
    act(() => code.click())
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('Esc during a drag puts it back and writes nothing', async () => {
    const onChange = vi.fn()
    await mountEditorPage({ ...DEFAULT_SETTINGS }, onChange)
    squares('insert').forEach((el, i) => (el.getBoundingClientRect = () => ({ left: i * 44, width: 38, top: 0, height: 38 }) as DOMRect))
    const [code, link] = squares('insert')
    act(() => code.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, button: 0 })))
    act(() => code.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 90 })))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(link.classList.contains('toolbar-arrange--gap-right')).toBe(false)
    act(() => code.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 90 })))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('the last button (YAZ-3806 T7)', () => {
  it('the one button that still shows cannot be hidden: a strip with no button would be an empty box', async () => {
    const onChange = vi.fn()
    const hidden = TOOLBAR_BUTTONS.filter((b) => b !== 'link')
    await mountEditorPage({ ...DEFAULT_SETTINGS, selectionToolbar: { ...DEFAULT_TOOLBAR, hidden } }, onChange)
    expect(square('link').getAttribute('aria-disabled')).toBe('true')
    act(() => square('link').click())
    expect(onChange).not.toHaveBeenCalled()
    act(() => square('code').click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, selectionToolbar: { ...DEFAULT_TOOLBAR, hidden: hidden.filter((b) => b !== 'code') } })
  })
})

describe('the order a drop writes (YAZ-3806 T5)', () => {
  it('moveGroup moves a group; moveButton moves a button inside its group only, the other groups untouched', () => {
    expect(moveGroup(DEFAULT_TOOLBAR, 1, 0).groups).toEqual(['lists', 'lineType', 'textStyle', 'insert'])
    const moved = moveButton(DEFAULT_TOOLBAR, 'insert', 1, 0)
    expect(groupButtons(moved, 'insert')).toEqual(['link', 'code'])
    expect(groupButtons(moved, 'textStyle')).toEqual(groupButtons(DEFAULT_TOOLBAR, 'textStyle'))
    expect(groupButtons(moveButton(DEFAULT_TOOLBAR, 'textStyle', 2, 0), 'textStyle').slice(0, 3)).toEqual(['underline', 'bold', 'italic'])
    expect(moved.buttons).toHaveLength(DEFAULT_TOOLBAR.buttons.length)
  })

  it('toggleButton hides and shows; a shown button keeps its place', () => {
    const off = toggleButton(DEFAULT_TOOLBAR, 'link')
    expect(off.hidden).toEqual(['link'])
    expect(toggleButton(off, 'link')).toEqual(DEFAULT_TOOLBAR)
  })
})
