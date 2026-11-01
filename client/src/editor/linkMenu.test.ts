/**
 * The one link menu (YAZ-3740) on a real editor, for each kind of link: the exact rows, their order, their groups
 * and their hints, and that each new row calls App's door with the link's target. Its flyout ("Open in ▸",
 * YAZ-3901) on `openMenuAt`: pointer and keys. A missing note and an ID of another vault of the window (YAZ-3905):
 * their menus (their pills are `wikilinkPlugin.test.ts`'s).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { IndexRecord } from '@shared/types'
import { SWITCH_MS } from '../sidebar/ContextMenu'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { openMenuAt, type LinkActions } from './linkMenu'
import type { MarkdownLinkNav } from './markdownLink'
import { WIKILINK_CLASS, createWikilinkResolveSource, type VaultsOfLetters } from './wikilink/wikilinkPlugin'

const record = (path: string, title: string, id?: string): IndexRecord => ({
  path, name: path.slice(path.lastIndexOf('/') + 1), basename: 'x', title, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1,
  ...(id === undefined ? {} : { id }), properties: {}, aliases: [], tags: [], links: [], embeds: [],
})

const NOTE = '/vault/AR v2 plan.md'
const ROAD = '/vault/Plans/Road Map.md'
const DIR = '/vault/Projects'
const records = [record(NOTE, 'AR v2 plan', 'YAS-466'), record(ROAD, 'Road Map')]
const folders = [record(`${DIR}/.folder.md`, 'Projects')]
const paths: Record<string, string> = { 'yas-466': NOTE, 'plans/road map': ROAD, projects: DIR }
const resolve = (target: string) => paths[target.toLowerCase()] ?? null
/** The window's other vaults: one uses `INL`, two use `TWO`. */
const vaultsOf: VaultsOfLetters = (letters) => (letters === 'INL' ? ['In-harness-lab'] : letters === 'TWO' ? ['Alpha', 'Beta'] : [])

type Doors = { [K in keyof Required<LinkActions>]: Mock }
/** App's doors (`linkActions`): the page is a favorite and not in focus. */
const doors = (): Doors => ({
  showInSidebar: vi.fn(),
  listState: vi.fn(() => ({ favorite: true, focus: false })),
  toggleFavorite: vi.fn(),
  toggleFocus: vi.fn(),
  openNewWindow: vi.fn(),
  openVsCode: vi.fn(),
  openDefault: vi.fn(),
  reveal: vi.fn(),
})

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mountWith(markdown: string, options: (acts: Doors) => Partial<Parameters<typeof createCrepe>[0]>) {
  const acts = doors()
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...options(acts) })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, acts, view: crepe.editor.action((ctx) => ctx.get(editorViewCtx)) }
}

/** A note of a vault that uses IDs (`YAS`), with App's doors unless `withDoors` is false. */
async function mount(markdown: string, withDoors = true, letters: VaultsOfLetters = vaultsOf) {
  const source = createWikilinkResolveSource()
  source.update(resolve, records, folders, true, ['YAS'])
  const onNotice = vi.fn()
  const m = await mountWith(markdown, (acts) => ({
    wikilinks: source,
    wikilinkNav: { ...(withDoors ? acts : {}), root: '/vault', createFolder: () => '', openCurrent: vi.fn(), openBackground: vi.fn(), onNotice },
    vaultsOfLetters: letters,
  }))
  return { ...m, onNotice }
}

/** A note with one Markdown link; `inApp` finds `/Other/Plan.md` for a relative href. */
async function mountMarkdown(markdown: string) {
  const nav: Partial<MarkdownLinkNav> = { open: vi.fn(), copy: vi.fn().mockResolvedValue(undefined), onNotice: vi.fn() }
  const m = await mountWith(markdown, (acts) => {
    Object.assign(nav, acts, {
      inApp: (href: string) => (href.startsWith('../') ? '/Other/Plan.md' : null),
      vaultPath: (href: string) => (href.startsWith('../') ? '/Other/Plan.md' : null),
      vaultTag: () => 'Other Vault',
      icon: () => ({ class: 'file-icon' }),
      openPath: vi.fn(),
    })
    return { markdownLinkNav: nav as MarkdownLinkNav }
  })
  return { ...m, nav: nav as MarkdownLinkNav & { copy: Mock; onNotice: Mock } }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.ctx-menu--editor').forEach((el) => el.remove())
})

