import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { CARD_OPEN, takeCardLanding, type CardOpenRequest } from '../editor/card/cardOpen'
import { takeInlineDrawingLanding } from '../editor/drawing/inlineDrawingLand'
import type { SearchCandidate } from '../search/searchCandidates'
import { copySearchRowPath, inlineRowMenuSections, type InlineRowMenuHandlers } from './inlineRowMenu'
import type { MenuAction, MenuItem, MenuParent } from './menuSections'

const PAGE = '/vault/Notes.md'

const drawingRow: SearchCandidate = {
  kind: 'file',
  name: 'Architecture',
  lower: 'architecture',
  label: 'Architecture',
  path: `${PAGE}#drawing-0`,
  folder: '',
  inlineDrawing: true,
  page: PAGE,
  index: 0,
}

const cardRow: SearchCandidate = {
  kind: 'file',
  name: 'Capital of France',
  lower: 'capital of france',
  label: 'Capital of France',
  path: `${PAGE}#GEO-140`,
  folder: '',
  id: 'GEO-140',
  card: true,
  page: PAGE,
  index: 1,
}

function makeHandlers(over: Partial<InlineRowMenuHandlers> = {}): InlineRowMenuHandlers {
  return {
    openSearchCard: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenFileBackground: vi.fn(),
    onRevealInFiles: vi.fn(),
    onOpenVsCode: vi.fn(),
    onOpenDefault: vi.fn(),
    onReveal: vi.fn(),
    onNotice: vi.fn(),
    hotkeys: {},
    unit: (s) => s,
    ...over,
  }
}

const groupLabels = (sections: readonly (readonly MenuItem[])[]) => sections.map((g) => g.map((i) => i.label))
const findItem = (sections: readonly (readonly MenuItem[])[], label: string): MenuItem => {
  const hit = sections.flat().find((i) => i.label === label)
  if (hit === undefined) throw new Error(`missing item: ${label}`)
  return hit
}

