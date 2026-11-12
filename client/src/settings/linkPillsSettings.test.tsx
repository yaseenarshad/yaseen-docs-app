/**
 * Settings › Link pills (YAZ-4924, the redo): one row in Files & Links with a vault open — the format box (draft +
 * commit, the chips, the ready formats), the vault rule only with `{vault}`, the live preview drawn by the cell's pill,
 * and the toolbars a click on a part or the icon opens, each button writing one field through the vault's `save`.
 * Nothing of it without a vault.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type IdsState } from '@shared/types'
import { DEFAULT_LINK_PILL_FORMAT, NO_LINK_PILLS, type LinkPills } from '@shared/linkPills'
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
  return { el: container, save, row: container.querySelector<HTMLElement>('[data-setting="linkPills"]') as HTMLElement }
}

const button = (el: ParentNode, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label) as HTMLButtonElement
const click = (el: Element) => act(() => (el as HTMLElement).click())
const select = (el: ParentNode, label: string) => el.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
const pick = (sel: HTMLSelectElement, label: string) =>
  act(() => {
    const i = [...sel.options].findIndex((o) => o.textContent === label)
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(sel, String(i))
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const enter = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
const formatBox = (row: HTMLElement) => row.querySelector<HTMLInputElement>('input[aria-label="Link pill format"]') as HTMLInputElement
const preview = (row: HTMLElement) => row.querySelector('.link-pills-preview') as HTMLElement
const pillTexts = (row: HTMLElement) => [...preview(row).querySelectorAll('.wikilink')].map((p) => p.textContent)
const toolbar = (row: HTMLElement) => row.querySelector<HTMLElement>('.pill-toolbar')

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('Settings › Link pills (YAZ-4924)', () => {
  it("is one row with a vault open, on today's look: the default format, the vault rule, four pills as today, no toolbar, no Reset; nothing without a vault", () => {
    const { el, row } = mount(NO_LINK_PILLS)
    expect(el.querySelectorAll('[data-setting^="linkPill"]')).toHaveLength(1)
    expect(formatBox(row).value).toBe(DEFAULT_LINK_PILL_FORMAT)
    expect(formatBox(row).maxLength).toBe(60)
    expect(select(row, 'Vault name on a link pill')?.selectedOptions[0]?.textContent).toBe('Vault name: other vaults only')
    expect([...row.querySelectorAll<HTMLButtonElement>('.link-pills-chip')].map((b) => b.textContent)).toEqual(['{icon}', '{name}', '{id}', '{vault}', '{folder}', '{path}'])
    // The preview: four pills, the one into another vault named in brackets, the missing one dim, the icon on each found name.
    expect([...preview(row).querySelectorAll('.wikilink')].map((p) => [p.textContent, p.classList.contains('wikilink--unresolved'), p.querySelector('.file-icon') !== null])).toEqual([['Roadmap', false, true], ['Q3 plan', false, true], ['Budget (Wiki)', false, true], ['Old plan', true, false]])
    expect(toolbar(row)).toBeNull()
    expect(button(row, 'Reset')).toBeUndefined()
    expect(mount(undefined).row).toBeNull()
  })

  it('the format keeps on Enter or blur; a format the app cannot read keeps the stored one, marks the box and says why', () => {
    const { row, save } = mount(NO_LINK_PILLS)
    const box = formatBox(row)
    type(box, '{name} ({id})')
    expect(save).not.toHaveBeenCalled()
    enter(box)
    expect(save).toHaveBeenLastCalledWith({ format: '{name} ({id})' })
    type(box, '{Name} {id}')
    enter(box)
    expect(save).toHaveBeenCalledTimes(1)
    expect(box.classList.contains('settings__input--error')).toBe(true)
    expect(row.querySelector('.settings__error')?.textContent).toBe('Not a token: {Name}')
    type(box, '{icon}')
    act(() => void box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(save).toHaveBeenCalledTimes(1)
    expect(row.querySelector('.settings__error')?.textContent).toBe('The format needs {name}')
    type(box, DEFAULT_LINK_PILL_FORMAT)
    enter(box)
    expect(save).toHaveBeenCalledTimes(1) // the stored format: nothing to save
    expect(row.querySelector('.settings__error')).toBeNull()
  })

  it('a token chip puts its token in at the caret and keeps at once', () => {
    const { row, save } = mount({ format: '{name}' })
    const box = formatBox(row)
    act(() => box.setSelectionRange(0, 0))
    click(button(row, 'Add {vault}'))
    expect(box.value).toBe('{vault}{name}')
    expect(save).toHaveBeenLastCalledWith({ format: '{vault}{name}' })
    expect(box.selectionStart).toBe('{vault}'.length)
  })

  it('a ready format sets the format, with its text style where it has one; Plain is a look', () => {
    const { row, save } = mount({ parts: { name: { bold: true } } })
    const ready = select(row, 'Ready formats') as HTMLSelectElement
    expect([...ready.options].map((o) => o.textContent)).toEqual(['Ready formats…', 'Name', 'Name (ID)', 'Name · Folder', 'Vault › Name', '(Name)', '→ Name', 'Plain'])
    pick(ready, 'Name (ID)')
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { bold: true } }, format: '{icon}{name} ({id})' })
    pick(ready, '(Name)')
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { bold: true }, text: { color: 'accent', size: 'normal' } }, format: '({icon}{name})' })
    pick(ready, 'Plain')
    expect(save).toHaveBeenLastCalledWith({ format: '{name}', parts: { name: { bold: true, color: 'same' } }, box: { fill: 'none' } })
  })

  it('the vault rule shows only while the format has {vault}, and writes the rule', () => {
    expect(select(mount({ format: '{name}' }).row, 'Vault name on a link pill')).toBeNull()
    const { row, save } = mount(NO_LINK_PILLS)
    pick(select(row, 'Vault name on a link pill') as HTMLSelectElement, 'Vault name: always')
    expect(save).toHaveBeenLastCalledWith({ vault: 'always' })
    pick(select(row, 'Vault name on a link pill') as HTMLSelectElement, 'Vault name: never')
    expect(save).toHaveBeenLastCalledWith({ vault: 'never' })
  })

  it("a click on a pill's name opens the Name toolbar: B I U, the colour, the size, each one field; a default back is dropped", () => {
    const { row, save } = mount(NO_LINK_PILLS)
    click(preview(row).querySelector('.wikilink') as Element)
    const bar = toolbar(row) as HTMLElement
    expect(bar.getAttribute('aria-label')).toBe('Name toolbar')
    expect(select(bar, 'What to style')?.selectedOptions[0]?.textContent).toBe('Name')
    expect([...(select(bar, 'What to style') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Name', 'Vault', 'Your text', 'Box'])
    click(button(bar, 'Bold'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { bold: true } } })
    click(button(bar, 'Italic'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { italic: true } } })
    click(button(bar, 'Underline'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { underline: true } } })
    expect(button(bar, 'Accent colour').getAttribute('aria-pressed')).toBe('true')
    click(button(bar, 'Same as text'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { color: 'same' } } })
    click(button(bar, 'Muted'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { color: 'muted' } } })
    click(bar.querySelector('[role="radio"][title="Teal"]') as Element)
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { color: 'teal' } } })
    click(button(bar, 'Small'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { size: 'small' } } })
    click(button(bar, 'Accent colour'))
    expect(save).toHaveBeenLastCalledWith({})
    click(button(bar, 'Close the toolbar'))
    expect(toolbar(row)).toBeNull()
  })

  it("a part's toolbar shows the part's own state; a quiet part's defaults are muted and small; a click on the ID or your text opens theirs", () => {
    const { row, save } = mount({ format: '[{icon}{name} {id}]', parts: { name: { bold: true, color: 'blue' } } }, true)
    click(preview(row).querySelector('.wikilink') as Element)
    let bar = toolbar(row) as HTMLElement
    expect([button(bar, 'Bold').getAttribute('aria-pressed'), bar.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('title'), button(bar, 'Normal').getAttribute('aria-pressed')]).toEqual(['true', 'Blue', 'true'])
    click(preview(row).querySelector('.link-pill__id') as Element)
    bar = toolbar(row) as HTMLElement
    expect(bar.getAttribute('aria-label')).toBe('ID toolbar')
    expect([button(bar, 'Muted').getAttribute('aria-pressed'), button(bar, 'Small').getAttribute('aria-pressed')]).toEqual(['true', 'true'])
    click(button(bar, 'Accent colour'))
    expect(save).toHaveBeenLastCalledWith({ format: '[{icon}{name} {id}]', parts: { name: { bold: true, color: 'blue' }, id: { color: 'accent' } } })
    click(button(bar, 'Normal'))
    expect(save).toHaveBeenLastCalledWith({ format: '[{icon}{name} {id}]', parts: { name: { bold: true, color: 'blue' }, id: { size: 'normal' } } })
    click(preview(row).querySelector('.link-pill__text') as Element)
    expect(toolbar(row)?.getAttribute('aria-label')).toBe('Your text toolbar')
    click(button(toolbar(row) as HTMLElement, 'Bold'))
    expect(save).toHaveBeenLastCalledWith({ format: '[{icon}{name} {id}]', parts: { name: { bold: true, color: 'blue' }, text: { bold: true } } })
    // The picker switches the part.
    pick(select(toolbar(row) as HTMLElement, 'What to style') as HTMLSelectElement, 'Box')
    expect(toolbar(row)?.getAttribute('aria-label')).toBe('Box toolbar')
  })

  it("a click on a pill's icon opens the Box toolbar: Shape, Fill, Strength with a colour fill", () => {
    const { row, save } = mount(NO_LINK_PILLS)
    click(preview(row).querySelector('.file-icon') as Element)
    const bar = toolbar(row) as HTMLElement
    expect(bar.getAttribute('aria-label')).toBe('Box toolbar')
    expect([button(bar, 'Round').getAttribute('aria-pressed'), button(bar, 'Accent tint').getAttribute('aria-pressed'), button(bar, 'Strong')]).toEqual(['true', 'true', undefined])
    click(button(bar, 'Square'))
    expect(save).toHaveBeenLastCalledWith({ box: { shape: 'square' } })
    click(button(bar, 'Underline'))
    expect(save).toHaveBeenLastCalledWith({ box: { shape: 'underline' } })
    click(button(bar, 'No fill'))
    expect(save).toHaveBeenLastCalledWith({ box: { fill: 'none' } })
    click(bar.querySelector('[role="radio"][title="Teal"]') as Element)
    expect(save).toHaveBeenLastCalledWith({ box: { fill: 'teal' } })
    const coloured = mount({ box: { fill: 'teal', strength: 'light' } })
    click(preview(coloured.row).querySelector('.file-icon') as Element)
    const bar2 = toolbar(coloured.row) as HTMLElement
    expect([coloured.row.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('title'), button(bar2, 'Light').getAttribute('aria-pressed')]).toEqual(['Teal', 'true'])
    click(button(bar2, 'Strong'))
    expect(coloured.save).toHaveBeenLastCalledWith({ box: { fill: 'teal', strength: 'strong' } })
    click(button(bar2, 'Medium'))
    expect(coloured.save).toHaveBeenLastCalledWith({ box: { fill: 'teal' } })
    click(button(bar2, 'Accent tint'))
    expect(coloured.save).toHaveBeenLastCalledWith({})
  })

  it('the preview wears the look: the variables on it, the pieces of the format on each pill, the ID in an ID vault; Reset saves today', () => {
    const { row, save } = mount({ format: '[{vault} › {name} {id} {folder}]', vault: 'always', box: { fill: 'none' }, parts: { name: { bold: true } } }, true)
    expect(preview(row).style.getPropertyValue('--pill-bg')).toBe('transparent')
    expect(preview(row).style.getPropertyValue('--pill-name-weight')).toBe('bold')
    expect(pillTexts(row)).toEqual(['[Mine › Roadmap YAS-12 Plans]', '[Mine › Q3 plan Boards]', '[Wiki › Budget]', '[Mine › Old plan]'])
    expect(preview(row).querySelector('.file-icon')).toBeNull()
    click(button(row, 'Reset'))
    expect(save).toHaveBeenLastCalledWith({})
    // No ID vault: the ID piece and its space go.
    expect(pillTexts(mount({ format: '[{vault} › {name} {id} {folder}]', vault: 'always' }).row)).toEqual(['[Mine › Roadmap Plans]', '[Mine › Q3 plan Boards]', '[Wiki › Budget]', '[Mine › Old plan]'])
  })

  it('an old look reaches the row converted: the format box shows version 1 as a format', () => {
    const { row } = mount({ format: '({icon}{name} ({vault}))', parts: { text: { color: 'accent', size: 'normal' } } })
    expect(formatBox(row).value).toBe('({icon}{name} ({vault}))')
    expect(pillTexts(row)).toEqual(['(Roadmap)', '(Q3 plan)', '(Budget (Wiki))', '(Old plan)'])
  })
})
