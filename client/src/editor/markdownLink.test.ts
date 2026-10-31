/**
 * Standard Markdown link interactions (YAZ-1309) against a real Crepe editor. Opening is a
 * host-owned side effect; edit/remove use Crepe's own link-tooltip API so there is one link
 * editor and one serializer. Right-click menus belong to the exact retained editor instance.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { addLinkOn, type MarkdownLinkNav } from './markdownLink'

const mounted: Array<{ crepe: ReturnType<typeof createCrepe>; root: HTMLElement }> = []

async function mount(markdown = '[Example](https://example.com)\n', overrides: Partial<MarkdownLinkNav> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const nav: MarkdownLinkNav = {
    open: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    onNotice: vi.fn(),
    ...overrides,
  }
  const crepe = createCrepe({ root, defaultValue: markdown, markdownLinkNav: nav })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, nav, root, view: crepe.editor.ctx.get(editorViewCtx) }
}

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await item.crepe.destroy()
    item.root.remove()
  }
})

const anchorOf = (root: HTMLElement) => root.querySelector<HTMLAnchorElement>('a')!
const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const rowsOf = (view: EditorView) => Array.from(popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item'))
const rowNamed = (view: EditorView, label: string) => rowsOf(view).find((row) => row.textContent === label)!

/** The default "Links in a note" gestures (YAZ-3936): ⌘-click opens in this tab, ⌘⇧-click in a background tab. */
const OPEN: MouseEventInit = { button: 0, metaKey: true }
const BEHIND: MouseEventInit = { button: 0, metaKey: true, shiftKey: true }

function mouse(target: Element, type: 'mousedown' | 'contextmenu', init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, ...init })
  target.dispatchEvent(event)
  return event
}

describe('primary click', () => {
  it('an open gesture opens the href immediately, prevents caret placement, and does not change Markdown', async () => {
    const { crepe, nav, root } = await mount()
    const event = mouse(anchorOf(root), 'mousedown', OPEN)

    expect(event.defaultPrevented).toBe(true)
    expect(nav.open).toHaveBeenCalledWith('https://example.com')
    expect(getMarkdownForSave(crepe)).toBe('[Example](https://example.com)\n')
  })

  it('opens the whole logical link from a formatted segment that ProseMirror renders separately', async () => {
    const { nav, root } = await mount('[**Bold** label](relative/file.pdf)\n')
    const formattedSegment = Array.from(root.querySelectorAll('a')).find((anchor) => anchor.textContent === 'Bold')
    expect(formattedSegment).toBeDefined()
    mouse(formattedSegment!, 'mousedown', OPEN)
    expect(nav.open).toHaveBeenCalledWith('relative/file.pdf')
  })

  it.each([
    ['fragment-only links', '[Section](#section)\n', { button: 0 }],
    ['middle clicks', '[Example](https://example.com)\n', { button: 1 }],
    ['a click no gesture has', '[Example](https://example.com)\n', { button: 0, shiftKey: true }],
    // YAZ-3935 C1: in an editable note a plain click puts the caret in the link's words, as on text.
    ['a plain click', '[Example](https://example.com)\n', { button: 0 }],
  ])('leaves %s to the editor/browser', async (_name, markdown, init) => {
    const { nav, root } = await mount(markdown)
    const event = mouse(anchorOf(root), 'mousedown', init)
    expect(event.defaultPrevented).toBe(false)
    expect(nav.open).not.toHaveBeenCalled()
  })

  it('reports an open failure passively', async () => {
    const open = vi.fn().mockRejectedValue(new Error('no handler'))
    const onNotice = vi.fn()
    const { root } = await mount(undefined, { open, onNotice })
    mouse(anchorOf(root), 'mousedown', OPEN)
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('Could not open link: no handler'))
  })

  it('reports a synchronous host failure passively too', async () => {
    const open = vi.fn(() => {
      throw new Error('bridge unavailable')
    })
    const onNotice = vi.fn()
    const { root } = await mount(undefined, { open, onNotice })
    expect(() => mouse(anchorOf(root), 'mousedown', OPEN)).not.toThrow()
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('Could not open link: bridge unavailable'))
  })
})

