// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOutlineFoldKey } from '@client/editor/outline/outlineFoldKeys'
import { escapeSameLineOrderedMarkers as macEscape } from '@client/editor/listItemRoundTrip'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { readFolds, writeFolds } from '../store/foldPref'
import { applyTask, taskLines, tickOf } from '../comments/taskWrite'
import { attachFolds, HIDDEN_ATTR, type PageFolds } from './folds'
import { pageTasks, readerText } from './pageMarked'
import { renderPage, type PageLook } from './pageRender'

/**
 * YAZ-5568 (numbered text, Yaseen's report on a day page): a bullet whose text starts `1) ` was drawn as a bullet with
 * an EMPTY line holding a numbered list (CommonMark reads `* 1) x` so), with its own fold arrow ("Fold bullet"); folded
 * (Collapse all, then the parent opened), only its square and its turned arrow were left: no text. The Mac reads
 * `* 1) x` / `* 1. x` as bullet TEXT (YAZ-1329, `escapeSameLineOrderedMarkers`); the phone now parses with that rule.
 * And the Mac counts a bullet's fold key without its `1) ` (`outlineFoldLabel`): `1) Fruit` and `2) Fruit` are two.
 * Open = every line's text shows; folded = the children are gone and the line stays. Made-up data only.
 */
const look: PageLook = {
  link: () => ({ label: 'link', open: null }),
  embed: (inner) => ({ kind: 'card', id: inner }),
  asset: () => null,
  card: () => document.createElement('div'),
}

/** The reported shape, made-up: `*` bullets two spaces deep, a loose parent, a parent with a link, `1) ` children. */
const DAY = [
  '# Day',
  'PLAN',
  [
    '* Morning',
    '  * 902am',
    '',
    '    * gym time now',
    '    * a little work first',
    '  * 934am - [[DEMO-40]] Reasons the app over the others',
    '    * 1) click into bullets (the old app had this but it was not smooth)',
    '    * 2) use the mouse to see the heading level',
    '    * 3) highlight colours the way i want',
    '    * 4) keys to expand and collapse (no toggles)',
    '  * 933am - quick work session',
    '    * ok so',
  ].join('\n'),
].join('\n\n')

async function drawn(text: string, initial?: readonly string[]): Promise<{ el: HTMLElement; folds: PageFolds }> {
  const el = document.createElement('div')
  document.body.append(el)
  await renderPage(text, look, el)
  const folds = attachFolds(el, { title: 'Day', initial })
  folds.apply()
  return { el, folds }
}
const arrows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.fold-btn')]
const labels = (el: HTMLElement) => arrows(el).map((b) => b.dataset.foldLabel)
const arrow = (el: HTMLElement, start: string) => arrows(el).find((b) => b.dataset.foldLabel!.startsWith(start))!
/** A bullet's own line: its words without its children and its arrow. */
const own = (li: Element) =>
  [...li.childNodes]
    .filter((n) => !(n instanceof Element && n.matches('ul, ol, .fold-btn')))
    .map((n) => n.textContent)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
