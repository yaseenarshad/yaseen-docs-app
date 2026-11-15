// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { NUMBERED_TASKS_PAGE } from '../dev/taskFixtures'
import { HAS_CHROME, inChrome } from './chromeLayout.testing'
import { renderPage, type PageLook } from './pageRender'

/**
 * YAZ-5510: in a numbered task list (`1. [ ] …`, `10. [ ] …`) the number, then the box, then the text, with no overlap.
 * The page is drawn here (jsdom) and laid out in headless Chrome with the phone's stylesheets (`chromeLayout.testing.ts`).
 * A number is the item's `::marker`, drawn outside the item: Chrome ends it at the item's left edge (the "1." glyphs
 * and their space), so the number's right edge is the item's left edge. Made-up tasks.
 */
const look: PageLook = {
  link: (inner) => ({ label: inner, open: { kind: 'page', path: `${inner}.md` } }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: () => document.createElement('div'),
}

const MEASURE = `(() => [...document.querySelectorAll('.reader__body ol > li')].flatMap((li) => {
  const box = li.querySelector(':scope > .page-task, :scope > p:first-child > .page-task')
  if (!box) return []
  const marker = getComputedStyle(li, '::marker')
  const number = li.parentElement.start + [...li.parentElement.children].indexOf(li)
  const b = box.getBoundingClientRect()
  const text = document.createRange()
  text.selectNodeContents(li)
  const words = [...text.getClientRects()].filter((r) => r.left >= b.right - 0.5)
  return [{ number, numberRight: li.getBoundingClientRect().left, boxLeft: b.left, boxRight: b.right, boxTop: b.top, textLeft: words.length ? Math.min(...words.map((r) => r.left)) : null, outside: getComputedStyle(li).listStylePosition, shown: marker.content !== 'none' && getComputedStyle(li).listStyleType !== 'none' }]
}))()`

describe('a numbered task: the number, then the box, then the text (YAZ-5510)', () => {
  it.skipIf(!HAS_CHROME)("the box's left edge is right of the number's right edge, for 1. and 10.; the text after the box", async () => {
    const page = document.createElement('article')
    page.className = 'reader'
    const body = document.createElement('div')
    body.className = 'reader__body'
    page.append(body)
    document.body.append(page)
    await renderPage(NUMBERED_TASKS_PAGE, look, body)
    for (const scheme of ['light', 'dark'] as const) {
      const items = await inChrome<{ number: number; numberRight: number; boxLeft: number; boxRight: number; textLeft: number | null; outside: string; shown: boolean }[]>(page.outerHTML, MEASURE, { scheme })
      expect(items.map((i) => i.number)).toEqual([1, 2, 10, 11])
      for (const i of items) {
        expect(i.shown, `the number ${i.number} shows`).toBe(true)
        expect(i.outside).toBe('outside')
        expect(i.boxLeft, `the box of ${i.number}. starts right of its number`).toBeGreaterThanOrEqual(i.numberRight)
        expect(i.textLeft, `the text of ${i.number}. starts right of its box`).not.toBeNull()
        expect(i.textLeft!).toBeGreaterThan(i.boxRight)
      }
    }
    page.remove()
  }, 30_000)
})
