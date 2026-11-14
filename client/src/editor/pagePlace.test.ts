/**
 * A page's place as a place in its text (YAZ-5164): the block at the scroller's top edge and how far below the edge it
 * starts, read off one view and put back in another view of the same text that has other things above it.
 */
import { describe, expect, it } from 'vitest'
import type { EditorView } from '@milkdown/kit/prose/view'
import { holdPagePlace, readPagePlace, scrollerOf, showPagePlace } from './pagePlace'

/** A box at `top`, `height` tall, in window px; `drawn` false is a block folded away (no client rects). */
function block(top: number, height: number, drawn = true): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON: () => ({}) })
  el.getClientRects = () => (drawn ? [el.getBoundingClientRect()] : []) as unknown as DOMRectList
  return el
}

/** A scroller whose box is `top`..`bottom` on the window, and whose scrollTop moves every block drawn in it. */
function scroller(top: number, bottom: number, blocks: { el: HTMLElement; top: number; height: number }[]): HTMLElement {
  const el = block(top, bottom - top)
  let scrollTop = 0
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      const by = v - scrollTop
      scrollTop = v
      for (const b of blocks) {
        b.top -= by
        const next = block(b.top, b.height)
        b.el.getBoundingClientRect = next.getBoundingClientRect
      }
    },
  })
  return el
}

/** A view of top-level blocks at positions `0, 10, 20, …`, a card nested at 15 when given. */
function viewOf(blocks: HTMLElement[], nested?: HTMLElement): EditorView {
  const at = (pos: number) => (pos === 15 && nested !== undefined ? nested : (blocks[pos / 10] ?? null))
  const doc = {
    content: { size: blocks.length * 10 },
    forEach: (fn: (node: unknown, pos: number) => void) => blocks.forEach((_b, i) => fn({}, i * 10)),
    descendants: (fn: (node: unknown, pos: number) => boolean | void) => {
      for (let i = 0; i < blocks.length; i++) {
        if (fn({}, i * 10) === false) return
        if (i === 1 && nested !== undefined && fn({}, 15) === false) return
      }
    },
  }
  return { state: { doc }, nodeDOM: at } as unknown as EditorView
}

describe('readPagePlace', () => {
  it('the first block that reaches below the top edge, how far above the edge it starts, and the caret in the first block that starts in view', () => {
    const blocks = [block(-300, 200), block(-80, 120), block(60, 40), block(120, 40)]
    expect(readPagePlace(viewOf(blocks), block(0, 500))).toEqual({ pos: 10, offset: -80, caret: 21 })
  })

  it('a block folded away is skipped; with no block starting in view the caret goes into the top block', () => {
    const blocks = [block(-300, 200), block(-50, 0, false), block(-40, 900), block(600, 40)]
    expect(readPagePlace(viewOf(blocks), block(0, 500))).toEqual({ pos: 20, offset: -40, caret: 21 })
  })

  it('a pinned card (Edit card) is the place, nested or not: it keeps its own place on screen, the caret in it', () => {
    const card = block(240, 100)
    const blocks = [block(-100, 200), block(100, 300)]
    expect(readPagePlace(viewOf(blocks, card), block(0, 500), card)).toEqual({ pos: 15, offset: 240, caret: 16 })
  })

  it('nothing drawn: no place', () => {
    expect(readPagePlace(viewOf([]), block(0, 500))).toBeNull()
  })
})

describe('showPagePlace', () => {
  it('scrolls so the block starts the same distance below the edge, in a view with more above the text', () => {
    const tops = [{ top: 200, height: 300 }, { top: 500, height: 600 }, { top: 1100, height: 40 }]
    const els = tops.map((t) => block(t.top, t.height))
    const live = tops.map((t, i) => ({ el: els[i], ...t }))
    const host = scroller(50, 550, live)
    expect(showPagePlace(viewOf(els), host, { pos: 10, offset: -80 })).toBe(true)
    // The block at 10 now starts 80 px above the scroller's top edge (50).
    expect(els[1].getBoundingClientRect().top).toBe(50 - 80)
    expect(host.scrollTop).toBe(500 - 50 + 80)
  })

  it('a place past the end, or a block not drawn, leaves the scroller', () => {
    const els = [block(0, 10, false)]
    const host = scroller(0, 500, [{ el: els[0], top: 0, height: 10 }])
    expect(showPagePlace(viewOf(els), host, { pos: 0, offset: 0 })).toBe(false)
    expect(showPagePlace(viewOf(els), host, { pos: 90, offset: 0 })).toBe(false)
    expect(host.scrollTop).toBe(0)
  })
})

describe('holdPagePlace (a lock, an unlock, the caret given back)', () => {
  it('the block at the top stays at its spot, whatever the change does to the scroll or the layout above it', () => {
    const tops = [{ top: -200, height: 300 }, { top: 100, height: 300 }]
    const els = tops.map((t) => block(t.top, t.height))
    const live = tops.map((t, i) => ({ el: els[i], ...t }))
    const host = scroller(0, 500, live)
    host.style.overflowY = 'auto'
    Object.defineProperties(host, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } })
    const view = viewOf(els) as EditorView & { dom: HTMLElement; isDestroyed: boolean }
    Object.assign(view, { dom: host.appendChild(document.createElement('div')), isDestroyed: false })
    const out = holdPagePlace(view, () => {
      // The change scrolls to the top (a focus on a caret out of view), and a bar above grows by 40 px.
      host.scrollTop = -1000
      for (const b of live) {
        b.top += 40
        b.el.getBoundingClientRect = block(b.top, b.height).getBoundingClientRect
      }
      return 'done'
    })
    expect(out).toBe('done')
    expect(els[0].getBoundingClientRect().top).toBe(-200)
  })

  it('scrollerOf: the nearest ancestor that scrolls itself; one set to scroll with nothing to scroll is not it', () => {
    const tall = (el: HTMLElement, scroll: number) => Object.defineProperties(el, { scrollHeight: { value: scroll }, clientHeight: { value: 500 } })
    const outer = document.body.appendChild(document.createElement('div'))
    outer.style.overflowY = 'auto'
    tall(outer, 2000)
    const mid = outer.appendChild(document.createElement('div'))
    mid.style.overflowY = 'auto'
    tall(mid, 500)
    const leaf = mid.appendChild(document.createElement('p'))
    expect(scrollerOf(leaf)).toBe(outer)
    expect(scrollerOf(outer)).toBeNull()
    outer.remove()
  })
})
