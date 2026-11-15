/**
 * List node helpers (YAZ-1709): an image bullet's label is its alt text — width stripped, src as
 * the fallback — so fold keys, zoom keys and breadcrumbs give it an identity of its own instead of
 * "Untitled item"; and `findOwnImages` yields item-relative offsets that resolve straight to the
 * image nodes (`doc.nodeAt(itemPos + 1 + offset)`), ignoring images inside nested lists — those
 * belong to the child items. Real parser through `createCrepe`, so the offsets are the schema's.
 * A table cell is a boundary for the item helpers (YAZ-3818): `itemInCell`, `innermostItemPos`, and
 * `findOwnImages` skips a table the item holds.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { createCrepe } from '../createCrepe'
import { findOwnEmbeds, findOwnImages, innermostItemPos, itemInCell, itemLabelText } from './listNodes'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function docOf(markdown: string): Promise<ProseNode> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.doc)
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Every list_item with its document position, in document order. */
const items = (doc: ProseNode): { item: ProseNode; itemPos: number }[] => {
  const found: { item: ProseNode; itemPos: number }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'list_item') found.push({ item: node, itemPos: pos })
    return true
  })
  return found
}

const srcsOf = (doc: ProseNode, itemPos: number, own: { offset: number }[]) =>
  own.map(({ offset }) => doc.nodeAt(itemPos + 1 + offset)?.attrs.src as string)

describe('YAZ-4920: an id embed on a bullet, with the host\'s board check', () => {
  const isBoard = (target: string) => target === 'EMB-40'

  it('the label counts the id embed as a board, without its options (the fold key stays through a view write); without the check it is text', async () => {
    const doc = await docOf('* ![[EMB-40|640x360 view=1,2,0.5]]\n* ![[YAZ-12|x]]\n')
    const [board, note] = items(doc)
    expect(itemLabelText(board.item, isBoard)).toBe('![[EMB-40]]')
    expect(itemLabelText(board.item)).toBe('![[EMB-40|640x360 view=1,2,0.5]]')
    expect(itemLabelText(note.item, isBoard)).toBe('![[YAZ-12|x]]')
  })

  it('findOwnEmbeds finds the id embed with the check, and not without it', async () => {
    const doc = await docOf('* ![[EMB-40|640x360]] and ![[CloudFront.drawio]]\n')
    const [item] = items(doc)
    expect(findOwnEmbeds(item.item, isBoard)).toHaveLength(2)
    expect(findOwnEmbeds(item.item)).toHaveLength(1)
  })
})

describe('itemLabelText', () => {
  it('an image bullet is labelled by its alt text, width stripped', async () => {
    const doc = await docOf('* ![Shot|400](a.png)\n')
    expect(itemLabelText(items(doc)[0].item)).toBe('Shot')
  })

  it('an empty alt falls back to the src; text beside an image concatenates; a text bullet is unchanged', async () => {
    const doc = await docOf('* ![](a.png)\n* Before ![Shot](a.png) after\n* Plain\n')
    const [empty, mixed, plain] = items(doc)
    expect(itemLabelText(empty.item)).toBe('a.png')
    expect(itemLabelText(mixed.item)).toBe('Before Shot after')
    expect(itemLabelText(plain.item)).toBe('Plain')
  })
})

describe('findOwnImages', () => {
  it('each entry is the image node plus an offset that resolves back to it through itemPos + 1 + offset', async () => {
    const doc = await docOf('* One ![A](a.png) two ![B](b.png)\n')
    const { item, itemPos } = items(doc)[0]
    const own = findOwnImages(item)
    expect(own).toHaveLength(2)
    for (const { node, offset } of own) {
      expect(node.type.name).toBe('image')
      expect(doc.nodeAt(itemPos + 1 + offset)).toBe(node)
    }
    expect(srcsOf(doc, itemPos, own)).toEqual(['a.png', 'b.png'])
  })

  it("ignores images inside nested lists — those are the child items' own; a text leaf has none", async () => {
    const doc = await docOf('* ![P](p.png)\n  * ![N](n.png)\n* Text\n')
    const [parent, child, leaf] = items(doc)
    expect(srcsOf(doc, parent.itemPos, findOwnImages(parent.item))).toEqual(['p.png'])
    expect(srcsOf(doc, child.itemPos, findOwnImages(child.item))).toEqual(['n.png'])
    expect(findOwnImages(leaf.item)).toEqual([])
  })

  it('ignores images in a table the item holds (YAZ-3818): they sit in its cells', async () => {
    const doc = await docOf('* ![P](p.png)\n\n  | h |\n  | --- |\n  | ![C](c.png) |\n')
    const [bullet] = items(doc)
    expect(srcsOf(doc, bullet.itemPos, findOwnImages(bullet.item))).toEqual(['p.png'])
  })
})

/** The resolved position inside the first text node that holds `text`. */
const at = (doc: ProseNode, text: string) => {
  let pos = -1
  doc.descendants((node, nodePos) => {
    if (pos < 0 && node.isText && node.text!.includes(text)) pos = nodePos + node.text!.indexOf(text)
    return pos < 0
  })
  return doc.resolve(pos)
}

describe('a table cell is a boundary (YAZ-3818)', () => {
  // A bullet holding a table (YAZ-3770) whose body cells hold a plain line and a bullet with a child.
  const NOTE = '* outer\n\n  | h1 | h2 |\n  | --- | --- |\n  | plain | <ul><li>cell<ul><li>kid</li></ul></li></ul> |\n\ntext\n'

  it('itemInCell: true in a cell bullet at any depth; false on a plain cell line, in the outer bullet and outside lists', async () => {
    const doc = await docOf(NOTE)
    expect(itemInCell(at(doc, 'cell'))).toBe(true)
    expect(itemInCell(at(doc, 'kid'))).toBe(true)
    expect(itemInCell(at(doc, 'plain'))).toBe(false)
    expect(itemInCell(at(doc, 'outer'))).toBe(false)
    expect(itemInCell(at(doc, 'text'))).toBe(false)
  })

  it('innermostItemPos: the cell bullet in a cell; null on a plain cell line, never the outer bullet', async () => {
    const doc = await docOf(NOTE)
    const [outer, cell, kid] = items(doc)
    expect(innermostItemPos(at(doc, 'outer'))).toBe(outer.itemPos)
    expect(innermostItemPos(at(doc, 'cell'))).toBe(cell.itemPos)
    expect(innermostItemPos(at(doc, 'kid'))).toBe(kid.itemPos)
    expect(innermostItemPos(at(doc, 'plain'))).toBeNull()
  })
})
