// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { NUMBERED_TASKS_PAGE } from '../dev/taskFixtures'
import { HAS_CHROME, inChrome } from './chromeLayout.testing'
import { renderPage, type PageLook } from './pageRender'

/**
 * YAZ-5510 (follow-up, Yaseen's call: match the Mac). In a numbered task list (`1. [ ] …`, `10. [ ] …`) only the box
 * shows, in the number's place (the Mac's Crepe `renderLabel` draws a task's box as the label, numbered or not): the
 * number is hidden, the box sits where a bullet task's box sits, the text where a numbered item's text is, and a line
 * that wraps starts under the text. The tap on the box's middle is the box, its tap area 44 px.
 * The page is drawn here (jsdom) and laid out in headless Chrome with the phone's stylesheets (`chromeLayout.testing.ts`).
 * Made-up tasks.
 */
const look: PageLook = {
  link: (inner) => ({ label: inner, open: { kind: 'page', path: `${inner}.md` } }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: () => document.createElement('div'),
}

const MEASURE = `(() => {
  const bullet = document.querySelector('.reader__body ul > li > .page-task, .reader__body ul > li > p:first-child > .page-task')
  return [...document.querySelectorAll('.reader__body ol > li')].flatMap((li) => {
    const box = li.querySelector(':scope > .page-task, :scope > p:first-child > .page-task')
    if (!box) return []
    const number = li.parentElement.start + [...li.parentElement.children].indexOf(li)
    const b = box.getBoundingClientRect()
    const text = document.createRange()
    text.selectNodeContents(li)
    const lines = [...text.getClientRects()].filter((r) => r.width > 0 && r.left >= b.right - 0.5)
    const style = getComputedStyle(li)
    const tap = getComputedStyle(box, '::before')
    return [{
      number,
      shown: getComputedStyle(li, '::marker').content !== 'none' && style.listStyleType !== 'none',
      listLeft: li.parentElement.getBoundingClientRect().left,
      textStart: li.getBoundingClientRect().left + parseFloat(style.paddingLeft),
      boxLeft: b.left,
      boxRight: b.right,
      bulletBoxLeft: bullet ? bullet.getBoundingClientRect().left : null,
      lineLefts: [...new Set(lines.map((r) => Math.round(r.left * 10) / 10))],
      lineTops: [...new Set(lines.map((r) => Math.round(r.top)))].length,
      hit: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === box,
      tap: [parseFloat(tap.width), parseFloat(tap.height)],
    }]
  })
})()`

type Item = { number: number; shown: boolean; listLeft: number; textStart: number; boxLeft: number; boxRight: number; bulletBoxLeft: number | null; lineLefts: number[]; lineTops: number; hit: boolean; tap: number[] }

describe("a numbered task: only its box, in the number's place (YAZ-5510, the Mac's rule)", () => {
  it.skipIf(!HAS_CHROME)('for 1., 2., 10. and 11.: no number; the box in the number column, where a bullet task\'s box is; the text, and its wrapped lines, after it', async () => {
    const page = document.createElement('article')
    page.className = 'reader'
    const body = document.createElement('div')
    body.className = 'reader__body'
    page.append(body)
    document.body.append(page)
    // A bullet task after the numbered ones: its box is where a numbered task's box goes.
    await renderPage(`${NUMBERED_TASKS_PAGE}\nAnd:\n\n- [ ] Rake the path\n`, look, body)
    for (const scheme of ['light', 'dark'] as const) {
      const items = await inChrome<Item[]>(page.outerHTML, MEASURE, { scheme })
      expect(items.map((i) => i.number)).toEqual([1, 2, 10, 11])
      for (const i of items) {
        expect(i.shown, `the number ${i.number} is hidden`).toBe(false)
        expect(i.boxLeft, `the box of ${i.number}. is inside the list, in the number's column`).toBeGreaterThanOrEqual(i.listLeft)
        expect(i.boxRight, `the box of ${i.number}. ends before the text starts`).toBeLessThan(i.textStart)
        expect(i.bulletBoxLeft).not.toBeNull()
        expect(i.boxLeft, `the box of ${i.number}. sits where a bullet task's box sits`).toBeCloseTo(i.bulletBoxLeft!, 0)
        expect(i.lineLefts, `the text of ${i.number}. (every line) starts where the item's text starts`).toEqual([Math.round(i.textStart * 10) / 10])
        expect(i.hit, `a tap on the middle of the box of ${i.number}. is the box`).toBe(true)
        expect(i.tap, `the box of ${i.number}. is a 44 px tap`).toEqual([44, 44])
      }
      expect(items.find((i) => i.number === 10)!.lineTops, 'the long task wraps').toBeGreaterThan(1)
    }
    page.remove()
  }, 30_000)
})
