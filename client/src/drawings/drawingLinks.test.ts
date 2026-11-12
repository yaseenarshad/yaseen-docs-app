/**
 * Page links in a drawing (YAZ-4039 D7, D11): what a pill shows, and what each gesture on it does, through the note's
 * own pieces. The engine side (layout, hit test, hover, clicks, menu) is `engine/.../tests/hostLinks.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { linkMenuRows, type LinkMenu } from '../editor/linkMenu'
import { wikilinkFollower } from '../editor/wikilink/wikilinkClick'
import { linkMenuOf } from '../editor/wikilink/wikilinkMenu'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { drawingHostLinks, drawingLinkLook, linkVault, mountDrawingVault, openShapeLink, windowFollow, windowLinkLook, type DrawingLinkDeps, type DrawingLinkHit } from './drawingLinks'

const ID = 'k3m9x2pq7abc'
const GONE = 'zzzzzzzzzzz9'
const paths: Record<string, string> = { [ID]: '/vault/Projects/Road Map.md', Known: '/vault/Known.md', Projects: '/vault/Projects' }
const records = [{ path: '/vault/Projects/Road Map.md', title: 'Road Map' }] as unknown as IndexRecord[]

/** The boards mounted by a test: each test leaves the window with no vault. */
let unmounts: Array<() => void> = []
afterEach(() => {
  unmounts.forEach((unmount) => unmount())
  unmounts = []
})

function setup(readOnly = false) {
  const source = createWikilinkResolveSource()
  source.update((target) => paths[target] ?? null, records, [], true)
  unmounts.push(mountDrawingVault('/vault', source))
  const nav = { root: '/vault', createFolder: () => '', openCurrent: vi.fn(), openNewTab: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn(), hotkeys: () => undefined }
  const follow = vi.fn()
  const hover = vi.fn()
  const menu = vi.fn()
  const deps = (): DrawingLinkDeps => ({ source, follow, nav, readOnly: () => readOnly, hover, menu })
  return { source, nav, follow, hover, menu, deps, links: drawingHostLinks(deps) }
}

const hit = (inner: string): DrawingLinkHit => ({ elementId: 'text-1', inner, start: 4, end: 6 + inner.length, rect: { left: 10, top: 20, right: 90, bottom: 40 } })
const press = (mods: Partial<PointerEvent> = {}) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods }) as PointerEvent

describe('what a pill shows', () => {
  it("shows an ID link's title, a name link's name, and a folder with its icon", () => {
    const { source } = setup()
    expect(drawingLinkLook(ID, source)).toEqual({ label: 'Road Map' })
    expect(drawingLinkLook('Known', source)).toEqual({ label: 'Known' })
    expect(drawingLinkLook('Known|my alias', source)).toEqual({ label: 'my alias' })
    expect(drawingLinkLook('Projects', source)).toEqual({ label: 'Projects', folder: true })
  })

  it('shows a missing page dim, and a gone ID as a missing note', () => {
    const { source } = setup()
    expect(drawingLinkLook('Nowhere', source)).toEqual({ label: 'Nowhere', missing: true })
    expect(drawingLinkLook(GONE, source)).toEqual({ label: `Missing note · ${GONE}`, missing: true })
  })

  it('leaves a link with nothing to show as text', () => {
    const { source } = setup()
    expect(drawingLinkLook('Known|', source)).toBeNull()
  })

  it('gives every board of the window one resolver', () => {
    expect(setup().links.resolve).toBe(setup().links.resolve)
  })
})

