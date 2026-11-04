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
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { toolbarPrefs } from './toolbarPrefs'
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

/** The highlight swatches, in the order `buildToolbar` adds them. */
const SWATCHES = ['highlight', 'highlight-green', 'highlight-blue', 'highlight-pink'] as const

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
    // Crepe's Formatting group with Underline and the four swatches, then its code and link — one
    // divider between two groups, none at an end.
    const strip = [...document.querySelector('.milkdown-toolbar')!.children].map((el) => (el as HTMLElement).dataset.toolbarItem ?? (el.classList.contains('divider') ? '|' : el.tagName))
    expect(strip).toEqual([
      'h1', 'h2', 'h3', 'text', '|',
      'checklist', 'bulletList', 'numberedList', '|',
      'bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-pink', 'highlight-more', '|',
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
  it('four dots join Crepe\'s Formatting group, in order, after Strikethrough and before Inline code', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')

    const keys = order()
    const at = keys.indexOf('strikethrough')
    expect(keys.slice(at + 1, at + 5)).toEqual([...SWATCHES])
    expect(keys.indexOf('highlight-pink')).toBeLessThan(keys.indexOf('code'))
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
 * The highlight buttons' new look and their ▾ menu (YAZ-4348 demo round 2, `highlightMenu.ts`): each button is a
 * bold "A" on a square of its wash token; the ▾ opens more colours, Remove highlight and Custom… on the body, so
 * the toolbar's `overflow: hidden` cannot cut it off, and without taking the focus or the selection.
 */
describe('highlight buttons and the ▾ menu (YAZ-4348 demo round 2)', () => {
  const menu = () => document.querySelector<HTMLElement>('body > .highlight-menu')
  const isOpen = () => menu() !== null && !menu()!.hidden
  const menuItem = (label: string) => {
    const el = menu()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (el == null) throw new Error(`no menu item: ${label}`)
    return el
  }
  /** A real click on a menu item: the mousedown the menu cancels, then the click. */
  const clickItem = async (label: string) => {
    const el = menuItem(label)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    el.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    await settle()
  }
  const key = (k: string) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(event)
    return event
  }
  const customInput = () => document.querySelector<HTMLInputElement>('input.table-colour-input')!

  afterEach(() => {
    document.querySelectorAll('.highlight-menu').forEach((el) => el.remove())
  })

  it('each highlight button is a bold "A" on a square of its own wash token, and the ▾ follows them', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    const tokens = ['--mark-bg', '--mark-bg-green', '--mark-bg-blue', '--mark-bg-pink']
    SWATCHES.forEach((key, i) => {
      const square = must(key).querySelector('svg rect.highlight-icon__wash')
      expect(square?.getAttribute('fill')).toBe(`var(${tokens[i]})`)
      const letter = must(key).querySelector('svg text.highlight-icon__a')
      expect(letter?.textContent).toBe('A')
      expect(letter?.getAttribute('font-weight')).toBe('800')
    })
    const keys = order()
    expect(keys[keys.indexOf('highlight-pink') + 1]).toBe('highlight-more')
    expect(must('highlight-more').getAttribute('aria-label')).toBe('More highlight colours')
  })

  it('the lit button is the selection\'s colour (the ring); the ▾ lights for a menu or custom colour', async () => {
    const { view } = await mount('<mark class="highlight-blue">blue</mark> <mark class="highlight-orange">orange</mark> <mark style="background-color: #3366ff">mine</mark> plain\n')
    await select(view, 'blue')
    expect(litDots()).toEqual(['highlight-blue'])
    expect(must('highlight-more').classList.contains('active')).toBe(false)
    await select(view, 'orange')
    expect(litDots()).toEqual([])
    expect(must('highlight-more').classList.contains('active')).toBe(true)
    await select(view, 'mine')
    expect(must('highlight-more').classList.contains('active')).toBe(true)
    await select(view, 'plain')
    expect(must('highlight-more').classList.contains('active')).toBe(false)
  })

  it('the ▾ opens the menu on the body under it — four colours, Remove highlight, Custom… — and keeps the selection and the focus', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    const before = view.state.selection
    await press('highlight-more')
    expect(isOpen()).toBe(true)
    expect(menu()!.closest('.milkdown-toolbar')).toBeNull()
    expect(menu()!.getAttribute('role')).toBe('menu')
    const labels = [...menu()!.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Highlight orange', 'Highlight purple', 'Highlight red', 'Highlight gray', 'Remove highlight', 'Custom…'])
    expect(menuItem('Highlight orange').querySelector('rect')?.getAttribute('fill')).toBe('var(--mark-bg-orange)')
    expect(view.state.selection.eq(before)).toBe(true)
    expect(view.hasFocus()).toBe(true)
    // A second press closes it.
    await press('highlight-more')
    expect(isOpen()).toBe(false)
  })

  it('a colour in the menu highlights the selection with its class form, closes the menu, and the strip lights the ▾', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    await clickItem('Highlight orange')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-orange">world</mark>\n')
    expect(isOpen()).toBe(false)
    expect(must('highlight-more').classList.contains('active')).toBe(true)
    // Opened again, orange wears the ring.
    await press('highlight-more')
    expect(menuItem('Highlight orange').classList.contains('active')).toBe(true)
    expect(menuItem('Highlight orange').getAttribute('aria-checked')).toBe('true')
    expect(menuItem('Highlight red').getAttribute('aria-checked')).toBe('false')
  })

  it('Remove highlight takes every colour off the selection', async () => {
    const { crepe, view } = await mount('==a== <mark class="highlight-red">b</mark> c\n')
    await selectSpan(view, 'a', 'c')
    await press('highlight-more')
    await clickItem('Remove highlight')
    expect(getMarkdownForSave(crepe)).toBe('a b c\n')
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

  it('works from the keyboard: arrows move through the items, Enter picks; a key press on the ▾ opens it on the first item', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    const current = () => menu()!.querySelector('.is-current')?.getAttribute('aria-label') ?? null
    expect(current()).toBeNull()
    expect(key('ArrowDown').defaultPrevented).toBe(true)
    expect(current()).toBe('Highlight orange')
    key('ArrowRight')
    expect(current()).toBe('Highlight purple')
    key('End')
    expect(current()).toBe('Custom…')
    key('ArrowDown')
    expect(current()).toBe('Highlight orange')
    key('ArrowUp')
    key('ArrowUp')
    expect(current()).toBe('Remove highlight')
    key('Home')
    key('ArrowRight')
    key('ArrowRight')
    expect(current()).toBe('Highlight red')
    expect(key('Enter').defaultPrevented).toBe(true)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-red">world</mark>\n')
    expect(isOpen()).toBe(false)

    // Enter or Space on a focused ▾ is a click with no pointer (detail 0): the menu opens on its first item.
    must('highlight-more').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))
    expect(isOpen()).toBe(true)
    expect(current()).toBe('Highlight orange')
    // Any other key closes it and goes on to the note.
    expect(key('x').defaultPrevented).toBe(false)
    expect(isOpen()).toBe(false)
  })

  it('Custom… opens the system colour picker; the pick goes to the text selected then, as the style form, in one undo step', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    await clickItem('Custom…')
    expect(isOpen()).toBe(false)
    const input = customInput()
    expect(input.value).toBe('#ffd500')
    // The panel does not block the window: the user selects other text, then picks.
    await select(view, 'hello')
    input.value = '#3366ff'
    input.dispatchEvent(new Event('change'))
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #3366ff">world</mark>\n')
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('hello')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('on a custom run, Custom… wears the ring and the picker starts on its colour', async () => {
    const { view } = await mount('<mark style="background-color: #3366ff">mine</mark>\n')
    await select(view, 'mine')
    await press('highlight-more')
    expect(menuItem('Custom…').getAttribute('aria-checked')).toBe('true')
    await clickItem('Custom…')
    expect(customInput().value).toBe('#3366ff')
  })

  it('a custom pick on text deleted while the picker was open does nothing', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    await clickItem('Custom…')
    const from = view.state.doc.textContent.indexOf('world') + 1
    view.dispatch(view.state.tr.delete(from, from + 5))
    customInput().value = '#3366ff'
    customInput().dispatchEvent(new Event('change'))
    expect(getMarkdownForSave(crepe)).not.toContain('<mark')
    expect(view.state.doc.textContent).toBe('hello ')
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
    expect(strip()).toEqual(['h1', 'h2', 'h3', 'text', '|', 'bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-pink', 'highlight-more', '|', 'code', 'link'])

    toolbarPrefs.value = { ...DEFAULT_TOOLBAR, groups: ['lists', 'lineType', 'textStyle', 'insert'], buttons: ['link', ...DEFAULT_TOOLBAR.buttons.filter((b) => b !== 'link')] }
    await tick()
    expect(strip().slice(0, 5)).toEqual(['checklist', 'bulletList', 'numberedList', '|', 'h1'])
    expect(strip().slice(-2)).toEqual(['link', 'code'])

    toolbarPrefs.value = DEFAULT_TOOLBAR
    await tick()
    expect(strip()).toEqual([
      'h1', 'h2', 'h3', 'text', '|',
      'checklist', 'bulletList', 'numberedList', '|',
      'bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-pink', 'highlight-more', '|',
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