let writeText: Mock
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
})

const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')!

/**
 * A menu as it reads: a label row in brackets, a line as ──, a parent with ▸, a hint after a ·. The flyout is
 * not part of its parent's menu.
 */
function shape(menu: HTMLElement): string[] {
  return Array.from(menu.children).map((el) => {
    if (el.classList.contains('document-zoom__divider')) return '──'
    const button = (el.matches('button') ? el : el.querySelector(':scope > button')) as HTMLButtonElement
    const text = button.disabled ? `(${button.textContent})` : `${button.textContent}${button.getAttribute('aria-haspopup') === 'menu' ? ' ▸' : ''}`
    return button.dataset.hint === undefined ? text : `${text} · ${button.dataset.hint}`
  })
}

const span = (root: HTMLElement, text: string) => {
  const found = Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).find((el) => el.textContent === text)
  if (found === undefined) throw new Error(`no .wikilink showing "${text}"`)
  return found
}
const rightClick = (target: Element) => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 }))
/** The right-click menu of the link showing `text`. */
function menuOf(root: HTMLElement, view: EditorView, text: string): HTMLElement {
  rightClick(span(root, text))
  return popupOf(view)
}
const rowOf = (menu: HTMLElement, label: string) => Array.from(menu.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')).find((row) => row.textContent === label)!
/** The flyout of the menu's "Open in", opened by a click. */
function flyoutOf(menu: HTMLElement): HTMLElement {
  rowOf(menu, 'Open in').click()
  return menu.querySelector<HTMLElement>('.ctx-menu__sub')!
}

const OPEN_IN = ['New window', 'VS Code', 'Default app', '──', 'Reveal in Finder']

describe('the one link menu, for each kind of link (YAZ-3740)', () => {
  it('an ID link: its title and ID, the Open rows, the copy rows with what each copies, the lists and Open in ▸, then Edit and Remove', async () => {
    const { root, view } = await mount('pad [[YAS-466]] tail\n')
    const menu = menuOf(root, view, 'AR v2 plan')
    expect(shape(menu)).toEqual([
      '(AR v2 plan · YAS-466)', '──',
      'Open', 'Open in new tab', 'Show in sidebar', '──',
      'Copy name and ID', 'Copy ID', 'Copy path', '──',
      'Remove from favorites', 'Add to focus', 'Open in ▸', '──',
      'Edit link', 'Remove link',
    ])
    expect(shape(flyoutOf(menu))).toEqual(OPEN_IN)
  })

  it('a name link: no ID label, "Copy name" with the name the pill shows (YAZ-3778 D3), no Copy ID', async () => {
    const { root, view } = await mount('pad [[Plans/Road Map]] tail\n')
    const menu = menuOf(root, view, 'Road Map')
    expect(shape(menu)).toEqual([
      '(Road Map)', '──', // the pill's name, not the typed path (YAZ-3747 demo)
      'Open', 'Open in new tab', 'Show in sidebar', '──',
      'Copy name', 'Copy path', '──',
      'Remove from favorites', 'Add to focus', 'Open in ▸', '──',
      'Edit link', 'Remove link',
    ])
    expect(shape(flyoutOf(menu))).toEqual(OPEN_IN)
  })

  it('a folder link: "<name> (folder)", and Open in ▸ has no New window, as in the sidebar', async () => {
    const { root, view } = await mount('pad [[Projects]] tail\n')
    const menu = menuOf(root, view, 'Projects')
    expect(shape(menu)).toEqual([
      '(Projects (folder))', '──',
      'Open', 'Open in new tab', 'Show in sidebar', '──',
      'Copy name', 'Copy path', '──',
      'Remove from favorites', 'Add to focus', 'Open in ▸', '──',
      'Edit link', 'Remove link',
    ])
    expect(shape(flyoutOf(menu))).toEqual(['VS Code', 'Default app', '──', 'Reveal in Finder'])
  })

  it('a Markdown link into another vault of the window: "<name> (<vault>)", Copy name, and the place rows of its page', async () => {
    const { root, view } = await mountMarkdown('[the plan](../Other/Plan.md)\n')
    rightClick(root.querySelector('a')!)
    const menu = popupOf(view)
    expect(shape(menu)).toEqual([
      '(Plan (Other Vault))', '──',
      'Open', 'Open in new tab', 'Show in sidebar', '──',
      'Copy name', 'Copy path', '──',
      'Remove from favorites', 'Add to focus', 'Open in ▸', '──',
      'Edit link', 'Remove link',
    ])
    expect(shape(flyoutOf(menu))).toEqual(OPEN_IN)
  })

  it('a web link: Open, Copy address, Edit link, Remove link', async () => {
    const { root, view } = await mountMarkdown('[Example](https://example.com)\n')
    rightClick(root.querySelector('a')!)
    expect(shape(popupOf(view))).toEqual(['Open', '──', 'Copy address', '──', 'Edit link', 'Remove link'])
  })

  it('with no doors from App the place rows that need one are left out; Copy path stays', async () => {
    const { root, view } = await mount('pad [[YAS-466]] tail\n', false)
    expect(shape(menuOf(root, view, 'AR v2 plan'))).toEqual([
      '(AR v2 plan · YAS-466)', '──',
      'Open', 'Open in new tab', '──',
      'Copy name and ID', 'Copy ID', 'Copy path', '──',
      'Edit link', 'Remove link',
    ])
  })
})

describe('each new row calls its door with the link\'s target (YAZ-3740)', () => {
  it('a [[link]]: Show in sidebar, the lists and every Open in ▸ row get the page\'s path', async () => {
    const { root, view, acts } = await mount('pad [[YAS-466]] tail\n')
    rowOf(menuOf(root, view, 'AR v2 plan'), 'Show in sidebar').click()
    rowOf(menuOf(root, view, 'AR v2 plan'), 'Remove from favorites').click()
    rowOf(menuOf(root, view, 'AR v2 plan'), 'Add to focus').click()
    for (const child of ['New window', 'VS Code', 'Default app', 'Reveal in Finder']) rowOf(flyoutOf(menuOf(root, view, 'AR v2 plan')), child).click()
    expect(acts.showInSidebar).toHaveBeenCalledExactlyOnceWith(NOTE)
    // The state the menu read goes with the toggle, as the tab menu's.
    expect(acts.toggleFavorite).toHaveBeenCalledExactlyOnceWith([NOTE], true)
    expect(acts.toggleFocus).toHaveBeenCalledExactlyOnceWith([NOTE], false)
    for (const door of [acts.openNewWindow, acts.openVsCode, acts.openDefault, acts.reveal]) expect(door).toHaveBeenCalledExactlyOnceWith(NOTE)
    expect(acts.listState).toHaveBeenCalledWith(NOTE)
  })

  it('demo M2: only Copy path, Add to focus and Add to favorites carry an icon, as in the tab menu; no row has a hint', async () => {
    const { root, view } = await mount('pad [[YAS-466]] tail\n')
    const menu = menuOf(root, view, 'AR v2 plan')
    const rows = Array.from(menu.querySelectorAll<HTMLElement>(':scope > .ctx-menu__item, :scope > .ctx-menu__parent > .ctx-menu__item'))
    expect(rows.filter((row) => row.querySelector('svg') !== null).map((row) => row.textContent)).toEqual(['Copy path', 'Remove from favorites', 'Add to focus'])
    expect(rows.filter((row) => row.dataset.hint !== undefined && row.dataset.hint !== '')).toEqual([])
  })

  it('Copy name and ID, Copy name and Copy path copy their text; the notice shows what a name or ID row copied (demo M1)', async () => {
    const { crepe, root, view, onNotice } = await mount('a [[YAS-466]] b [[Plans/Road Map]] c\n')
    rowOf(menuOf(root, view, 'AR v2 plan'), 'Copy name and ID').click()
    await vi.waitFor(() => expect(onNotice).toHaveBeenLastCalledWith('Copied: AR v2 plan (YAS-466)'))
    rowOf(menuOf(root, view, 'Road Map'), 'Copy name').click()
    await vi.waitFor(() => expect(onNotice).toHaveBeenLastCalledWith('Copied: Road Map'))
    rowOf(menuOf(root, view, 'Road Map'), 'Copy path').click()
    await vi.waitFor(() => expect(onNotice).toHaveBeenLastCalledWith('Copied path'))
    expect(writeText.mock.calls).toEqual([['AR v2 plan (YAS-466)'], ['Road Map'], [ROAD]])
    expect(getMarkdownForSave(crepe)).toBe('a [[YAS-466]] b [[Plans/Road Map]] c\n')
  })

  it('a Markdown link: Show in sidebar and Copy path take the page it opens; a web link\'s Copy address its href', async () => {
    const pill = await mountMarkdown('[the plan](../Other/Plan.md)\n')
    rightClick(pill.root.querySelector('a')!)
    rowOf(popupOf(pill.view), 'Show in sidebar').click()
    rightClick(pill.root.querySelector('a')!)
    rowOf(popupOf(pill.view), 'Copy path').click()
    expect(pill.acts.showInSidebar).toHaveBeenCalledExactlyOnceWith('/Other/Plan.md')
    expect(pill.nav.copy).toHaveBeenCalledExactlyOnceWith('/Other/Plan.md')
    await vi.waitFor(() => expect(pill.nav.onNotice).toHaveBeenCalledWith('Copied path'))
    const web = await mountMarkdown('[Example](https://example.com)\n')
    rightClick(web.root.querySelector('a')!)
    rowOf(popupOf(web.view), 'Copy address').click()
    expect(web.nav.copy).toHaveBeenCalledExactlyOnceWith('https://example.com')
    await vi.waitFor(() => expect(web.nav.onNotice).toHaveBeenCalledWith('Copied address'))
  })

  it('Remove link leaves the text the pill shows: a pathed name link its name (YAZ-3778 D3), an ID link its title', async () => {
    const { crepe, root, view } = await mount('a [[Plans/Road Map]] b [[YAS-466]] c\n')
    rowOf(menuOf(root, view, 'Road Map'), 'Remove link').click()
    rowOf(menuOf(root, view, 'AR v2 plan'), 'Remove link').click()
    expect(getMarkdownForSave(crepe)).toBe('a Road Map b AR v2 plan c\n')
  })
})

describe('the flyout of a parent row (YAZ-3901)', () => {
  const ran = { child: vi.fn(), reveal: vi.fn(), other: vi.fn() }
  let close: () => void
  let menu: HTMLElement
  beforeEach(() => {
    for (const run of Object.values(ran)) run.mockClear()
    close = openMenuAt(document.body, 10, 10, [
      { label: 'Other row', run: ran.other },
      { label: 'Open in', run: () => {}, children: [[{ label: 'VS Code', run: ran.child }], [{ label: 'Reveal in Finder', run: ran.reveal }]] },
    ])
    menu = document.querySelector<HTMLElement>('.ctx-menu--editor')!
  })
  afterEach(() => {
    close()
    vi.useRealTimers()
  })
  const parentRow = () => menu.querySelector<HTMLButtonElement>('.ctx-menu__item--parent')!
  const flyout = () => menu.querySelector<HTMLElement>('.ctx-menu__sub')
  const key = (target: EventTarget, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))

  it('looks like the sidebar\'s "Open in ▸": a parent row with a closed flyout, its groups parted by a line', () => {
    expect(shape(menu)).toEqual(['Other row', 'Open in ▸'])
    expect(parentRow().parentElement!.classList.contains('ctx-menu__parent')).toBe(true)
    expect(parentRow().getAttribute('aria-expanded')).toBe('false')
    expect(flyout()).toBeNull()
    parentRow().click()
    expect(flyout()!.className).toBe('ctx-menu ctx-menu--editor ctx-menu__sub')
    expect(shape(flyout()!)).toEqual(['VS Code', '──', 'Reveal in Finder'])
    expect(parentRow().getAttribute('aria-expanded')).toBe('true')
  })

  it('the pointer: hover opens it at once; on another row it closes after the sidebar\'s wait, unless the pointer comes back', () => {
    vi.useFakeTimers()
    parentRow().parentElement!.dispatchEvent(new MouseEvent('mouseenter'))
    expect(flyout()).not.toBeNull()
    rowOf(menu, 'Other row').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    parentRow().parentElement!.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(SWITCH_MS)
    expect(flyout()).not.toBeNull()
    rowOf(menu, 'Other row').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(SWITCH_MS - 1)
    expect(flyout()).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(flyout()).toBeNull()
    expect(ran.other).not.toHaveBeenCalled()
  })

  it('closing the menu while the flyout waits to go clears the wait (YAZ-3910 A6)', () => {
    vi.useFakeTimers()
    parentRow().parentElement!.dispatchEvent(new MouseEvent('mouseenter'))
    rowOf(menu, 'Other row').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(vi.getTimerCount()).toBe(1)
    close()
    expect(menu.isConnected).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an empty group of the flyout draws no line', () => {
    close()
    close = openMenuAt(document.body, 10, 10, [{ label: 'Open in', run: () => {}, children: [[], [{ label: 'Reveal in Finder', run: ran.reveal }]] }])
    menu = document.querySelector<HTMLElement>('.ctx-menu--editor')!
    parentRow().click()
    expect(shape(flyout()!)).toEqual(['Reveal in Finder'])
  })

  it('the keys: ArrowRight opens it with the focus on its first row; ArrowLeft closes it and gives the focus back', () => {
    parentRow().focus()
    key(parentRow(), 'ArrowRight')
    expect(document.activeElement?.textContent).toBe('VS Code')
    key(document.activeElement!, 'ArrowLeft')
    expect(flyout()).toBeNull()
    expect(document.activeElement).toBe(parentRow())
    expect(menu.isConnected).toBe(true)
  })

  it('Escape closes the flyout alone; the next Escape closes the menu', () => {
    parentRow().click()
    key(window, 'Escape')
    expect(flyout()).toBeNull()
    expect(menu.isConnected).toBe(true)
    key(window, 'Escape')
    expect(menu.isConnected).toBe(false)
  })

  it('a press inside the flyout keeps the menu; a child row runs and closes the whole menu', () => {
    parentRow().click()
    rowOf(flyout()!, 'Reveal in Finder').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menu.isConnected).toBe(true)
    rowOf(flyout()!, 'Reveal in Finder').click()
    expect(ran.reveal).toHaveBeenCalledOnce()
    expect(ran.child).not.toHaveBeenCalled()
    expect(menu.isConnected).toBe(false)
  })
})

