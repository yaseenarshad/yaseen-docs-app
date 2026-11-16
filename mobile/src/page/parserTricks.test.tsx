// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { plainSwallowers } from '@client/editor/card/localOnly'
import { beforeAll, describe, expect, it } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { PhoneCard } from '../review/PhoneCard'
import { loadVaultData, type VaultData } from '../search/vaultData'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { drawCard, pageLook, resolveSourceOf } from './pageLook'
import { renderPage } from './pageRender'

/**
 * YAZ-5364 (the family of YAZ-5318): no ONE element or comment of the text may swallow the rest of a page or a card.
 * The 4 cases of the bug (`<template>`, `<math><mtext><textarea>`, an unclosed `<!--`, `<select>`), each closed and
 * unclosed, and 12 more tricks that switch the HTML parser, in a page, a card and Review. The secret name of the marks
 * never shows.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const SECRET = /data-m[0-9a-f]{16}-/
const LINKS = '[[Trip plan]] ![[DEMO-40]] after'

let data: VaultData
beforeAll(async () => {
  onlyLocalMedia()
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  await seedReaderVault(store, tokenStoreOn(backend), READER_FILES)
  data = await loadVaultData(store, READER_ID, 'vault')
})

const visible = (el: Element) => `${el.textContent ?? ''} ${[...el.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((a) => /^(aria-|alt|title)/.test(a.name)).map((a) => a.value)).join(' ')}`

/**
 * `inline`: the trick is in the line of the link (the link, the embed and the next block draw as such).
 * `block`: the trick is a block of its own line; the link is the next paragraph (it draws as a link).
 * `raw`: Markdown keeps the trick's paragraph as raw HTML (an HTML block: `<frameset`, `<div`), so the link in it is its
 *   text, not a link; the next block draws.
 * `toEnd`: Markdown itself keeps the rest as the block's raw HTML (CommonMark: an unclosed comment, `<?`, `<!X`,
 *   `<![CDATA[` run to the end of the text). Then the rest shows as its text: it is never hidden.
 */
type Kind = 'inline' | 'block' | 'raw' | 'toEnd'
const CASES: [string, Kind, string][] = [
  // The 4 of the bug, unclosed and closed.
  ['template, unclosed', 'inline', `x <template> ${LINKS}`],
  ['template, closed', 'inline', `x <template>inside</template> ${LINKS}`],
  ['math mtext textarea, unclosed', 'inline', `x <math><mtext><textarea> ${LINKS}`],
  ['math mtext, closed', 'inline', `x <math><mtext>in</mtext></math> ${LINKS}`],
  ['comment, unclosed, a block of its own', 'toEnd', '<!--'],
  ['comment, closed, a block of its own', 'block', '<!-- a note -->'],
  ['comment, closed, in the line', 'inline', `x <!-- a note --> ${LINKS}`],
  ['select, unclosed', 'inline', `x <select> ${LINKS}`],
  ['select, closed', 'inline', `x <select><option>a</option></select> ${LINKS}`],
  // 12 more tricks that switch the parser.
  ['svg foreignObject, unclosed', 'inline', `x <svg><foreignObject> ${LINKS}`],
  ['desc (removed with its content), unclosed', 'inline', `x <desc> ${LINKS}`],
  ['frameset first', 'raw', `<frameset> ${LINKS}`],
  ['math mi, unclosed', 'inline', `x <math><mi> ${LINKS}`],
  ['TEMPLATE in capitals', 'inline', `x <TEMPLATE> ${LINKS}`],
  ['math annotation-xml text/html', 'inline', `x <math><annotation-xml encoding="text/html"> ${LINKS}`],
  ['table then select', 'inline', `x <table><select> ${LINKS}`],
  ['a div with an open quote', 'block', '<div title="x'],
  ['a div with no end', 'raw', '<div'],
  ['<?php with no ?>', 'toEnd', '<?php echo 1;'],
  ['<!DOCTYPE with no >', 'toEnd', '<!DOCTYPE x'],
  ['<![CDATA[ with no end', 'toEnd', '<![CDATA[ x'],
]

