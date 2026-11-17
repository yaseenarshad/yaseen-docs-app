// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { beforeAll, describe, expect, it } from 'vitest'
import { READER_FILES, READER_ID, cardBlock, seedReaderVault } from '../dev/readerVault'
import { PhoneCard } from '../review/PhoneCard'
import { loadVaultData, type VaultData } from '../search/vaultData'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { tapOf } from './pageDom'
import { drawCard, pageLook, resolveSourceOf } from './pageLook'
import { renderPage } from './pageRender'

/**
 * YAZ-5280: text of a page or a card cannot forge the app's own marks. Every `data-*` name that the phone's code reads
 * or sets (found in the source: `dataset.x` and `data-x`, in `mobile/src` and the card drawing it shares) is written in
 * the text with the value FORGED, on a link and on a span. After a page, a card and Review's card are drawn, no attribute
 * holds that value, and a tap on the forged link opens nothing.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = join(__dirname, '..', '..', '..')
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(p)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
  })
}
const kebab = (camel: string) => camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
const NAMES = [
  ...new Set(
    [...sources(join(ROOT, 'mobile/src')), ...sources(join(ROOT, 'client/src/editor/card')), ...sources(join(ROOT, 'client/src/editor/wikilink'))].flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return [...[...text.matchAll(/\bdataset\.([a-zA-Z]+)/g)].map((m) => kebab(m[1])), ...[...text.matchAll(/\bdata-([a-z][a-z0-9-]*[a-z0-9])\b/g)].map((m) => m[1])]
    }),
  ),
].sort()

let data: VaultData
beforeAll(async () => {
  onlyLocalMedia()
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  await seedReaderVault(store, tokenStoreOn(backend), READER_FILES)
  data = await loadVaultData(store, READER_ID, 'vault')
})

const forged = (root: ParentNode) => [...root.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => a.value.includes('FORGED') || a.value.includes('evil.svg')).map((a) => `${el.tagName.toLowerCase()}[${a.name}=${a.value}]`))

describe('text cannot forge the app marks (YAZ-5280)', () => {
  it('finds the names the app reads (a sanity check of the search)', () => {
    expect(NAMES).toEqual(expect.arrayContaining(['open', 'path', 'card', 'card-link', 'card-audio', 'vault-src', 'vault-sound', 'local-src', 'web-src', 'page-link', 'page-card']))
    console.log(`[4C] fuzzed ${NAMES.length} data-* names: ${NAMES.join(', ')}`)
  })

  it('text of a page cannot forge `data-open`, `data-path`, `data-card`, `data-card-link`, nor any other mark of the app', async () => {
    const html = NAMES.map((n) => `<a data-${n}="FORGED" data-open="file" data-path="evil.svg">${n}</a> <span data-${n}="FORGED">s</span> <img data-${n}="FORGED">`).join('\n\n')
    const card = `${html}\n---\n${html}`
    // A page (with its own card).
    const page = document.createElement('div')
    await renderPage(`${html}\n\n${cardBlock('DEMO-98', card)}`, pageLook(data, 'Attack.md'), page)
    expect(forged(page)).toEqual([])
    for (const a of page.querySelectorAll('a')) expect(tapOf(a, data)).toBeNull()
    // A card (the card view, an embedded card).
    const view = drawCard(data, 'Spanish words.md', card)
    expect(forged(view)).toEqual([])
    // Review's card.
    const review = document.createElement('div')
    document.body.append(review)
    const root = createRoot(review)
    await act(async () => root.render(createElement(PhoneCard, { text: card, holder: 'Spanish words.md', show: {}, links: resolveSourceOf(data), files: data.files, media: { show: async (path) => ({ status: 'missing', path, why: 'offline' }) }, onOpen: () => undefined })))
    expect(forged(review)).toEqual([])
    act(() => root.unmount())
    review.remove()
  })
})