const item = (el: HTMLElement, start: string) => [...el.querySelectorAll('li')].find((li) => own(li).startsWith(start)) ?? null
const shown = (el: Element | null) => el !== null && el.closest(`[${HIDDEN_ATTR}]`) === null
/** Every bullet's line has words (no empty line holding a list), and each of `starts` is a line that shows. */
function allTextShows(el: HTMLElement, starts: readonly string[]): void {
  for (const li of el.querySelectorAll('li')) expect(own(li), `a bullet with no words: ${li.outerHTML.slice(0, 120)}`).not.toBe('')
  for (const s of starts) {
    expect(item(el, s), `"${s}" is a line`).not.toBeNull()
    expect(shown(item(el, s)), `"${s}" shows`).toBe(true)
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('YAZ-5568: the reported page (bullets whose text starts "1) ")', () => {
  const FOUR = ['1) click into bullets', '2) use the mouse', '3) highlight colours', '4) keys to expand']

  it('reproduces the report before the fix: CommonMark alone reads each line as an empty bullet holding a numbered list', async () => {
    const { pageMarked } = await import('./pageMarked')
    const raw = pageMarked.parse('* 934am\n  * 1) click\n  * 2) use\n') as string
    expect(raw).toMatch(/<li>\s*<ol>/)
    // The Mac's rule, the phone's parse: bullet text.
    expect(pageMarked.parse(readerText('* 934am\n  * 1) click\n  * 2) use\n')) as string).not.toMatch(/<ol/)
  })

  it('open: each "1) " line is a bullet with its own words, no numbered list, no arrow of its own', async () => {
    const { el } = await drawn(DAY)
    expect(el.querySelectorAll('ol')).toHaveLength(0)
    allTextShows(el, [...FOUR, '934am', '933am', 'gym time now'])
    expect(labels(el)).toEqual(['Morning', '902am', '934am - link Reasons the app over the others', '933am - quick work session'])
    expect(labels(el)).not.toContain('bullet')
    // The four are bullets (`ul > li`) one level under the parent, as on the Mac.
    for (const s of FOUR) expect(item(el, s)!.parentElement!.closest('li')).toBe(item(el, '934am'))
    expect(item(el, '1) click')!.parentElement!.tagName).toBe('UL')
  })

  it('folded: the four lines are gone, the parent line and its link stay, the siblings show', async () => {
    const { el } = await drawn(DAY)
    arrow(el, '934am').click()
    expect(arrow(el, '934am').getAttribute('aria-expanded')).toBe('false')
    for (const s of FOUR) expect(shown(item(el, s))).toBe(false)
    expect(shown(item(el, '934am'))).toBe(true)
    expect(item(el, '934am')!.querySelector('.wikilink')).not.toBeNull()
    expect(shown(item(el, '933am'))).toBe(true)
    expect(shown(item(el, 'ok so'))).toBe(true)
    arrow(el, '934am').click()
    allTextShows(el, FOUR)
  })

  it('Collapse all, then the parent opened: the four lines show whole (the reported state: squares, no text)', async () => {
    const { el, folds } = await drawn(DAY)
    folds.setAll(true)
    for (const s of FOUR) expect(shown(item(el, s))).toBe(false)
    arrow(el, 'Morning').click()
    arrow(el, '934am').click()
    allTextShows(el, FOUR)
    folds.setAll(false)
    expect(el.querySelectorAll(`[${HIDDEN_ATTR}]`)).toHaveLength(0)
    allTextShows(el, [...FOUR, 'gym time now', 'ok so'])
  })

  it('the parent\'s key is the Mac\'s (its link as its words)', async () => {
    const { el } = await drawn(DAY)
    expect(arrow(el, '934am').dataset.foldKey).toBe(getOutlineFoldKey('934am - link Reasons the app over the others', 0))
  })
})

describe('YAZ-5568: lines that start with a number or a letter', () => {
  const STARTS = ['1) one', '1. dot', '(1) brackets', 'a) letter', 'i. roman', '10) ten']

  it.each(STARTS)('"* %s" with children: its words show, it folds its children only', async (start) => {
    const { el } = await drawn(`# Day\n\n* ${start}\n  * kid of ${start}\n* after\n`)
    expect(el.querySelectorAll('ol')).toHaveLength(0)
    allTextShows(el, [start, `kid of ${start}`, 'after'])
    expect(labels(el)).toEqual([start])
    arrow(el, start).click()
    expect(shown(item(el, start))).toBe(true)
    expect(shown(item(el, `kid of ${start}`))).toBe(false)
    expect(shown(item(el, 'after'))).toBe(true)
  })

  it.each(STARTS)('"* %s" as a leaf under a parent: bullet text, no arrow', async (start) => {
    const { el } = await drawn(`# Day\n\n* parent\n  * ${start}\n  * ${start} again\n`)
    expect(el.querySelectorAll('ol')).toHaveLength(0)
    allTextShows(el, [start, `${start} again`])
    expect(labels(el)).toEqual(['parent'])
  })

  it('the phone escapes what the Mac escapes (outside code fences too), and a number after a task\'s box', () => {
    const text = ['* 1) a', '- 2. b', '+ 10) c', '\t* 3) d', '    * 4. e', '* (1) f', '* a) g', '1. real', '1) real', '```', '* 1) code', '* [ ] 1) code task', '```', '* 1)', '* 1.5 kg'].join('\n')
    expect(readerText(text)).toBe(macEscape(text))
    expect(readerText('- [ ] 1) a\n1. [x] 2. b\n* [ ] (1) c\n* [ ] 1.5 kg')).toBe('- [ ] 1\\) a\n1. [x] 2\\. b\n* [ ] (1) c\n* [ ] 1.5 kg')
    expect(readerText(text).split('\n')).toHaveLength(text.split('\n').length)
  })

  it('"1) Fruit" and "2) Fruit" parents: two keys, the Mac\'s (counted without the "1) ")', async () => {
    const { el } = await drawn('# Day\n\n* 1) Fruit\n  * pears\n* 2) Fruit\n  * figs\n* Fruit\n  * plums\n')
    expect(arrows(el).map((b) => b.dataset.foldKey)).toEqual([getOutlineFoldKey('1) Fruit', 0), getOutlineFoldKey('2) Fruit', 1), getOutlineFoldKey('Fruit', 2)])
    expect(new Set(arrows(el).map((b) => b.dataset.foldKey)).size).toBe(3)
    arrow(el, '2) Fruit').click()
    expect(shown(item(el, 'pears'))).toBe(true)
    expect(shown(item(el, 'figs'))).toBe(false)
    expect(shown(item(el, 'plums'))).toBe(true)
  })
})

describe('YAZ-5568: real numbered lists and bullets together', () => {
  it('a numbered list (1. and 1)) under a bullet stays numbered; the bullet folds it', async () => {
    for (const d of ['.', ')']) {
      const { el } = await drawn(`# Day\n\n* parent\n  1${d} one\n  2${d} two\n* next\n`)
      expect(el.querySelectorAll('ol')).toHaveLength(1)
      expect(el.querySelectorAll('ol > li')).toHaveLength(2)
      allTextShows(el, ['parent', 'one', 'two', 'next'])
      arrow(el, 'parent').click()
      expect(shown(item(el, 'one'))).toBe(false)
      expect(shown(item(el, 'next'))).toBe(true)
      document.body.replaceChildren()
    }
  })

  it('bullets under a numbered item; a "1) " bullet under a numbered item is text', async () => {
    const { el } = await drawn('# Day\n\n1. first\n   * kid\n   * 1) numbered words\n2. second\n')
    expect(el.querySelectorAll('ol')).toHaveLength(1)
    allTextShows(el, ['first', 'kid', '1) numbered words', 'second'])
    expect(labels(el)).toEqual(['first'])
    arrow(el, 'first').click()
    expect(shown(item(el, 'kid'))).toBe(false)
    expect(shown(item(el, '1) numbered words'))).toBe(false)
    expect(shown(item(el, 'second'))).toBe(true)
  })
})

describe('YAZ-5568: markers, indents, tasks, links, depth', () => {
  it('`*`, `-` and `+` bullets each fold their own children', async () => {
    const { el } = await drawn('# Day\n\n* star\n  * 1) star kid\n- dash\n  - 2) dash kid\n+ plus\n  + 3) plus kid\n')
    allTextShows(el, ['star', 'dash', 'plus', '1) star kid', '2) dash kid', '3) plus kid'])
    expect(labels(el)).toEqual(['star', 'dash', 'plus'])
    arrow(el, 'dash').click()
    expect(shown(item(el, '1) star kid'))).toBe(true)
    expect(shown(item(el, '2) dash kid'))).toBe(false)
    expect(shown(item(el, '3) plus kid'))).toBe(true)
  })

  it.each([
    ['a tab', '\t'],
    ['two spaces', '  '],
    ['four spaces', '    '],
  ])('children indented with %s', async (_, pad) => {
    const { el } = await drawn(`# Day\n\n* parent\n${pad}* 1) one\n${pad}* 2) two\n${pad}${pad}* 3) deeper\n* next\n`)
    expect(el.querySelectorAll('ol, pre')).toHaveLength(0)
    allTextShows(el, ['parent', '1) one', '2) two', '3) deeper', 'next'])
    expect(labels(el)).toEqual(['parent', '2) two'])
    arrow(el, 'parent').click()
    for (const s of ['1) one', '2) two', '3) deeper']) expect(shown(item(el, s))).toBe(false)
    expect(shown(item(el, 'next'))).toBe(true)
  })

  it('a task with children folds them; its box stays; "* [ ] 1) x" is a task whose text starts "1)"; "* 1) [ ] x" is text, as on the Mac', async () => {
    const text = '# Day\n\n* [ ] pack\n  * 1) the tent\n  * 2) the stove\n* [ ] 1) numbered task\n* 1) [ ] not a task\n'
    const { el } = await drawn(text)
    const boxes = el.querySelectorAll('.page-task')
    expect(boxes).toHaveLength(2)
    allTextShows(el, ['pack', '1) the tent', '2) the stove', '1) numbered task', '1) [ ] not a task'])
    arrow(el, 'pack').click()
    expect(shown(item(el, '1) the tent'))).toBe(false)
    expect(shown(item(el, 'pack')!.querySelector('.page-task'))).toBe(true)
    // The tick reads the same parse: the same two tasks, on their lines.
    expect(pageTasks(text.slice('# Day\n\n'.length)).map((t) => t.line)).toEqual([0, 3])
  })

  it('a tick on "* [ ] 1) x" changes the one byte in its box; the file keeps "1)" as written', () => {
    const content = '---\ntitle: Day\n---\n\n# Day\n\n* [ ] 1) numbered task\n  * 1) kid\n* [ ] 2. second\n'
    const tasks = taskLines(content)
    expect(tasks.map((t) => t.line)).toEqual([3, 5])
    const r = applyTask(content, tickOf(content, tasks[0]!.core, 0, true))
    expect(r).toEqual({ kind: 'ticked', content: content.replace('* [ ] 1) numbered', '* [x] 1) numbered') })
  })

  it('a parent with a link pill and a #journal tag folds its "1) " children', async () => {
    const { el } = await drawn('# Day\n\n* 934am - [[DEMO-40]] Reasons #journal\n  * 1) first\n  * 2) second\n')
    allTextShows(el, ['934am', '1) first', '2) second'])
    expect(item(el, '934am')!.textContent).toContain('#journal')
    arrow(el, '934am').click()
    expect(shown(item(el, '1) first'))).toBe(false)
  })

  it('five levels deep: each parent folds what is under it, every line has its words', async () => {
    const { el } = await drawn('# Day\n\n* one\n  * 1) two\n    * 2) three\n      * 3) four\n        * 4) five\n          * 5) six\n')
    allTextShows(el, ['one', '1) two', '2) three', '3) four', '4) five', '5) six'])
    expect(labels(el)).toEqual(['one', '1) two', '2) three', '3) four', '4) five'])
    // Every level is a bullet list (squares and circles as on the Mac), none a numbered list.
    expect(el.querySelectorAll('ol')).toHaveLength(0)
    expect(item(el, '5) six')!.closest('ul')!.parentElement!.closest('ul')).not.toBeNull()
    arrow(el, '2) three').click()
    expect(shown(item(el, '2) three'))).toBe(true)
    for (const s of ['3) four', '4) five', '5) six']) expect(shown(item(el, s))).toBe(false)
  })

  it('a fold at the last bullet of the page (no line end after it)', async () => {
    const { el } = await drawn('# Day\n\nText.\n\n* last\n  * 1) the end')
    allTextShows(el, ['last', '1) the end'])
    arrow(el, 'last').click()
    expect(shown(item(el, '1) the end'))).toBe(false)
    expect(shown(item(el, 'last'))).toBe(true)
  })

  it('a heading inside a list does not fold; the bullet around it does', async () => {
    const { el } = await drawn('# Day\n\n* parent\n\n  ## In a list\n\n  * 1) kid\n* next\n')
    allTextShows(el, ['parent', '1) kid', 'next'])
    expect(labels(el)).toEqual(['parent'])
    arrow(el, 'parent').click()
    expect(shown(el.querySelector('li h2'))).toBe(false)
    expect(shown(item(el, '1) kid'))).toBe(false)
  })

  it('folds kept and given back (as after a reload): the same lines folded, the rest whole', async () => {
    const first = await drawn(DAY)
    arrow(first.el, '934am').click()
    const kept = first.folds.folded()
    expect(kept).toEqual([getOutlineFoldKey('934am - link Reasons the app over the others', 0)])
    document.body.replaceChildren()
    const { el } = await drawn(DAY, kept)
    expect(arrow(el, '934am').getAttribute('aria-expanded')).toBe('false')
    expect(shown(item(el, '1) click'))).toBe(false)
    allTextShows(el, ['902am', 'gym time now', '933am', 'ok so'])
  })
})

describe('YAZ-5568: a long page in slices', () => {
  it('"1) " children after a slice\'s cut: the same lines, keys and folds as the page drawn whole', async () => {
    const block = (i: number) => `* ${i}am - [[DEMO-${i}]] Part ${i}\n  * 1) first of ${i}\n  * 2) second of ${i}\n\n${'A line of made-up notes. '.repeat(12)}`
    const text = `# Day\n\n${Array.from({ length: 300 }, (_, i) => block(i)).join('\n\n')}`
    expect(text.length).toBeGreaterThan(64_000)
    const whole = document.createElement('div')
    await renderPage(text, look, whole)
    attachFolds(whole, { title: 'Day' }).apply()
    const sliced = document.createElement('div')
    document.body.append(sliced)
    const kept = [getOutlineFoldKey('299am - link Part 299', 0)]
    const folds = attachFolds(sliced, { title: 'Day', initial: kept })
    let slices = 0
    await renderPage(text, look, sliced, async () => {
      slices++
      folds.scan()
    })
    folds.apply()
    expect(slices).toBeGreaterThan(5)
    expect(sliced.querySelectorAll('ol')).toHaveLength(0)
    expect(arrows(sliced).map((b) => b.dataset.foldKey)).toEqual(arrows(whole).map((b) => b.dataset.foldKey))
    expect(arrows(sliced)).toHaveLength(300)
    expect(shown(item(sliced, '1) first of 299'))).toBe(false)
    expect(shown(item(sliced, '1) first of 298'))).toBe(true)
    expect(shown(item(sliced, '2) second of 150'))).toBe(true)
  }, 30000)

  it('a parent whose children are loose (blank lines) across a cut keeps them all as its children', async () => {
    const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}. ${'Made-up words to fill the page. '.repeat(20)}`).join('\n\n')
    const kids = Array.from({ length: 40 }, (_, i) => `  * ${i + 1}) kid ${i + 1} ${'more words '.repeat(30)}`).join('\n\n')
    const text = `# Day\n\n${filler}\n\n* parent\n\n${kids}\n\n* after\n`
    const whole = document.createElement('div')
    await renderPage(text, look, whole)
    const sliced = document.createElement('div')
    document.body.append(sliced)
    const folds = attachFolds(sliced, { title: 'Day' })
    await renderPage(text, look, sliced, async () => folds.scan())
    folds.apply()
    expect(sliced.querySelectorAll('ol, pre')).toHaveLength(0)
    for (let i = 1; i <= 40; i++) expect(item(sliced, `${i}) kid ${i}`), `kid ${i}`).not.toBeNull()
    arrow(sliced, 'parent').click()
    for (let i = 1; i <= 40; i++) expect(shown(item(sliced, `${i}) kid ${i}`)), `kid ${i} folded`).toBe(false)
    expect(shown(item(sliced, 'after'))).toBe(true)
  }, 30000)
})

