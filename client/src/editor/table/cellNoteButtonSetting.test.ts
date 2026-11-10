/**
 * The cell note "+" (YAZ-4790 demo: "cell notes for all tables are by default off … there should be a global setting,
 * and then … every table"), on real editors:
 * - Settings › Tables › Cell notes › Add button is Off by default: no "+" on a table that follows it;
 * - a table's own On (`notebutton`) shows it even with Settings Off; its own Off (`nonotebutton`) never shows it;
 * - the six-dot menu's "Cell note button" (Default / On / Off): a pick equal to Settings saves no part.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'
import { formatTableComment, parseTableComment, plainTable } from './tableComment'
import { cellNoteButtonSetting, setCellNoteButtonSetting } from './timeFormatSetting'
import { cellPos } from './tableTestKit'

afterEach(async () => {
  setCellNoteButtonSetting(false)
  await unmountAll()
})

const TABLE = (part = '') => `| a | b |\n| - | - |\n| c | d |\n${part === '' ? '' : `\n<!-- table: ${part} -->\n`}`
const shownButton = () => [...document.querySelectorAll<HTMLButtonElement>('.cell-note-button')].find((b) => b.dataset.show === 'true') ?? null
const hover = (view: EditorView, row: number, col: number) => (view.nodeDOM(cellPos(view, row, col)) as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
function boxes(view: EditorView) {
  for (const cell of view.dom.querySelectorAll<HTMLElement>('td, th')) {
    const row = (cell.parentElement as HTMLTableRowElement).rowIndex
    const col = (cell as HTMLTableCellElement).cellIndex
    cell.getBoundingClientRect = () => new DOMRect(col * 100, row * 30, 100, 30)
  }
  view.dom.parentElement!.getBoundingClientRect = () => new DOMRect(10, 20, 500, 500)
}
async function hovered(markdown: string) {
  const m = await mount(markdown)
  boxes(m.view)
  hover(m.view, 1, 0)
  return m
}

describe('YAZ-4790 demo: the comment parts', () => {
  it('YAZ-4790 demo: `notebutton` and `nonotebutton` read and write back the same', () => {
    for (const part of ['notebutton', 'nonotebutton'] as const) {
      const parsed = parseTableComment(`<!-- table: ${part} -->`)!
      expect(parsed[part]).toBe(true)
      expect(formatTableComment(parsed)).toBe(`<!-- table: ${part} -->`)
    }
    expect(formatTableComment(plainTable()) ?? '').not.toMatch(/notebutton/)
  })
})

describe('YAZ-4790 demo: where the + shows', () => {
  it('YAZ-4790 demo: Settings › Add button is Off by default: a table that follows it shows no +', async () => {
    expect(cellNoteButtonSetting()).toBe(false)
    await hovered(TABLE())
    expect(shownButton()).toBeNull()
  })

  it('YAZ-4790 demo: Settings On: a table that follows it shows the +', async () => {
    setCellNoteButtonSetting(true)
    await hovered(TABLE())
    expect(shownButton()).not.toBeNull()
  })

  it('YAZ-4790 demo: a table set On shows the + with Settings Off', async () => {
    await hovered(TABLE('notebutton'))
    expect(shownButton()).not.toBeNull()
  })

  it('YAZ-4790 demo: a table set Off never shows it, with Settings On', async () => {
    setCellNoteButtonSetting(true)
    await hovered(TABLE('nonotebutton'))
    expect(shownButton()).toBeNull()
  })
})

describe('YAZ-4790 demo: the six-dot menu "Cell note button"', () => {
  async function openMenu(markdown: string) {
    const m = await mount(markdown)
    const handle = document.createElement('div')
    handle.className = 'milkdown-block-handle'
    const item = document.createElement('div')
    item.className = 'operation-item'
    handle.appendChild(item)
    m.view.dom.parentElement!.appendChild(handle)
    handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
    let pos = -1
    m.view.state.doc.descendants((node, p) => {
      if (pos === -1 && node.type.name === 'table') pos = p
      return pos === -1
    })
    m.view.posAtCoords = () => ({ pos: pos + 1, inside: pos })
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    return m
  }
  const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')!
  const picker = (view: EditorView) => {
    const found = [...popupOf(view).querySelectorAll<HTMLElement>('.block-menu-picker')].find((p) => p.querySelector('.block-menu-picker__label')?.textContent === 'Cell note button')
    if (found === undefined) throw new Error('no Cell note button picker')
    return found
  }
  /** The picker's list, opened: each choice's text. */
  const choices = (view: EditorView) => {
    picker(view).querySelector<HTMLButtonElement>('.block-menu-picker__value')!.click()
    return [...picker(view).querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')]
  }
  const pick = (view: EditorView, text: string) => {
    const button = choices(view).find((b) => b.firstElementChild?.textContent === text || b.textContent?.replace('✓', '') === text)
    if (button === undefined) throw new Error(`no ${text}: ${choices(view).map((b) => b.textContent).join(', ')}`)
    button.click()
  }

  it('YAZ-4790 demo: the list is "Default (Off)" with the Settings value, and the one other choice', async () => {
    const { view } = await openMenu(TABLE())
    expect(choices(view).map((b) => b.textContent?.replace('✓', ''))).toEqual(['Default (Off)', 'On'])
  })

  it('YAZ-4790 demo: with Settings Off, On saves `notebutton`; Default takes the part away', async () => {
    const { crepe, view } = await openMenu(TABLE())
    pick(view, 'On')
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: notebutton -->')
    pick(view, 'Default (Off)')
    expect(getMarkdownForSave(crepe)).not.toMatch(/notebutton/)
  })

  it('YAZ-4790 demo: with Settings On, Off saves `nonotebutton`', async () => {
    setCellNoteButtonSetting(true)
    const { crepe, view } = await openMenu(TABLE())
    pick(view, 'Off')
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: nonotebutton -->')
  })
})