describe('the menus of a missing note and an ID of another vault (YAZ-3905; their pills: wikilinkPlugin.test.ts)', () => {
  it('S10: its menu says what it can, and copies the ID', async () => {
    const { root, view, onNotice } = await mount('pad [[YAS-999]] tail\n')
    const menu = menuOf(root, view, 'Missing note · YAS-999')
    expect(shape(menu)).toEqual(['(Missing note · YAS-999)', '──', 'Copy ID', '──', 'Edit link', 'Remove link'])
    rowOf(menu, 'Copy ID').click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('YAS-999')
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('Copied: YAS-999'))
  })

  it('S23: an ID with another open vault\'s letters: its menu says whose ID it is', async () => {
    const { root, view } = await mount('pad [[INL-4]] tail\n')
    expect(shape(menuOf(root, view, 'INL-4'))).toEqual(['(INL-4 · ID from the In-harness-lab vault)', '──', 'Copy ID', '──', 'Edit link', 'Remove link'])
  })

  it('S23: letters that two open vaults share name no vault: "another vault"', async () => {
    const { root, view } = await mount('pad [[TWO-3]] tail\n')
    expect(shape(menuOf(root, view, 'TWO-3'))).toEqual(['(TWO-3 · ID from another vault)', '──', 'Copy ID', '──', 'Edit link', 'Remove link'])
  })

  it('S23: letters no open vault has stay a name link, with a name link\'s menu', async () => {
    const plain = await mount('pad [[GPT-4]] tail\n')
    expect(shape(menuOf(plain.root, plain.view, 'GPT-4'))).toEqual(['(GPT-4)', '──', 'Open', 'Open in new tab', '──', 'Copy name', '──', 'Edit link', 'Remove link'])
  })
})