describe('the gestures of Settings › Hotkeys, read at the click (YAZ-3936)', () => {
  it('a changed binding works at once: "the old way" makes a plain click open; Open in a new tab goes where its gesture says', async () => {
    const openPath = vi.fn()
    let hotkeys = {}
    const { root } = await mount('[Note](../note.md)\n', { inApp: () => '/v/note.md', openPath, hotkeys: () => hotkeys })
    expect(mouse(anchorOf(root), 'mousedown', { button: 0 }).defaultPrevented).toBe(false)
    hotkeys = { 'links.thisTab': 'Click', 'links.newTab': 'Alt+Click' }
    expect(mouse(anchorOf(root), 'mousedown', { button: 0 }).defaultPrevented).toBe(true)
    mouse(anchorOf(root), 'mousedown', { button: 0, altKey: true })
    expect(mouse(anchorOf(root), 'mousedown', OPEN).defaultPrevented).toBe(false) // ⌘-click has no action now
    expect(openPath.mock.calls).toEqual([['/v/note.md', 'thisTab'], ['/v/note.md', 'newTab']])
  })

  it('a read-only note keeps "a click opens" (YAZ-3879 point 6)', async () => {
    const openPath = vi.fn()
    const { crepe, root } = await mount('[Note](../note.md)\n', { inApp: () => '/v/note.md', openPath })
    crepe.setReadonly(true)
    expect(mouse(anchorOf(root), 'mousedown', { button: 0 }).defaultPrevented).toBe(true)
    expect(openPath).toHaveBeenCalledExactlyOnceWith('/v/note.md', 'thisTab')
  })
})

describe('a link into a vault this window does not show (YAZ-3609 D21)', () => {
  it('asks the host to add the vault, and never sends the link to the OS; ⌘⇧ asks for a background tab', async () => {
    const elsewhere = vi.fn(() => true)
    const { nav, root } = await mount('[Old](../Archive/old.md)\n', { inApp: () => null, elsewhere })
    mouse(anchorOf(root), 'mousedown', OPEN)
    mouse(anchorOf(root), 'mousedown', BEHIND)
    expect(elsewhere.mock.calls).toEqual([['../Archive/old.md', false], ['../Archive/old.md', true]])
    expect(nav.open).not.toHaveBeenCalled()
  })

  it('V4 a file in no vault the app knows still goes to the OS', async () => {
    const { nav, root } = await mount('[Elsewhere](/tmp/x.md)\n', { inApp: () => null, elsewhere: () => false })
    mouse(anchorOf(root), 'mousedown', OPEN)
    expect(nav.open).toHaveBeenCalledWith('/tmp/x.md')
  })
})

describe('a link to this vault opens in a tab (YAZ-3609 D8, D9)', () => {
  const inApp = (href: string) => (href === '../note.md' ? '/v/note.md' : null)

  it.each([
    ['L1 a ⌘-click opens the current tab', OPEN, 'thisTab'],
    ['L1 a ⌘⇧-click opens a background tab', BEHIND, 'backgroundTab'],
  ])('%s, and never asks the OS', async (_name, init, where) => {
    const openPath = vi.fn()
    const { crepe, nav, root } = await mount('[Note](../note.md)\n', { inApp, openPath })
    const event = mouse(anchorOf(root), 'mousedown', init)
    expect(event.defaultPrevented).toBe(true)
    expect(openPath).toHaveBeenCalledWith('/v/note.md', where)
    expect(nav.open).not.toHaveBeenCalled()
    expect(getMarkdownForSave(crepe)).toBe('[Note](../note.md)\n')
  })

  it.each([
    ['L9 a ⌘-click on a web link', OPEN],
    ['D9 a ⌘⇧-click on a web link', BEHIND],
  ])('%s goes to the OS, as before', async (_name, init) => {
    const openPath = vi.fn()
    const { nav, root } = await mount('[Example](https://example.com)\n', { inApp, openPath })
    const event = mouse(anchorOf(root), 'mousedown', init)
    expect(event.defaultPrevented).toBe(true)
    expect(nav.open).toHaveBeenCalledWith('https://example.com')
    expect(openPath).not.toHaveBeenCalled()
  })
})