/* ---------------------------------------------------------------- the page view ---------------------------------- */

const page = (props: string, body: string) => `---\n${props}---\n\n${body}\n`
const DAY_BODY = DAY.replace('# Day\n\nPLAN', '# Day notes\n\n## Plan')
const FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  'Day notes.md': page('title: Day notes\nfolding: true\n', DAY_BODY),
  'Day off.md': page('title: Day off\nfolding: false\n', DAY_BODY.replace('# Day notes', '# Day off')),
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
  await waitFor(x, () => x.host.querySelector('.reader__body li') !== null)
  return x
}
const body = (x: Harness) => x.host.querySelector<HTMLElement>('.reader__body')!
const PARENT = '934am - Capital of Spain Reasons the app over the others'

describe('YAZ-5568: the reported page on the page view', () => {
  it('folded, kept on this phone, and folded again after the app opens again; the file is as it was', async () => {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, FILES)
    h = await openPage('Day notes', phone)
    allTextShows(body(h), ['1) click into bullets', '4) keys to expand'])
    await h.click(`Fold ${PARENT}`)
    expect(shown(item(body(h), '1) click'))).toBe(false)
    expect(readFolds(READER_ID, 'Day notes.md')).toEqual([getOutlineFoldKey(PARENT, 0)])
    expect((await phone.store.read(READER_ID, 'Day notes.md'))?.content).toBe(FILES['Day notes.md'])
    h.unmount()
    h = await openPage('Day notes', phone)
    expect(h.button(`Unfold ${PARENT}`)?.getAttribute('aria-expanded')).toBe('false')
    expect(shown(item(body(h), '1) click'))).toBe(false)
    expect(shown(item(body(h), '933am'))).toBe(true)
    await h.click(`Unfold ${PARENT}`)
    allTextShows(body(h), ['1) click into bullets', '2) use the mouse', '3) highlight colours', '4) keys to expand'])
  })

  it('⋯ → Collapse all, the parents opened one by one: every line whole; ⋯ → Expand all: nothing hidden', async () => {
    h = await openPage('Day notes')
    await h.click('Page tools')
    await h.click(/Collapse all/)
    expect(shown(item(body(h), '1) click'))).toBe(false)
    await h.click('Unfold Plan')
    await h.click('Unfold Morning')
    await h.click(`Unfold ${PARENT}`)
    allTextShows(body(h), ['1) click into bullets', '4) keys to expand'])
    await h.click('Page tools')
    await h.click(/Collapse all/)
    await h.click('Page tools')
    await h.click(/Expand all/)
    expect(body(h).querySelectorAll(`[${HIDDEN_ATTR}]`)).toHaveLength(0)
    allTextShows(body(h), ['1) click into bullets', 'gym time now', 'ok so'])
  })

  it('`folding: false`: no arrows, every line whole, still bullet text', async () => {
    writeFolds(READER_ID, 'Day off.md', [getOutlineFoldKey(PARENT, 0)])
    h = await openPage('Day off')
    expect(body(h).querySelectorAll('.fold-btn')).toHaveLength(0)
    expect(body(h).querySelectorAll(`[${HIDDEN_ATTR}]`)).toHaveLength(0)
    expect(body(h).querySelectorAll('ol')).toHaveLength(0)
    allTextShows(body(h), ['1) click into bullets', '4) keys to expand', '933am'])
  })
})