const pageText = (kind: Kind, line: string) => (kind === 'inline' ? `${line}\n\n## Next block\n\nMore text.` : `${line}\n\n${LINKS}\n\n## Next block\n\nMore text.`)

describe('no element or comment of the text hides the rest (YAZ-5364)', () => {
  it.each(CASES)('in a page: %s', async (_name, kind, line) => {
    const el = document.createElement('div')
    await renderPage(pageText(kind, line), pageLook(data, 'Attack.md'), el)
    expect(el.innerHTML).not.toMatch(SECRET)
    expect(visible(el)).not.toMatch(SECRET)
    expect(visible(el)).not.toMatch(/<(a|span|p|h2) data-/)
    expect(el.textContent).toContain('Trip plan')
    expect(el.textContent).toContain('Next block')
    expect(el.textContent).toContain('More text.')
    expect(el.querySelector('template, svg, math, select, frameset, desc, textarea, [title*="<"]')).toBeNull()
    if (kind !== 'toEnd') expect(el.querySelector('h2')?.textContent).toBe('Next block')
    if (kind === 'inline' || kind === 'block') {
      expect(el.querySelector('a.wikilink')?.textContent).toBe('Trip plan')
      expect(el.querySelector('[data-card-embed="DEMO-40"]')).not.toBeNull()
    }
  })

  it.each(CASES)('in a card and in Review: %s', async (_name, kind, line) => {
    const front = kind === 'inline' ? line.replace('![[DEMO-40]]', '[[Spanish words]]') : `${line}\n\n[[Trip plan]] after`
    const text = `${front}\n---\nback side`
    const view = drawCard(data, 'Spanish words.md', text)
    expect(view.innerHTML).not.toMatch(SECRET)
    expect(visible(view)).not.toMatch(SECRET)
    expect(view.textContent).toContain('Trip plan')
    expect(view.textContent).toContain('back side')
    if (kind === 'inline' || kind === 'block') expect([...view.querySelectorAll('[data-card-link]')].map((p) => p.getAttribute('data-card-link'))).toContain('Trip plan')
    const review = document.createElement('div')
    document.body.append(review)
    const root = createRoot(review)
    await act(async () => root.render(createElement(PhoneCard, { text, holder: 'Spanish words.md', show: {}, links: resolveSourceOf(data), files: data.files, media: { show: async (path) => ({ status: 'missing', path, why: 'offline' }) }, onOpen: () => undefined })))
    expect(review.innerHTML).not.toMatch(SECRET)
    expect(review.textContent).toContain('Trip plan')
    expect(review.textContent).toContain('back side')
    act(() => root.unmount())
    review.remove()
  })
})

describe('plainSwallowers: what changes before the parse (YAZ-5364)', () => {
  it('keeps the allowed, whole tags and the whole comments as they are', () => {
    const html = '<p class="a" title="1 > 0">x <b>y</b><!-- note --><!--><br/></p><img alt="a" src="data:,">'
    expect(plainSwallowers(html)).toBe(html)
  })

  it('makes each swallowing construct plain text', () => {
    expect(plainSwallowers('a <template> b')).toBe('a &lt;template> b')
    expect(plainSwallowers('a <!-- b')).toBe('a &lt;!-- b')
    expect(plainSwallowers('a <?x b')).toBe('a &lt;?x b')
    expect(plainSwallowers('a </ x> b')).toBe('a &lt;/ x> b')
    expect(plainSwallowers('<div title="x <p>y</p>')).toBe('&lt;div title="x <p>y</p>')
    expect(plainSwallowers('<span x <a href="#">')).toBe('&lt;span x <a href="#">')
    expect(plainSwallowers('<Math><MI>')).toBe('&lt;Math>&lt;MI>')
    expect(plainSwallowers('</select>')).toBe('&lt;/select>')
  })
})
