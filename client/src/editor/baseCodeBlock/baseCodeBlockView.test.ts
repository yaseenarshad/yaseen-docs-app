/**
 * `base` code blocks rendered inline (6B, GRO-2146): real editor (`createCrepe`), a fenced
 * block with `language === 'base'` swaps Crepe's CodeMirror node view for a stored slot
 * that React portals `<BaseCodeBlock>` into; every other language keeps the stock CodeMirror
 * block exactly as today. The save-path guard matters most: the block round-trips
 * byte-identically (valid and invalid YAML), a commit through the slot lands in the markdown
 * as the exact block text, and typing elsewhere never remounts the slot DOM.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { BASE_CODE_BLOCK_CLASS, createBaseCodeBlockSlotStore, type BaseCodeBlockSlotStore } from './baseCodeBlockView'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, store: BaseCodeBlockSlotStore) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, baseCodeBlocks: store })
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
  const store = createBaseCodeBlockSlotStore()
  const { crepe } = await mount(markdown, store)
  return getMarkdownForSave(crepe)
}

const YAML = 'views:\n  - type: table\n    name: All'
const MD = `Intro\n\n\`\`\`base\n${YAML}\n\`\`\`\n\nOutro\n`

describe('base code block round-trip (node view only, GRO-2146)', () => {
  it('a valid ```base block round-trips byte-identically', async () => {
    expect(await roundTrip(MD)).toBe(MD)
  })

  it('an invalid-YAML ```base block round-trips byte-identically', async () => {
    const md = '```base\nviews: [broken\n```\n'
    expect(await roundTrip(md)).toBe(md)
  })

  it('a non-base code block round-trips byte-identically', async () => {
    const md = '```ts\nconst x = 1\n```\n'
    expect(await roundTrip(md)).toBe(md)
  })
})

describe('base code block node view (slot store + DOM)', () => {
  it('a ```base block gets a slot instead of the CodeMirror block', async () => {
    const store = createBaseCodeBlockSlotStore()
    const { root } = await mount(MD, store)
    const slots = store.list()
    expect(slots).toHaveLength(1)
    expect(slots[0].text).toBe(YAML)
    expect(slots[0].dom.isConnected).toBe(true)
    expect(slots[0].dom.classList.contains(BASE_CODE_BLOCK_CLASS)).toBe(true)
    expect(root.querySelectorAll(`.${BASE_CODE_BLOCK_CLASS}`)).toHaveLength(1)
    expect(root.querySelectorAll('.milkdown-code-block')).toHaveLength(0)
  })

  it('every other language keeps the stock CodeMirror block', async () => {
    const store = createBaseCodeBlockSlotStore()
    const { root } = await mount('```ts\nconst x = 1\n```\n', store)
    expect(store.list()).toHaveLength(0)
    expect(root.querySelectorAll('.milkdown-code-block')).toHaveLength(1)
    expect(root.querySelectorAll(`.${BASE_CODE_BLOCK_CLASS}`)).toHaveLength(0)
  })

  it('a base block and a ts block coexist, each with its own rendering', async () => {
    const store = createBaseCodeBlockSlotStore()
    const { root } = await mount(`\`\`\`base\n${YAML}\n\`\`\`\n\n\`\`\`ts\nconst x = 1\n\`\`\`\n`, store)
    expect(store.list()).toHaveLength(1)
    expect(root.querySelectorAll(`.${BASE_CODE_BLOCK_CLASS}`)).toHaveLength(1)
    expect(root.querySelectorAll('.milkdown-code-block')).toHaveLength(1)
  })

  it('commit replaces the block text and the save carries the exact edited block', async () => {
    const store = createBaseCodeBlockSlotStore()
    const { crepe } = await mount(MD, store)
    const edited = 'views:\n  - type: table\n    name: Renamed'
    store.list()[0].commit(edited)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].text).toBe(edited)
    expect(getMarkdownForSave(crepe)).toBe(`Intro\n\n\`\`\`base\n${edited}\n\`\`\`\n\nOutro\n`)
  })

  it('typing elsewhere keeps the SAME slot DOM node (no remount)', async () => {
    const store = createBaseCodeBlockSlotStore()
    const { crepe, root } = await mount(MD, store)
    const dom = store.list()[0].dom
    const view = viewOf(crepe)
    view.dispatch(view.state.tr.insertText('x', 2))
    view.dispatch(view.state.tr.insertText('y', 3))
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].dom).toBe(dom)
    expect(store.list()[0].text).toBe(YAML)
    expect(dom.isConnected).toBe(true)
    expect(root.querySelectorAll(`.${BASE_CODE_BLOCK_CLASS}`)).toHaveLength(1)
  })

  it('a commit keeps the SAME slot DOM node too (edit never remounts)', async () => {
    const store = createBaseCodeBlockSlotStore()
    await mount(MD, store)
    const dom = store.list()[0].dom
    store.list()[0].commit('views: []')
    expect(store.list()[0].dom).toBe(dom)
    expect(dom.isConnected).toBe(true)
  })

  it('deleting the block removes the slot', async () => {
    const store = createBaseCodeBlockSlotStore()
    const { crepe, root } = await mount(`\`\`\`base\n${YAML}\n\`\`\`\n`, store)
    const dom = store.list()[0].dom
    const view = viewOf(crepe)
    view.dispatch(view.state.tr.delete(0, view.state.doc.content.child(0).nodeSize))
    expect(store.list()).toHaveLength(0)
    expect(dom.isConnected).toBe(false)
    expect(root.querySelectorAll(`.${BASE_CODE_BLOCK_CLASS}`)).toHaveLength(0)
  })
})