describe('a Markdown link into a vault of the window is a pill (YAZ-3609 D19)', () => {
  // The icon is attributes on the span of the link's own text (`fileIconDecoration`): its `::before` draws it.
  const icon = (path: string, folder: boolean) => ({ class: 'probe-icon', 'data-path': path, 'data-folder': String(folder) })
  const vaultPath = (href: string) => (href.startsWith('../') ? `/v/${href.slice(3)}` : null)
  const firsts = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.link-pill--first'))

  it('I6 a vault link is a pill whose first piece carries the icon, on its own text; I7 a web link stays a plain link', async () => {
    const { crepe, root } = await mount('[Plan](../plan.md) and [Research](../research) and [Web](https://example.com)\n', { vaultPath, icon })
    expect(firsts(root).map((el) => [el.closest('a')?.getAttribute('href'), el.textContent, el.classList.contains('probe-icon'), el.dataset.folder])).toEqual([
      ['../plan.md', 'Plan', true, 'false'],
      ['../research', 'Research', true, 'true'],
    ])
    expect(Array.from(root.querySelectorAll('a')).find((a) => a.textContent === 'Web')?.querySelector('.link-pill')).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe('[Plan](../plan.md) and [Research](../research) and [Web](https://example.com)\n')
  })

  it('YAZ-3656 a link with a bold part is one pill: one icon, the first piece and the last piece rounded', async () => {
    const { root } = await mount('[Plan **bold** end](../plan.md)\n', { vaultPath, icon })
    expect(root.querySelectorAll('.probe-icon')).toHaveLength(1)
    const pieces = Array.from(root.querySelectorAll<HTMLElement>('.link-pill'))
    expect(pieces.map((el) => el.textContent)).toEqual(['Plan ', 'bold', ' end'])
    expect(pieces[0]!.classList.contains('link-pill--first') && pieces[2]!.classList.contains('link-pill--last')).toBe(true)
  })

  it('D22 a pill into another vault names that vault as its last piece, inside the link (YAZ-3738 D4); a pill of this vault names none', async () => {
    const vaultTag = (path: string) => (path.startsWith('/v/other/') ? 'Other Vault' : null)
    const { crepe, root } = await mount('[Plan **bold** end](../other/plan.md) and [Here](../here.md)\n', { vaultPath, icon, vaultTag })
    // The vault's name is the pill's own last piece, inside the link and after its text (YAZ-3738 D4).
    const tagged = Array.from(root.querySelectorAll<HTMLElement>('.link-pill__vault'))
    expect(tagged.map((el) => [el.textContent, el.closest('a') !== null, el.previousElementSibling?.textContent])).toEqual([[' (Other Vault)', true, ' end']])
    // A widget: the saved note does not change.
    expect(getMarkdownForSave(crepe)).toBe('[Plan **bold** end](../other/plan.md) and [Here](../here.md)\n')
  })

  it('YAZ-3738 D4: text typed at the link\'s end lands after the vault name, outside the pill', async () => {
    const vaultTag = (path: string) => (path.startsWith('/v/other/') ? 'Other Vault' : null)
    const { view, root } = await mount('[Plan](../other/plan.md) and\n', { vaultPath, icon, vaultTag })
    // Plain text right after the link (1..5), as a keystroke there gives (YAZ-3655).
    view.dispatch(view.state.tr.insert(5, view.state.schema.text('X')))
    expect(view.dom.textContent).toContain('Plan (Other Vault)X and')
    expect(root.querySelector('.link-pill__vault')?.closest('a')).not.toBeNull()
  })

  it('an open gesture on the pill opens the link', async () => {
    const openPath = vi.fn()
    const { root } = await mount('[Plan](../plan.md)\n', { vaultPath, icon, inApp: (href) => vaultPath(href), openPath })
    mouse(root.querySelector('.link-pill')!, 'mousedown', OPEN)
    expect(openPath).toHaveBeenCalledWith('/v/plan.md', 'thisTab')
  })

  it('YAZ-3655 text typed inside and right after a pill is real text: it saves, and the pill follows its link', async () => {
    const { crepe, view, root } = await mount('[Plan](../plan.md)\n', { vaultPath, icon })
    view.dispatch(view.state.tr.insertText('s', 1 + 'Plan'.length))
    expect(getMarkdownForSave(crepe)).toBe('[Plans](../plan.md)\n')
    expect(firsts(root)[0]?.textContent).toBe('Plans')
    // Plain text after the link, as a keystroke there gives (the end-to-end test types it for real).
    view.dispatch(view.state.tr.insert(view.state.doc.content.size - 1, view.state.schema.text(' and more')))
    expect(getMarkdownForSave(crepe)).toBe('[Plans](../plan.md) and more\n')
    expect(Array.from(root.querySelectorAll('.link-pill')).map((el) => el.textContent).join('')).toBe('Plans')
  })
})

