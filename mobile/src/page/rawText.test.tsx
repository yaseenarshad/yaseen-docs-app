// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { READER_FILES, READER_ID, cardBlock, seedReaderVault } from '../dev/readerVault'
import { PhoneCard } from '../review/PhoneCard'
import { loadVaultData, type VaultData } from '../search/vaultData'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { drawCard, pageLook, resolveSourceOf } from './pageLook'
import { renderPage } from './pageRender'

/**
 * YAZ-5318: a raw-text element of the text (`<textarea>` and the others) must not swallow the rest of the page, nor show
 * the renderer's own HTML, nor the secret name of its marks. And (round 3 test gap): the secret is new for each load.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RAW = ['textarea', 'title', 'xmp', 'noembed', 'noframes', 'plaintext', 'iframe', 'noscript', 'style', 'script']
const SECRET = /data-m[0-9a-f]{16}-/

let data: VaultData
beforeAll(async () => {
  onlyLocalMedia()
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  await seedReaderVault(store, tokenStoreOn(backend), READER_FILES)
  data = await loadVaultData(store, READER_ID, 'vault')
})

/** The text a person or VoiceOver gets: the text and every attribute that names or labels. */
const visible = (el: Element) => `${el.textContent ?? ''} ${[...el.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((a) => /^(aria-|alt|title)/.test(a.name)).map((a) => a.value)).join(' ')}`

const cases = RAW.flatMap((tag) => [
  [`${tag}, unclosed`, `x <${tag}> [[Trip plan]] ![[DEMO-40]] after`],
  [`${tag}, closed`, `x <${tag}>inside</${tag}> [[Trip plan]] ![[DEMO-40]] after`],
])

describe('a raw-text element cannot hide the page or show the secret (YAZ-5318)', () => {
  it.each(cases)('in a page: %s', async (_name, line) => {
    const el = document.createElement('div')
    await renderPage(`${line}\n\n## Next block\n\nMore text.`, pageLook(data, 'Attack.md'), el)
    expect(el.innerHTML).not.toMatch(SECRET)
    expect(visible(el)).not.toMatch(SECRET)
    expect(visible(el)).not.toMatch(/<(a|span) data-/)
    // The link and the embed after the tag, and the next block, still draw.
    expect(el.querySelector('a.wikilink')?.textContent).toBe('Trip plan')
    expect(el.querySelector('[data-card-embed="DEMO-40"]')).not.toBeNull()
    expect(el.querySelector('h2')?.textContent).toBe('Next block')
    expect(el.querySelector(RAW.join(', '))).toBeNull()
  })

  it.each(cases)('in a card and in Review: %s', async (_name, line) => {
    const text = `${line.replace('![[DEMO-40]]', '[[Spanish words]]')}\n---\nback side`
    const view = drawCard(data, 'Spanish words.md', text)
    expect(view.innerHTML).not.toMatch(SECRET)
    expect(visible(view)).not.toMatch(SECRET)
    expect([...view.querySelectorAll('[data-card-link]')].map((p) => p.getAttribute('data-card-link'))).toContain('Trip plan')
    expect(view.textContent).toContain('back side')
    const review = document.createElement('div')
    document.body.append(review)
    const root = createRoot(review)
    await act(async () => root.render(createElement(PhoneCard, { text, holder: 'Spanish words.md', show: {}, links: resolveSourceOf(data), files: data.files, media: { show: async (path) => ({ status: 'missing', path, why: 'offline' }) }, onOpen: () => undefined })))
    expect(review.innerHTML).not.toMatch(SECRET)
    expect(review.textContent).toContain('back side')
    act(() => root.unmount())
    review.remove()
  })

  it('a page with its own card: the card after a stray tag still draws', async () => {
    const el = document.createElement('div')
    await renderPage(`Before <textarea> [[Trip plan]]\n\n${cardBlock('DEMO-12', 'la biblioteca\n---\nthe library')}\n`, pageLook(data, 'Attack.md'), el)
    expect(el.querySelector('.page-card[data-card-id="DEMO-12"]')?.textContent).toContain('the library')
    expect(el.innerHTML).not.toMatch(SECRET)
  })
})

describe('the secret of the marks (round 3 test gap)', () => {
  it('is new for each load: two loads of the module give two different mark names', async () => {
    vi.resetModules()
    const one = await import('@client/editor/card/localOnly')
    vi.resetModules()
    const two = await import('@client/editor/card/localOnly')
    expect(one.localMark('page-link')).toMatch(/^data-m[0-9a-f]{16}-page-link$/)
    expect(two.localMark('page-link')).toMatch(/^data-m[0-9a-f]{16}-page-link$/)
    expect(one.localMark('page-link')).not.toBe(two.localMark('page-link'))
  })

  it('is not in the DOM before or after the clean: a drawn page and card hold no mark name, and the document none', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    await renderPage(`[[Trip plan]] ![[DEMO-40]]\n\n- [x] done\n\n${cardBlock('DEMO-12', 'x [[Spanish words]]')}`, pageLook(data, 'Attack.md'), el)
    el.append(drawCard(data, 'Spanish words.md', '[[Trip plan]] ![[song.mp3]]'))
    expect(document.documentElement.outerHTML).not.toMatch(SECRET)
    for (const e of document.querySelectorAll('*')) for (const a of e.attributes) expect(a.name).not.toMatch(SECRET)
    el.remove()
  })
})
