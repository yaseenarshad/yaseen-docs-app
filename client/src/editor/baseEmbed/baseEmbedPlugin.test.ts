/**
 * Base embeds in the editor (6A, GRO-2145): real editor (`createCrepe`), the `![[X.base]]` /
 * `![[X.base#View]]` paragraph gets a widget decoration (never a schema change), inspected via
 * the slot store + DOM. The save-path guard matters most: an embed must round-trip byte-identically,
 * and typing near it must NOT remount the widget DOM.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { BASE_EMBED_CLASS, createBaseEmbedSlotStore, type BaseEmbedSlotStore } from './baseEmbedPlugin'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, store: BaseEmbedSlotStore) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, baseEmbeds: store })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

function viewOf(crepe: Crepe): EditorView {
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx))
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

async function roundTrip(markdown: string): Promise<string> {
  const store = createBaseEmbedSlotStore()
  const { crepe } = await mount(markdown, store)
  return getMarkdownForSave(crepe)
}

describe('base embed round-trip (decoration only, GRO-2145)', () => {
  it('![[X.base]] round-trips byte-identically', async () => {
    const md = 'Intro\n\n![[Topics.base]]\n\nOutro\n'
    expect(await roundTrip(md)).toBe(md)
  })

  it('![[X.base#View]] round-trips byte-identically', async () => {
    const md = '![[Topics.base#Board]]\n'
    expect(await roundTrip(md)).toBe(md)
  })

  it('an unresolvable target round-trips untouched (resolution is render-side only)', async () => {
    const md = '![[No Such File.base]]\n'
    expect(await roundTrip(md)).toBe(md)
  })

  it('an embed with surrounding text in the paragraph round-trips byte-identically', async () => {
    const md = 'See ![[Topics.base#All]] for the table.\n'
    expect(await roundTrip(md)).toBe(md)
  })
})

describe('base embed widget (slot store + DOM)', () => {
  it('decorates the paragraph with a widget beneath the text', async () => {
    const store = createBaseEmbedSlotStore()
    const { root } = await mount('Intro\n\n![[Topics.base]]\n\nOutro\n', store)
    const slots = store.list()
    expect(slots).toHaveLength(1)
    expect(slots[0].target).toBe('Topics.base')
    expect(slots[0].viewName).toBeNull()
    expect(slots[0].dom.isConnected).toBe(true)
    expect(slots[0].dom.classList.contains(BASE_EMBED_CLASS)).toBe(true)
    expect(root.querySelectorAll(`.${BASE_EMBED_CLASS}`)).toHaveLength(1)
    // beneath the text: the widget sits right after the paragraph that carries the embed
    expect(slots[0].dom.previousSibling?.textContent).toContain('![[Topics.base]]')
  })

  it('#View is carried on the slot', async () => {
    const store = createBaseEmbedSlotStore()
    await mount('![[Topics.base#Board]]\n', store)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].viewName).toBe('Board')
  })

  it('a paragraph with two base embeds gets no widget', async () => {
    const store = createBaseEmbedSlotStore()
    await mount('![[A.base]] and ![[B.base]]\n', store)
    expect(store.list()).toHaveLength(0)
  })

  it('non-base embeds and wikilinks get no widget', async () => {
    const store = createBaseEmbedSlotStore()
    await mount('![[note]] and ![[img.png]] and [[Topics.base]]\n', store)
    expect(store.list()).toHaveLength(0)
  })

  it('two embed paragraphs get one widget each', async () => {
    const store = createBaseEmbedSlotStore()
    await mount('![[A.base]]\n\n![[B.base]]\n', store)
    expect(store.list().map((s) => s.target)).toEqual(['A.base', 'B.base'])
  })

  it('typing near the embed keeps the SAME widget DOM node (no remount)', async () => {
    const store = createBaseEmbedSlotStore()
    const { crepe, root } = await mount('Intro\n\n![[Topics.base]]\n\nOutro\n', store)
    const dom = store.list()[0].dom
    const view = viewOf(crepe)
    // type into the first paragraph, then directly inside the embed paragraph (before the `!`)
    view.dispatch(view.state.tr.insertText('x', 2))
    const embedParaStart = view.state.doc.content.child(0).nodeSize // the embed paragraph node's position
    view.dispatch(view.state.tr.insertText('y', embedParaStart + 1))
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].dom).toBe(dom)
    expect(dom.isConnected).toBe(true)
    expect(root.querySelectorAll(`.${BASE_EMBED_CLASS}`)).toHaveLength(1)
  })

  it('deleting the embed text removes the widget', async () => {
    const store = createBaseEmbedSlotStore()
    const { crepe, root } = await mount('![[Topics.base]]\n', store)
    const dom = store.list()[0].dom
    const view = viewOf(crepe)
    view.dispatch(view.state.tr.delete(1, view.state.doc.content.child(0).nodeSize - 1))
    expect(store.list()).toHaveLength(0)
    expect(dom.isConnected).toBe(false)
    expect(root.querySelectorAll(`.${BASE_EMBED_CLASS}`)).toHaveLength(0)
  })
})