describe('the address in the link popup (YAZ-3645)', () => {
  it('follows the link as a click on it does: a vault page opens in a tab, never a new browser window', async () => {
    const openPath = vi.fn()
    const { nav, root, view } = await mount('[Note](../note.md) and [Web](https://example.com)\n', { inApp: (href) => (href === '../note.md' ? '/v/note.md' : null), openPath })
    const popup = (href: string) => {
      const a = document.createElement('a')
      a.className = 'link-display'
      a.setAttribute('href', href)
      a.target = '_blank'
      view.dom.closest('.milkdown')!.appendChild(a)
      return a
    }
    const vault = popup('../note.md')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    vault.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(openPath).toHaveBeenCalledWith('/v/note.md', 'thisTab')
    popup('https://example.com').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
    expect(nav.open).toHaveBeenCalledWith('https://example.com')
    expect(root).toBeDefined()
  })

  it('YAZ-3650 a right-click on the address opens nothing', async () => {
    const openPath = vi.fn()
    const { nav, view } = await mount('[Note](../note.md)\n', { inApp: () => '/v/note.md', openPath })
    const a = document.createElement('a')
    a.className = 'link-display'
    a.setAttribute('href', '../note.md')
    view.dom.closest('.milkdown')!.appendChild(a)
    a.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }))
    expect(openPath).not.toHaveBeenCalled()
    expect(nav.open).not.toHaveBeenCalled()
  })

  it('leaves an anchor outside the editor alone', async () => {
    const openPath = vi.fn()
    await mount('[Note](../note.md)\n', { inApp: () => '/v/note.md', openPath })
    const outside = document.createElement('a')
    outside.className = 'link-display'
    outside.setAttribute('href', '../note.md')
    document.body.appendChild(outside)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    outside.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(openPath).not.toHaveBeenCalled()
    outside.remove()
  })
})

describe('"Add link…" from the note menu (YAZ-3609 D17)', () => {
  it('opens the link box on the selection, and only with one, in a note that can change; nothing after the editor is gone', async () => {
    const { crepe, view } = await mount('Read the plan first.\n')
    const addLink = vi.fn()
    crepe.editor.ctx.update(linkTooltipAPI.key, (api) => ({ ...api, addLink }))
    expect(addLinkOn(view)).toBe(false) // no selection
    let at = -1
    view.state.doc.descendants((node, pos) => { if (at === -1 && node.isText) at = pos + node.text!.indexOf('the plan') })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at, at + 'the plan'.length)))
    crepe.setReadonly(true)
    expect(addLinkOn(view)).toBe(false)
    crepe.setReadonly(false)
    expect(addLinkOn(view)).toBe(true)
    expect(addLink).toHaveBeenCalledExactlyOnceWith(at, at + 'the plan'.length)
    await crepe.destroy()
    mounted.splice(0)
    expect(addLinkOn(view)).toBe(false)
  })
})

