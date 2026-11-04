/**
 * The selection toolbar (`createCrepe.ts` `buildToolbar`): the Heading group (YAZ-923) and the
 * Highlight button that joins Crepe's own Formatting group (YAZ-1480).
 *
 * Tested through a REAL Crepe (the `wikilinkPicker.test.ts` mount idiom), not a stub builder:
 * the group is wired via `featureConfigs[CrepeFeature.Toolbar].buildToolbar`, so mounting is the
 * only thing that proves the wiring, that the group is ADDED and LEADS the strip (YAZ-2700 D13 —
 * stock Bold/Italic/… survive, after it), and that `active`/`onRun` run against a real `Ctx` —
 * real selection, real commands, real markdown out. The order is read off the real strip because
 * the move to the front counts on Crepe's `GroupBuilder.build()` handing back its own array: a
 * Crepe that copied it would leave the group last, with no error.
 *
 * NB: Crepe's toolbar items fire on POINTERDOWN, not click (a click never reaches them because
 * the button must act before the editor's selection is torn down) — hence `press()` below.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { toolbarPrefs } from './toolbarPrefs'
import { HIGHLIGHT_HEX } from './marks/highlight'
import { readHex, shadesOf } from './highlightPanel'
import { setUsedHighlightColors, setUsedHighlightColorsSaver } from './highlightUsed'
import { DEFAULT_TOOLBAR } from '@shared/types'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** The Heading group's items, in the order `buildToolbar` adds them. */
const HEADING_ITEMS = ['h1', 'h2', 'h3', 'text'] as const
type HeadingItem = (typeof HEADING_ITEMS)[number]

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.focus()
  return { crepe, view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.milkdown-toolbar').forEach((el) => el.remove())
  toolbarPrefs.value = DEFAULT_TOOLBAR
})

/** Let the toolbar's own update tick land (it renders off the view update, not synchronously). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

/** Start of `text` inside a single text node. */
function find(view: EditorView, text: string): number {
  let from = -1
  view.state.doc.descendants((node, pos) => {
    if (from >= 0) return false
    const index = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (index >= 0) from = pos + index
    return from < 0
  })
  if (from < 0) throw new Error(`text not found: ${text}`)
  return from
}

/** Select from the start of `start` to the end of `end` — the toolbar only shows for a non-empty selection. */
async function selectSpan(view: EditorView, start: string, end: string): Promise<void> {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, find(view, start), find(view, end) + end.length)))
  await settle()
}

const select = (view: EditorView, text: string) => selectSpan(view, text, text)

