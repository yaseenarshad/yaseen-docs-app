/**
 * The Drawing slash-menu item (YAZ-877): where it lands on Crepe's own menu, and what its
 * `onRun` does — clear the typed `/query` the way every stock item does, then insert the
 * embed as PLAIN TEXT once the sidecar exists. The builder is stubbed (Crepe exports neither
 * `GroupBuilder` nor its config types); `featureConfig.test.ts` pins the real wiring.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { drawingEmbed, drawingMenu, type SlashMenuBuilder } from './drawingMenu'

type Item = { label: string; icon: string; onRun?: (ctx: Ctx) => void }

/** Records what `buildMenu` appends, and to which of Crepe's stock groups. */
function stubBuilder() {
  const added: { group: string; key: string; item: Item }[] = []
  const builder: SlashMenuBuilder = {
    getGroup: (group) => ({ addItem: (key, item) => added.push({ group, key, item: item as Item }) }),
  }
  return { builder, added }
}

/** A ctx serving just the two slices `onRun` reads, over a fake view whose dispatches are recorded. */
function stubCtx() {
  const call = vi.fn()
  const dispatch = vi.fn()
  const tr = { insertText: vi.fn((text: string) => ({ inserted: text })) }
  const view = { state: { tr }, dispatch }
  const ctx = {
    get: (slice: unknown) => {
      if (slice === commandsCtx) return { call }
      if (slice === editorViewCtx) return view
      throw new Error('unexpected slice')
    },
  } as unknown as Ctx
  return { ctx, call, dispatch, tr }
}

beforeEach(() => vi.clearAllMocks())

describe('drawingMenu', () => {
  it('appends "Drawing" and, beside it, "Diagram" to Crepe\'s stock advanced group (YAZ-4831 item 2)', () => {
    const { builder, added } = stubBuilder()
    drawingMenu({ create: vi.fn() })(builder)
    expect(added.map((a) => [a.group, a.key, a.item.label])).toEqual([
      ['advanced', 'drawing', 'Drawing'],
      ['advanced', 'diagram', 'Diagram'],
    ])
    for (const a of added) expect(a.item.icon).toContain('<svg')
  })

  it('"Diagram" makes a diagram and inserts its embed', async () => {
    const { builder, added } = stubBuilder()
    const create = vi.fn().mockResolvedValue('Plan diagram.drawio')
    drawingMenu({ create })(builder)
    const { ctx, dispatch, tr } = stubCtx()
    added[1].item.onRun?.(ctx)
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith('diagram')
    expect(tr.insertText).toHaveBeenCalledWith('![[Plan diagram.drawio|locked]]')
  })

  it('clears the typed /query first (the stock items\' own opening move), then inserts the embed as plain text', async () => {
    const { builder, added } = stubBuilder()
    const create = vi.fn().mockResolvedValue('Drawing 2026-08-25 20.31.02.excalidraw')
    drawingMenu({ create })(builder)
    const { ctx, call, dispatch, tr } = stubCtx()

    added[0].item.onRun?.(ctx)
    // Synchronous half: the query text goes before anything is written.
    expect(call).toHaveBeenCalledWith(clearTextInCurrentBlockCommand.key)
    expect(dispatch).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith('drawing')
    expect(tr.insertText).toHaveBeenCalledWith('![[Drawing 2026-08-25 20.31.02.excalidraw|locked]]')
    expect(drawingEmbed('x.excalidraw')).toBe('![[x.excalidraw|locked]]')
  })

  it('a failed create inserts nothing and goes to the notice path, never a throw', async () => {
    const { builder, added } = stubBuilder()
    const onNotice = vi.fn()
    drawingMenu({ create: vi.fn().mockRejectedValue(new Error('read-only volume')), onNotice })(builder)
    const { ctx, dispatch } = stubCtx()

    added[0].item.onRun?.(ctx)
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("Can't create a drawing: read-only volume"))
    expect(dispatch).not.toHaveBeenCalled()
  })
})
