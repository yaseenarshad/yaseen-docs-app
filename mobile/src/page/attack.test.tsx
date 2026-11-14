// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { READER_FILES, READER_ID, cardBlock, seedReaderVault } from '../dev/readerVault'
import { watchMedia, type FileShow, type VaultMedia } from '../media/ui/vaultMedia'
import { PhoneCard } from '../review/PhoneCard'
import { loadVaultData, type VaultData } from '../search/vaultData'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { fillCardEmbeds } from './pageDom'
import { drawCard, pageLook, resolveSourceOf } from './pageLook'
import { renderPage } from './pageRender'
import { VECTORS, remoteAttributes, watchWrites } from './testing'

/**
 * YAZ-5242 (and YAZ-5208, YAZ-5209, YAZ-5243): the checker's 90 vectors through the THREE ways the phone draws text from
 * a vault: a page (`renderPage`, its own card, an embedded card), a card (`drawCard`: the card view), and Review's card
 * (`PhoneCard`). The app runs at https://app.example/. For each vector: no write, insertion, fetch, request or `Audio` of
 * an address on another host, also after each Play is tapped, and no attribute of the final DOM holds one (only a web
 * link that opens Safari: `target="_blank"`, `rel="noopener noreferrer"`).
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let data: VaultData
const media: VaultMedia = { show: async (path): Promise<FileShow> => ({ status: 'missing', path, why: 'offline' }) }

beforeAll(async () => {
  onlyLocalMedia()
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  await seedReaderVault(store, tokenStoreOn(backend), READER_FILES)
  data = await loadVaultData(store, READER_ID, 'vault')
})
afterAll(() => {
  document.body.replaceChildren()
})

const tapEveryPlay = (root: ParentNode) => {
  for (const play of root.querySelectorAll<HTMLButtonElement>('.card__audio-play')) play.click()
}
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('the 90 vectors make no request in a page, a card or Review (YAZ-5242)', () => {
  it('has the 90 vectors of the checker', () => {
    expect(VECTORS).toHaveLength(90)
    expect(location.origin).toBe('https://app.example')
  })

  it.each(VECTORS.map((v, i) => [i + 1, v]))('vector %i: %s', async (_n, vector) => {
    const card = `${vector}\n---\n${vector}\n\nA {{hidden ${vector}}} word.`
    const watch = watchWrites()
    const results: string[][] = []
    try {
      // 1. A page: the vector, a card of its own with it, and an embedded card file.
      const page = document.createElement('div')
      document.body.append(page)
      await renderPage(`${vector}\n\n${cardBlock('DEMO-99', card)}\n\n![[DEMO-40]]`, pageLook(data, 'Attack.md'), page)
      const store = { read: async () => ({ content: `---\nkind: card\ntitle: x\n---\n\n${cardBlock('DEMO-40', card)}\n` }) }
      await fillCardEmbeds(page, data, store as never, () => undefined)
      const pageWatch = watchMedia(page, media)
      await settle()
      tapEveryPlay(page)
      pageWatch.stop()
      results.push(remoteAttributes(page))

      // 2. A card: the card view, a page's own card and an embed all draw with `drawCard`.
      const view = document.createElement('div')
      document.body.append(view)
      view.append(drawCard(data, 'Spanish words.md', card))
      tapEveryPlay(view)
      results.push(remoteAttributes(view))

      // 3. Review's card, every side shown.
      const review = document.createElement('div')
      document.body.append(review)
      const root = createRoot(review)
      await act(async () =>
        root.render(createElement(PhoneCard, { text: card, holder: 'Spanish words.md', show: {}, links: resolveSourceOf(data), files: data.files, media, onOpen: () => undefined })),
      )
      await act(async () => settle())
      tapEveryPlay(review)
      results.push(remoteAttributes(review))
      act(() => root.unmount())
      page.remove()
      view.remove()
      review.remove()
    } finally {
      watch.stop()
    }
    expect({ requests: watch.remote, page: results[0], card: results[1], review: results[2] }).toEqual({ requests: [], page: [], card: [], review: [] })
  })
})
