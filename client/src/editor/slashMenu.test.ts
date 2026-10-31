/**
 * The slash menu in a list item and the "Current time" row (YAZ-3550; YAZ-3511 D21, D22; edge
 * cases 70–78 on YAZ-3512), against the REAL menu: `createCrepe()` over the installed, patched
 * Crepe (`client/vendor/milkdown-crepe-7.22.1-yaz3550.*`). The upstream copy keeps the menu shut
 * in every list item and filters by the label alone, so these fail on it.
 *
 * jsdom gotchas the helper absorbs: the view never really has focus (the menu asks for it), and
 * after a transaction in a list item jsdom's DOM selection pulls the caret back to the first
 * item — so the caret is set again once that has happened. A real window does neither.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { createSlashMenu, formatCurrentTime, tableRow, type SlashMenuGroups, type SlashRow } from './slashMenu'
import { OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS } from './outline/outlineFolding'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

afterEach(async () => {
  vi.useRealTimers()
  while (mounted.length > 0) {
    const current = mounted.pop()
    if (current !== undefined) {
      await current.crepe.destroy()
      current.root.remove()
    }
  }
})

async function mountWithCrepe(markdown: string): Promise<{ crepe: Crepe; root: HTMLElement; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.hasFocus = () => true
  return { crepe, root, view }
}

const mount = mountWithCrepe

const menuOf = (root: HTMLElement) => root.querySelector<HTMLElement>('.milkdown-slash-menu')
const isShown = (root: HTMLElement) => menuOf(root)?.dataset.show === 'true'
const rows = (root: HTMLElement) => [...(menuOf(root)?.querySelectorAll('.menu-group li') ?? [])].map((li) => li.textContent?.trim() ?? '')
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Replaces the text of the textblock that reads `blockText` with `typed`, the caret after it, and
 * returns a `hold()` that puts the caret back there whenever jsdom has pulled it away.
 */
async function typeIn(view: EditorView, blockText: string, typed: string): Promise<() => void> {
  let from = -1
  let to = -1
  view.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isTextblock && node.textContent === blockText) {
      from = pos + 1
      to = pos + node.nodeSize - 1
    }
  })
  if (from === -1) throw new Error(`no block reads ${blockText}`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).insertText(typed))
  const caret = from + typed.length
  const hold = () => {
    if (view.state.selection.from !== caret || !view.state.selection.empty) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)))
    }
  }
  await tick(10)
  hold()
  return hold
}

async function openMenu(view: EditorView, root: HTMLElement, blockText: string, typed = '/'): Promise<string[]> {
  const hold = await typeIn(view, blockText, typed)
  await vi.waitFor(() => {
    hold()
    expect(isShown(root)).toBe(true)
  })
  // The menu's keydown listener attaches in a Vue effect after the show.
  await tick()
  hold()
  return rows(root)
}

/** The rows of the plain-line menu (D21: a list item shows these, less the two it cannot use). */
const PLAIN_ROWS = ['Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6', 'Quote', 'Divider', 'Current time', 'Bullet List', 'Task List', 'Code', 'Table']
const LIST_ROWS = PLAIN_ROWS.filter((row) => row !== 'Divider' && row !== 'Bullet List')

describe('formatCurrentTime (D22, edge case 76)', () => {
  it.each([
    [9, 5, '9:05am - '],
    [12, 0, '12:00pm - '],
    [0, 30, '12:30am - '],
    [23, 59, '11:59pm - '],
    [11, 47, '11:47am - '],
    [13, 7, '1:07pm - '],
  ])('%i:%i → %j', (hours, minutes, expected) => {
    expect(formatCurrentTime(new Date(2026, 9, 28, hours, minutes, 42))).toBe(expected)
  })
})

describe('buildMenu (YAZ-3550)', () => {
  /** A builder stub with Crepe's three stock groups; `build()` hands back its own groups. */
  function stubBuilder() {
    const groups = ['text', 'list', 'advanced'].map((key) => ({ key, items: [] as Array<{ key: string } & SlashRow> }))
    const builder: SlashMenuGroups = {
      getGroup: (key) => ({ addItem: (itemKey, item) => groups.find((g) => g.key === key)?.items.push({ ...item, key: itemKey }) }),
      build: () => groups,
    }
    return { builder, groups }
  }

  it('ends the Text group with Current time, its keywords on it, before the host extension runs', () => {
    const { builder, groups } = stubBuilder()
    const order: string[] = []
    createSlashMenu((b) => {
      order.push(...b.build()[0].items.map((item) => item.key))
      b.getGroup('advanced').addItem('drawing', { label: 'Drawing', icon: '' })
    }).buildMenu(builder)
    expect(order).toEqual(['current-time'])
    expect(groups[0].items[0]).toMatchObject({ key: 'current-time', label: 'Current time', keywords: ['current', 'now', 'clock', 'time'] })
    expect(groups[0].items[0].icon).toContain('<svg')
    // Table (YAZ-3696 D12) takes Crepe's place after Code, before the host's Drawing.
    expect(groups[2].items.map((item) => item.key)).toEqual(['table', 'drawing'])
  })
})

