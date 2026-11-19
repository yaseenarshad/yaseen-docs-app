/**
 * ⌘F in Settings' open section (YAZ-5968): what it reads (row names, help, group titles, the choices shown), the count,
 * next and back with wrap, a recount when the section's text changes, and close clearing the paint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintedFindRanges } from '../editor/find/cardFind'
import { createFindChannel } from '../editor/find/findChannel'
import { createSectionFinder, sectionMatches } from './sectionFind'

let pane: HTMLElement | null = null
const unbinds: (() => void)[] = []

afterEach(() => {
  unbinds.splice(0).forEach((u) => u())
  pane?.remove()
  pane = null
})

const PANE = `
  <div class="find-bar-dock find-bar-dock--settings"><div class="find-bar"><input class="find-bar__input"><span class="find-bar__count">1 of 2</span></div></div>
  <section class="settings-section">
    <h2 class="settings-section__title">Cards</h2>
    <div class="settings-group">
      <h3 class="settings-group__title">Title mark</h3>
      <div class="setting" data-setting="a">
        <div class="setting__text"><p class="setting__label">Title in the head</p><p class="setting__hint">Shows the card's title.</p></div>
        <div class="setting__control"><div class="settings__options"><button>Always</button><button>Only if different</button><button>Never</button></div></div>
      </div>
      <div class="setting" data-setting="b">
        <div class="setting__text"><p class="setting__label">Order</p></div>
        <div class="setting__control"><select><option>Newest title first</option><option selected>Oldest first</option></select></div>
      </div>
      <div class="setting" data-setting="c" hidden><p class="setting__label">Hidden title row</p></div>
      <svg><text>title</text></svg>
    </div>
  </section>`

function mountPane(html = PANE): HTMLElement {
  pane = document.createElement('div')
  pane.className = 'settings-pane'
  pane.innerHTML = html
  document.body.appendChild(pane)
  return pane
}

describe('sectionMatches', () => {
  it('finds case-insensitively in titles, labels and help, never in the find bar, a hidden row, a glyph or an option not shown', () => {
    const el = mountPane()
    expect(sectionMatches(el, 'TITLE').map((r) => r.toString())).toEqual(['Title', 'Title', 'title'])
    expect(sectionMatches(el, 'of')).toEqual([])
  })

  it('reads each choice on its own: a button word, a select`s shown option', () => {
    const el = mountPane()
    expect(sectionMatches(el, 'always').map((r) => r.toString())).toEqual(['Always'])
    // Two buttons side by side never make one word.
    expect(sectionMatches(el, 'alwaysonly')).toEqual([])
    expect(sectionMatches(el, 'first').map((r) => r.toString())).toEqual(['first'])
    expect(sectionMatches(el, 'newest')).toEqual([])
  })

  it('an empty query finds nothing', () => {
    expect(sectionMatches(mountPane(), '')).toEqual([])
  })
})

describe('createSectionFinder', () => {
  const bind = (onClose?: () => void) => {
    const el = mountPane()
    const channel = createFindChannel()
    unbinds.push(createSectionFinder(channel, () => el, onClose))
    channel.open()
    return { el, channel }
  }

  it('counts, starts on the first, and steps next and back with wrap', () => {
    const { channel } = bind()
    channel.setQuery('title')
    expect(channel.getState()).toMatchObject({ total: 3, activeIndex: 0 })
    expect(paintedFindRanges().filter((r) => r.active)).toHaveLength(1)
    channel.next()
    channel.next()
    expect(channel.getState().activeIndex).toBe(2)
    channel.next()
    expect(channel.getState().activeIndex).toBe(0)
    channel.prev()
    expect(channel.getState().activeIndex).toBe(2)
    expect(paintedFindRanges()).toEqual([
      { text: 'Title', active: false },
      { text: 'Title', active: false },
      { text: 'title', active: true },
    ])
  })

  it('brings the current match into the pane', () => {
    const { el, channel } = bind()
    const spy = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) })
    // jsdom lays nothing out: a range far below the pane's bottom must scroll it.
    const proto = Range.prototype as unknown as { getBoundingClientRect?: () => DOMRect }
    const had = proto.getBoundingClientRect
    proto.getBoundingClientRect = () => ({ top: 400, bottom: 420, left: 0, right: 10, width: 10, height: 20, x: 0, y: 400, toJSON: () => ({}) }) as DOMRect
    try {
      channel.setQuery('never')
      expect(el.scrollTop).toBeGreaterThan(0)
    } finally {
      proto.getBoundingClientRect = had
      spy.mockRestore()
    }
  })

  it('counts again when a row shows or hides', async () => {
    const { el, channel } = bind()
    channel.setQuery('title')
    expect(channel.getState().total).toBe(3)
    el.querySelector('[data-setting="c"]')?.removeAttribute('hidden')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(channel.getState().total).toBe(4)
    el.querySelector('[data-setting="a"]')?.remove()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(channel.getState().total).toBe(2)
  })

  it('the bar`s own count changing counts nothing again', async () => {
    const { el, channel } = bind()
    channel.setQuery('title')
    channel.next()
    const count = el.querySelector('.find-bar__count') as HTMLElement
    count.textContent = '2 of 3'
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(channel.getState()).toMatchObject({ total: 3, activeIndex: 1 })
  })

  it('close clears the marks and hands the focus back', () => {
    const onClose = vi.fn()
    const { channel } = bind(onClose)
    channel.setQuery('title')
    channel.close()
    expect(paintedFindRanges()).toEqual([])
    expect(channel.getState()).toMatchObject({ open: false, total: 0 })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