describe('right-click menu', () => {
  it('a web link: the one link menu (YAZ-3609 D23, YAZ-3740) with no name and no new tab: Open, Copy address, Edit, Remove', async () => {
    const { nav, root, view } = await mount()
    const event = mouse(anchorOf(root), 'contextmenu', { button: 2 })

    expect(event.defaultPrevented).toBe(true)
    expect(rowsOf(view).map((row) => row.textContent)).toEqual(['Open', 'Copy address', 'Edit link', 'Remove link'])
    expect(rowNamed(view, 'Remove link').classList.contains('ctx-menu__item--danger')).toBe(true)
    rowNamed(view, 'Open').click()
    expect(nav.open).toHaveBeenCalledExactlyOnceWith('https://example.com')
  })

  it('D23 a link into a vault of the window: its name and vault, Open (this tab) and Open in new tab (behind)', async () => {
    const openPath = vi.fn()
    const { root, view } = await mount('[the plan](../Other/Plan.md)\n', {
      inApp: () => '/Other/Plan.md',
      vaultPath: () => '/Other/Plan.md',
      vaultTag: () => 'Other Vault',
      icon: () => ({ class: 'file-icon' }),
      openPath,
    })
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    // No App doors here: of the place rows only Copy path (YAZ-3740; with the doors: `linkMenu.test.ts`).
    expect(rowsOf(view).map((row) => row.textContent)).toEqual(['Plan (Other Vault)', 'Open', 'Open in new tab', 'Copy name', 'Copy path', 'Edit link', 'Remove link'])
    expect(rowsOf(view)[0]!.disabled).toBe(true)
    rowNamed(view, 'Open in new tab').click()
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    rowNamed(view, 'Open').click()
    expect(openPath.mock.calls).toEqual([['/Other/Plan.md', 'backgroundTab'], ['/Other/Plan.md', 'thisTab']])
  })

  it('a read-only note (YAZ-3076 D2) offers no Edit and no Remove: they would change the note', async () => {
    const { crepe, root, view } = await mount()
    crepe.setReadonly(true)
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    expect(rowsOf(view).map((row) => row.textContent)).toEqual(['Open', 'Copy address'])
  })

  it('Edit link opens Crepe\'s existing editor with the current href', async () => {
    const { root, view } = await mount()
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    rowNamed(view, 'Edit link').click()
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('.milkdown-link-edit input')?.value).toBe('https://example.com'))
  })

  it('Copy address copies only the href and keeps Markdown byte-identical', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    const { crepe, nav, root, view } = await mount(undefined, { copy })
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    rowNamed(view, 'Copy address').click()
    expect(copy).toHaveBeenCalledWith('https://example.com')
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledWith('Copied address'))
    expect(getMarkdownForSave(crepe)).toBe('[Example](https://example.com)\n')
  })

  it('reports a copy failure passively', async () => {
    const copy = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    const onNotice = vi.fn()
    const { root, view } = await mount(undefined, { copy, onNotice })
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    rowNamed(view, 'Copy address').click()
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("Can't copy address: clipboard denied"))
  })

  it('reports a synchronous clipboard failure passively too', async () => {
    const copy = vi.fn(() => {
      throw new Error('clipboard unavailable')
    })
    const onNotice = vi.fn()
    const { root, view } = await mount(undefined, { copy, onNotice })
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    expect(() => rowNamed(view, 'Copy address').click()).not.toThrow()
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("Can't copy address: clipboard unavailable"))
  })

  it('Remove link removes only the mark and preserves formatted label content', async () => {
    const { crepe, root, view } = await mount('[**Bold** label](https://example.com)\n')
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    rowNamed(view, 'Remove link').click()
    expect(getMarkdownForSave(crepe)).toBe('**Bold** label\n')
  })

  it.each([
    ['outside mousedown', () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))],
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['scroll', () => document.body.dispatchEvent(new Event('scroll', { bubbles: true }))],
    ['blur', () => window.dispatchEvent(new Event('blur'))],
  ])('closes on %s', async (_name, dismiss) => {
    const { root, view } = await mount()
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    dismiss()
    expect(popupOf(view)).toBeNull()
  })
})

describe('ownership and cleanup', () => {
  it('opens a menu only in the retained editor that owns the anchor', async () => {
    const first = await mount('[First](https://first.example)\n')
    const second = await mount('[Second](https://second.example)\n')
    mouse(anchorOf(second.root), 'contextmenu', { button: 2 })
    expect(popupOf(first.view)).toBeNull()
    expect(popupOf(second.view)).not.toBeNull()
  })

  it('removes its popup and listeners when the editor is destroyed', async () => {
    const { crepe, root, view } = await mount()
    const parent = view.dom.parentElement!
    const anchor = anchorOf(root)
    mouse(anchor, 'contextmenu', { button: 2 })
    await crepe.destroy()
    mounted.splice(0)
    expect(parent.querySelector('.ctx-menu--editor')).toBeNull()
    expect(mouse(anchor, 'contextmenu', { button: 2 }).defaultPrevented).toBe(false)
  })
})