describe('the slash menu in a list item (D21, edge cases 70–75)', () => {
  it('74: a plain line shows the menu as before, Current time in the Text group', async () => {
    const { root, view } = await mount('x\n')
    expect(await openMenu(view, root, 'x')).toEqual(PLAIN_ROWS)
  })

  it.each([
    ['70: a bullet', '* x\n'],
    ['71: a nested bullet', '* a\n  * x\n'],
    ['71: a task item', '* [ ] x\n'],
    ['72: a numbered item', '1. x\n'],
  ])('%s opens the same menu, without Divider and Bullet List', async (_name, markdown) => {
    const { root, view } = await mount(markdown)
    expect(await openMenu(view, root, 'x')).toEqual(LIST_ROWS)
  })

  it('the rows follow the caret: "/" on a plain line, then "/" in a bullet (the same filter) hides the two rows', async () => {
    const { root, view } = await mount('p\n\n* x\n')
    expect(await openMenu(view, root, 'p')).toEqual(PLAIN_ROWS)
    press('Escape')
    await vi.waitFor(() => expect(isShown(root)).toBe(false))
    expect(await openMenu(view, root, 'x')).toEqual(LIST_ROWS)
  })

  it.each([
    ['a code block', '```\nx\n```\n'],
    ['a code block in a bullet', '* a\n\n  ```\n  x\n  ```\n'],
  ])('73: %s opens no menu', async (_name, markdown) => {
    const { root, view } = await mount(markdown)
    await typeIn(view, 'x', '/')
    await tick(100)
    expect(isShown(root)).toBe(false)
  })

  it('75: Esc closes the menu and keeps the "/" text', async () => {
    const { root, view } = await mount('* x\n')
    await openMenu(view, root, 'x')
    press('Escape')
    await vi.waitFor(() => expect(isShown(root)).toBe(false))
    expect(view.state.doc.toString()).toContain('list_item(paragraph("/"))')
  })
})

describe('Current time (D22, edge cases 70–72, 77, 78)', () => {
  it.each(['current', 'now', 'clock', 'time', 'TIME'])('77, 78: "/%s" finds it, as the first row', async (query) => {
    const { root, view } = await mount('x\n')
    const found = await openMenu(view, root, 'x', `/${query}`)
    expect(found[0]).toBe('Current time')
    if (query.toLowerCase() === 'time') expect(found).toEqual(['Current time'])
  })

  it.each([
    ['70: a bullet', '* x\n', 'bullet_list(list_item(paragraph("11:47am - ")))'],
    ['71: a nested bullet', '* a\n  * x\n', 'bullet_list(list_item(paragraph("11:47am - ")))))'],
    ['71: a task item', '* [ ] x\n', 'bullet_list(list_item(paragraph("11:47am - ")))'],
    ['72: a numbered item', '1. x\n', 'ordered_list(list_item(paragraph("11:47am - ")))'],
    ['74: a plain line', 'x\n', 'doc(paragraph("11:47am - "))'],
  ])('"/time" + Enter in %s: the time at the caret, "/time" gone, the block unchanged', async (_name, markdown, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 28, 11, 47, 30))
    const { root, view } = await mount(markdown)
    const checkedBefore = view.state.doc.toJSON() as unknown
    await openMenu(view, root, 'x', '/time')
    press('Enter')
    await vi.waitFor(() => expect(isShown(root)).toBe(false))
    expect(view.state.doc.toString()).toContain(expected)
    expect(view.state.doc.textContent).not.toContain('/time')
    // The caret is after the inserted text, ready to type on.
    expect(view.state.selection.$from.parent.textContent.slice(0, view.state.selection.$from.parentOffset)).toBe('11:47am - ')
    // A task item stays a task (its `checked` attribute is untouched).
    if (markdown.startsWith('* [ ]')) {
      expect(JSON.stringify(view.state.doc.toJSON())).toContain('"checked":false')
      expect(JSON.stringify(checkedBefore)).toContain('"checked":false')
    }
  })
})

