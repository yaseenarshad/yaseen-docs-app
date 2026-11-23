// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_INLINE_SCENE_JSON } from '@shared/inlineDrawing'
import type { BoardWindowHandle, BoardWindowHost } from '../embed/types'
import { blockMenuItems } from '../blockHandleMenu'
import { createCrepe, editorViewOf, getMarkdownForSave } from '../createCrepe'

vi.mock('../embed/loadBoardWindow', () => ({
  loadBoardWindow: () =>
    Promise.resolve({
      mountBoardWindow: (host: BoardWindowHost): BoardWindowHandle => {
        const dom = document.createElement('div')
        dom.className = 'board-window'
        void host
        return {
          dom,
          update: () => {},
          setSelected: () => {},
          setFoldable: () => {},
          setFolded: () => {},
          flush: () => {},
          fit: () => {},
          showPage: () => {},
          handleKey: () => false,
          menuRows: () => [],
          destroy: () => dom.remove(),
        }
      },
    }),
}))

let mounted: { crepe: ReturnType<typeof createCrepe>; root: HTMLElement } | null = null

afterEach(async () => {
  if (mounted !== null) {
    await mounted.crepe.destroy()
    mounted.root.remove()
    mounted = null
  }
  document.querySelectorAll('.ctx-menu').forEach((el) => el.remove())
})

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({
    root,
    defaultValue: markdown,
    boardEmbeds: { root: '/v' },
    inlineDrawing: { root: '/v' },
  })
  await crepe.create()
  mounted = { crepe, root }
  return { crepe, view: editorViewOf(crepe), root }
}

describe('6-dot block handle menu Position rows (YAZ-6354)', () => {
  it('adds Position flyout for an inline drawing and updates its drawingLine', async () => {
    const md = `\`\`\`excalidraw\n${EMPTY_INLINE_SCENE_JSON}\n\`\`\`\n<!-- drawing: 640x360 locked -->\n`
    const { crepe, view } = await mount(md)
    const items = blockMenuItems(view, { pos: 0, inside: 0 })
    const posRow = items.find((item) => item.kind !== 'strip' && item.label === 'Position')
    expect(posRow).toBeDefined()
    expect(posRow?.kind).toBeUndefined()
    const choices = posRow && posRow.kind !== 'strip' ? posRow.children?.[0] ?? [] : []
    expect(choices.map((c) => [c.label, c.hint])).toEqual([
      ['App default', '✓'],
      ['Left', undefined],
      ['Center', undefined],
      ['Right', undefined],
    ])

    choices.find((c) => c.label === 'Center')!.run()
    expect(getMarkdownForSave(crepe)).toContain('<!-- drawing: 640x360 locked align=center -->')

    // Re-querying reflects the updated checkmark on Center.
    const nextRow = blockMenuItems(view, { pos: 0, inside: 0 }).find((item) => item.kind !== 'strip' && item.label === 'Position')
    const nextChoices = nextRow && nextRow.kind !== 'strip' ? nextRow.children?.[0] ?? [] : []
    expect(nextChoices.find((c) => c.label === 'Center')?.hint).toBe('✓')
  })

  it('adds Position flyout for lone .excalidraw and .drawio embeds and omits it on plain paragraphs', async () => {
    const md = 'Plain text\n\n![[Sketch.excalidraw|640x360]]\n\n![[Arch.drawio|align=left]]\n'
    const { crepe, view } = await mount(md)
    const positions: number[] = []
    view.state.doc.forEach((_node, offset) => positions.push(offset))

    // Plain paragraph: no Position row.
    expect(blockMenuItems(view, { pos: positions[0]!, inside: positions[0]! }).some((i) => i.kind !== 'strip' && i.label === 'Position')).toBe(false)

    // Lone .excalidraw embed: Position -> Right.
    const exRow = blockMenuItems(view, { pos: positions[1]!, inside: positions[1]! }).find((i) => i.kind !== 'strip' && i.label === 'Position')
    expect(exRow).toBeDefined()
    ;(exRow && exRow.kind !== 'strip' ? exRow.children?.[0] : [])!.find((c) => c.label === 'Right')!.run()
    expect(getMarkdownForSave(crepe)).toContain('![[Sketch.excalidraw|640x360 align=right]]')

    // Re-read positions after edit and test .drawio embed: Left -> App default.
    const nextPositions: number[] = []
    view.state.doc.forEach((_node, offset) => nextPositions.push(offset))
    const dioRow = blockMenuItems(view, { pos: nextPositions[2]!, inside: nextPositions[2]! }).find((i) => i.kind !== 'strip' && i.label === 'Position')
    expect(dioRow).toBeDefined()
    const dioChoices = dioRow && dioRow.kind !== 'strip' ? dioRow.children?.[0] ?? [] : []
    expect(dioChoices.find((c) => c.label === 'Left')?.hint).toBe('✓')
    dioChoices.find((c) => c.label === 'App default')!.run()
    expect(getMarkdownForSave(crepe)).toContain('![[Arch.drawio]]')
  })

  it('adds Position flyout for a bullet whose first block is a drawing embed, and hides it when read-only', async () => {
    const md = '* ![[Sketch.excalidraw|locked]]\n'
    const { crepe, view } = await mount(md)
    let itemPos = -1
    view.state.doc.descendants((node, pos) => {
      if (itemPos === -1 && node.type.name === 'list_item') itemPos = pos
    })
    expect(itemPos).toBeGreaterThanOrEqual(0)
    const row = blockMenuItems(view, { pos: itemPos, inside: itemPos }).find((i) => i.kind !== 'strip' && i.label === 'Position')
    expect(row).toBeDefined()
    ;(row && row.kind !== 'strip' ? row.children?.[0] : [])!.find((c) => c.label === 'Center')!.run()
    expect(getMarkdownForSave(crepe)).toContain('* ![[Sketch.excalidraw|locked align=center]]')

    crepe.setReadonly(true)
    expect(blockMenuItems(view, { pos: itemPos, inside: itemPos }).some((i) => i.kind !== 'strip' && i.label === 'Position')).toBe(false)
  })
})

