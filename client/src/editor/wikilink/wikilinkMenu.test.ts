/**
 * Right-click on a `[[link]]` (YAZ-2293, YAZ-3609 D23): real editor (`createCrepe({ wikilinkNav })`), real
 * mousedown / contextmenu events on the rendered `.wikilink` spans. Pinned here: the one link menu names
 * the note and its id, and "Copy ID" copies exactly the id; a missing note still offers its id (YAZ-3905
 * S10); a NAME link gets the same menu with no ID rows; Open, Open in new tab, Copy name, Edit link and
 * Remove link do what they say (YAZ-3740; every kind's exact rows and the new rows: `linkMenu.test.ts`); a right-button mousedown on a link is swallowed so the link is still rendered when
 * `contextmenu` arrives; and the menu closes the way every `.ctx-menu--editor` popup does.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { IndexRecord } from '@shared/types'
import { linkResolver } from '../../links/folderLinks'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { WIKILINK_CLASS, createWikilinkResolveSource, type MutableWikilinkResolveSource } from './wikilinkPlugin'

const ID = 'k3m9x2pq7abc'
const DEAD = 'zzzzzzzzzzz9'
const resolve = (target: string) => (target === ID ? '/vault/Projects/Road Map.md' : target === 'Known' ? '/vault/Known.md' : null)

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** The feed of a vault that uses IDs, unless a test says otherwise (YAZ-2523). */
async function mount(markdown: string, withNav = true, feed: (source: MutableWikilinkResolveSource) => void = (source) => source.update(resolve, undefined, undefined, true)) {
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
const rowNamed = (view: EditorView, label: string) => rowsOf(popupOf(view)!).find((row) => row.textContent === label)!
/** The one link menu's rows (D23, YAZ-3740), with no App doors: an id link's, its top line the ID alone (YAZ-3747 demo), with Copy ID. */
const idMenu = (id: string) => [`ID: ${id}`, 'Open', 'Open in new tab', 'Copy name and ID', 'Copy ID', 'Copy path', 'Edit link', 'Remove link']
/** A found name link's: no top line, it would repeat the pill (YAZ-3747 demo); no Copy ID. */
const nameMenu = () => ['Open', 'Open in new tab', 'Copy name', 'Copy path', 'Edit link', 'Remove link']
/** A name link that finds nothing: no top line, no path to copy. */
const deadNameMenu = () => ['Open', 'Open in new tab', 'Copy name', 'Edit link', 'Remove link']
/** A note that is gone (YAZ-3905 S10): what can be said, its ID to copy, Edit and Remove. */
const missingMenu = (id: string) => [`Missing note · ${id}`, 'Copy ID', 'Edit link', 'Remove link']

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
  it('replaces the native menu with the one link menu: the note\'s name and its id, which are not actions, then the rows', async () => {
    const { root, view } = await mount(`pad [[${ID}]] tail\n`)
    expect(mouse(linkSpan(root, 'Road Map'), 'contextmenu').defaultPrevented).toBe(true)
    const rows = rowsOf(popupOf(view)!)
    expect(rows.map((row) => row.textContent)).toEqual(idMenu(ID))
    expect(rows.map((row) => row.disabled)).toEqual([true, false, false, false, false, false, false, false])
  })

  it('Copy ID copies exactly the id, says so, closes — and the document keeps every byte', async () => {
    const md = `pad [[${ID}]] tail\n`
    const { crepe, root, nav, view } = await mount(md)
    mouse(linkSpan(root, 'Road Map'), 'contextmenu')
    rowNamed(view, 'Copy ID').click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(ID)
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith(`Copied: ${ID}`))
    expect(popupOf(view)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(md)
  })

  it('reports a clipboard the OS refused', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const { root, nav, view } = await mount(`pad [[${ID}]] tail\n`)
    mouse(linkSpan(root, 'Road Map'), 'contextmenu')
    rowNamed(view, 'Copy ID').click()
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith("Can't copy ID: denied"))
  })

  it('a hand-typed label and a heading segment are the same link: the name row is the TITLE', async () => {
    const { root, view } = await mount(`pad [[${ID}|my label]] and [[${ID}#Scope]] tail\n`)
    mouse(linkSpan(root, 'my label'), 'contextmenu')
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(idMenu(ID))
    mouse(linkSpan(root, 'Scope'), 'contextmenu')
    expect(view.dom.parentElement!.querySelectorAll('.ctx-menu--editor')).toHaveLength(1) // retargeted, never stacked
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(idMenu(ID))
  })

  it('S10: an id no note has reads "Missing note", and still offers its id and Copy ID (YAZ-3905)', async () => {
    const { root, view } = await mount(`pad [[${DEAD}]] tail\n`)
    expect(mouse(linkSpan(root, `Missing note · ${DEAD}`), 'contextmenu').defaultPrevented).toBe(true)
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(missingMenu(DEAD))
    rowNamed(view, 'Copy ID').click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(DEAD)
  })

  it('E: the pill shows the title of the note, and of the folder (YAZ-2420 D14); the top line is the ID alone', async () => {
    const FOLDER_ID = 'f7n2w8rt4xyz'
    const titled = (path: string, id: string, title: string) => ({ path, id, title, folder: 'upwork-2026', basename: 'x', aliases: [] as string[] }) as IndexRecord
    const records = [titled('/vault/upwork-2026/up-001-abdul-k3m9x2pq7abc.md', ID, 'UP-001 - Abdul')]
    const folders = [titled('/vault/upwork-2026/.folder.md', FOLDER_ID, 'Upwork 2026')]
    const { root, view } = await mount(`pad [[${FOLDER_ID}]] and [[${ID}]] tail\n`, true, (source) =>
      source.update(linkResolver(records, '/vault', ['/vault/upwork-2026'], folders), records, folders, true),
    )
    mouse(linkSpan(root, 'UP-001 - Abdul'), 'contextmenu')
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(idMenu(ID))
    mouse(linkSpan(root, 'Upwork 2026'), 'contextmenu')
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(idMenu(FOLDER_ID))
  })

  it('K5 — right-click a rendered link to a FOLDER: its id and Copy ID', async () => {
    const FOLDER_ID = 'f7n2w8rt4xyz'
    const record = (path: string, id: string, title: string): IndexRecord => ({
      path, id, name: path.slice(path.lastIndexOf('/') + 1), basename: 'x', title, folder: 'Projects', ext: 'md', size: 1, ctime: 1, mtime: 1,
      properties: {}, aliases: [], tags: [], links: [], embeds: [],
    })
    // The bridge's feed: a folder with its settings file's id, and a note INSIDE it — which is no folder.
    const records = [record('/vault/Projects/Road Map.md', ID, 'Road Map')]
    const folders = [record('/vault/Projects/.folder.md', FOLDER_ID, 'Projects')]
    const { root, view } = await mount(`pad [[${FOLDER_ID}]] and [[${ID}]] tail\n`, true, (source) =>
      source.update(linkResolver(records, '/vault', ['/vault/Projects'], folders), records, folders, true),
    )
    mouse(linkSpan(root, 'Projects'), 'contextmenu') // the link itself shows the bare name
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(idMenu(FOLDER_ID))
    rowNamed(view, 'Copy ID').click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(FOLDER_ID)
    mouse(linkSpan(root, 'Road Map'), 'contextmenu')
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(idMenu(ID))
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

  it('a Ctrl-click is macOS\'s other right-click: its left-button mousedown is swallowed on a link, never on raw text', async () => {
    const { root } = await mount(`pad [[${ID}]] and [[Other]] tail\n`)
    const ctrlDown = (target: Element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(ctrlDown(linkSpan(root, 'Road Map'))).toBe(true)
    expect(ctrlDown(linkSpan(root, 'Other'))).toBe(true)
    expect(ctrlDown(root.querySelector('.ProseMirror p')!)).toBe(false)
  })
})

describe('right-click on a number ID link (YAZ-2677 D3)', () => {
  const NUMBERED = (target: string) => (target.toLowerCase() === 'yaz-12' || target.toLowerCase() === 'old-12' ? '/vault/Projects/Road Map.md' : null)
  const feed = (source: MutableWikilinkResolveSource) => source.update(NUMBERED, undefined, undefined, true, ['YAZ', 'OLD'])

  it('shows and copies the ID as the app writes it, whatever the case or the letters of before in the link', async () => {
    for (const typed of ['YAZ-12', 'yaz-12', 'OLD-12']) {
      const { root, view } = await mount(`pad [[${typed}]] tail\n`, true, feed)
      expect(mouse(linkSpan(root, 'Road Map'), 'contextmenu').defaultPrevented).toBe(true)
      expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(idMenu('YAZ-12'))
      rowNamed(view, 'Copy ID').click()
      expect(writeText).toHaveBeenLastCalledWith('YAZ-12')
    }
  })

  it('S21, S22: `[[GPT-4]]` and `[[BUS-12]]` are name links there: the menu has no ID rows', async () => {
    const { root, view } = await mount('pad [[GPT-4]] and [[BUS-12]] tail\n', true, feed)
    for (const shown of ['GPT-4', 'BUS-12']) {
      mouse(linkSpan(root, shown), 'contextmenu')
      expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(deadNameMenu())
    }
  })

  it('S25: a number ID no note has is a missing note (YAZ-3905 S10): its id as the app writes it, and Copy ID', async () => {
    const { root, view } = await mount('pad [[yaz-99]] tail\n', true, feed)
    expect(mouse(linkSpan(root, 'Missing note · YAZ-99'), 'contextmenu').defaultPrevented).toBe(true)
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(missingMenu('YAZ-99'))
  })
})

describe('a name link gets the same menu (YAZ-3609 D23)', () => {
  it('a found and a missing NAME link: the right mousedown is swallowed, and the menu has no ID rows', async () => {
    const { root, view } = await mount('pad [[Known]] and [[Missing]] tail\n')
    for (const [shown, menu] of [['Known', nameMenu], ['Missing', deadNameMenu]] as const) {
      expect(mouse(linkSpan(root, shown), 'mousedown').defaultPrevented).toBe(true)
      expect(mouse(linkSpan(root, shown), 'contextmenu').defaultPrevented).toBe(true)
      expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(menu())
    }
  })

  it('a pathed name link, to a note or a folder, has no top line: never its typed path, nor a repeat of its pill (YAZ-3747 demo)', async () => {
    const FOLDER_ID = 'f7n2w8rt4xyz'
    const record = (path: string, id: string, title: string): IndexRecord => ({
      path, id, name: path.slice(path.lastIndexOf('/') + 1), basename: 'x', title, folder: 'area', ext: 'md', size: 1, ctime: 1, mtime: 1,
      properties: {}, aliases: [], tags: [], links: [], embeds: [],
    })
    const folders = [record('/vault/evals/context/fernhill/.folder.md', FOLDER_ID, 'fernhill')]
    const base = linkResolver([], '/vault', ['/vault/evals', '/vault/evals/context', '/vault/evals/context/fernhill'], folders)
    const { root, view } = await mount('pad [[evals/context/fernhill]] and [[Sub/Deep/Known]] tail\n', true, (source) =>
      source.update((target) => (target === 'Sub/Deep/Known' ? '/vault/Sub/Deep/Known.md' : base(target)), [], folders, true),
    )
    mouse(linkSpan(root, 'fernhill'), 'contextmenu')
    expect(rowsOf(popupOf(view)!)[0]!.textContent).toBe('Open')
    mouse(linkSpan(root, 'Known'), 'contextmenu')
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(nameMenu())
  })

  // The ID vault's half is `replaces the native menu` and `the reveal trap`, above.
  it('in a vault that does not use IDs a link whose text looks like an id is a name link: no Copy ID (YAZ-2523 V5)', async () => {
    const { root, view } = await mount(`pad [[${ID}]] tail\n`, true, (source) => source.update(() => null))
    mouse(linkSpan(root, ID), 'contextmenu')
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(deadNameMenu())
  })

  it('Open and Open in new tab follow the link as a click and a ⌘-click do', async () => {
    const { root, nav, view } = await mount('pad [[Known]] tail\n')
    mouse(linkSpan(root, 'Known'), 'contextmenu')
    rowNamed(view, 'Open').click()
    mouse(linkSpan(root, 'Known'), 'contextmenu')
    rowNamed(view, 'Open in new tab').click()
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Known.md')
    expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith('/vault/Known.md')
  })

  it('"Copy link" is gone (YAZ-3740): Copy name copies the page\'s name, not the alias or the heading', async () => {
    const { root, nav, view } = await mount('pad [[Known#Q1|the plan]] tail\n')
    mouse(linkSpan(root, 'the plan'), 'contextmenu')
    expect(rowNamed(view, 'Copy link')).toBeUndefined()
    expect(rowNamed(view, 'Copy name').dataset.hint).toBeUndefined() // demo M1: the notice says it
    rowNamed(view, 'Copy name').click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Known')
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith('Copied: Known'))
  })

  it('Edit link puts the caret in the raw `[[…]]` with its target selected: the link shows as text', async () => {
    const { root, view } = await mount('pad [[Known|the plan]] tail\n')
    mouse(linkSpan(root, 'the plan'), 'contextmenu')
    rowNamed(view, 'Edit link').click()
    const { from, to } = view.state.selection
    expect(view.state.doc.textBetween(from, to)).toBe('Known')
    expect(root.querySelector(`.${WIKILINK_CLASS}`)).toBeNull()
  })

  it('Remove link keeps the text the link shows: an alias, an id link\'s title, a heading part', async () => {
    const { crepe, root, view } = await mount(`a [[Known|the plan]] b [[${ID}]] c [[Known#Q1]] d\n`)
    for (const shown of ['the plan', 'Road Map', 'Q1']) {
      mouse(linkSpan(root, shown), 'contextmenu')
      rowNamed(view, 'Remove link').click()
    }
    expect(getMarkdownForSave(crepe)).toBe('a the plan b Road Map c Known > Q1 d\n')
  })

  it('a read-only note offers no Edit and no Remove (YAZ-3076 D2)', async () => {
    const { crepe, root, view } = await mount('pad [[Known]] tail\n')
    crepe.setReadonly(true)
    mouse(linkSpan(root, 'Known'), 'contextmenu')
    expect(rowsOf(popupOf(view)!).map((row) => row.textContent)).toEqual(['Open', 'Open in new tab', 'Copy name', 'Copy path'])
  })

})

describe('what keeps the native menu', () => {
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