function item(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.milkdown-toolbar [data-toolbar-item="${key}"]`)
}

function must(key: string): HTMLElement {
  const el = item(key)
  if (el === null) throw new Error(`no toolbar item: ${key}`)
  return el
}

/** Which of H1/H2/H3/T the toolbar is lighting up right now. */
function actives(): HeadingItem[] {
  return HEADING_ITEMS.filter((key) => must(key).classList.contains('active'))
}

/** The highlight swatches, in the order `buildToolbar` adds them (YAZ-4348 demo round 2: pink went into the ▾ panel). */
const SWATCHES = ['highlight', 'highlight-green', 'highlight-blue'] as const

/** Crepe's toolbar buttons act on pointerdown — a plain `.click()` is a no-op here. */
async function press(key: string): Promise<void> {
  must(key).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
  await settle()
}

/** Every item key in the strip, left to right. */
function order(): Array<string | undefined> {
  return [...document.querySelectorAll<HTMLElement>('.milkdown-toolbar [data-toolbar-item]')].map((b) => b.dataset.toolbarItem)
}

/** Which swatches the toolbar is lighting up right now. */
const litDots = (): Array<(typeof SWATCHES)[number]> => SWATCHES.filter((key) => must(key).classList.contains('active'))

describe('Heading toolbar group (YAZ-923)', () => {
  it('H1/H2/H3/T lead the selection toolbar — labelled, glyph-iconed — and every stock item is still there, after them, in one tab order', async () => {
    const { view } = await mount('# One\n\nplain\n')
    await select(view, 'plain')

    const buttons = HEADING_ITEMS.map(must)
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Heading 1', 'Heading 2', 'Heading 3', 'Text'])
    expect(buttons.map((b) => b.title)).toEqual(['Heading 1', 'Heading 2', 'Heading 3', 'Text'])
    // The label IS the icon: an `Hn` / `T` glyph drawn as SVG text.
    expect(buttons.map((b) => b.querySelector('svg text')?.textContent)).toEqual(['H1', 'H2', 'H3', 'T'])

    // A GROUP was added, not a replacement toolbar: Crepe's own marks are all still there. The
    // Heading group LEADS the strip (YAZ-2700): its buttons are the ones under the hand.
    expect(item('bold')).not.toBeNull()
    expect(item('italic')).not.toBeNull()
    const order = [...document.querySelectorAll<HTMLElement>('.milkdown-toolbar [data-toolbar-item]')].map(
      (b) => b.dataset.toolbarItem,
    )
    expect(order.slice(0, 4)).toEqual(['h1', 'h2', 'h3', 'text'])
    expect(order.indexOf('text')).toBeLessThan(order.indexOf('bold'))

    // The WHOLE strip (D13, YAZ-3806 T1, T8), dividers too: the Heading group, the Lists group,
    // Crepe's Formatting group with Underline, the three swatches and their ▾, then its code and link — one
    // divider between two groups, none at an end.
    const strip = [...document.querySelector('.milkdown-toolbar')!.children].map((el) => (el as HTMLElement).dataset.toolbarItem ?? (el.classList.contains('divider') ? '|' : el.tagName))
    expect(strip).toEqual([
      'h1', 'h2', 'h3', 'text', '|',
      'checklist', 'bulletList', 'numberedList', '|',
      'bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-more', '|',
      'code', 'link',
    ])
    // The tab order is that order: every item is a button where it stands, and none jumps the queue or leaves it.
    const items = [...document.querySelectorAll<HTMLElement>('.milkdown-toolbar [data-toolbar-item]')]
    expect(items.every((button) => button.tagName === 'BUTTON' && button.tabIndex === 0)).toBe(true)
  })

  it('lights exactly the block\'s own level — the invisible ## made visible', async () => {
    const { view } = await mount('# One\n\n## Two\n\n### Three\n\nplain\n')

    await select(view, 'One')
    expect(actives()).toEqual(['h1'])
    await select(view, 'Two')
    expect(actives()).toEqual(['h2'])
    await select(view, 'Three')
    expect(actives()).toEqual(['h3'])
  })

  it('lights T — and no heading — inside a plain paragraph', async () => {
    const { view } = await mount('## Two\n\nplain\n')
    await select(view, 'plain')
    expect(actives()).toEqual(['text'])
  })

  it('lights nothing for a block that is neither: a level past the group (h4) reads as no answer', async () => {
    const { view } = await mount('#### Four\n')
    await select(view, 'Four')
    expect(actives()).toEqual([])
  })

  it('pressing a level writes the markdown that typing its hashes would', async () => {
    const { crepe, view } = await mount('plain\n')

    await select(view, 'plain')
    await press('h1')
    expect(getMarkdownForSave(crepe)).toBe('# plain\n')

    await select(view, 'plain')
    await press('h3')
    expect(getMarkdownForSave(crepe)).toBe('### plain\n')
  })

  it('T is the way back: a heading turns into a plain paragraph without backspacing hashes', async () => {
    const { crepe, view } = await mount('## Two\n\ntail\n')
    await select(view, 'Two')
    await press('text')
    expect(getMarkdownForSave(crepe)).toBe('Two\n\ntail\n')
  })

  it('only the selected block changes; the rest of the document is left alone', async () => {
    const { crepe, view } = await mount('# One\n\n## Two\n\nplain\n')
    await select(view, 'plain')
    await press('h2')
    expect(getMarkdownForSave(crepe)).toBe('# One\n\n## Two\n\n## plain\n')
  })

  it('the lit button follows the press: switching level re-lights, T un-lights every heading', async () => {
    const { view } = await mount('plain\n')

    await select(view, 'plain')
    expect(actives()).toEqual(['text'])

    await press('h2')
    await select(view, 'plain')
    expect(actives()).toEqual(['h2'])

    await press('text')
    await select(view, 'plain')
    expect(actives()).toEqual(['text'])
  })

  it('pressing the level a block already is leaves it exactly as it was', async () => {
    const { crepe, view } = await mount('## Two\n')
    await select(view, 'Two')
    await press('h2')
    expect(getMarkdownForSave(crepe)).toBe('## Two\n')
    await select(view, 'Two')
    expect(actives()).toEqual(['h2'])
  })
})

/**
 * The Highlight swatches (YAZ-1480): unlike the Heading group they do NOT get a group of their
 * own — they are added into Crepe's OWN Formatting group, so they land beside
 * Bold/Italic/Strikethrough instead of at the far end of the strip. A dot lights when ANY of the
 * selection carries its colour (🔒 D5, Bold's rule), so a partly highlighted line still shows it
 * and the press then removes.
 */
describe('highlight swatches (YAZ-1480)', () => {
  it('three dots join Crepe\'s Formatting group, in order, after Strikethrough and before Inline code; pink is not one (YAZ-4348 demo round 2)', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')

    const keys = order()
    const at = keys.indexOf('strikethrough')
    expect(keys.slice(at + 1, at + 4)).toEqual([...SWATCHES])
    expect(keys.indexOf('highlight-blue')).toBeLessThan(keys.indexOf('code'))
    expect(item('highlight-pink')).toBeNull()
  })

  it('yellow carries the shortcut in its title AND in aria-keyshortcuts; the colours are labelled by name', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')

    // Gathered into one object so a single wrong attribute does not hide the other two.
    // The title is for eyes; `aria-keyshortcuts` is for screen readers, and it is spelled the way
    // the ARIA spec demands (`Meta+Shift+H`), not with the ⌘ glyph. Both come from the keymap.
    const attrs = (key: string) => ({
      label: must(key).getAttribute('aria-label'),
      title: must(key).title,
      keys: must(key).getAttribute('aria-keyshortcuts'),
    })
    expect(attrs('highlight')).toEqual({ label: 'Highlight', title: 'Highlight (⇧⌘H)', keys: 'Meta+Shift+H' })
    // A colour has no shortcut at all — no empty attribute left behind.
    expect(attrs('highlight-green')).toEqual({ label: 'Highlight green', title: 'Highlight green', keys: null })
  })

  it('pressing green wraps the selection in `<mark class="highlight-green">`, pressing it again removes it', async () => {
    const { crepe, view } = await mount('hello world\n')

    await select(view, 'world')
    await press('highlight-green')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-green">world</mark>\n')

    await select(view, 'world')
    await press('highlight-green')
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('every colour present in the selection lights its dot — a partly highlighted line included — and the press removes it', async () => {
    const { crepe, view } = await mount('==yellow== and <mark class="highlight-green">green</mark> and plain\n')

    await select(view, 'green')
    expect(litDots()).toEqual(['highlight-green'])

    await select(view, 'yellow')
    expect(litDots()).toEqual(['highlight'])

    await select(view, 'plain')
    expect(litDots()).toEqual([])

    await selectSpan(view, 'yellow', 'plain')
    expect(litDots()).toEqual(['highlight', 'highlight-green'])
    await press('highlight')
    expect(getMarkdownForSave(crepe)).toBe('yellow and <mark class="highlight-green">green</mark> and plain\n')
  })

  /**
   * The strip re-reads itself after its own press: the selection survives the command, so the dot
   * you just pressed answers the NEW state — lit becomes unlit, and unlit becomes lit — without
   * the user having to re-select to see it.
   */
  it('a press re-lights the strip it pressed: green off leaves nothing lit, yellow on plain lights yellow', async () => {
    const { crepe, view } = await mount('<mark class="highlight-green">green</mark> and plain\n')

    await select(view, 'green')
    expect(litDots()).toEqual(['highlight-green'])
    await press('highlight-green')
    expect(litDots()).toEqual([])

    await select(view, 'plain')
    expect(litDots()).toEqual([])
    await press('highlight')
    expect(litDots()).toEqual(['highlight'])
    expect(getMarkdownForSave(crepe)).toBe('green and ==plain==\n')
  })
})

/**
 * The highlight buttons' look and their ▾ panel (YAZ-4348 demo round 2, `highlightPanel.ts`): each button is a bold
 * "A" on a square of its wash token, yellow, green and blue; the ▾ opens the board's colour popup on the body — most
 * used custom colours, the 8 colours and None, shades, a hex code — so the toolbar's `overflow: hidden` cannot cut
 * it off, without taking the selection, and open for the next pick.
 */
describe('highlight buttons and the ▾ panel (YAZ-4348 demo round 2)', () => {
  const panel = () => document.querySelector<HTMLElement>('body > .highlight-panel')
  const isOpen = () => panel() !== null && !panel()!.hidden
  const swatch = (label: string) => {
    const el = panel()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (el == null) throw new Error(`no swatch: ${label}`)
    return el
  }
  const labels = (section: number) => [...panel()!.querySelectorAll('.highlight-panel__section')[section].querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
  const headings = () => [...panel()!.querySelectorAll<HTMLElement>('.highlight-panel__section:not([hidden]) .highlight-panel__heading')].map((h) => h.textContent)
  const ringed = () => [...panel()!.querySelectorAll('.highlight-panel__swatch.active')].map((b) => b.getAttribute('aria-label'))
  const shades = () => [...panel()!.querySelectorAll<HTMLButtonElement>('.highlight-panel__section:nth-child(3) .highlight-panel__swatch')].map((b) => b.title.split(' ').pop())
  const hexInput = () => panel()!.querySelector<HTMLInputElement>('.highlight-panel__hex-input')!
  /** A real click on a swatch: the mousedown the panel cancels, then the click. */
  const click = async (label: string) => {
    const el = swatch(label)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    el.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    await settle()
  }
  const key = (k: string, at: Element = document.activeElement!) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    at.dispatchEvent(event)
    return event
  }
  const box = () => panel()!.querySelector<HTMLElement>('.highlight-panel__box')!
  const boxOpen = () => !box().hidden
  const pencil = () => panel()!.querySelector<HTMLButtonElement>('button[aria-label="Custom colour…"]')!
  const clickPencil = () => {
    pencil().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    pencil().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  }
  const field = (name: 'Red' | 'Green' | 'Blue') => box().querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!
  /** A pointer on the box's square or slider, at (x, y) in a 100 × 100 box at the window's top left. */
  const pointer = (type: string, x: number, y: number, at: EventTarget) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    at.dispatchEvent(event)
    return event
  }
  const saved = vi.fn()

  beforeEach(() => {
    setUsedHighlightColors([])
    saved.mockReset()
    setUsedHighlightColorsSaver(saved)
  })
  afterEach(() => {
    document.querySelectorAll('.highlight-panel').forEach((el) => el.remove())
    setUsedHighlightColors([])
    setUsedHighlightColorsSaver(() => {})
  })

  it('each highlight button is a bold "A" on a square of its own wash token — yellow, green, blue — and the ▾ follows them', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    const tokens = ['--mark-bg', '--mark-bg-green', '--mark-bg-blue']
    SWATCHES.forEach((key, i) => {
      const square = must(key).querySelector('svg rect.highlight-icon__wash')
      expect(square?.getAttribute('fill')).toBe(`var(${tokens[i]})`)
      const letter = must(key).querySelector('svg text.highlight-icon__a')
      expect(letter?.textContent).toBe('A')
      expect(letter?.getAttribute('font-weight')).toBe('800')
    })
    const keys = order()
    expect(keys[keys.indexOf('highlight-blue') + 1]).toBe('highlight-more')
    expect(must('highlight-more').getAttribute('aria-label')).toBe('More highlight colours')
  })

  it('the lit button is the selection\'s colour (the ring); the ▾ lights for pink, a panel colour or a custom one', async () => {
    const { view } = await mount('<mark class="highlight-blue">blue</mark> <mark class="highlight-pink">pink</mark> <mark class="highlight-orange">orange</mark> <mark style="background-color: #3366ff">mine</mark> plain\n')
    await select(view, 'blue')
    expect(litDots()).toEqual(['highlight-blue'])
    expect(must('highlight-more').classList.contains('active')).toBe(false)
    for (const text of ['pink', 'orange', 'mine']) {
      await select(view, text)
      expect(litDots()).toEqual([])
      expect(must('highlight-more').classList.contains('active')).toBe(true)
    }
    await select(view, 'plain')
    expect(must('highlight-more').classList.contains('active')).toBe(false)
  })

  it('the ▾ opens the panel on the body: Colors (None and the 8), Shades, Hex code — and keeps the selection and the focus', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    const before = view.state.selection
    await press('highlight-more')
    expect(isOpen()).toBe(true)
    expect(panel()!.closest('.milkdown-toolbar')).toBeNull()
    expect(panel()!.getAttribute('role')).toBe('dialog')
    // No custom colour used yet: no "Most used custom colors" row.
    expect(headings()).toEqual(['Colors', 'Shades', 'Hex code'])
    expect(labels(1)).toEqual(['None', 'Highlight yellow', 'Highlight green', 'Highlight blue', 'Highlight pink', 'Highlight orange', 'Highlight purple', 'Highlight red', 'Highlight gray'])
    expect(swatch('None').classList.contains('is-none')).toBe(true)
    expect(swatch('Highlight pink').style.getPropertyValue('--swatch')).toBe('var(--mark-bg-pink)')
    expect(swatch('Highlight yellow').style.getPropertyValue('--swatch')).toBe('var(--mark-bg)')
    // Nothing highlighted: None wears the ring, no shades, an empty hex.
    expect(ringed()).toEqual(['None'])
    expect(panel()!.querySelector('.highlight-panel__no-shades')?.textContent).toBe('No shades available for this color')
    expect(hexInput().value).toBe('')
    expect(view.state.selection.eq(before)).toBe(true)
    expect(view.hasFocus()).toBe(true)
    // A second press closes it.
    await press('highlight-more')
    expect(isOpen()).toBe(false)
  })

  it('a colour saves its class form, pink included; the panel stays open, the ring moves, and each pick is one undo step', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    await click('Highlight pink')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-pink">world</mark>\n')
    expect(isOpen()).toBe(true)
    expect(ringed()).toEqual(['Highlight pink'])
    expect(hexInput().value).toBe(HIGHLIGHT_HEX.pink.slice(1))
    expect(shades()[2]).toBe(HIGHLIGHT_HEX.pink)
    await click('Highlight orange')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-orange">world</mark>\n')
    expect(ringed()).toEqual(['Highlight orange'])
    // Picking the lit colour again keeps it: the panel is not a toggle.
    await click('Highlight orange')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-orange">world</mark>\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-pink">world</mark>\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('None takes every colour off the selection', async () => {
    const { crepe, view } = await mount('==a== <mark class="highlight-red">b</mark> <mark style="background-color: #3366ff">c</mark> d\n')
    await selectSpan(view, 'a', 'd')
    await press('highlight-more')
    expect(ringed()).toEqual(['Highlight yellow', 'Highlight red'])
    await click('None')
    expect(getMarkdownForSave(crepe)).toBe('a b c d\n')
    expect(ringed()).toEqual(['None'])
  })

  it('a shade is a custom colour: it saves the style form, keeps its row of shades, and counts as a use', async () => {
    const { crepe, view } = await mount('<mark class="highlight-blue">world</mark>\n')
    await select(view, 'world')
    await press('highlight-more')
    const row = shades()
    expect(row).toEqual(shadesOf(HIGHLIGHT_HEX.blue))
    // Lighter to darker: each step's channels add up to less than the one before.
    const light = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0)
    const lights = row.map((s) => light(s!))
    expect(lights).toEqual([...lights].sort((a, b) => b - a))
    expect(new Set(lights).size).toBe(5)
    await click(`Shade 4 ${row[3]}`)
    expect(getMarkdownForSave(crepe)).toBe(`<mark style="background-color: ${row[3]}">world</mark>\n`)
    expect(shades()).toEqual(row)
    expect(swatch(`Shade 4 ${row[3]}`).classList.contains('active')).toBe(true)
    expect(swatch('Highlight blue').classList.contains('active')).toBe(false)
    expect(saved).toHaveBeenLastCalledWith([{ color: row[3], uses: 1 }])
    // The row of most used custom colours shows it now.
    expect(headings()).toEqual(['Most used custom colors', 'Colors', 'Shades', 'Hex code'])
    expect(labels(0)).toEqual([row[3]])
  })

  it('the most used row: most used first, a click applies and counts; at most five', async () => {
    setUsedHighlightColors([
      { color: '#3366ff', uses: 3 },
      { color: '#00aa00', uses: 2 },
      { color: '#111111', uses: 1 },
      { color: '#222222', uses: 1 },
      { color: '#333333', uses: 1 },
      { color: '#444444', uses: 1 },
    ])
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    expect(labels(0)).toEqual(['#3366ff', '#00aa00', '#111111', '#222222', '#333333'])
    await click('#00aa00')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #00aa00">world</mark>\n')
    // Three uses each now: the latest goes first.
    expect(saved.mock.lastCall![0].slice(0, 2)).toEqual([{ color: '#00aa00', uses: 3 }, { color: '#3366ff', uses: 3 }])
    expect(swatch('#00aa00').classList.contains('active')).toBe(true)
  })

  it('Hex code: a valid hex and Enter applies it with the focus back in the note; an invalid one does nothing', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    hexInput().focus()
    hexInput().value = 'zz12'
    expect(key('Enter', hexInput()).defaultPrevented).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    hexInput().value = '#ABCDEF'
    key('Enter', hexInput())
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #abcdef">world</mark>\n')
    expect(view.hasFocus()).toBe(true)
    expect(isOpen()).toBe(true)
    expect(hexInput().value).toBe('abcdef')
    // Three digits read as six.
    expect(readHex('f80')).toBe('#ff8800')
    // Escape in the field closes the panel and gives the focus back to the note.
    hexInput().focus()
    key('Escape', hexInput())
    expect(isOpen()).toBe(false)
    expect(view.hasFocus()).toBe(true)
  })

  it('the pencil and the field open the panel\'s own colour box right under the Hex code field, never the system picker', async () => {
    const { view } = await mount('<mark class="highlight-green">hello</mark> world\n')
    await select(view, 'world')
    await press('highlight-more')
    expect(boxOpen()).toBe(false)
    clickPencil()
    expect(boxOpen()).toBe(true)
    // Inside the panel, right after the Hex code field, in its section.
    const hexField = panel()!.querySelector('.highlight-panel__hex')!
    expect(hexField.nextElementSibling).toBe(box())
    expect(pencil().getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('input[type="color"]')).toBeNull()
    expect(box().querySelector('[aria-label="Saturation and brightness"] .highlight-panel__sv-handle')).not.toBeNull()
    expect(box().querySelector('[aria-label="Hue"] .highlight-panel__hue-handle')).not.toBeNull()
    // Nothing on the selection: the box starts on yellow.
    expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['255', '213', '0'])
    expect(view.hasFocus()).toBe(true)
    // The pencil again closes just the box.
    clickPencil()
    expect(boxOpen()).toBe(false)
    expect(isOpen()).toBe(true)

    // A mousedown on the field opens it too, on the field's colour.
    await select(view, 'hello')
    await press('highlight-more')
    hexInput().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(boxOpen()).toBe(true)
    expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['80', '200', '120'])
    // A hex typed in the field moves the box.
    hexInput().value = '3366ff'
    hexInput().dispatchEvent(new Event('input', { bubbles: true }))
    expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['51', '102', '255'])
  })

  it('a drag in the box previews, and its release is one pick: one undo step, one use; the box stays open', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    const square = box().querySelector<HTMLElement>('.highlight-panel__sv')!
    const hue = box().querySelector<HTMLElement>('.highlight-panel__hue')!
    for (const el of [square, hue]) vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    // The square keeps the selection and the focus.
    expect(pointer('mousedown', 50, 50, square).defaultPrevented).toBe(true)
    pointer('pointerdown', 50, 50, square)
    pointer('pointermove', 100, 0, document)
    // Yellow's hue, full saturation and brightness: the hex field and R G B follow, the text does not yet.
    expect(hexInput().value).toBe('ffd500')
    pointer('pointermove', 100, 50, document)
    expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['128', '106', '0'])
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    expect(saved).not.toHaveBeenCalled()
    pointer('pointerup', 100, 50, document)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #806a00">world</mark>\n')
    expect(saved).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenLastCalledWith([{ color: '#806a00', uses: 1 }])
    expect(isOpen()).toBe(true)
    expect(boxOpen()).toBe(true)
    expect(view.hasFocus()).toBe(true)
    // A move after the release does nothing.
    pointer('pointermove', 0, 100, document)
    expect(hexInput().value).toBe('806a00')
    // The hue slider: red, the same saturation and brightness.
    pointer('pointerdown', 0, 5, hue)
    pointer('pointerup', 0, 5, document)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #800000">world</mark>\n')
    expect(saved).toHaveBeenCalledTimes(2)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #806a00">world</mark>\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('R G B from the keyboard: typing previews, Enter is one pick with the focus back in the note', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    const type = (name: 'Red' | 'Green' | 'Blue', value: string) => {
      field(name).focus()
      field(name).value = value
      field(name).dispatchEvent(new Event('input', { bubbles: true }))
    }
    type('Red', '51')
    type('Green', '102')
    type('Blue', '255')
    expect(hexInput().value).toBe('3366ff')
    // Keys in a field are its own: a letter does not close the panel.
    expect(key('x', field('Blue')).defaultPrevented).toBe(false)
    expect(isOpen()).toBe(true)
    // The up arrow steps the channel.
    key('ArrowUp', field('Blue'))
    expect(field('Blue').value).toBe('255')
    key('ArrowDown', field('Red'))
    expect(hexInput().value).toBe('3266ff')
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    expect(key('Enter', field('Red')).defaultPrevented).toBe(true)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #3266ff">world</mark>\n')
    expect(saved).toHaveBeenCalledTimes(1)
    expect(view.hasFocus()).toBe(true)
    expect(boxOpen()).toBe(true)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('Escape closes only the box — from the note, the hex field or an R G B field — and a second one the panel', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    expect(key('Escape').defaultPrevented).toBe(true)
    expect(boxOpen()).toBe(false)
    expect(isOpen()).toBe(true)
    key('Escape')
    expect(isOpen()).toBe(false)

    await press('highlight-more')
    clickPencil()
    field('Green').focus()
    key('Escape', field('Green'))
    expect(boxOpen()).toBe(false)
    expect(isOpen()).toBe(true)
    expect(view.hasFocus()).toBe(true)

    hexInput().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    hexInput().focus()
    key('Escape', hexInput())
    expect(boxOpen()).toBe(false)
    expect(isOpen()).toBe(true)
    expect(view.state.selection.empty).toBe(false)
    // Closing the panel takes the box with it: the next open starts without it.
    clickPencil()
    key('Escape', hexInput())
    key('Escape', hexInput())
    expect(isOpen()).toBe(false)
    await press('highlight-more')
    expect(boxOpen()).toBe(false)
  })

  it('the eyedropper: hidden without the browser\'s EyeDropper; with it, its colour is one pick', async () => {
    const win = window as unknown as { EyeDropper?: unknown }
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    const dropper = () => box().querySelector<HTMLButtonElement>('button[aria-label="Pick a colour from the screen"]')!
    expect(dropper().hidden).toBe(true)
    clickPencil()
    win.EyeDropper = class {
      open = () => Promise.resolve({ sRGBHex: '#123456' })
    }
    try {
      clickPencil()
      expect(dropper().hidden).toBe(false)
      dropper().click()
      await settle()
      expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #123456">world</mark>\n')
      expect(saved).toHaveBeenCalledTimes(1)
      expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['18', '52', '86'])
      // Cancelled (Escape in the eyedropper): nothing.
      win.EyeDropper = class {
        open = () => Promise.reject(new DOMException('cancelled', 'AbortError'))
      }
      dropper().click()
      await settle()
      expect(saved).toHaveBeenCalledTimes(1)
    } finally {
      delete win.EyeDropper
    }
  })

  it('a box pick after its text was deleted does nothing: the panel and the box are gone', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    const enter = field('Red')
    const from = view.state.doc.textContent.indexOf('world') + 1
    view.dispatch(view.state.tr.delete(from, from + 5))
    expect(isOpen()).toBe(false)
    key('Enter', enter)
    expect(getMarkdownForSave(crepe)).not.toContain('<mark')
    expect(view.state.doc.textContent).toBe('hello ')
    expect(saved).not.toHaveBeenCalled()
  })

  it('Escape closes it and goes no further; a mousedown outside closes it; a new selection closes it', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    const esc = key('Escape')
    expect(esc.defaultPrevented).toBe(true)
    expect(isOpen()).toBe(false)
    expect(view.state.selection.empty).toBe(false)

    await press('highlight-more')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(isOpen()).toBe(false)

    await press('highlight-more')
    await select(view, 'hello')
    expect(isOpen()).toBe(false)
  })

  it('works from the keyboard: the arrows walk the swatches as a grid, Enter picks and the panel stays; a key press on the ▾ opens it on the first swatch', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    // Enter or Space on a focused ▾ is a click with no pointer (detail 0).
    must('highlight-more').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))
    expect(isOpen()).toBe(true)
    const current = () => panel()!.querySelector('.is-current')?.getAttribute('aria-label') ?? null
    expect(current()).toBe('None')
    expect(key('ArrowRight').defaultPrevented).toBe(true)
    expect(current()).toBe('Highlight yellow')
    key('ArrowDown')
    expect(current()).toBe('Highlight purple')
    expect(key('Enter').defaultPrevented).toBe(true)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-purple">world</mark>\n')
    expect(isOpen()).toBe(true)
    expect(current()).toBe('Highlight purple')
    // Purple has shades now: down again is its second shade.
    key('ArrowDown')
    expect(current()).toBe(`Shade 2 ${shadesOf(HIGHLIGHT_HEX.purple)[1]}`)
    key('ArrowDown')
    expect(panel()!.querySelector('.is-current')?.classList.contains('highlight-panel__pencil')).toBe(true)
    key('End')
    expect(current()).toBe('Custom colour…')
    key('Home')
    expect(current()).toBe('None')
    key('ArrowLeft')
    expect(current()).toBe('Custom colour…')
    // Any other key closes it and goes on to the note.
    expect(key('x').defaultPrevented).toBe(false)
    expect(isOpen()).toBe(false)
  })
})

/**
 * The Lists group and Underline (YAZ-3806 T1, T3, T8), and T in a list (YAZ-4369, which replaces T4). The rule itself
 * is `listButtons.test.ts`'s table; here the buttons are pressed on the real strip.
 */
describe('list buttons and Underline (YAZ-3806)', () => {
  const LISTS = ['checklist', 'bulletList', 'numberedList'] as const
  const litLists = () => LISTS.filter((key) => must(key).classList.contains('active'))

  it('the three list buttons are labelled; a press makes the line a bullet and lights Bullet, a second press makes it text', async () => {
    const { crepe, view } = await mount('plain\n')
    await select(view, 'plain')
    expect(LISTS.map((key) => must(key).getAttribute('aria-label'))).toEqual(['Checklist', 'Bullet list', 'Numbered list'])
    expect(litLists()).toEqual([])

    await press('bulletList')
    expect(getMarkdownForSave(crepe)).toBe('* plain\n')
    expect(litLists()).toEqual(['bulletList'])
    // T lights for every plain line, in a list or not (YAZ-4369): the bullet is still a paragraph.
    expect(actives()).toEqual(['text'])

    await press('bulletList')
    expect(getMarkdownForSave(crepe)).toBe('plain\n')
    expect(actives()).toEqual(['text'])
  })

  it('T on an H3 bullet: a plain line in the same bullet; its children and siblings stay (YAZ-4369)', async () => {
    const { crepe, view } = await mount('* ### one\n  * kid\n* two\n')
    await select(view, 'one')
    expect(actives()).toEqual(['h3'])
    expect(litLists()).toEqual(['bulletList'])
    await press('text')
    expect(getMarkdownForSave(crepe)).toBe('* one\n  * kid\n* two\n')
    await select(view, 'one')
    expect(actives()).toEqual(['text'])
    expect(litLists()).toEqual(['bulletList'])
    // A second T on the plain bullet changes nothing; the lit Bullet takes it out of the list.
    await press('text')
    expect(getMarkdownForSave(crepe)).toBe('* one\n  * kid\n* two\n')
  })

  it('Numbered and Checklist press the same rule', async () => {
    const { crepe, view } = await mount('one\n')
    await select(view, 'one')
    await press('numberedList')
    expect(getMarkdownForSave(crepe)).toBe('1. one\n')
    expect(litLists()).toEqual(['numberedList'])
    await press('checklist')
    expect(getMarkdownForSave(crepe)).toBe('* [ ] one\n')
    expect(litLists()).toEqual(['checklist'])
  })

  it('U sits after Italic, names ⌘U, lights for underlined text, and its press takes the underline off', async () => {
    const { crepe, view } = await mount('a <u>word</u> b\n')
    await select(view, 'word')
    const keys = order()
    expect(keys.slice(keys.indexOf('italic'), keys.indexOf('italic') + 3)).toEqual(['italic', 'underline', 'strikethrough'])
    expect(must('underline').title).toBe('Underline (⌘U)')
    expect(must('underline').classList.contains('active')).toBe(true)
    await press('underline')
    expect(getMarkdownForSave(crepe)).toBe('a word b\n')
    expect(must('underline').classList.contains('active')).toBe(false)
    await press('underline')
    expect(getMarkdownForSave(crepe)).toBe('a <u>word</u> b\n')
  })
})

/**
 * The user's order (YAZ-3806 T5, T6): Settings sets `toolbarPrefs`, and the strip of an editor that is ALREADY open
 * follows at once — Crepe builds its strip in a Vue `computed` that reads the ref.
 */
describe('the toolbar setting (YAZ-3806 T5, T6)', () => {
  const strip = () => [...document.querySelector('.milkdown-toolbar')!.children].map((el) => (el as HTMLElement).dataset.toolbarItem ?? '|')
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('a change reaches the open strip: a hidden button leaves, a hidden group takes its divider with it, a moved group moves, and the default comes back', async () => {
    const { view } = await mount('plain\n')
    await select(view, 'plain')

    toolbarPrefs.value = { ...DEFAULT_TOOLBAR, hidden: ['bold'] }
    await tick()
    expect(item('bold')).toBeNull()
    expect(item('italic')).not.toBeNull()

    toolbarPrefs.value = { ...DEFAULT_TOOLBAR, hidden: ['checklist', 'bulletList', 'numberedList'] }
    await tick()
    expect(strip()).toEqual(['h1', 'h2', 'h3', 'text', '|', 'bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-more', '|', 'code', 'link'])

    toolbarPrefs.value = { ...DEFAULT_TOOLBAR, groups: ['lists', 'lineType', 'textStyle', 'insert'], buttons: ['link', ...DEFAULT_TOOLBAR.buttons.filter((b) => b !== 'link')] }
    await tick()
    expect(strip().slice(0, 5)).toEqual(['checklist', 'bulletList', 'numberedList', '|', 'h1'])
    expect(strip().slice(-2)).toEqual(['link', 'code'])

    toolbarPrefs.value = DEFAULT_TOOLBAR
    await tick()
    expect(strip()).toEqual([
      'h1', 'h2', 'h3', 'text', '|',
      'checklist', 'bulletList', 'numberedList', '|',
      'bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-more', '|',
      'code', 'link',
    ])
  })

  it('a hidden button keeps its key: ⌘B still bolds with Bold off the strip', async () => {
    toolbarPrefs.value = { ...DEFAULT_TOOLBAR, hidden: ['bold'] }
    const { crepe, view } = await mount('plain\n')
    await select(view, 'plain')
    expect(item('bold')).toBeNull()
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true }))
    expect(getMarkdownForSave(crepe)).toBe('**plain**\n')
  })
})
