import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { IndexRecord, TreeNode } from '@shared/types'
import { buildViewOnlyCatalog } from '../links/viewOnlyCatalog'
import { createCrepe, getPlainText } from './createCrepe'
import { createViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import { createWikilinkResolveSource } from './wikilink/wikilinkPlugin'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const current = mounted.pop()
    if (current !== undefined) {
      await current.crepe.destroy()
      current.root.remove()
    }
  }
})

describe('createCrepe view-only source isolation (YAZ-1310)', () => {
  it('consults the separate source without replacing or extending semantic records/resolution', async () => {
    const record: IndexRecord = {
      path: '/vault/Home.md', name: 'Home.md', basename: 'Home', title: 'Home', folder: '', ext: 'md',
      size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [],
    }
    const semantic = createWikilinkResolveSource()
    const resolve = (target: string) => target === 'Home' ? record.path : null
    semantic.update(resolve, [record])
    const recordsBefore = semantic.records
    const resolverBefore = semantic.resolve
    const viewOnly = createViewOnlyLinkSource()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: '[[Home]] [[data.json]]\n', wikilinks: semantic, viewOnlyLinks: viewOnly })
    await crepe.create()
    mounted.push({ crepe, root })

    const node: TreeNode = { type: 'file', name: 'data.json', path: '/vault/data.json', kind: 'text', size: 1, mtime: 1 }
    viewOnly.update(buildViewOnlyCatalog('/vault', [node]))
    viewOnly.update(buildViewOnlyCatalog('/vault', []))

    expect(semantic.records).toBe(recordsBefore)
    expect(semantic.resolve).toBe(resolverBefore)
    expect(semantic.records).toEqual([record])
    expect(semantic.resolve?.('data.json')).toBeNull()
  })
})

describe('getPlainText: what the page settings menu counts (YAZ-2643)', () => {
  async function text(markdown: string): Promise<string> {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: markdown })
    await crepe.create()
    mounted.push({ crepe, root })
    return getPlainText(crepe)
  }

  it('is the text of the blocks with one line break between two of them: no Markdown syntax (S16, S18)', async () => {
    expect(await text('# Title\n\nSome **bold** text.\n\nLast one.\n')).toBe('Title\nSome bold text.\nLast one.')
  })

  it('reads bullets, a quote, a code block and the cells of a table', async () => {
    expect(await text('* one\n  * two\n\n> said\n\n```js\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nEnd.\n')).toBe('one\ntwo\nsaid\nconst a = 1\na\nb\n1\n2\nEnd.')
  })

  it('is empty for an empty note (S20)', async () => {
    expect(await text('')).toBe('')
  })

  it('a note that ends in a bullet: the empty paragraph Crepe keeps under it adds one break, once the editor has run a transaction', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: '* one\n* two\n' })
    await crepe.create()
    mounted.push({ crepe, root })
    expect(getPlainText(crepe)).toBe('one\ntwo')
    const view = crepe.editor.ctx.get(editorViewCtx)
    view.dispatch(view.state.tr)
    expect(getPlainText(crepe)).toBe('one\ntwo\n')
  })
})