describe('inlineRowMenu (YAZ-6469)', () => {
  let clipDescriptor: PropertyDescriptor | undefined
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clipDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (clipDescriptor === undefined) delete (navigator as unknown as Record<string, unknown>).clipboard
    else Object.defineProperty(navigator, 'clipboard', clipDescriptor)
  })

  it('builds safe 3-group parity menu for inline drawing rows (with and without Explore callback)', async () => {
    const readFile = vi.spyOn(api, 'readFile').mockResolvedValue({
      path: PAGE,
      content: '---\ntitle: Notes\n---\nIntro\n```excalidraw\n{"elements":[]}\n```\n',
      mtime: 1,
      size: 1,
    })

    // Without Explore callback: omits Open in Explore
    const hNoExplore = makeHandlers()
    const withoutExplore = inlineRowMenuSections(drawingRow, hNoExplore)
    expect(groupLabels(withoutExplore)).toEqual([
      ['Show in page', 'Open in new tab', 'Show in sidebar'],
      ['Copy path'],
      ['Open in'],
    ])

    // With Explore + New window callbacks: includes Open in new window right after Open in new tab (YAZ-6513)
    const onOpenInlineDrawingExplore = vi.fn()
    const onOpenNewWindow = vi.fn()
    const h = makeHandlers({ onOpenInlineDrawingExplore, onOpenNewWindow })
    const sections = inlineRowMenuSections(drawingRow, h)
    expect(groupLabels(sections)).toEqual([
      ['Show in page', 'Open in new tab', 'Open in new window', 'Open in Explore', 'Show in sidebar'],
      ['Copy path'],
      ['Open in'],
    ])

    // No parent-mutating actions
    const allLabels = sections.flat().map((i) => i.label)
    for (const forbidden of ['Rename', 'Delete', 'Cut', 'Change icon']) expect(allLabels).not.toContain(forbidden)

    // Group 1 actions
    ;(findItem(sections, 'Show in page') as MenuAction).onSelect()
    expect(h.onOpenFile).toHaveBeenCalledExactlyOnceWith(PAGE)
    expect(takeInlineDrawingLanding(PAGE, 0)).toBe(true)

    ;(findItem(sections, 'Open in new tab') as MenuAction).onSelect()
    expect(h.openSearchCard).toHaveBeenCalledExactlyOnceWith(drawingRow, true)

    ;(findItem(sections, 'Open in new window') as MenuAction).onSelect()
    expect(onOpenNewWindow).toHaveBeenCalledExactlyOnceWith(PAGE)

    ;(findItem(sections, 'Open in Explore') as MenuAction).onSelect()
    expect(onOpenInlineDrawingExplore).toHaveBeenCalledExactlyOnceWith(PAGE, 0)

    ;(findItem(sections, 'Show in sidebar') as MenuAction).onSelect()
    expect(h.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(PAGE)

    // Group 2: Copy path has ⌘⇧C hint, icon, and resolves 1-based line (line 5)
    const copyPath = findItem(sections, 'Copy path') as MenuAction
    expect(copyPath.hint).toBe('⌘⇧C')
    expect(copyPath.icon).toBeDefined()
    copyPath.onSelect()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(`${PAGE}:5`))
    expect(readFile).toHaveBeenCalledExactlyOnceWith(PAGE)
    expect(h.onNotice).toHaveBeenCalledWith('Copied path', 'info', 'clipboard')

    // Group 3: Open in › targets parent page on disk
    const openIn = findItem(sections, 'Open in') as MenuParent
    expect(openIn.children.map((g) => g.map((c) => c.label))).toEqual([['VS Code', 'Default app'], ['Reveal in Finder']])
    openIn.children[0][0].onSelect()
    openIn.children[0][1].onSelect()
    openIn.children[1][0].onSelect()
    expect(h.onOpenVsCode).toHaveBeenCalledExactlyOnceWith(PAGE)
    expect(h.onOpenDefault).toHaveBeenCalledExactlyOnceWith(PAGE)
    expect(h.onReveal).toHaveBeenCalledExactlyOnceWith(PAGE)
  })

  it('builds safe 3-group parity menu for inline card rows with Copy path, Copy card ID, Copy card link, and Open in Explore', async () => {
    vi.spyOn(api, 'readFile').mockResolvedValue({
      path: PAGE,
      content: 'Line 1\n```card\nQ\n```\n<!-- card: GEO-100 -->\n```card\nParis\n```\n<!-- card: GEO-140 -->\n',
      mtime: 1,
      size: 1,
    })

    const onOpenNewWindow = vi.fn()
    const h = makeHandlers({ onOpenNewWindow })
    const sections = inlineRowMenuSections(cardRow, h)
    expect(groupLabels(sections)).toEqual([
      ['Show in page', 'Open in new tab', 'Open in new window', 'Open in Explore', 'Show in sidebar'],
      ['Copy path', 'Copy card ID', 'Copy card link'],
      ['Open in'],
    ])

    // Show in page
    ;(findItem(sections, 'Show in page') as MenuAction).onSelect()
    expect(h.onOpenFile).toHaveBeenCalledExactlyOnceWith(PAGE)
    expect(takeCardLanding(PAGE, 'GEO-140')).toBe(true)

    // Open in new tab
    ;(findItem(sections, 'Open in new tab') as MenuAction).onSelect()
    expect(h.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(PAGE)
    expect(takeCardLanding(PAGE, 'GEO-140')).toBe(true)

    // Open in new window (YAZ-6513)
    ;(findItem(sections, 'Open in new window') as MenuAction).onSelect()
    expect(onOpenNewWindow).toHaveBeenCalledExactlyOnceWith(PAGE)

    // Open in Explore dispatches CARD_OPEN when no custom callback is supplied
    const received: CardOpenRequest[] = []
    const onCardOpen = (e: Event) => received.push((e as CustomEvent<CardOpenRequest>).detail)
    document.addEventListener(CARD_OPEN, onCardOpen)
    try {
      ;(findItem(sections, 'Open in Explore') as MenuAction).onSelect()
    } finally {
      document.removeEventListener(CARD_OPEN, onCardOpen)
    }
    expect(received).toEqual([{ path: PAGE, cardId: 'GEO-140', index: 1 }])

    // Show in sidebar
    ;(findItem(sections, 'Show in sidebar') as MenuAction).onSelect()
    expect(h.onRevealInFiles).toHaveBeenCalledExactlyOnceWith(PAGE)

    // Copy path -> line 6
    const copyPath = findItem(sections, 'Copy path') as MenuAction
    expect(copyPath.hint).toBe('⌘⇧C')
    copyPath.onSelect()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${PAGE}:6`))

    // Copy card ID -> GEO-140 with hint
    const copyId = findItem(sections, 'Copy card ID') as MenuAction
    expect(copyId.hint).toBe('GEO-140')
    copyId.onSelect()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('GEO-140'))
    expect(h.onNotice).toHaveBeenCalledWith('Copied: GEO-140', 'info', 'clipboard')

    // Copy card link -> [[GEO-140]]
    ;(findItem(sections, 'Copy card link') as MenuAction).onSelect()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('[[GEO-140]]'))
    expect(h.onNotice).toHaveBeenCalledWith('Copied: [[GEO-140]]', 'info', 'clipboard')
  })

  it('copySearchRowPath copies plain paths without reading disk and reports clipboard rejections', async () => {
    const readFile = vi.spyOn(api, 'readFile')
    const onNotice = vi.fn()
    await copySearchRowPath('/vault/Plain.md', undefined, onNotice)
    expect(readFile).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/vault/Plain.md')
    expect(onNotice).toHaveBeenCalledWith('Copied path', 'info', 'clipboard')

    writeText.mockRejectedValueOnce(new Error('denied'))
    await copySearchRowPath('/vault/Plain.md', undefined, onNotice)
    expect(onNotice).toHaveBeenCalledWith("Can't copy path: denied")
  })
})
