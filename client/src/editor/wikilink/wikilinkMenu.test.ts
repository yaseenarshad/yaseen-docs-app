/**
 * Right-click on an id link (YAZ-2293): real editor (`createCrepe({ wikilinkNav })`), real
 * mousedown / contextmenu events on the rendered `.wikilink` spans. Pinned here: the menu names
 * the note and its id and "Copy ID" copies exactly the id; a dead id still offers its id; a
 * NAME link keeps the native menu (nothing prevented, nothing drawn); a right-button mousedown on
 * an id link is swallowed so the link is still rendered when `contextmenu` arrives; and the menu
 * closes the way every `.ctx-menu--editor` popup does. `openIdMenu` is also driven on a bare
 * element — it must not need an editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { IndexRecord } from '@shared/types'
import { linkResolver } from '../../links/folderLinks'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { openIdMenu } from './wikilinkMenu'
import { WIKILINK_CLASS, createWikilinkResolveSource, type MutableWikilinkResolveSource } from './wikilinkPlugin'

const ID = 'k3m9x2pq7abc'
const DEAD = 'zzzzzzzzzzz9'
const resolve = (target: string) => (target === ID ? '/vault/Projects/Road Map.md' : target === 'Known' ? '/vault/Known.md' : null)

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, withNav = true, feed: (source: MutableWikilinkResolveSource) => void = (source) => source.update(resolve)) {
  const source = createWikilinkResolveSource()
  feed(source)
  const nav = { root: '/vault', createFolder: () => '', openCurrent: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn() }
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks: source, wikilinkNav: withNav ? nav : undefined })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, nav, view: crepe.editor.action((ctx) => ctx.get(editorViewCtx)) }
}

/** The rendered collapsed-link span showing `text` (throws when the link is not collapsed). */
function linkSpan(root: HTMLElement, text: string): Element {
  const span = Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).find((el) => el.textContent === text)
  if (span === undefined) throw new Error(`no collapsed .wikilink span showing "${text}"`)
  return span
}

function mouse(target: Element, type: 'mousedown' | 'contextmenu'): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 })
  target.dispatchEvent(event)
  return event
}

const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const rowsOf = (popup: HTMLElement) => Array.from(popup.querySelectorAll<HTMLButtonElement>('.ctx-menu__item'))

/** jsdom has no clipboard; the menu's only job is to hand the id to it, so spy on writeText. */
let writeText: Mock
const hadClipboard = 'clipboard' in navigator

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
})

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  if (!hadClipboard) delete (navigator as unknown as Record<string, unknown>).clipboard
})

describe('right-click on a rendered id link', () => {
  it('replaces the native menu with the note\'s name, its id and Copy ID — the two labels are not actions', async () => {
    const { root, view } = await mount(`pad [[${ID}]] tail\n`)
    expect(mouse(linkSpan(root, 'Road Map'), 'contextmenu').defaultPrevented).toBe(true)
    const rows = rowsOf(popupOf(view)!)
    expect(rows.map((row) => row.textContent)).toEqual(['Road Map', ID, 'Copy ID'])
    expect(rows.map((row) => row.disabled)).toEqual([true, true, false])
  })

  it('Copy ID copies exactly the id, says so, closes — and the document keeps every byte', async () => {
    const md = `pad [[${ID}]] tail\n`
    const { crepe, root, nav, view } = await mount(md)
    mouse(linkSpan(root, 'Road Map'), 'contextmenu')
    rowsOf(popupOf(view)!)[2]!.click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(ID)
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith('Copied ID'))
    expect(popupOf(view)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(md)
  })

  it('reports a clipboard the OS refused', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const { root, nav, view } = await mount(`pad [[${ID}]] tail\n`)
    mouse(linkSpan(root, 'Road Map'), 'contextmenu')
    rowsOf(popupOf(view)!)[2]!.click()
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith("Can't copy ID: denied"))
  })

  it('a hand-typed label and a heading segment are the same link: the name row is the TITLE', async () => {
    const { root, view } = await mount(`pad [[${ID}|my label]] and [[${ID}#Scope]] tail\n`)
    mouse(linkSpan(root, 'my label'), 'contextmenu')
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(['Road Map', ID, 'Copy ID'])
    mouse(linkSpan(root, 'Scope'), 'contextmenu')
    expect(view.dom.parentElement!.querySelectorAll('.ctx-menu--editor')).toHaveLength(1) // retargeted, never stacked
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(['Road Map', ID, 'Copy ID'])
  })

  it('an id no note has still offers its id and Copy ID — with no name row', async () => {
    const { root, view } = await mount(`pad [[${DEAD}]] tail\n`)
    expect(mouse(linkSpan(root, DEAD), 'contextmenu').defaultPrevented).toBe(true)
    const rows = rowsOf(popupOf(view)!)
    expect(rows.map((row) => row.textContent)).toEqual([DEAD, 'Copy ID'])
    rows[1]!.click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(DEAD)
  })

  it('K5 — right-click a rendered link to a FOLDER: the folder\'s name with "(folder)", its id and Copy ID', async () => {
    const FOLDER_ID = 'f7n2w8rt4xyz'
    const record = (path: string, id: string): IndexRecord => ({
      path, id, name: path.slice(path.lastIndexOf('/') + 1), basename: 'x', folder: 'Projects', ext: 'md', size: 1, ctime: 1, mtime: 1,
      properties: {}, aliases: [], tags: [], links: [], embeds: [],
    })
    // The bridge's feed: a folder with its settings file's id, and a note INSIDE it — which is no folder.
    const records = [record('/vault/Projects/Road Map.md', ID)]
    const folders = [record('/vault/Projects/.folder.md', FOLDER_ID)]
    const { root, view } = await mount(`pad [[${FOLDER_ID}]] and [[${ID}]] tail\n`, true, (source) =>
      source.update(linkResolver(records, '/vault', ['/vault/Projects'], folders), records, folders),
    )
    mouse(linkSpan(root, 'Projects'), 'contextmenu') // the link itself shows the bare name
    const rows = rowsOf(popupOf(view)!)
    expect(rows.map((row) => row.textContent)).toEqual(['Projects (folder)', FOLDER_ID, 'Copy ID'])
    expect(rows.map((row) => row.disabled)).toEqual([true, true, false])
    rows[2]!.click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(FOLDER_ID)
    mouse(linkSpan(root, 'Road Map'), 'contextmenu')
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(['Road Map', ID, 'Copy ID'])
  })

  it('the reveal trap: a right-button mousedown is swallowed, so the link is still rendered when contextmenu arrives', async () => {
    const { root, view } = await mount(`pad [[${ID}]] tail\n`)
    // Unprevented, the browser would put the caret in the match and the reveal rule would drop the span.
    expect(mouse(linkSpan(root, 'Road Map'), 'mousedown').defaultPrevented).toBe(true)
    expect(view.state.selection.from).toBe(1)
    mouse(linkSpan(root, 'Road Map'), 'contextmenu')
    expect(linkSpan(root, 'Road Map')).toBeDefined()
    expect(popupOf(view)).not.toBeNull()
  })

  it('a Ctrl-click is macOS\'s other right-click: its left-button mousedown is swallowed on an id link, never on a name link', async () => {
    const { root } = await mount(`pad [[${ID}]] and [[Other]] tail\n`)
    const ctrlDown = (target: Element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(ctrlDown(linkSpan(root, 'Road Map'))).toBe(true)
    expect(ctrlDown(linkSpan(root, 'Other'))).toBe(false)
  })
})

