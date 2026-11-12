/**
 * Settings › Link pills (YAZ-4924, the redo): one row in Files & Links with a vault open — the format box (draft +
 * commit, the chips, the ready formats), the vault rule only with `{vault}`, the live preview (round 4: a "Preview"
 * label and ONE sample pill with every part, drawn by the cell's pill), and the style panel a click on a part or the icon opens (round 3: titled "Styling: the …", three labelled rows), each
 * button writing one field through the vault's `save`. Nothing of it without a vault.
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
/** The panel's rows, by their labels on the left. */
const rows = (bar: HTMLElement) => [...bar.querySelectorAll('.pill-toolbar__row')].map((r) => r.querySelector('.pill-toolbar__label')?.textContent)
const rowOf = (bar: HTMLElement, label: string) => [...bar.querySelectorAll<HTMLElement>('.pill-toolbar__row')].find((r) => r.querySelector('.pill-toolbar__label')?.textContent === label) as HTMLElement
/** The title line: "Styling:" and the part it names (the quiet dropdown folded into it). */
const title = (bar: HTMLElement) => `${bar.querySelector('.pill-toolbar__title')?.firstChild?.textContent} ${select(bar, 'What to style')?.selectedOptions[0]?.textContent}`

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('Settings › Link pills (YAZ-4924)', () => {
  it("is one row with a vault open, on today's look: the default format, the vault rule, ONE sample pill with its vault's name, no toolbar, no Reset; nothing without a vault", () => {
    const { el, row } = mount(NO_LINK_PILLS)
    expect(el.querySelectorAll('[data-setting^="linkPill"]')).toHaveLength(1)
    expect(formatBox(row).value).toBe(DEFAULT_LINK_PILL_FORMAT)
    expect(formatBox(row).maxLength).toBe(60)
    expect(select(row, 'Vault name on a link pill')?.selectedOptions[0]?.textContent).toBe('Vault name: other vaults only')
    expect([...row.querySelectorAll<HTMLButtonElement>('.link-pills-chip')].map((b) => b.textContent)).toEqual(['{icon}', '{name}', '{id}', '{number}', '{vault}', '{folder}', '{path}', '{mark}'])
    // The preview (round 4): a muted "Preview" label and ONE sample pill, found, with its icon; the format has {vault},
    // so the sample shows its vault's name even under "other vaults only". No sentence around it.
    expect(preview(row).querySelector('.link-pills-preview__label')?.textContent).toBe('Preview')
    expect([...preview(row).querySelectorAll('.wikilink')].map((p) => [p.textContent, p.classList.contains('wikilink--unresolved'), p.querySelector('.file-icon') !== null])).toEqual([['Roadmap (Mine)', false, true]])
    expect(preview(row).textContent).toBe('PreviewRoadmap (Mine)')
    expect(preview(row).title).toBe('Click a part of a pill to style it')
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
    expect([...ready.options].map((o) => o.textContent)).toEqual(['Ready formats…', 'Name', 'Name (ID)', 'Name #Number', 'Name · Folder', 'Vault › Name', '(Name)', '→ Name', 'Name ↗', 'Plain'])
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

  it("a click on a pill's name opens the panel titled 'Styling: the name', three labelled rows: Text (B I U), Colour (one row: Accent · Text · Muted, the swatches), Size; each button one field; a default back is dropped", () => {
    const { row, save } = mount(NO_LINK_PILLS)
    click(preview(row).querySelector('.wikilink') as Element)
    const bar = toolbar(row) as HTMLElement
    expect(bar.getAttribute('aria-label')).toBe('Styling: the name')
    expect(title(bar)).toBe('Styling: the name')
    expect([...(select(bar, 'What to style') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['the name', 'the vault', 'your text', 'the box'])
    expect(rows(bar)).toEqual(['Text', 'Colour', 'Size'])
    expect([...rowOf(bar, 'Text').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['B', 'I', 'U'])
    // ONE colour row: the three named colours, then the ten swatches, the current one marked.
    const colour = rowOf(bar, 'Colour')
    expect([...colour.querySelectorAll('button[aria-pressed]')].map((b) => b.textContent)).toEqual(['Accent', 'Text', 'Muted'])
    expect(colour.querySelectorAll('[role="radio"]')).toHaveLength(10)
    expect(colour.querySelector('[aria-pressed="true"]')?.textContent).toBe('Accent')
    expect([...rowOf(bar, 'Size').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Normal', 'Small'])
    click(button(bar, 'Bold'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { bold: true } } })
    click(button(bar, 'Italic'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { italic: true } } })
    click(button(bar, 'Underline'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { underline: true } } })
    click(button(bar, 'Same as text'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { color: 'same' } } })
    click(button(bar, 'Muted'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { color: 'muted' } } })
    click(colour.querySelector('[role="radio"][title="Teal"]') as Element)
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { color: 'teal' } } })
    click(button(bar, 'Small'))
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { size: 'small' } } })
    click(button(bar, 'Accent colour'))
    expect(save).toHaveBeenLastCalledWith({})
    click(button(bar, 'Close the toolbar'))
    expect(toolbar(row)).toBeNull()
  })

  it("the panel shows the part's own state, the swatch marked in its row; a quiet part's defaults are muted and small; a click on the ID or your text retitles it; the title's dropdown switches", () => {
    const { row, save } = mount({ format: '[{icon}{name} {id}]', parts: { name: { bold: true, color: 'blue' } } }, true)
    click(preview(row).querySelector('.wikilink') as Element)
    let bar = toolbar(row) as HTMLElement
    expect([button(bar, 'Bold').getAttribute('aria-pressed'), rowOf(bar, 'Colour').querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('title'), button(bar, 'Normal').getAttribute('aria-pressed')]).toEqual(['true', 'Blue', 'true'])
    expect(rowOf(bar, 'Colour').querySelector('button[aria-pressed="true"]')).toBeNull()
    click(preview(row).querySelector('.link-pill__id') as Element)
    bar = toolbar(row) as HTMLElement
    expect(title(bar)).toBe('Styling: the ID')
    expect([button(bar, 'Muted').getAttribute('aria-pressed'), button(bar, 'Small').getAttribute('aria-pressed')]).toEqual(['true', 'true'])
    click(button(bar, 'Accent colour'))
    expect(save).toHaveBeenLastCalledWith({ format: '[{icon}{name} {id}]', parts: { name: { bold: true, color: 'blue' }, id: { color: 'accent' } } })
    click(button(bar, 'Normal'))
    expect(save).toHaveBeenLastCalledWith({ format: '[{icon}{name} {id}]', parts: { name: { bold: true, color: 'blue' }, id: { size: 'normal' } } })
    click(preview(row).querySelector('.link-pill__text') as Element)
    expect(title(toolbar(row) as HTMLElement)).toBe('Styling: your text')
    click(button(toolbar(row) as HTMLElement, 'Bold'))
    expect(save).toHaveBeenLastCalledWith({ format: '[{icon}{name} {id}]', parts: { name: { bold: true, color: 'blue' }, text: { bold: true } } })
    // The title's dropdown is the second way to pick.
    pick(select(toolbar(row) as HTMLElement, 'What to style') as HTMLSelectElement, 'the box')
    expect(title(toolbar(row) as HTMLElement)).toBe('Styling: the box')
    pick(select(toolbar(row) as HTMLElement, 'What to style') as HTMLSelectElement, 'the ID')
    expect(title(toolbar(row) as HTMLElement)).toBe('Styling: the ID')
  })

  it("a click on a pill's icon opens 'Styling: the box': the rows Shape, Fill and, with a colour fill, Strength", () => {
    const { row, save } = mount(NO_LINK_PILLS)
    click(preview(row).querySelector('.file-icon') as Element)
    const bar = toolbar(row) as HTMLElement
    expect(bar.getAttribute('aria-label')).toBe('Styling: the box')
    expect(title(bar)).toBe('Styling: the box')
    expect(rows(bar)).toEqual(['Shape', 'Fill'])
    expect([...rowOf(bar, 'Shape').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Round', 'Square', 'Underline'])
    expect([...rowOf(bar, 'Fill').querySelectorAll('button[aria-pressed]')].map((b) => b.textContent)).toEqual(['Tint', 'None'])
    expect(rowOf(bar, 'Fill').querySelectorAll('[role="radio"]')).toHaveLength(10)
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
    expect(rows(bar2)).toEqual(['Shape', 'Fill', 'Strength'])
    expect([rowOf(bar2, 'Fill').querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('title'), button(bar2, 'Light').getAttribute('aria-pressed')]).toEqual(['Teal', 'true'])
    click(button(bar2, 'Strong'))
    expect(coloured.save).toHaveBeenLastCalledWith({ box: { fill: 'teal', strength: 'strong' } })
    click(button(bar2, 'Medium'))
    expect(coloured.save).toHaveBeenLastCalledWith({ box: { fill: 'teal' } })
    click(button(bar2, 'Accent tint'))
    expect(coloured.save).toHaveBeenLastCalledWith({})
  })

  it('the preview wears the look: the variables on it, the pieces of the format on the sample pill; Reset saves today', () => {
    const { row, save } = mount({ format: '[{vault} › {name} {id} {folder}]', vault: 'always', box: { fill: 'none' }, parts: { name: { bold: true } } }, true)
    expect(preview(row).style.getPropertyValue('--pill-bg')).toBe('transparent')
    expect(preview(row).style.getPropertyValue('--pill-name-weight')).toBe('bold')
    expect(pillTexts(row)).toEqual(['[Mine › Roadmap YAS-12 Plans]'])
    expect(preview(row).querySelector('.file-icon')).toBeNull()
    click(button(row, 'Reset'))
    expect(save).toHaveBeenLastCalledWith({})
  })

  it('the sample note has every part: each token of the format shows on it, in a vault without IDs too; "never" hides the vault name', () => {
    const format = '{icon}{name} · {id} · {vault} · {folder} · {path} ·'
    const { row } = mount({ format })
    expect(pillTexts(row)).toEqual(['Roadmap · YAS-12 · Mine · Plans · Projects › Plans ·'])
    expect(['.file-icon', '.link-pill__id', '.link-pill__vault', '.link-pill__folder', '.link-pill__path', '.link-pill__text'].map((c) => preview(row).querySelector(c) !== null)).toEqual([true, true, true, true, true, true])
    expect(pillTexts(mount({ format, vault: 'always' }).row)).toEqual(['Roadmap · YAS-12 · Mine · Plans · Projects › Plans ·'])
    expect(pillTexts(mount({ format, vault: 'never' }).row)).toEqual(['Roadmap · YAS-12 · Plans · Projects › Plans ·'])
  })

  it('a click on each part of the sample pill opens its panel: the name, the ID, the vault, the folder, the path, your text, the box', () => {
    const { row } = mount({ format: '[{icon}{name} {id} {vault} {folder} {path}]' })
    const at = (sel: string) => {
      click(preview(row).querySelector(sel) as Element)
      return title(toolbar(row) as HTMLElement)
    }
    expect(['.wikilink', '.link-pill__id', '.link-pill__vault', '.link-pill__folder', '.link-pill__path', '.link-pill__text', '.file-icon'].map(at)).toEqual(['Styling: the name', 'Styling: the ID', 'Styling: the vault', 'Styling: the folder', 'Styling: the path', 'Styling: your text', 'Styling: the box'])
    // The label is no part: a click on it changes nothing.
    click(preview(row).querySelector('.link-pills-preview__label') as Element)
    expect(title(toolbar(row) as HTMLElement)).toBe('Styling: the box')
  })

  it('the chips: {number} next to {id}, {mark} last; each puts its token in', () => {
    const { row, save } = mount({ format: '{name}' })
    expect([...row.querySelectorAll('.link-pills-chip')].map((b) => b.textContent)).toEqual(['{icon}', '{name}', '{id}', '{number}', '{vault}', '{folder}', '{path}', '{mark}'])
    const box = formatBox(row)
    act(() => box.setSelectionRange(6, 6))
    click(button(row, 'Add {number}'))
    expect(save).toHaveBeenLastCalledWith({ format: '{name}{number}' })
    click(button(row, 'Add {mark}'))
    expect(save).toHaveBeenLastCalledWith({ format: '{name}{number}{mark}' })
  })

  it('the preview shows both: the sample YAS-12 gives #12, and the mark is a small icon after the name', () => {
    const { row } = mount({ format: '{icon}{name} #{number}{mark}' })
    expect(pillTexts(row)).toEqual(['Roadmap #12'])
    expect(preview(row).querySelector('.link-pill__number')?.textContent).toBe('12')
    const mark = preview(row).querySelector('.link-pill__mark') as HTMLElement
    expect(mark.querySelector('svg')).not.toBeNull()
    expect(mark.dataset.mark).toBe('arrow-up-right')
    expect((mount({ format: '{name}{mark}', parts: { mark: { icon: 'bookmark' } } }).row.querySelector('.link-pills-preview .link-pill__mark') as HTMLElement).dataset.mark).toBe('bookmark')
  })

  it("a click on the number opens 'Styling: the number' with the usual rows; a click on the mark 'Styling: the mark' with an Icon row of eight icons, then Colour and Size", () => {
    const { row, save } = mount({ format: '{icon}{name} #{number}{mark}' })
    click(preview(row).querySelector('.link-pill__number') as Element)
    let bar = toolbar(row) as HTMLElement
    expect(title(bar)).toBe('Styling: the number')
    expect(rows(bar)).toEqual(['Text', 'Colour', 'Size'])
    expect([button(bar, 'Muted').getAttribute('aria-pressed'), button(bar, 'Small').getAttribute('aria-pressed')]).toEqual(['true', 'true'])
    expect([...(select(bar, 'What to style') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['the name', 'the number', 'the mark', 'your text', 'the box'])
    // A click on the mark's drawing (a path inside its svg) lands on the mark.
    act(() => void (preview(row).querySelector('.link-pill__mark svg')?.firstElementChild as Element).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    bar = toolbar(row) as HTMLElement
    expect(title(bar)).toBe('Styling: the mark')
    expect(rows(bar)).toEqual(['Icon', 'Colour', 'Size'])
    const icons = [...rowOf(bar, 'Icon').querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    expect(icons.map((b) => b.getAttribute('aria-label'))).toEqual(['Arrow up-right', 'Arrow right', 'Link', 'Return arrow', 'Dot', 'Diamond', 'Star', 'Bookmark'])
    // Each is the small icon itself, no letter.
    expect(icons.map((b) => [b.textContent, b.querySelector('svg') !== null])).toEqual(icons.map(() => ['', true]))
    expect(icons.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.getAttribute('aria-label'))).toEqual(['Arrow up-right'])
    click(icons[6]!)
    expect(save).toHaveBeenLastCalledWith({ format: '{icon}{name} #{number}{mark}', parts: { mark: { icon: 'star' } } })
    click(icons[0]!)
    expect(save).toHaveBeenLastCalledWith({ format: '{icon}{name} #{number}{mark}' })
    // The mark's own colour and size; Normal by default.
    expect(button(bar, 'Normal').getAttribute('aria-pressed')).toBe('true')
    click(rowOf(bar, 'Colour').querySelector('[role="radio"][title="Red"]') as Element)
    expect(save).toHaveBeenLastCalledWith({ format: '{icon}{name} #{number}{mark}', parts: { mark: { color: 'red' } } })
    click(button(bar, 'Small'))
    expect(save).toHaveBeenLastCalledWith({ format: '{icon}{name} #{number}{mark}', parts: { mark: { size: 'small' } } })
  })

  it("the mark's Icon row shows the saved icon; its colour is the name's until it has its own", () => {
    const { row, save } = mount({ format: '{name}{mark}', parts: { name: { color: 'blue' }, mark: { icon: 'diamond' } } })
    click(preview(row).querySelector('.link-pill__mark') as Element)
    const bar = toolbar(row) as HTMLElement
    expect(rowOf(bar, 'Icon').querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('aria-label')).toBe('Diamond')
    expect(rowOf(bar, 'Colour').querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('title')).toBe('Blue')
    click(button(bar, 'Accent colour'))
    expect(save).toHaveBeenLastCalledWith({ format: '{name}{mark}', parts: { name: { color: 'blue' }, mark: { icon: 'diamond', color: 'accent' } } })
  })

  it("the row says it is the default, and where one link is styled (round 5): \"The default look of every link in this vault. Right-click a link to style that one.\"", () => {
    const { row } = mount(NO_LINK_PILLS)
    expect(row.textContent).toContain('The default look of every link in this vault. Right-click a link to style that one.')
  })

  it('an old look reaches the row converted: the format box shows version 1 as a format', () => {
    const { row } = mount({ format: '({icon}{name} ({vault}))', parts: { text: { color: 'accent', size: 'normal' } } })
    expect(formatBox(row).value).toBe('({icon}{name} ({vault}))')
    expect(pillTexts(row)).toEqual(['(Roadmap (Mine))'])
  })
})
