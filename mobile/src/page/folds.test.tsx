// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getHeadingFoldKey } from '@client/editor/outline/headingFolding'
import { getOutlineFoldKey } from '@client/editor/outline/outlineFoldKeys'
import { READER_FILES, READER_ID, cardBlock, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { readFolds, writeFolds } from '../store/foldPref'
import { attachFolds, HIDDEN_ATTR, revealFolds } from './folds'
import { renderPage, type PageLook } from './pageRender'

/**
 * YAZ-5568: folding on the phone, the Mac's rules (`headingFolding.ts`, `outlineFolding.ts`), option A: an arrow on
 * every heading H1 to H3 with text under it and every bullet with children; folds kept on this phone (vault + path),
 * never in the file; Collapse all / Expand all in ⋯; `folding: false`; Find (`find-folds`) and links open the folds that
 * hide their target; cards hide with their section; long pages in slices; VoiceOver's button names. Made-up data only.
 */
const look: PageLook = {
  link: () => ({ label: 'link', open: null }),
  embed: (inner) => ({ kind: 'card', id: inner }),
  asset: () => null,
  card: () => document.createElement('div'),
}

const GARDEN = [
  '# Garden plan',
  'What goes where this spring.',
  '## Beds',
  ['- North bed', '    - Tomatoes', '- South bed', '    - Beans', '        - Two rows', '- Herb pots'].join('\n'),
  '## Watering',
  'Water early.',
  '![[DEMO-40]]',
  '#### Hoses',
  'The long one.',
  '### Cans',
  'Two cans.',
  '## Jobs',
  ['- [ ] Dig the beds', '    - [ ] North bed first', '- [x] Buy compost'].join('\n'),
  '## Empty',
  '## Costs',
  'Seeds 18.',
  '- A list with a heading\n\n  ## In a list\n\n  text',
].join('\n\n')

async function drawn(text = GARDEN, title = 'Garden plan'): Promise<HTMLElement> {
  const el = document.createElement('div')
  document.body.append(el)
  await renderPage(text, look, el)
  attachFolds(el, { title }).apply()
  return el
}
const arrows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.fold-btn')]
const arrow = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`.fold-btn[data-fold-label="${label}"]`)!
const shown = (el: Element | null) => el !== null && el.closest(`[${HIDDEN_ATTR}]`) === null
/** A block by its own first words (a bullet by its line, not its children). */
const own = (e: Element) => (e.tagName === 'LI' ? ([...e.childNodes].find((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')?.textContent ?? '') : (e.textContent ?? '')).trim()
const byText = (el: HTMLElement, words: string) => [...el.querySelectorAll<HTMLElement>('h1, h2, h3, h4, p, li')].find((e) => own(e).startsWith(words))!

afterEach(() => {
  document.body.replaceChildren()
})

describe('YAZ-5568: what folds (the Mac\'s rules)', () => {
  it('H1 to H3 with text under them and bullets with children have an arrow; the title, H4, an empty heading, a leaf, a bullet with only text under it and a heading in a list do not', async () => {
    const el = await drawn()
    expect(arrows(el).map((b) => b.dataset.foldLabel)).toEqual(['Beds', 'North bed', 'South bed', 'Beans', 'Watering', 'Cans', 'Jobs', 'Dig the beds', 'Costs'])
    // The Mac's keys: `h:<hash>:<n>` for a heading, `<hash>:<n>` for a bullet.
    expect(arrow(el, 'Beds').dataset.foldKey).toBe(getHeadingFoldKey('Beds', 0))
    expect(arrow(el, 'South bed').dataset.foldKey).toBe(getOutlineFoldKey('South bed', 0))
  })

  it('a heading hides its section to the next heading of the same or a higher level; a bullet hides only its children', async () => {
    const el = await drawn()
    act(() => arrow(el, 'Watering').click())
    expect(shown(byText(el, 'Water early'))).toBe(false)
    expect(shown(byText(el, 'Hoses'))).toBe(false)
    expect(shown(byText(el, 'Two cans'))).toBe(false)
    expect(shown(byText(el, 'Jobs'))).toBe(true)
    expect(shown(byText(el, 'Watering'))).toBe(true)
    // The card embed in the folded section hides with it.
    expect(shown(el.querySelector('[data-card-embed="DEMO-40"]'))).toBe(false)
    act(() => arrow(el, 'Watering').click())
    expect(shown(byText(el, 'Water early'))).toBe(true)
    act(() => arrow(el, 'South bed').click())
    expect(shown(byText(el, 'Beans'))).toBe(false)
    expect(shown(byText(el, 'South bed'))).toBe(true)
    expect(shown(byText(el, 'Herb pots'))).toBe(true)
    expect(shown(byText(el, 'Tomatoes'))).toBe(true)
  })

  it('a parent task folds; its box stays, and the arrow is not a tap on the box (no tick)', async () => {
    const el = await drawn()
    const task = arrow(el, 'Dig the beds')
    const li = task.closest('li')!
    // The box stays the item's first child (the reader's CSS finds it there); the arrow is between the line and the children.
    expect(li.firstElementChild?.classList.contains('page-task')).toBe(true)
    expect(task.nextElementSibling?.tagName).toBe('UL')
    act(() => task.click())
    expect(shown(byText(el, 'North bed first'))).toBe(false)
  })

  it('VoiceOver: each arrow is a real button with aria-expanded and "Fold <line>" / "Unfold <line>"; no count', async () => {
    const el = await drawn()
    const b = arrow(el, 'Watering')
    expect(b.tagName).toBe('BUTTON')
    expect(b.type).toBe('button')
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect(b.getAttribute('aria-label')).toBe('Fold Watering')
    act(() => b.click())
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect(b.getAttribute('aria-label')).toBe('Unfold Watering')
    expect(b.textContent).toBe('')
    expect(b.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    // The heading's words are its own: Find, the Headings list and a link still read "Watering".
    expect(byText(el, 'Watering').textContent).toBe('Watering')
  })

  it('a tap on an arrow is the arrow\'s: no link, no tap of the page around it', async () => {
    const el = await drawn()
    const page = vi.fn()
    el.parentElement!.addEventListener('click', page)
    act(() => arrow(el, 'Beds').click())
    expect(page).not.toHaveBeenCalled()
  })

  it('Collapse all folds every heading and bullet, then Expand all opens them (the Mac\'s fold-all rule)', async () => {
    const el = await drawn()
    const folds = attachFolds(el, { title: 'Garden plan' })
    expect(folds.next()).toBe('collapse')
    act(() => folds.setAll(true))
    expect(arrows(el).every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(folds.next()).toBe('expand')
    expect([...el.children].filter((c) => shown(c)).map((c) => c.tagName + ':' + c.textContent)).toEqual(['H1:Garden plan', 'P:What goes where this spring.', 'H2:Beds', 'H2:Watering', 'H2:Jobs', 'H2:Empty', 'H2:Costs'])
    act(() => folds.setAll(false))
    expect(el.querySelectorAll(`[${HIDDEN_ATTR}]`)).toHaveLength(0)
  })

  it('reveal opens the folds that hide a node (and keeps them); peek opens them for a while', async () => {
    const el = await drawn()
    const folds = attachFolds(el, { title: 'Garden plan' })
    act(() => folds.setAll(true))
    const two = byText(el, 'Two rows')
    folds.peek([two])
    expect(shown(two)).toBe(true)
    folds.peek([])
    expect(shown(two)).toBe(false)
    revealFolds(two)
    expect(shown(two)).toBe(true)
    expect(arrow(el, 'Beds').getAttribute('aria-expanded')).toBe('true')
    expect(arrow(el, 'Beans').getAttribute('aria-expanded')).toBe('true')
    // The folds that do not hide it stay.
    expect(arrow(el, 'North bed').getAttribute('aria-expanded')).toBe('false')
    expect(arrow(el, 'Watering').getAttribute('aria-expanded')).toBe('false')
  })

  it('a card\'s own text does not fold', async () => {
    const el = document.createElement('div')
    await renderPage(['## Notes', cardBlock('DEMO-9', '## In a card\n\nText\n\n- a\n    - b').replace('```card', '```card')].join('\n\n'), { ...look, card: (t) => {
      const d = document.createElement('div')
      d.innerHTML = '<h2>In a card</h2><ul><li>a<ul><li>b</li></ul></li></ul>'
      void t
      return d
    } }, el)
    attachFolds(el).apply()
    expect(arrows(el).map((b) => b.dataset.foldLabel)).toEqual(['Notes'])
  })
})

describe('YAZ-5568: a long page drawn in slices', () => {
  it('each slice gets its arrows and its folds; a section that runs across slices hides whole; the keys are those of the whole page', async () => {
    const text = `# Long\n\n${Array.from({ length: 300 }, (_, i) => `## Part ${i % 150}\n\n${'A line of made-up notes. '.repeat(10)}\n\n- Item ${i}\n    - Child ${i}`).join('\n\n')}`
    expect(text.length).toBeGreaterThan(64_000)
    const whole = document.createElement('div')
    await renderPage(text, look, whole)
    attachFolds(whole, { title: 'Long' }).apply()
    const sliced = document.createElement('div')
    // Part 3 (its second one, occurrence 1) and Item 299 were folded before.
    const kept = [getHeadingFoldKey('Part 3', 1), getOutlineFoldKey('Item 299', 0)]
    const folds = attachFolds(sliced, { title: 'Long', initial: kept })
    let slices = 0
    await renderPage(text, look, sliced, async () => {
      slices++
      folds.scan()
    })
    folds.apply()
    expect(slices).toBeGreaterThan(5)
    expect(arrows(sliced).map((b) => b.dataset.foldKey)).toEqual(arrows(whole).map((b) => b.dataset.foldKey))
    const heading = [...sliced.querySelectorAll('h2')].filter((h) => h.textContent === 'Part 3')[1]!
    expect(heading.querySelector('.fold-btn')?.getAttribute('aria-expanded')).toBe('false')
    // Its section, to the next H2, is hidden; the heading and the next part show.
    let next = heading.nextElementSibling!
    for (; next.tagName !== 'H2'; next = next.nextElementSibling!) expect(next.hasAttribute(HIDDEN_ATTR)).toBe(true)
    expect(shown(heading)).toBe(true)
    expect(shown(next)).toBe(true)
    expect(shown(byText(sliced, 'Child 299'))).toBe(false)
    expect(shown(byText(sliced, 'Child 298'))).toBe(true)
  })
})

/* ---------------------------------------------------------------- the page view ---------------------------------- */

const page = (props: string, body: string) => `---\n${props}---\n\n${body}\n`
const FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  'Garden.md': page('title: Garden\n', ['# Garden', 'Intro.', '## Beds', '- North bed\n    - Tomatoes', '## Watering', 'Water the far corner early.', '### Hoses', 'The long hose.', '## Links', 'Go to [the hoses](#hoses).'].join('\n\n')),
  'No folds.md': page('title: No folds\nfolding: false\n', ['# No folds', '## Beds', '- North bed\n    - Tomatoes'].join('\n\n')),
  'Keep find.md': page('title: Keep find\nfind-folds: keep\n', ['# Keep find', '## Beds', 'A far corner.', '## Watering', 'The far corner.'].join('\n\n')),
  'All find.md': page('title: All find\nfind-folds: all\n', ['# All find', '## Beds', 'A far corner.', '## Watering', 'The far corner.'].join('\n\n')),
}

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  HTMLElement.prototype.animate = (() => ({}) as Animation) as unknown as typeof HTMLElement.prototype.animate
  for (const path of Object.keys(FILES)) writeFolds(READER_ID, path, [])
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text().slice(0, 300)}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function openPage(name: string, phone?: Awaited<ReturnType<typeof newPhone>>): Promise<Harness> {
  const p = phone ?? (await newPhone())
  if (phone === undefined) await seedReaderVault(p.store, p.tokens, FILES)
  const x = await mount({ phone: p })
  await x.click('Search')
  await waitFor(x, () => x.button(new RegExp(`^${name}, page`)) !== null)
  await x.click(new RegExp(`^${name}, page`))
  await waitFor(x, () => x.host.querySelector('.reader__body h2') !== null)
  return x
}
const body = (x: Harness) => x.host.querySelector<HTMLElement>('.reader__body')!
const words = (x: Harness, text: string) => [...body(x).querySelectorAll('p, li, h2, h3')].find((e) => e.textContent?.trim().startsWith(text)) ?? null
async function find(x: Harness, value: string): Promise<void> {
  await x.click('Page tools')
  await x.click(/Find in page/)
  await waitFor(x, () => x.host.querySelector('.find-line__input') !== null)
  const box = x.host.querySelector<HTMLInputElement>('.find-line__input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => void (await new Promise((r) => setTimeout(r, 120))))
}

describe('YAZ-5568: folds on the page view', () => {
  it('a fold is kept on this phone (vault + path), never in the file, and comes back after the app opens again', async () => {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, FILES)
    h = await openPage('Garden', phone)
    await h.click('Fold Watering')
    await h.click('Fold North bed')
    expect(shown(words(h, 'Water the far corner'))).toBe(false)
    expect(readFolds(READER_ID, 'Garden.md')).toEqual([getOutlineFoldKey('North bed', 0), getHeadingFoldKey('Watering', 0)].sort())
    // The page's file is as it was.
    expect((await phone.store.read(READER_ID, 'Garden.md'))?.content).toBe(FILES['Garden.md'])
    h.unmount()
    h = await openPage('Garden', phone)
    expect(h.button('Unfold Watering')?.getAttribute('aria-expanded')).toBe('false')
    expect(shown(words(h, 'Water the far corner'))).toBe(false)
    expect(shown(words(h, 'Tomatoes'))).toBe(false)
    expect(shown(words(h, 'The long hose'))).toBe(false)
  })

  it('⋯ → Collapse all, then ⋯ → Expand all (under Headings)', async () => {
    h = await openPage('Garden')
    await h.click('Page tools')
    const items = [...h.host.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent?.trim())
    expect(items).toEqual(['🔍 Find in page', '☰ Headings', 'Collapse all'])
    await h.click(/Collapse all/)
    expect(h.host.querySelector('.page-tools__menu')).toBeNull()
    expect([...body(h).querySelectorAll('.fold-btn')].every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true)
    await h.click('Page tools')
    await h.click(/Expand all/)
    expect(body(h).querySelectorAll(`[${HIDDEN_ATTR}]`)).toHaveLength(0)
  })

  it('`folding: false`: no arrows, nothing hidden, no Collapse all', async () => {
    writeFolds(READER_ID, 'No folds.md', [getHeadingFoldKey('Beds', 0)])
    h = await openPage('No folds')
    expect(body(h).querySelectorAll('.fold-btn')).toHaveLength(0)
    expect(body(h).querySelectorAll(`[${HIDDEN_ATTR}]`)).toHaveLength(0)
    await h.click('Page tools')
    expect(h.host.querySelector('.page-tools__menu')?.textContent).not.toMatch(/Collapse all|Expand all/)
  })

  it('a link to a heading in a folded part opens the folds that hide it, then lands', async () => {
    h = await openPage('Garden')
    await h.click('Fold Watering')
    expect(shown(words(h, 'Hoses'))).toBe(false)
    await act(async () => body(h!).querySelector<HTMLElement>('a[data-open="heading"]')!.click())
    expect(shown(words(h, 'Hoses'))).toBe(true)
    expect(h.button('Fold Watering')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('the Headings list lands on a heading in a folded part: its fold opens', async () => {
    h = await openPage('Garden')
    await h.click('Page tools')
    await h.click(/Collapse all/)
    await h.click('Page tools')
    await h.click(/Headings/)
    await waitFor(h, () => h!.host.querySelector('.headings-sheet__row') !== null)
    await h.click('Hoses')
    expect(shown(words(h, 'Hoses'))).toBe(true)
  })

  it('Find (`find-folds` absent: current) opens only the fold of the match it is on, and folds it again when Find closes', async () => {
    h = await openPage('Garden')
    await h.click('Page tools')
    await h.click(/Collapse all/)
    await find(h, 'far corner')
    expect(h.host.querySelector('.find-line__count')?.textContent).toBe('1 of 1')
    expect(shown(words(h, 'Water the far corner'))).toBe(true)
    expect(shown(words(h, 'The long hose'))).toBe(false)
    await h.click('Close find')
    expect(shown(words(h, 'Water the far corner'))).toBe(false)
    // The kept folds did not change.
    expect(h.button('Unfold Watering')).not.toBeNull()
  })

  it('`find-folds: keep` finds only what shows; `all` opens every fold that hides a match', async () => {
    h = await openPage('Keep find')
    await h.click('Fold Watering')
    await find(h, 'far corner')
    expect(h.host.querySelector('.find-line__count')?.textContent).toBe('1 of 1')
    expect(shown(words(h, 'The far corner'))).toBe(false)
    h.unmount()
    h = await openPage('All find')
    await h.click('Page tools')
    await h.click(/Collapse all/)
    await find(h, 'far corner')
    expect(h.host.querySelector('.find-line__count')?.textContent).toBe('1 of 2')
    expect(shown(words(h, 'A far corner'))).toBe(true)
    expect(shown(words(h, 'The far corner'))).toBe(true)
  })
})

describe('YAZ-5568: the look (jsdom has no layout: the rules are read from the CSS)', () => {
  const css = readFileSync(fileURLToPath(import.meta.url).replace(/folds\.test\.tsx$/, 'reader.css'), 'utf8')
  it('a hidden block is display: none; each arrow is a 44 px button, muted, turned right when folded', () => {
    expect(css).toMatch(/\.reader__body \[data-fold-hidden\] \{\s*display: none !important;/)
    expect(css).toMatch(/\.fold-btn \{[^}]*width: 44px;\s*height: 44px;[^}]*color: var\(--fg-muted\);/)
    expect(css).toMatch(/\.fold-btn\[aria-expanded='false'\] svg \{\s*transform: rotate\(-90deg\);/)
  })
})
