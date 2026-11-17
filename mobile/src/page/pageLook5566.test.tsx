// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { closeAll } from '../explore/sheets'
import { readCardLook } from '../media/ui/cardDraw'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { markSections, pageSwitchAttrs } from './pageSwitches'

/**
 * YAZ-5566: the page look on the phone, as the Mac's. The vault's Text size (`text-formatting.json` › `text.size`, the
 * Mac's `textVars`), which a card set to Same as pages follows too; the vault's default line (`line`, the Mac's
 * `lineVars` and `line.css`); and each page's own switches in its frontmatter (`section-indent`, `guide-lines`, the
 * Mac's `readPageSwitches`). jsdom has no layout, so the drawing rules are read from the CSS. Made-up vault only.
 */
const here = (name: string): string => fileURLToPath(import.meta.url).replace(/pageLook5566\.test\.tsx$/, name)
const css = readFileSync(here('reader.css'), 'utf8')
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no rule ${selector}`)
  return css.slice(at, css.indexOf('}', at))
}

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  act(() => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

const SECTIONS = '# Sections\n\nIntro.\n\n## Travel\n\nLine in travel.\n\n- Pack\n  - Socks\n\n#### Deep\n\nIn deep.\n\n### Three\n\nIn three.\n\n## Food\n\nIn food.\n\n---\n\nEnd.\n'

async function openPage(name: string, text: string, extra: Record<string, string> = {}): Promise<HTMLElement> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...READER_FILES, [`${name}.md`]: text, ...extra })
  h = await mount({ phone })
  await h.click('Search')
  await waitFor(h, () => h!.button(new RegExp(`^${name}, page`)) !== null)
  await h.click(new RegExp(`^${name}, page`))
  await waitFor(h, () => h!.host.querySelector('.reader__body h2') !== null)
  return h.host.querySelector<HTMLElement>('.reader__body')!
}

describe('YAZ-5566: the vault Text size and default line', () => {
  it('text-formatting.json › text.size is --text-size on the reader (the page\'s size); the line\'s darkness, thickness and pattern too', async () => {
    const body = await openPage('Sections', SECTIONS, { '.yaseendocs/text-formatting.json': JSON.stringify({ version: 2, text: { size: 19 }, line: { darkness: 20, thickness: 1, pattern: 'dashed' } }) })
    const reader = body.closest<HTMLElement>('.reader')!
    expect(reader.style.getPropertyValue('--text-size')).toBe('19px')
    expect(reader.style.getPropertyValue('--line-default-darkness')).toBe('20%')
    expect(reader.style.getPropertyValue('--line-default-thickness')).toBe('1px')
    expect(reader.style.getPropertyValue('--line-default-pattern')).toBe('dashed')
    expect(css).toMatch(/\.reader__body \{\s*--page-line:[^}]*font-size: var\(--text-size, 16px\);/)
  })

  it('no file: no variable, so the page is 16px and the line the Mac\'s app default (50%, 3px, solid)', async () => {
    const body = await openPage('Sections', SECTIONS)
    expect(body.closest<HTMLElement>('.reader')!.getAttribute('style') ?? '').toBe('')
    const hr = rule('.reader__body hr')
    expect(hr).toMatch(/--line-thick: var\(--line-default-thickness, 3px\)/)
    expect(hr).toMatch(/--line-color: color-mix\(in srgb, var\(--fg\) var\(--line-default-darkness, 50%\), transparent\)/)
    expect(hr).toMatch(/height: calc\(12px \+ var\(--line-thick\)\)/)
    expect(css).toMatch(/@container style\(--line-default-pattern: dashed\) \{\s*\.reader__body hr \{[^}]*calc\(5 \* var\(--line-thick\)\)/)
    expect(css).toMatch(/@container style\(--line-default-pattern: dotted\) \{\s*\.reader__body hr \{[^}]*calc\(2 \* var\(--line-thick\)\)/)
  })

  it('a card set to Same as pages follows the Text size: in the page (it inherits), alone (the card view), and in Review (readCardLook)', async () => {
    expect(rule('.card.card-view__card')).toMatch(/font-size: var\(--card-text-size, var\(--text-size, 16px\)\)/)
    const card = readFileSync(here('../../../client/src/editor/card/card.css'), 'utf8')
    expect(card).toMatch(/\.card \{[^}]*font-size: var\(--card-text-size, 1em\)/)
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, { ...READER_FILES, '.yaseendocs/text-formatting.json': JSON.stringify({ version: 2, text: { size: 18 } }), '.yaseendocs/card-look.json': JSON.stringify({ version: 1, textSize: 20 }) })
    const look = await readCardLook(phone.store, 'yaseen/vault@main')
    expect([look['--text-size'], look['--card-text-size']]).toEqual(['18px', '20px'])
    const none = await newPhone()
    await seedReaderVault(none.store, none.tokens, READER_FILES)
    expect((await readCardLook(none.store, 'yaseen/vault@main'))['--text-size']).toBeUndefined()
  })
})

describe('YAZ-5566: the page\'s own switches (frontmatter)', () => {
  it('reads them with the Mac\'s parser: only Guide lines off and Section indent on change the reader', () => {
    expect(pageSwitchAttrs('---\nsection-indent: true\nguide-lines: false\n---\nText')).toEqual({ 'data-guide-lines': 'off', 'data-section-indent': 'true' })
    expect(pageSwitchAttrs('---\nsection-indent: false\nguide-lines: true\ntoc: false\nbullet-threading: true\n---\nText')).toEqual({})
    expect(pageSwitchAttrs('Text with no frontmatter')).toEqual({})
    expect(pageSwitchAttrs('---\nsection-indent: yes\n---\n')).toEqual({})
  })

  it('section depths are the Mac\'s sectionDepths: by nesting, not by heading number; a skipped level is no extra step', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>top</p><h2>A</h2><p>a</p><h4>B</h4><p>b</p><h3>C</h3><p>c</p><h2>D</h2><ul><li>d</li></ul><h1>E</h1><p>e</p>'
    markSections(root, true)
    expect([...root.children].map((el) => el.getAttribute('data-sd'))).toEqual([null, null, '1', '1', '2', '1', '2', null, '1', null, '1'])
    markSections(root, false)
    expect(root.querySelector('[data-sd]')).toBeNull()
  })

  it('a page with section-indent: true and guide-lines: false: the body says so and its blocks carry their depths', async () => {
    const body = await openPage('Sections', `---\ntitle: Sections\nsection-indent: true\nguide-lines: false\n---\n${SECTIONS}`)
    expect([body.getAttribute('data-section-indent'), body.getAttribute('data-guide-lines')]).toEqual(['true', 'off'])
    const depth = (text: string) => [...body.children].find((el) => el.textContent?.trim().startsWith(text))?.getAttribute('data-sd') ?? null
    expect([depth('Intro'), depth('Travel'), depth('Line in travel'), depth('Pack'), depth('Deep'), depth('In deep'), depth('Three'), depth('In three'), depth('Food'), depth('In food')]).toEqual(['1', '1', '2', '2', '2', '3', '2', '3', '1', '2'])
    // The page's H1 opens a section too (all six levels do, as on the Mac), and stands at the edge.
    expect(body.querySelector('h1')!.hasAttribute('data-sd')).toBe(false)
  })

  it('a page with none: no switch, no depth (the Mac\'s defaults: guide lines on, no section indent)', async () => {
    const body = await openPage('Sections', SECTIONS)
    expect([body.getAttribute('data-section-indent'), body.getAttribute('data-guide-lines')]).toEqual([null, null])
    expect(body.querySelector('[data-sd]')).toBeNull()
  })

  it('the CSS: guide lines off takes the line away; section indent draws the Mac\'s steps and lines (18px on a phone, 30 wider)', () => {
    expect(rule(".reader__body[data-guide-lines='off'] li > :is(ul, ol)::before")).toMatch(/content: none/)
    const indent = rule('.reader__body[data-section-indent] > [data-sd]')
    expect(indent).toMatch(/border-left: calc\(var\(--sd\) \* var\(--step\)\) solid transparent/)
    expect(indent).toMatch(/border-image-slice: 0 0 0 calc\(var\(--sd\) \* var\(--section-step-n\)\)/)
    expect(indent).toMatch(/--section-line: color-mix\(in srgb, currentColor 14%, var\(--bg\)\)/)
    expect(indent).toMatch(/--section-step-n: 30/)
    expect(css).toMatch(/@container page \(max-width: 480px\) \{\s*\.reader__body\[data-section-indent\] > \[data-sd\] \{\s*--section-step-n: 18;/)
    for (const d of [1, 2, 3, 4, 5]) expect(css).toContain(`.reader__body[data-section-indent] > [data-sd='${d}'] { --sd: ${d}; }`)
    expect(rule('.reader__body[data-section-indent] > :is(h2, h3, h4, h5, h6)[data-sd]')).toMatch(/border-image-outset: calc\(var\(--page-gap\) \* 3\) 0 var\(--page-gap\)/)
  })
})
