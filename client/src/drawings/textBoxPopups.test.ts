import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@milkdown/kit/prose/state'
import { docToBox } from './textBoxDoc'
import { helpers, mountBox, typeText, unmountAll } from './textBoxTestKit'

vi.mock('../editor/createCrepe', async (load) => {
  const real = await load<typeof import('../editor/createCrepe')>()
  const list = ((globalThis as { __textBoxCrepes?: unknown[] }).__textBoxCrepes ??= [])
  return {
    ...real,
    createCrepe: (...args: Parameters<typeof real.createCrepe>) => {
      const crepe = real.createCrepe(...args)
      list.push(crepe)
      return crepe
    },
  }
})

afterEach(unmountAll)

const settle = () => new Promise((r) => setTimeout(r, 80))
const boxText = (view: Awaited<ReturnType<typeof mountBox>>['view']) => docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).text

describe('the pop-up toolbar and the / menu of a text box (YAZ-4277 1C, D4, D8)', () => {
  it('shows the toolbar on a letter selection, outside the zoomed root, with the checklist and no heading', async () => {
    const { view, root } = await mountBox('pick these words')
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)))
    await settle()
    const toolbar = document.querySelector<HTMLElement>('.excalidraw-text-box-popups .milkdown-toolbar')
    expect(toolbar).not.toBeNull()
    expect(root.querySelector('.milkdown-toolbar')).toBeNull()
    expect(toolbar!.dataset.show).toBe('true')
    const buttons = [...toolbar!.querySelectorAll<HTMLElement>('[data-toolbar-item]')]
    expect(buttons.map((button) => button.dataset.toolbarItem)).toEqual([
      'text', 'checklist', 'bulletList', 'bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-pink',
    ])
    // the Checklist button makes the line a checklist item
    const checklist = buttons.find((button) => button.dataset.toolbarItem === 'checklist')!
    checklist.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(boxText(view)).toBe('☐ pick these words')
  })

  it('shows the / menu outside the root, with the checklist row and no heading, quote, code or numbered row', async () => {
    const { view, root } = await mountBox('')
    view.focus()
    typeText(view, '/')
    await settle()
    const menu = document.querySelector<HTMLElement>('.excalidraw-text-box-popups .milkdown-slash-menu')
    expect(menu).not.toBeNull()
    expect(root.querySelector('.milkdown-slash-menu')).toBeNull()
    const rows = [...menu!.querySelectorAll<HTMLElement>('.menu-group li')]
    expect(rows.map((row) => row.textContent?.trim())).toEqual(['Text', 'Current time', 'Bullet List', 'Task List'])
    expect([...menu!.querySelectorAll('.tab-group li')].map((tab) => tab.textContent)).toEqual(['Text', 'List'])
    // the Task List row makes the line a checklist item
    const task = rows.find((row) => row.textContent?.trim() === 'Task List')!
    task.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    task.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }))
    await settle()
    expect(boxText(view)).toBe('☐ ')
  })
})