describe('the gestures on a pill', () => {
  it('⌘-click opens the page in a background tab, ⌘⇧-click in front', () => {
    const { links, follow } = setup()
    expect(links.onPointerDown(hit(ID), press({ metaKey: true }))).toBe(true)
    expect(follow).toHaveBeenLastCalledWith(ID, 'backgroundTab')
    expect(links.onPointerDown(hit(ID), press({ metaKey: true, shiftKey: true }))).toBe(true)
    expect(follow).toHaveBeenLastCalledWith(ID, 'newTab')
  })

  it('a plain click is the board’s: it selects the box', () => {
    const { links, follow } = setup()
    expect(links.onPointerDown(hit(ID), press())).toBe(false)
    expect(follow).not.toHaveBeenCalled()
  })

  it('a plain click opens on a read-only board, as in a read-only note', () => {
    const { links, follow } = setup(true)
    expect(links.onPointerDown(hit(ID), press())).toBe(true)
    expect(follow).toHaveBeenLastCalledWith(ID, 'thisTab')
  })

  it('a read-only board follows the vault\'s "Clicking a link: Explore" (YAZ-4939): a note pill opens in Explore, a folder pill and ⌘-click keep their doors', () => {
    const { links, follow, nav } = setup(true)
    Object.assign(nav, { openExplore: vi.fn(), exploreClick: () => true })
    expect(links.onPointerDown(hit(ID), press())).toBe(true)
    expect(follow).toHaveBeenLastCalledWith(ID, 'explore')
    expect(links.onPointerDown(hit('Projects'), press())).toBe(true)
    expect(follow).toHaveBeenLastCalledWith('Projects', 'thisTab')
    expect(links.onPointerDown(hit(ID), press({ metaKey: true }))).toBe(true)
    expect(follow).toHaveBeenLastCalledWith(ID, 'backgroundTab')
  })

  it('an editable board keeps a plain click as the board\'s own (it selects the box), whatever the vault\'s choice', () => {
    const { links, follow, nav } = setup()
    Object.assign(nav, { openExplore: vi.fn(), exploreClick: () => true })
    expect(links.onPointerDown(hit(ID), press())).toBe(false)
    expect(follow).not.toHaveBeenCalled()
  })

  it('⌘-click calls the note follower, which opens the page', () => {
    const { source, nav, deps } = setup()
    const follow = wikilinkFollower(source, nav)
    const links = drawingHostLinks(() => ({ ...deps(), follow }))
    links.onPointerDown(hit('Known'), press({ metaKey: true }))
    expect(nav.openBackground).toHaveBeenCalledWith('/vault/Known.md')
  })

  it('hover gives the page of a found pill and nothing for a missing one', () => {
    const { links, hover } = setup()
    links.onHover(hit(ID))
    expect(hover).toHaveBeenLastCalledWith({ path: '/vault/Projects/Road Map.md', rect: hit(ID).rect })
    links.onHover(hit('Nowhere'))
    expect(hover).toHaveBeenLastCalledWith(null)
    links.onHover(null)
    expect(hover).toHaveBeenLastCalledWith(null)
  })

  it('a right-click on a pill opens the link menu', () => {
    const { links, menu } = setup()
    const event = new MouseEvent('contextmenu')
    expect(links.onContextMenu(hit(ID), event)).toBe(true)
    expect(menu).toHaveBeenCalledWith(hit(ID), event)
  })

  it("the menu is the note's one link menu", () => {
    const { source, nav, follow } = setup()
    const labels = (menu: LinkMenu) => linkMenuRows(menu).map((row) => row.label)
    expect(labels(linkMenuOf(ID, source, nav, follow, undefined, undefined, undefined, undefined))).toEqual([`ID: ${ID}`, 'Open', 'Open in new tab', 'Copy name and ID', 'Copy ID', 'Copy path'])
  })
})

describe("a shape's link", () => {
  it('follows a [[link]], with the gesture keys', () => {
    const { follow, nav, source } = setup()
    expect(openShapeLink(`[[${ID}]]`, press(), { source, follow, nav })).toBe(true)
    expect(follow).toHaveBeenLastCalledWith(ID, 'thisTab')
    openShapeLink('[[Known]]', press({ metaKey: true }), { source, follow, nav })
    expect(follow).toHaveBeenLastCalledWith('Known', 'backgroundTab')
  })

  it('opens a path of the vault and a vault page name in a tab', () => {
    const { follow, nav, source } = setup()
    expect(openShapeLink('/vault/Known.md', press(), { source, follow, nav })).toBe(true)
    expect(nav.openCurrent).toHaveBeenLastCalledWith('/vault/Known.md')
    openShapeLink('Known', press({ metaKey: true }), { source, follow, nav })
    expect(nav.openBackground).toHaveBeenLastCalledWith('/vault/Known.md')
  })

  it('leaves a web link to the engine, and never opens a path outside the vault', () => {
    const { follow, nav, source } = setup()
    expect(openShapeLink('https://example.com', press(), { source, follow, nav })).toBe(false)
    expect(openShapeLink('/etc/hosts', press(), { source, follow, nav })).toBe(true)
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(nav.onNotice).toHaveBeenCalled()
  })
})

