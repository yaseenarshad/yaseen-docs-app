// CHECKER (YAZ-4946 round 1): a copy of a card pasted ABOVE the card it copies.
import { afterEach, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  while (mounted.length > 0) {
    const c = mounted.pop()!
    await c.crepe.destroy()
    c.root.remove()
  }
})

it('a card copied and pasted above itself: the ORIGINAL keeps its ID and history, the pasted copy does not', async () => {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], [], true, ['WIKI'])
  const root = document.createElement('div')
  document.body.appendChild(root)
  const md = 'Intro\n\n```card\nOriginal question\n---\nAnswer\n```\n<!-- card: WIKI-9, 2026-11-01T09:00Z good, 2026-11-05T09:00Z good -->\n'
  const crepe = createCrepe({ root, defaultValue: md, wikilinks: source })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.hasFocus = () => true
  // What a copy of the card in the app puts on the clipboard: its <pre> with data-card-line (toDOM).
  const pre = view.dom.ownerDocument.createElement('div')
  let html = ''
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') {
      const slice = view.state.doc.slice(pos, pos + node.nodeSize)
      const { dom } = (view as unknown as { serializeForClipboard?: (s: typeof slice) => { dom: HTMLElement } }).serializeForClipboard?.(slice) ?? { dom: pre }
      html = dom.innerHTML
    }
    return true
  })
  expect(html).toContain('data-card-line')
  // Paste it at the end of "Intro" (above the original).
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)))
  if (typeof globalThis.ClipboardEvent === 'undefined') (globalThis as unknown as { ClipboardEvent: unknown }).ClipboardEvent = class extends Event { clipboardData = null }
  view.pasteHTML(html)
  const saved = getMarkdownForSave(crepe)
  const lines = saved.split('\n').filter((l) => l.startsWith('<!-- card'))
  // Two cards now hold WIKI-9 and its history; the sweep keeps the FIRST in page order (the pasted copy) and
  // empties the second (the original). Expected: the pasted card carries no ID and no history.
  expect(lines).toEqual(['<!-- card: WIKI-9, 2026-11-01T09:00Z good, 2026-11-05T09:00Z good -->'])
})

it('the copy rule: a paste below is the copy too and takes a new ID from the door; a move keeps the ID and the history', async () => {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], [], true, ['WIKI'])
  const root = document.createElement('div')
  document.body.appendChild(root)
  const line = '<!-- card: WIKI-9, off, 2026-11-01T09:00Z good -->'
  const md = `\`\`\`card\nQ\n---\nA\n\`\`\`\n${line}\n\nOutro\n`
  const crepe = createCrepe({ root, defaultValue: md, wikilinks: source, cards: { path: '/v/deck.md', mintId: () => Promise.resolve('WIKI-30') } })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  const card = view.state.doc.firstChild!
  const cardLines = () => getMarkdownForSave(crepe).split('\n').filter((l) => l.startsWith('<!-- card'))
  // A paste below (the copy's slice inserted after the card): the copy keeps `off`, loses the ID and the history, then takes WIKI-30.
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, card).setMeta('uiEvent', 'paste'))
  expect(cardLines()).toEqual([line, '<!-- card: off -->'])
  await new Promise((r) => setTimeout(r, 0))
  expect(cardLines()).toEqual([line, '<!-- card: WIKI-30, off -->'])
  // A move: the card leaves its place and lands at the end in ONE transaction (a drag): it keeps its ID and history.
  const end = view.state.doc.content.size
  view.dispatch(view.state.tr.insert(end, card).delete(0, card.nodeSize).setMeta('uiEvent', 'drop'))
  expect(cardLines()).toEqual(['<!-- card: WIKI-30, off -->', line])
  // An outside write with two cards of one ID is the sweep's to settle: the editor takes it as it is.
  const twice = `\`\`\`card\nQ\n---\nA\n\`\`\`\n${line}\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n${line}\n`
  const { applyExternalMarkdown } = await import('../external/applyExternalMarkdown')
  applyExternalMarkdown(crepe, twice)
  expect(cardLines()).toEqual([line, line])
})

it('YAZ-4993 (the round 2 nit): a drag of the ORIGINAL while an agent`s changed, older copy sits unswept loses no review', async () => {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], [], true, ['WIKI'])
  const root = document.createElement('div')
  document.body.appendChild(root)
  // The agent wrote its copy with a line it read BEFORE the Nov 7 answer, and changed the text. The sweep has not run.
  const stale = '<!-- card: WIKI-9, 2026-11-01T09:00Z good -->'
  const full = '<!-- card: WIKI-9, 2026-11-01T09:00Z good, 2026-11-07T09:00Z good -->'
  const md = `\`\`\`card\nQ, reworded\n---\nA\n\`\`\`\n${stale}\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n${full}\n\nOutro\n`
  const crepe = createCrepe({ root, defaultValue: md, wikilinks: source, cards: { path: '/v/deck.md', mintId: () => Promise.resolve('WIKI-30') } })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  let from = -1
  view.state.doc.forEach((node, pos, i) => {
    if (i === 1) from = pos
  })
  const original = view.state.doc.nodeAt(from)!
  // A drag of the original to the end: it leaves its place and lands at the end in ONE transaction.
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, original).delete(from, from + original.nodeSize).setMeta('uiEvent', 'drop'))
  await new Promise((r) => setTimeout(r, 0))
  const saved = getMarkdownForSave(crepe)
  // The Nov 7 review is only on the original. It must still be in the file; the move keeps the ID and the history.
  expect(saved).toContain('2026-11-07T09:00Z good')
  expect(saved.split('\n').filter((l) => l.startsWith('<!-- card'))).toEqual([stale, full])
})
