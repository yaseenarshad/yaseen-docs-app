// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { createWikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
import { drawLocalCard } from '../media/ui/cardDraw'
import { renderPage, type PageLook } from './pageRender'

/**
 * YAZ-5448: a code block wraps its long lines everywhere the phone shows Markdown (no side scroll), with its indents
 * kept, and a long inline code, URL or word breaks. jsdom has no layout, so the cascade is checked: the phone's real
 * stylesheets in the page, the real drawings (the page renderer, the Mac's card drawing), and each place's computed style.
 */
const sheet = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SHEETS = ['../styles.css', '../../../client/src/editor/card/card.css', '../../../client/src/editor/table/cardTable.css', '../../../client/src/review/cardScreens.css', './reader.css', '../review/review.css']

const LONG = 'const answer = someVeryLongFunctionName(firstArgument, secondArgument, thirdArgument, fourthArgument, fifthArgument)'
const URL_LINE = 'https://example.com/a/very/long/path/that/never/stops/with-no-spaces-at-all-1234567890abcdef1234567890abcdef'
// A card: a code block and a hidden word on the front; a long inline code and a second code block on the back.
const CARD = ['What does {{show}} print?', '', '```js', 'function show() {', `    ${LONG}`, '}', '```', '---', `It prints \`${URL_LINE}\``, '', '```sh', `\t${URL_LINE}`, '```'].join('\n')

const holder = 'cards/code.md'
const links = createWikilinkResolveSource()
const card = () => drawLocalCard(CARD, {}, { links, files: [], holder })
const look: PageLook = {
  link: (inner) => ({ label: inner, open: null }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: () => card(),
}

const wraps = (el: Element) => {
  const s = getComputedStyle(el)
  return { whiteSpace: s.whiteSpace, overflowWrap: s.overflowWrap }
}
const WRAPS = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }

let styles: HTMLStyleElement[] = []
beforeAll(() => {
  onlyLocalMedia()
  styles = SHEETS.map((path) => {
    const el = document.createElement('style')
    el.textContent = sheet(path)
    document.head.append(el)
    return el
  })
})
afterAll(() => styles.forEach((s) => s.remove()))

describe('code blocks wrap their long lines on the phone (YAZ-5448)', () => {
  it('the page reader: a code block and a card in the page; the indents stay in the text', async () => {
    const body = document.createElement('div')
    body.className = 'reader__body'
    document.body.append(body)
    await renderPage(['# Code', '', '```ts', 'if (ready) {', `    ${LONG}`, '}', '```', '', `A long word: ${URL_LINE} and \`${LONG.replace(/ /g, '')}\`.`, '', '```card', CARD, '```'].join('\n'), look, body)
    const pres = [...body.querySelectorAll('pre')]
    expect(pres.length).toBeGreaterThanOrEqual(2)
    for (const pre of pres) expect(wraps(pre)).toEqual(WRAPS)
    expect(pres[0].textContent).toContain(`\n    ${LONG}`)
    const inline = [...body.querySelectorAll('code')].filter((c) => c.closest('pre') === null)
    expect(inline.length).toBeGreaterThan(0)
    for (const code of inline) expect(getComputedStyle(code).overflowWrap).toBe('anywhere')
    // A long URL or word in the text: the reader's body breaks it.
    expect(getComputedStyle(body).overflowWrap).toBe('anywhere')
    body.remove()
  })

  it('the card view', () => {
    const article = document.createElement('article')
    article.className = 'reader card-view'
    const host = document.createElement('div')
    host.className = 'card card-view__card'
    host.append(card())
    article.append(host)
    document.body.append(article)
    const pre = host.querySelector('pre')!
    expect(wraps(pre)).toEqual(WRAPS)
    expect(getComputedStyle(article).overflowWrap).toBe('anywhere')
    for (const code of host.querySelectorAll('p code')) expect(getComputedStyle(code).overflowWrap).toBe('anywhere')
    article.remove()
  })

  it('Review: the front with its word hidden, then the back with every part shown', () => {
    for (const [show, blocks, part] of [[{ sides: 1, shown: 0 }, 1, '.card__blank'], [{ sides: 2 }, 2, '.card__hidden']] as const) {
      const box = document.createElement('div')
      box.className = 'review__card card card-screen'
      box.append(drawLocalCard(CARD, show, { links, files: [], holder }))
      document.body.append(box)
      const pres = [...box.querySelectorAll('pre')]
      expect(pres).toHaveLength(blocks)
      for (const pre of pres) expect(wraps(pre)).toEqual(WRAPS)
      expect(box.querySelector(part)).not.toBeNull()
      expect(pres[0].textContent).toContain(`    ${LONG}`)
      for (const code of box.querySelectorAll('p code')) expect(getComputedStyle(code).overflowWrap).toBe('anywhere')
      expect(getComputedStyle(box).overflowWrap).toBe('anywhere')
      box.remove()
    }
  })

  it('keeps the code font and look: the reader still styles the block and its code', () => {
    const css = sheet('./reader.css')
    expect(css).toMatch(/\.reader__body pre \{[^}]*padding: 10px 12px;[^}]*background: var\(--bg-side\);/)
    expect(css).toMatch(/\.reader__body code \{[^}]*font-family: ui-monospace, SFMono-Regular, Menlo, monospace;/)
  })
})