describe('6-dot block handle menu Position rows for pictures (YAZ-6424)', () => {
  it('adds Position flyout for a standalone lone picture, updates alt while preserving width, and resets to App default', async () => {
    const md = '![Shot|320](images/shot.png)\n'
    const { crepe, view } = await mount(md)
    const items = blockMenuItems(view, { pos: 0, inside: 0 })
    const posRow = items.find((item) => item.kind !== 'strip' && item.label === 'Position')
    expect(posRow).toBeDefined()
    const choices = posRow && posRow.kind !== 'strip' ? posRow.children?.[0] ?? [] : []
    expect(choices.map((c) => [c.label, c.hint])).toEqual([
      ['App default', '✓'],
      ['Left', undefined],
      ['Center', undefined],
      ['Right', undefined],
    ])

    choices.find((c) => c.label === 'Center')!.run()
    expect(getMarkdownForSave(crepe)).toContain('![Shot|320 align=center](images/shot.png)')

    const nextRow = blockMenuItems(view, { pos: 0, inside: 0 }).find((item) => item.kind !== 'strip' && item.label === 'Position')
    const nextChoices = nextRow && nextRow.kind !== 'strip' ? nextRow.children?.[0] ?? [] : []
    expect(nextChoices.find((c) => c.label === 'Center')?.hint).toBe('✓')

    nextChoices.find((c) => c.label === 'Right')!.run()
    expect(getMarkdownForSave(crepe)).toContain('![Shot|320 align=right](images/shot.png)')

    const resetRow = blockMenuItems(view, { pos: 0, inside: 0 }).find((item) => item.kind !== 'strip' && item.label === 'Position')
    ;(resetRow && resetRow.kind !== 'strip' ? resetRow.children?.[0] : [])!.find((c) => c.label === 'App default')!.run()
    expect(getMarkdownForSave(crepe)).toContain('![Shot|320](images/shot.png)')
  })

  it('adds Position flyout for a bullet-nested lone picture and hides it in read-only mode', async () => {
    const md = '* ![Shot|480](images/shot.png)\n'
    const { crepe, view } = await mount(md)
    let itemPos = -1
    view.state.doc.descendants((node, pos) => {
      if (itemPos === -1 && node.type.name === 'list_item') itemPos = pos
    })
    expect(itemPos).toBeGreaterThanOrEqual(0)

    const row = blockMenuItems(view, { pos: itemPos, inside: itemPos }).find((i) => i.kind !== 'strip' && i.label === 'Position')
    expect(row).toBeDefined()
    ;(row && row.kind !== 'strip' ? row.children?.[0] : [])!.find((c) => c.label === 'Center')!.run()
    expect(getMarkdownForSave(crepe)).toContain('* ![Shot|480 align=center](images/shot.png)')

    crepe.setReadonly(true)
    expect(blockMenuItems(view, { pos: itemPos, inside: itemPos }).some((i) => i.kind !== 'strip' && i.label === 'Position')).toBe(false)
  })

  it('omits Position flyout when text is beside the picture or the image src is a board', async () => {
    const md = 'Before ![Shot](images/shot.png) after\n\n![Arch](../Other/Arch.drawio)\n'
    const { view } = await mount(md)
    const positions: number[] = []
    view.state.doc.forEach((_node, offset) => positions.push(offset))

    expect(blockMenuItems(view, { pos: positions[0]!, inside: positions[0]! }).some((i) => i.kind !== 'strip' && i.label === 'Position')).toBe(false)
    expect(blockMenuItems(view, { pos: positions[1]!, inside: positions[1]! }).some((i) => i.kind !== 'strip' && i.label === 'Position')).toBe(false)
  })
})