describe('what keeps the native menu', () => {
  it('a NAME link: neither the right mousedown nor the contextmenu is prevented, and nothing is drawn', async () => {
    const { root, view } = await mount('pad [[Known]] and [[Missing]] tail\n')
    for (const shown of ['Known', 'Missing']) {
      expect(mouse(linkSpan(root, shown), 'mousedown').defaultPrevented).toBe(false)
      expect(mouse(linkSpan(root, shown), 'contextmenu').defaultPrevented).toBe(false)
    }
    expect(popupOf(view)).toBeNull()
  })

  it('plain text', async () => {
    const { root, view } = await mount(`pad [[${ID}]] tail\n`)
    expect(mouse(root.querySelector('.ProseMirror p')!, 'contextmenu').defaultPrevented).toBe(false)
    expect(popupOf(view)).toBeNull()
  })

  it('without wikilinkNav the menu plugin is not registered at all', async () => {
    const { root, view } = await mount(`pad [[${ID}]] tail\n`, false)
    expect(mouse(linkSpan(root, 'Road Map'), 'contextmenu').defaultPrevented).toBe(false)
    expect(popupOf(view)).toBeNull()
  })
})

describe('dismiss', () => {
  const cases: Array<[string, (view: EditorView) => void]> = [
    ['outside mousedown', () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))],
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['scroll', () => document.body.dispatchEvent(new Event('scroll', { bubbles: true }))],
    ['window blur', () => window.dispatchEvent(new Event('blur'))],
    ['doc change', (view) => view.dispatch(view.state.tr.insertText('x', 1))],
  ]
  for (const [name, dismiss] of cases) {
    it(name, async () => {
      const { root, view } = await mount(`pad [[${ID}]] tail\n`)
      mouse(linkSpan(root, 'Road Map'), 'contextmenu')
      expect(popupOf(view)).not.toBeNull()
      dismiss(view)
      expect(popupOf(view)).toBeNull()
    })
  }

  it('mousedown inside the popup keeps it open', async () => {
    const { root, view } = await mount(`pad [[${ID}]] tail\n`)
    mouse(linkSpan(root, 'Road Map'), 'contextmenu')
    rowsOf(popupOf(view)!)[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(popupOf(view)).not.toBeNull()
  })
})

describe('openIdMenu on any element (no editor)', () => {
  it('draws, copies and closes on a bare parent; the returned close is the caller\'s own dismiss', async () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const onNotice = vi.fn()
    const close = openIdMenu(parent, 10, 10, 'Road Map', ID, onNotice)
    const popup = parent.querySelector<HTMLElement>('.ctx-menu')!
    expect(rowsOf(popup).map((row) => row.textContent)).toEqual(['Road Map', ID, 'Copy ID'])
    rowsOf(popup)[2]!.click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(ID)
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledExactlyOnceWith('Copied ID'))
    expect(parent.querySelector('.ctx-menu')).toBeNull()

    openIdMenu(parent, 10, 10, undefined, ID, onNotice)
    const again = openIdMenu(parent, 10, 10, undefined, ID, onNotice)
    expect(parent.querySelectorAll('.ctx-menu')).toHaveLength(2) // the caller owns one-at-a-time
    again()
    close()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(parent.querySelector('.ctx-menu')).toBeNull()
    parent.remove()
  })
})
