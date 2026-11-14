// CHECKER (YAZ-4993 extra round): a cut and paste of the ORIGINAL while an agent's older copy sits unswept.
import { afterEach, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection, NodeSelection } from '@milkdown/kit/prose/state'
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
const stale = '<!-- card: WIKI-9, 2026-11-01T09:00Z good -->'
const full = '<!-- card: WIKI-9, 2026-11-01T09:00Z good, 2026-11-07T09:00Z good -->'

async function open(staleText: string) {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], [], true, ['WIKI'])
  const root = document.createElement('div')
  document.body.appendChild(root)
  const md = `\`\`\`card\n${staleText}\n---\nA\n\`\`\`\n${stale}\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n${full}\n\nOutro\n`
  const crepe = createCrepe({ root, defaultValue: md, wikilinks: source, cards: { path: '/v/deck.md', mintId: () => Promise.resolve('WIKI-30') } })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.hasFocus = () => true
  return { crepe, view }
}

for (const staleText of ['Q, reworded', 'Q']) {
  it(`cut, then paste at the end (two transactions), agent copy text "${staleText}": no review leaves the file`, async () => {
    const { crepe, view } = await open(staleText)
    let from = -1
    view.state.doc.forEach((_n, pos, i) => {
      if (i === 1) from = pos
    })
    const original = view.state.doc.nodeAt(from)!
    // The cut.
    view.dispatch(view.state.tr.delete(from, from + original.nodeSize).setMeta('uiEvent', 'cut'))
    // The paste, at the end.
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, original).setMeta('uiEvent', 'paste'))
    await new Promise((r) => setTimeout(r, 0))
    const saved = getMarkdownForSave(crepe)
    expect(saved).toContain('2026-11-07T09:00Z good')
  })
}

it('real path: NodeSelection of the original, serialize, delete (cut), pasteHTML at the end', async () => {
  const { crepe, view } = await open('Q, reworded')
  let from = -1
  view.state.doc.forEach((_n, pos, i) => {
    if (i === 1) from = pos
  })
  const slice = view.state.doc.slice(from, from + view.state.doc.nodeAt(from)!.nodeSize)
  const { dom } = (view as unknown as { serializeForClipboard: (s: typeof slice) => { dom: HTMLElement } }).serializeForClipboard(slice)
  const html = dom.innerHTML
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, from)))
  view.dispatch(view.state.tr.deleteSelection().setMeta('uiEvent', 'cut'))
  const end = view.state.doc.content.size - 1
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
  if (typeof globalThis.ClipboardEvent === 'undefined') (globalThis as unknown as { ClipboardEvent: unknown }).ClipboardEvent = class extends Event { clipboardData = null }
  view.pasteHTML(html)
  await new Promise((r) => setTimeout(r, 0))
  const saved = getMarkdownForSave(crepe)
  expect(saved).toContain('2026-11-07T09:00Z good')
})