describe('Table in a bullet (YAZ-3696 D12, option B)', () => {
  /** The first header cell holds the caret: its paragraph is the caret's parent. */
  const caretInFirstHeaderCell = (view: EditorView) => {
    const { $from } = view.state.selection
    const cell = $from.node($from.depth - 1)
    const table = $from.node($from.depth - 3)
    expect(cell.type.name).toBe('table_header')
    expect(table.firstChild?.firstChild).toBe(cell)
  }

  it.each([
    ['an empty bullet', '* x\n', 'bullet_list(list_item(table('],
    ['an empty nested bullet', '* a\n  * x\n', 'bullet_list(list_item(paragraph("a"), bullet_list(list_item(table('],
    ['an empty numbered item', '1. x\n', 'ordered_list(list_item(table('],
    ['an empty bullet with a child', '* x\n  * Child\n', 'bullet_list(list_item(table('],
    // A task item cannot hold a table on its marker line (`* [ ] | a |` reads as text): the D12 placement.
    ['an empty task item', '* [ ] x\n', 'bullet_list(list_item(paragraph, table('],
  ])('"/table" + Enter in %s: a 3×3 table on the marker line, the item\'s first child (YAZ-3805), a task item\'s below its line', async (_name, markdown, expected) => {
    const { root, view } = await mount(markdown)
    await openMenu(view, root, 'x', '/table')
    press('Enter')
    await vi.waitFor(() => expect(isShown(root)).toBe(false))
    expect(view.state.doc.toString()).toContain(expected)
    expect(view.state.doc.textContent).not.toContain('/table')
    let table: ProseNode | undefined
    view.state.doc.descendants((node) => {
      if (node.type.name === 'table') table = node
    })
    expect(table?.childCount).toBe(3)
    expect(table?.firstChild?.childCount).toBe(3)
    caretInFirstHeaderCell(view)
  })

  it('"/table" + Enter on a plain line works as today: the table takes the line, the caret in its first header cell', async () => {
    const { root, view } = await mount('x\n')
    await openMenu(view, root, 'x', '/table')
    press('Enter')
    await vi.waitFor(() => expect(isShown(root)).toBe(false))
    expect(view.state.doc.firstChild?.type.name).toBe('table')
    expect(view.state.doc.textContent).toBe('')
    caretInFirstHeaderCell(view)
  })

  it('text before the query stays on the label line (option A, reached by a direct run)', async () => {
    const { crepe, view } = await mountWithCrepe('* Hello /table\n')
    const end = view.state.doc.resolve(3).end()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    crepe.editor.action((ctx) => tableRow.onRun?.(ctx))
    expect(view.state.doc.toString()).toContain('bullet_list(list_item(paragraph("Hello "), table(')
    caretInFirstHeaderCell(view)
  })

  it('the new table in an empty bullet round trips on the marker line: the saved markdown loads back to the same document', async () => {
    const { crepe, root, view } = await mountWithCrepe('* x\n')
    await openMenu(view, root, 'x', '/table')
    press('Enter')
    await vi.waitFor(() => expect(isShown(root)).toBe(false))
    const saved = getMarkdownForSave(crepe)
    const again = await mountWithCrepe(saved)
    // The bullet, label line and table, read back as they were (the live doc also holds Crepe's trailing paragraph).
    expect(saved).toBe('* |    |    |    |\n  | :- | :- | :- |\n  |    |    |    |\n  |    |    |    |\n')
    expect(again.view.state.doc.firstChild?.toString()).toBe(view.state.doc.firstChild?.toString())
    expect(getMarkdownForSave(again.crepe)).toBe(saved)
  })

  it('the bullet fold works with the table as the item\'s first child: the arrow stays, the fold hides the table and the child', async () => {
    const { crepe, root, view } = await mountWithCrepe('* x\n  * Child\n')
    await openMenu(view, root, 'x', '/table')
    press('Enter')
    await vi.waitFor(() => expect(isShown(root)).toBe(false))
    const before = getMarkdownForSave(crepe)
    const toggle = () => root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)
    const folded = () => [...root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)]
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true')
    // The arrow is the item's, before the table, so the fold never hides it.
    expect(toggle()?.closest('table')).toBeNull()
    // table.css's "no top margin" rule reaches this table (jsdom has no layout to measure).
    expect(root.querySelector('.milkdown-list-item-block > li > .children > .content-dom > .milkdown-table-block:is(:first-child, .outline-toggle + *)')).not.toBeNull()
    toggle()!.click()
    expect(folded().map((el) => (el.querySelector('table') !== null ? 'table' : el.textContent?.trim()))).toEqual(['table', 'Child'])
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false')
    expect(getMarkdownForSave(crepe)).toBe(before)
    toggle()!.click()
    expect(folded()).toHaveLength(0)
  })
})
