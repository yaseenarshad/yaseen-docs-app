/** Unit tests for `exploreInlineSections` (YAZ-6470 #5): inline drawing and inline card right-click menus. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuAction, MenuItem, MenuParent, MenuSection } from '../sidebar/menuSections'
import { applyMenuIcons, resetMenuIconsForTest } from '../views/view/menuIconsStore'
import { exploreInlineSections, explorePageSections, type ExploreInlineMenuDoors } from './exploreMenu'

const { readFile, copyText, landOnCard, landOnInlineDrawing } = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<{ path: string; content: string; mtime: number; size: number }>>(),
  copyText: vi.fn(),
  landOnCard: vi.fn(),
  landOnInlineDrawing: vi.fn(),
}))

vi.mock('../api', () => ({ api: { readFile } }))
vi.mock('../editor/linkMenu', () => ({ copyText }))
vi.mock('../editor/card/cardOpen', () => ({ landOnCard }))
vi.mock('../editor/drawing/inlineDrawingLand', () => ({ landOnInlineDrawing }))

const PAGE_MD = [
  '---',
  'title: Architecture',
  '---',
  '',
  'Intro line',
  '```excalidraw',
  '{"type":"excalidraw","version":2,"elements":[]}',
  '```',
  '<!-- drawing: title "Auth Flow" -->',
  '',
  '```card',
  'Question',
  '---',
  'Answer',
  '```',
  '<!-- card: YAZ-42 -->',
  '',
].join('\n')

function flatItems(sections: MenuSection[]): MenuItem[] {
  return sections.flat()
}

function findAction(sections: MenuSection[], label: string): MenuAction {
  const item = flatItems(sections).find((i) => i.kind === undefined && i.label === label)
  if (!item || item.kind !== undefined || !('onSelect' in item) || item.onSelect === undefined) {
    throw new Error(`Expected menu action "${label}"`)
  }
  return item as MenuAction
}

function findParent(sections: MenuSection[], label: string): MenuParent {
  const item = flatItems(sections).find((i) => i.kind === undefined && i.label === label && 'children' in i && i.children !== undefined)
  if (!item || item.kind !== undefined || !('children' in item) || item.children === undefined) {
    throw new Error(`Expected menu parent "${label}"`)
  }
  return item as MenuParent
}

function makeDoors(overrides: Partial<ExploreInlineMenuDoors> = {}): ExploreInlineMenuDoors {
  return {
    openInlineDrawing: vi.fn(),
    showDrawingInPage: vi.fn(),
    openCardInPage: vi.fn(),
    openCardWindow: vi.fn(),
    openInlineDrawingTab: vi.fn(),
    openInTab: vi.fn(),
    linkActions: {
      openNewWindow: vi.fn(),
      openVsCode: vi.fn(),
      reveal: vi.fn(),
    },
    onNotice: vi.fn(),
    closeStack: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  resetMenuIconsForTest()
  readFile.mockReset().mockResolvedValue({ path: '/v/Architecture.md', content: PAGE_MD, mtime: 1, size: PAGE_MD.length })
  copyText.mockReset().mockResolvedValue(undefined)
  landOnCard.mockReset()
  landOnInlineDrawing.mockReset()
})

afterEach(() => {
  resetMenuIconsForTest()
})

describe('exploreInlineSections (YAZ-6470 #5)', () => {
  it('builds inline drawing menu without Rename file and wires all actions', async () => {
    const doors = makeDoors()
    const sections = exploreInlineSections({ kind: 'drawing', page: '/v/Architecture.md', index: 0, name: 'Auth Flow' }, doors)
    const labels = flatItems(sections).map((i) => (i.kind === undefined ? i.label : ''))

    expect(labels).toEqual(['Open in Explore', 'Show in page', 'Open in new tab', 'Open in new window', 'Copy path', 'Open in'])
    expect(labels).not.toContain('Rename file')

    findAction(sections, 'Open in Explore').onSelect()
    expect(doors.openInlineDrawing).toHaveBeenCalledWith('/v/Architecture.md', 0, 'Auth Flow')
    expect(doors.closeStack).not.toHaveBeenCalled()

    findAction(sections, 'Show in page').onSelect()
    expect(doors.showDrawingInPage).toHaveBeenCalledWith('/v/Architecture.md', 0)
    expect(doors.closeStack).not.toHaveBeenCalled()

    findAction(sections, 'Open in new tab').onSelect()
    expect(doors.openInlineDrawingTab).toHaveBeenCalledWith('/v/Architecture.md', 0, false)
    expect(doors.closeStack).toHaveBeenCalledTimes(1)

    findAction(sections, 'Open in new window').onSelect()
    expect(doors.linkActions?.openNewWindow).toHaveBeenCalledWith('/v/Architecture.md')
    expect(doors.closeStack).toHaveBeenCalledTimes(2)

    findAction(sections, 'Copy path').onSelect()
    await Promise.resolve()
    await Promise.resolve()
    expect(copyText).toHaveBeenCalledWith('/v/Architecture.md:6', 'path', doors.onNotice)

    const openIn = findParent(sections, 'Open in')
    const subLabels = openIn.children.flat().map((c) => c.label)
    expect(subLabels).toEqual(['VS Code', 'Reveal in Finder'])
    openIn.children.flat().find((c) => c.label === 'VS Code')!.onSelect()
    expect(doors.linkActions?.openVsCode).toHaveBeenCalledWith('/v/Architecture.md')
    openIn.children.flat().find((c) => c.label === 'Reveal in Finder')!.onSelect()
    expect(doors.linkActions?.reveal).toHaveBeenCalledWith('/v/Architecture.md')
  })

  it('builds inline card menu without Rename file and wires Explore, card window, tab landing, copy ID/link/path, and Open in', async () => {
    const doors = makeDoors()
    const sections = exploreInlineSections({ kind: 'card', page: '/v/Architecture.md', id: 'YAZ-42', index: 0, name: 'OAuth Card' }, doors)
    const labels = flatItems(sections).map((i) => (i.kind === undefined ? i.label : ''))

    expect(labels).toEqual(['Open in Explore', 'Open card', 'Open in new tab', 'Open in new window', 'Copy path', 'Copy card ID', 'Copy card link', 'Open in'])
    expect(labels).not.toContain('Rename file')

    findAction(sections, 'Open in Explore').onSelect()
    expect(doors.openCardInPage).toHaveBeenCalledWith('/v/Architecture.md', { id: 'YAZ-42', index: 0 })

    findAction(sections, 'Open card').onSelect()
    expect(doors.openCardWindow).toHaveBeenCalledWith('/v/Architecture.md', 'YAZ-42', 0)

    findAction(sections, 'Open in new tab').onSelect()
    expect(landOnCard).toHaveBeenCalledWith('/v/Architecture.md', 'YAZ-42')
    expect(doors.openInTab).toHaveBeenCalledWith('/v/Architecture.md')
    expect(doors.closeStack).toHaveBeenCalledTimes(1)

    findAction(sections, 'Open in new window').onSelect()
    expect(doors.linkActions?.openNewWindow).toHaveBeenCalledWith('/v/Architecture.md')
    expect(doors.closeStack).toHaveBeenCalledTimes(2)

    findAction(sections, 'Copy path').onSelect()
    await Promise.resolve()
    await Promise.resolve()
    expect(copyText).toHaveBeenCalledWith('/v/Architecture.md:11', 'path', doors.onNotice)

    findAction(sections, 'Copy card ID').onSelect()
    expect(copyText).toHaveBeenCalledWith('YAZ-42', 'card ID', doors.onNotice)

    findAction(sections, 'Copy card link').onSelect()
    expect(copyText).toHaveBeenCalledWith('[[YAZ-42]]', 'card link', doors.onNotice)

    const openIn = findParent(sections, 'Open in')
    expect(openIn.children.flat().map((c) => c.label)).toEqual(['VS Code', 'Reveal in Finder'])
  })

  it('omits Copy card ID and Copy card link when card has no ID yet', () => {
    const doors = makeDoors()
    const sections = exploreInlineSections({ kind: 'card', page: '/v/Architecture.md', id: null, index: 0 }, doors)
    const labels = flatItems(sections).map((i) => (i.kind === undefined ? i.label : ''))
    expect(labels).not.toContain('Copy card ID')
    expect(labels).not.toContain('Copy card link')
    expect(labels).toContain('Copy path')
  })
})

describe('explorePageSections (YAZ-6550)', () => {
  it('places Focus directly above Favorites in the bottom section', () => {
    const sections = explorePageSections('/v/Architecture.md', {
      openInTab: vi.fn(),
      onRenameFile: vi.fn(),
      onNotice: vi.fn(),
      closeStack: vi.fn(),
      linkActions: {
        showInSidebar: vi.fn(),
        openNewWindow: vi.fn(),
        reveal: vi.fn(),
        openVsCode: vi.fn(),
        listState: () => ({ focus: false, favorite: true }),
        toggleFocus: vi.fn(),
        toggleFavorite: vi.fn(),
      },
    })
    expect(sections.map((group) => group.map((i) => i.label))).toEqual([
      ['Open in new tab', 'Open in new window', 'Open in mini window'],
      ['Show in sidebar', 'Copy path'],
      ['Rename file'],
      ['Add to focus', 'Remove from favorites', 'Reveal in Finder', 'Open in VS Code'],
    ])
    const flat = sections.flat().map((i) => i.label)
    expect(flat.indexOf('Add to focus')).toBe(flat.indexOf('Remove from favorites') - 1)
  })

  it('YAZ-6567: attaches default icons to page and inline Explore menus and omits them on none / off', () => {
    const pageDoors = {
      openInTab: vi.fn(),
      onNotice: vi.fn(),
      closeStack: vi.fn(),
      linkActions: { showInSidebar: vi.fn(), openNewWindow: vi.fn() },
    }
    const pageSections = explorePageSections('/v/Architecture.md', pageDoors)
    for (const label of ['Open in new tab', 'Open in new window', 'Show in sidebar']) {
      expect(findAction(pageSections, label).icon).toBeDefined()
    }

    const inlineDoors = makeDoors()
    for (const target of [
      { kind: 'drawing' as const, page: '/v/Architecture.md', index: 0 },
      { kind: 'card' as const, page: '/v/Architecture.md', id: 'YAZ-42', index: 0 },
    ]) {
      const sections = exploreInlineSections(target, inlineDoors)
      expect(findAction(sections, 'Open in new tab').icon).toBeDefined()
      expect(findAction(sections, 'Open in new window').icon).toBeDefined()
    }

    applyMenuIcons({ openNewTab: 'none', newWindow: 'none', showInSidebar: 'none' })
    const nonePage = explorePageSections('/v/Architecture.md', pageDoors)
    for (const label of ['Open in new tab', 'Open in new window', 'Show in sidebar']) {
      expect(findAction(nonePage, label).icon).toBeUndefined()
    }
    for (const target of [
      { kind: 'drawing' as const, page: '/v/Architecture.md', index: 0 },
      { kind: 'card' as const, page: '/v/Architecture.md', id: 'YAZ-42', index: 0 },
    ]) {
      const sections = exploreInlineSections(target, inlineDoors)
      expect(findAction(sections, 'Open in new tab').icon).toBeUndefined()
      expect(findAction(sections, 'Open in new window').icon).toBeUndefined()
    }

    applyMenuIcons('off')
    const offPage = explorePageSections('/v/Architecture.md', pageDoors)
    for (const label of ['Open in new tab', 'Open in new window', 'Show in sidebar']) {
      expect(findAction(offPage, label).icon).toBeUndefined()
    }
  })
})