/** YAZ-4067 4A1: a window can show several vaults, and every board draws with the one window resolver. */
describe('two vaults in one window', () => {
  const vault = (root: string, letters: string, pages: Record<string, string>, titles: Record<string, string>) => {
    const source = createWikilinkResolveSource()
    const records = Object.entries(titles).map(([path, title]) => ({ path, title })) as unknown as IndexRecord[]
    source.update((target) => pages[target] ?? null, records, [], true, [letters])
    return source
  }
  const a = vault('/a', 'AAA', { 'AAA-1': '/a/Plan.md', Shared: '/a/Shared.md' }, { '/a/Plan.md': 'Plan' })
  const b = vault('/b', 'BBB', { 'BBB-1': '/b/Budget.md', Shared: '/b/Shared.md' }, { '/b/Budget.md': 'Budget' })

  it('resolves an ID of each vault, and a name in root order, while boards of both are mounted', () => {
    unmounts.push(mountDrawingVault('/b', b), mountDrawingVault('/a', a))
    expect(windowLinkLook('AAA-1')).toEqual({ label: 'Plan' })
    expect(windowLinkLook('BBB-1')).toEqual({ label: 'Budget' })
    expect(windowLinkLook('Shared')).toEqual({ label: 'Shared' })
    expect(linkVault('Shared')?.root).toBe('/a')
    expect(windowLinkLook('AAA-9')).toEqual({ label: 'Missing note · AAA-9', missing: true })
    expect(windowLinkLook('BBB-9')).toEqual({ label: 'Missing note · BBB-9', missing: true })
  })

  it('keeps a vault while any board of it is mounted, and drops it with the last one', () => {
    const boardA1 = mountDrawingVault('/a', a)
    const boardA2 = mountDrawingVault('/a', a)
    const boardB = mountDrawingVault('/b', b)
    unmounts.push(boardB)
    boardA1()
    expect(windowLinkLook('AAA-1')).toEqual({ label: 'Plan' })
    boardA2()
    expect(windowLinkLook('AAA-1')?.missing).toBe(true)
    expect(windowLinkLook('BBB-1')).toEqual({ label: 'Budget' })
  })

  it('tells every board when a vault comes or its index changes the look of a link it drew', () => {
    const { links } = setup()
    const listener = vi.fn()
    unmounts.push(links.subscribe(listener))
    expect(windowLinkLook('BBB-1')?.missing).toBe(true)
    const own = vault('/b', 'BBB', { 'BBB-1': '/b/Budget.md' }, { '/b/Budget.md': 'Budget' })
    unmounts.push(mountDrawingVault('/b', own))
    expect(listener).toHaveBeenCalledTimes(1)
    own.update(own.resolve, [{ path: '/b/Budget.md', title: 'Budget 2026' }] as unknown as IndexRecord[], [], true, ['BBB'])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(windowLinkLook('BBB-1')).toEqual({ label: 'Budget 2026' })
  })

  it('YAZ-4074 6A item 7: a new index that changes no look of a drawn link wakes no board (a note autosave)', () => {
    const { links } = setup()
    const listener = vi.fn()
    unmounts.push(links.subscribe(listener))
    const own = vault('/b', 'BBB', { 'BBB-1': '/b/Budget.md' }, { '/b/Budget.md': 'Budget' })
    unmounts.push(mountDrawingVault('/b', own))
    expect(windowLinkLook('BBB-1')).toEqual({ label: 'Budget' })
    listener.mockClear()
    // The autosave of another note: a new records array, the same titles.
    own.update(own.resolve, [...own.records, { path: '/b/Other.md', title: 'Other' } as unknown as IndexRecord], [], true, ['BBB'])
    expect(listener).not.toHaveBeenCalled()
    // A rename of the linked note does wake them.
    own.update(own.resolve, [{ path: '/b/Budget.md', title: 'Budget Q3' }] as unknown as IndexRecord[], [], true, ['BBB'])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("a board of one vault opens a page of the other as it is, never making one in its own vault", () => {
    unmounts.push(mountDrawingVault('/a', a), mountDrawingVault('/b', b))
    const nav = { root: '/b', createFolder: () => '', openCurrent: vi.fn(), openNewTab: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn(), hotkeys: () => undefined }
    const own = vi.fn()
    const follow = windowFollow(b, nav, own)
    follow('AAA-1', 'backgroundTab')
    expect(nav.openBackground).toHaveBeenCalledWith('/a/Plan.md')
    follow('BBB-1', 'thisTab')
    expect(own).toHaveBeenCalledWith('BBB-1', 'thisTab')
    follow('Nowhere', 'thisTab')
    expect(own).toHaveBeenLastCalledWith('Nowhere', 'thisTab')
  })
})
