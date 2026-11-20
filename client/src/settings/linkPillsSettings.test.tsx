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
import { UNIT_WORDS, unitTextOf } from '../vault/unitWord'
import { SettingsDialog } from './SettingsDialog'
import type { SettingsCtx } from './registry'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(pills: LinkPills | undefined, ids = false, word = UNIT_WORDS.page) {
  const save = vi.fn()
  const ctx: SettingsCtx = { unitWord: { settings: { unit: 'page', own: { one: '', many: '' } }, word, unit: unitTextOf(word), save: vi.fn() }, settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), linkPills: pills === undefined ? undefined : { pills, save }, textFormatting: { vaults: [{ root: '/v', name: 'Mine', state: { formatting: {}, save: vi.fn() } }], activeRoot: '/v' } }
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
/** The sample page pill's text (the card pill, YAZ-5919, has its own tests). */
const pillTexts = (row: HTMLElement) => [...preview(row).querySelectorAll('.wikilink:not(.link-pills-preview__card)')].map((p) => p.textContent)
const cardPill = (row: HTMLElement) => preview(row).querySelector<HTMLElement>('.link-pills-preview__card')
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
    // The preview (round 4): a muted "Preview" label and two sample pills (YAZ-5919): a page with the sidebar's page
    // icon, and a card with the card icon. The format has {vault}, so the page shows its vault's name even under "other
    // vaults only"; a card is in this vault, so it shows none. No sentence around them.
    expect(preview(row).querySelector('.link-pills-preview__label')?.textContent).toBe('Preview')
    expect([...preview(row).querySelectorAll('.wikilink')].map((p) => [p.textContent, p.querySelector('.file-icon')?.getAttribute('data-kind') ?? null, p.querySelector('.card-icon') !== null])).toEqual([
      ['Roadmap (Mine)', 'markdown', false],
      ['Capital of France', null, true],
    ])
    expect(preview(row).textContent).toBe('PreviewRoadmap (Mine)Capital of France')
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
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { bold: true } }, format: '{icon} {name} ({id})' })
    pick(ready, '(Name)')
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { bold: true }, text: { color: 'accent', size: 'normal' } }, format: '({icon} {name})' })
    pick(ready, 'Plain')
    // Plain (YAZ-5961): the format stays (the mounted look has none: the default); every part but the icon in the
    // text's colour and size; no box.
    const same = { color: 'same', size: 'normal' }
    expect(save).toHaveBeenLastCalledWith({
      parts: { name: { bold: true, color: 'same' }, id: same, number: same, vault: same, folder: same, path: same, text: same },
      box: { fill: 'none' },
    })
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
    click(preview(row).querySelector('.link-pills-preview__name') as Element)
    const bar = toolbar(row) as HTMLElement
    expect(bar.getAttribute('aria-label')).toBe('Styling: the name')
    expect(title(bar)).toBe('Styling: the name')
    expect([...(select(bar, 'What to style') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['the name', 'the icon', 'the vault', 'your text', 'the box'])
    expect(rows(bar)).toEqual(['Text', 'Colour', 'Size'])
    expect([...rowOf(bar, 'Text').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['B', 'I', 'U'])
    // ONE colour row: the three named colours, then the ten swatches, the current one marked.
    const colour = rowOf(bar, 'Colour')
    expect([...colour.querySelectorAll('button[aria-pressed]')].map((b) => b.textContent)).toEqual(['Accent', 'Text', 'Muted'])
    expect(colour.querySelectorAll('[role="radio"]')).toHaveLength(11)
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
    click(preview(row).querySelector('.link-pills-preview__name') as Element)
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

  it("a click on the pill's edge (its own span, not a piece) opens 'Styling: the box': the rows Shape, Fill and, with a colour fill, Strength", () => {
    const { row, save } = mount(NO_LINK_PILLS)
    click(preview(row).querySelector('.wikilink') as Element)
    const bar = toolbar(row) as HTMLElement
    expect(bar.getAttribute('aria-label')).toBe('Styling: the box')
    expect(title(bar)).toBe('Styling: the box')
    expect(rows(bar)).toEqual(['Shape', 'Fill'])
    expect([...rowOf(bar, 'Shape').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Round', 'Square', 'Underline'])
    expect([...rowOf(bar, 'Fill').querySelectorAll('button[aria-pressed]')].map((b) => b.textContent)).toEqual(['Tint', 'None'])
    expect(rowOf(bar, 'Fill').querySelectorAll('[role="radio"]')).toHaveLength(11)
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
    click(preview(coloured.row).querySelector('.wikilink') as Element)
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

  it('the sample page has every part: each token of the format shows on it, in a vault without IDs too; "never" hides the vault name', () => {
    const format = '{icon}{name} · {id} · {vault} · {folder} · {path} ·'
    const { row } = mount({ format })
    expect(pillTexts(row)).toEqual(['Roadmap · YAS-12 · Mine · Plans · Projects › Plans ·'])
    expect(['.file-icon', '.link-pill__id', '.link-pill__vault', '.link-pill__folder', '.link-pill__path', '.link-pill__text'].map((c) => preview(row).querySelector(c) !== null)).toEqual([true, true, true, true, true, true])
    expect(pillTexts(mount({ format, vault: 'always' }).row)).toEqual(['Roadmap · YAS-12 · Mine · Plans · Projects › Plans ·'])
    expect(pillTexts(mount({ format, vault: 'never' }).row)).toEqual(['Roadmap · YAS-12 · Plans · Projects › Plans ·'])
  })

  it('a click on each part of the sample pill opens its panel: the name, the icon, the ID, the vault, the folder, the path, your text, the box', () => {
    const { row } = mount({ format: '[{icon}{name} {id} {vault} {folder} {path}]' })
    const at = (sel: string) => {
      click(preview(row).querySelector(sel) as Element)
      return title(toolbar(row) as HTMLElement)
    }
    expect(['.link-pills-preview__name', '.file-icon', '.link-pill__id', '.link-pill__vault', '.link-pill__folder', '.link-pill__path', '.link-pill__text', '.wikilink'].map(at)).toEqual(['Styling: the name', 'Styling: the icon', 'Styling: the ID', 'Styling: the vault', 'Styling: the folder', 'Styling: the path', 'Styling: your text', 'Styling: the box'])
    // An icon piece (`{icon}` away from `{name}`) is the icon too.
    const { row: piece } = mount({ format: '{name} {icon}' })
    click(preview(piece).querySelector('.link-pill__icon .file-icon') as Element)
    expect(title(toolbar(piece) as HTMLElement)).toBe('Styling: the icon')
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
    expect(mark.style.getPropertyValue('--pill-mark-icon')).toMatch(/^url\("data:image\/svg\+xml,/)
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
    expect([...(select(bar, 'What to style') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['the name', 'the icon', 'the number', 'the mark', 'your text', 'the box'])
    // A click on the mark's drawing (its mask) lands on the mark.
    act(() => void (preview(row).querySelector('.link-pill__mark') as Element).dispatchEvent(new MouseEvent('click', { bubbles: true })))
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

  it("a click on the pill's icon opens 'Styling: the icon' (YAZ-5843, YAZ-5972): two Colour rows, Pages and files then Cards, Default on in each; a pick sets its row alone; no icon in the format, no 'the icon'", () => {
    const { row, save } = mount(NO_LINK_PILLS)
    click(preview(row).querySelector('.file-icon') as Element)
    const bar = toolbar(row) as HTMLElement
    expect(bar.getAttribute('aria-label')).toBe('Styling: the icon')
    expect(rows(bar)).toEqual(['Pages and files', 'Cards'])
    for (const label of ['Pages and files', 'Cards']) {
      const colour = rowOf(bar, label)
      expect([...colour.querySelectorAll('button[aria-pressed]')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Default', 'true'], ['Accent', 'false'], ['Text', 'false'], ['Muted', 'false']])
      // The ten swatches, then Custom colour… last.
      const radios = [...colour.querySelectorAll('[role="radio"]')]
      expect(radios).toHaveLength(11)
      expect([radios[10].getAttribute('aria-label'), radios[10].getAttribute('aria-checked')]).toEqual(['Custom colour…', 'false'])
    }
    expect(bar.querySelector('button[aria-label="Bold"]')).toBeNull()
    click(rowOf(bar, 'Pages and files').querySelector('[role="radio"][title="Teal"]') as Element)
    expect(save).toHaveBeenLastCalledWith({ parts: { icon: { color: 'teal', cardColor: 'kind' } } })
    click(rowOf(bar, 'Cards').querySelector('[role="radio"][title="Teal"]') as Element)
    expect(save).toHaveBeenLastCalledWith({ parts: { icon: { cardColor: 'teal' } } })
    click(button(rowOf(bar, 'Cards'), 'Accent colour'))
    expect(save).toHaveBeenLastCalledWith({ parts: { icon: { cardColor: 'accent' } } })
    // A file of one colour (before YAZ-5972) shows it in both rows; Default on pages keeps the cards' colour.
    const coloured = mount({ parts: { icon: { color: 'teal' }, name: { bold: true } } })
    click(preview(coloured.row).querySelector('.file-icon') as Element)
    const bar2 = toolbar(coloured.row) as HTMLElement
    for (const label of ['Pages and files', 'Cards'])
      expect([button(rowOf(bar2, label), "Default: the app's icon colours").getAttribute('aria-pressed'), rowOf(bar2, label).querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('title')]).toEqual(['false', 'Teal'])
    expect([preview(coloured.row).style.getPropertyValue('--pill-icon-fg'), preview(coloured.row).style.getPropertyValue('--pill-card-icon-fg')]).toEqual(['var(--table-text-teal)', 'var(--table-text-teal)'])
    click(button(rowOf(bar2, 'Pages and files'), "Default: the app's icon colours"))
    expect(coloured.save).toHaveBeenLastCalledWith({ parts: { name: { bold: true }, icon: { cardColor: 'teal' } } })
    const plain = mount({ format: '{name}' })
    click(preview(plain.row).querySelector('.link-pills-preview__name') as Element)
    expect([...(select(toolbar(plain.row) as HTMLElement, 'What to style') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['the name', 'the box'])
  })

  it('pages red and cards teal (YAZ-5972): the preview carries each row\'s variable; each row shows its own', () => {
    const { row } = mount({ parts: { icon: { color: 'red', cardColor: 'teal' } } })
    expect([preview(row).style.getPropertyValue('--pill-icon-fg'), preview(row).style.getPropertyValue('--pill-card-icon-fg')]).toEqual(['var(--table-text-red)', 'var(--table-text-teal)'])
    click(cardPill(row)!.querySelector('.card-icon') as Element)
    const bar = toolbar(row) as HTMLElement
    expect(['Pages and files', 'Cards'].map((l) => rowOf(bar, l).querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('title'))).toEqual(['Red', 'Teal'])
  })

  it('Custom colour… (YAZ-5972) ends every colour row: it opens the colour box; a pick saves #rrggbb; a hex shows on the swatch, selected', () => {
    const { row, save } = mount(NO_LINK_PILLS)
    click(preview(row).querySelector('.link-pills-preview__name') as Element)
    const bar = toolbar(row) as HTMLElement
    const custom = rowOf(bar, 'Colour').querySelector<HTMLElement>('.pill-toolbar__custom') as HTMLElement
    expect([custom.textContent, custom.getAttribute('aria-checked'), custom.getAttribute('aria-expanded')]).toEqual(['Custom…', 'false', 'false'])
    click(custom)
    expect(custom.getAttribute('aria-expanded')).toBe('true')
    const box = rowOf(bar, 'Colour').querySelector<HTMLElement>('.colour-box') as HTMLElement
    expect(box.hidden).toBe(false)
    // Type R G B and press Enter: one finished pick.
    const fields = [...box.querySelectorAll<HTMLInputElement>('.colour-box__rgb input')]
    act(() => {
      ;['255', '0', '170'].forEach((v, i) => {
        setter?.call(fields[i], v)
        fields[i].dispatchEvent(new Event('input', { bubbles: true }))
      })
      fields[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(save).toHaveBeenLastCalledWith({ parts: { name: { color: '#ff00aa' } } })
    click(custom)
    expect(box.hidden).toBe(true)

    // A stored hex: the swatch shows it and is the selected one; the named colours and swatches are not.
    const hexed = mount({ parts: { name: { color: '#ff00aa' } }, box: { fill: '#3366cc' } })
    expect(preview(hexed.row).style.getPropertyValue('--pill-name-fg')).toBe('#ff00aa')
    click(preview(hexed.row).querySelector('.link-pills-preview__name') as Element)
    const bar2 = toolbar(hexed.row) as HTMLElement
    const checked = rowOf(bar2, 'Colour').querySelectorAll('[role="radio"][aria-checked="true"]')
    expect([...checked].map((r) => r.getAttribute('aria-label'))).toEqual(['Custom colour… (#ff00aa)'])
    expect((checked[0].querySelector('.settings__band-swatch') as HTMLElement).style.background).toMatch(/#ff00aa|rgb\(255, 0, 170\)/)
    expect(rowOf(bar2, 'Colour').querySelector('button[aria-pressed="true"]')).toBeNull()
    // The box: its Fill row too, and Strength shows for a custom fill.
    pick(select(bar2, 'What to style') as HTMLSelectElement, 'the box')
    expect(rowOf(bar2, 'Fill').querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('aria-label')).toBe('Custom colour… (#3366cc)')
    expect(rows(bar2)).toContain('Strength')
    // The mark, every part and the icon's rows end with it too.
    const marked = mount({ format: '{icon} {name} {id}{mark}' })
    for (const part of ['the mark', 'the ID', 'the icon']) {
      click(preview(marked.row).querySelector('.link-pills-preview__name') as Element)
      const b = toolbar(marked.row) as HTMLElement
      pick(select(b, 'What to style') as HTMLSelectElement, part)
      const colourRows = [...b.querySelectorAll<HTMLElement>('.pill-toolbar__row')].filter((r) => r.querySelector('.settings__band-colours') !== null)
      expect(colourRows.length).toBeGreaterThan(0)
      for (const r of colourRows) expect([...r.querySelectorAll('[role="radio"]')].at(-1)?.classList.contains('pill-toolbar__custom')).toBe(true)
    }
  })

  it("YAZ-5919: the card pill follows the format and its icon opens 'Styling: the icon'; its edge the box", () => {
    const { row, save } = mount({ format: '{icon}{name} #{number}{mark}', parts: { icon: { color: 'red' } } })
    const card = cardPill(row)!
    expect(card.textContent).toBe('Capital of France #34')
    expect([card.querySelector('.link-pill__number')?.textContent, card.querySelector('.link-pill__mark') !== null]).toEqual(['34', true])
    // The colour and the gap reach both pills: they ride on the preview, as on a page's layer.
    expect([preview(row).style.getPropertyValue('--pill-icon-fg'), preview(row).style.getPropertyValue('--pill-icon-gap')]).toEqual(['var(--table-text-red)', '1px'])
    click(card.querySelector('.card-icon') as Element)
    expect(title(toolbar(row) as HTMLElement)).toBe('Styling: the icon')
    click(button(rowOf(toolbar(row) as HTMLElement, 'Cards'), 'Muted'))
    expect(save).toHaveBeenLastCalledWith({ format: '{icon}{name} #{number}{mark}', parts: { icon: { color: 'red', cardColor: 'muted' } } })
    click(card.querySelector('.link-pills-preview__name') as Element)
    expect(title(toolbar(row) as HTMLElement)).toBe('Styling: the name')
    click(card)
    expect(title(toolbar(row) as HTMLElement)).toBe('Styling: the box')
    // The icon as a piece (`{name} · {icon}`): the card icon stands in the tail and still opens the icon.
    const piece = mount({ format: '{name} · {icon}' }).row
    click(cardPill(piece)!.querySelector('.link-pill__icon .card-icon') as Element)
    expect(title(toolbar(piece) as HTMLElement)).toBe('Styling: the icon')
    // No {icon}: no card icon.
    expect(cardPill(mount({ format: '{name}' }).row)!.querySelector('.card-icon')).toBeNull()
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

  it("the hint under the chips says the vault's word (YAZ-4950): a Doc vault reads \"doc\"", () => {
    expect(mount(NO_LINK_PILLS).row.querySelector('.settings__tokens')?.textContent).toBe('Other text shows as you type it. An empty part, like the ID of a page without one, takes its text with it.')
    act(() => root?.unmount())
    container?.remove()
    expect(mount(NO_LINK_PILLS, false, UNIT_WORDS.doc).row.querySelector('.settings__tokens')?.textContent).toBe('Other text shows as you type it. An empty part, like the ID of a doc without one, takes its text with it.')
  })

  it('an old look reaches the row converted: the format box shows version 1 as a format', () => {
    const { row } = mount({ format: '({icon}{name} ({vault}))', parts: { text: { color: 'accent', size: 'normal' } } })
    expect(formatBox(row).value).toBe('({icon}{name} ({vault}))')
    expect(pillTexts(row)).toEqual(['(Roadmap (Mine))'])
  })

  it('YAZ-6002 (D5): Hover subsection under Preview edits Style, Colour and Strength and updates preview vars; searching "hover" finds Link pills', () => {
    const { row, save } = mount(NO_LINK_PILLS)
    const hover = row.querySelector<HTMLElement>('.link-pills-hover')!
    expect(hover).not.toBeNull()
    expect(rows(hover)).toEqual(['Style', 'Colour', 'Strength'])
    expect([...rowOf(hover, 'Style').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Wash', 'Underline', 'Text colour', 'Off'])
    expect([...rowOf(hover, 'Strength').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Subtle', 'Medium', 'Strong'])
    expect(button(rowOf(hover, 'Style'), 'Wash').getAttribute('aria-pressed')).toBe('true')
    expect(button(rowOf(hover, 'Colour'), 'Auto hover colour').getAttribute('aria-pressed')).toBe('true')
    expect(button(rowOf(hover, 'Strength'), 'Subtle').getAttribute('aria-pressed')).toBe('true')
    click(rowOf(hover, 'Colour').querySelector('[role="radio"][title="Purple"]') as Element)
    expect(save).toHaveBeenLastCalledWith({ hover: { color: 'purple' } })
    click(button(rowOf(hover, 'Strength'), 'Strong'))
    expect(save).toHaveBeenLastCalledWith({ hover: { strength: 'strong' } })
    click(button(rowOf(hover, 'Style'), 'Off'))
    expect(save).toHaveBeenLastCalledWith({ hover: { style: 'off' } })

    const off = mount({ hover: { style: 'off' } })
    expect(rows(off.row.querySelector<HTMLElement>('.link-pills-hover')!)).toEqual(['Style'])
    expect(preview(off.row).style.getPropertyValue('--pill-hover-off')).toBe('1')
    expect(button(off.row, 'Reset')).toBeDefined()

    const text = mount({ hover: { style: 'text', color: 'teal' } })
    expect(rows(text.row.querySelector<HTMLElement>('.link-pills-hover')!)).toEqual(['Style', 'Colour'])
    expect(preview(text.row).style.getPropertyValue('--pill-hover-fg')).toBe('var(--table-text-teal)')
  })
})
