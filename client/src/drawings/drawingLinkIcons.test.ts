/**
 * A drawing pill's file icon (YAZ-4110 5B, change 2): read once off the sidebar's own CSS (`fileIconDecoration`), drawn
 * into a small canvas, held for each look, at most 64. jsdom has no CSS `::before` and no canvas, so the test stands in
 * for both: `getComputedStyle(probe, '::before')` answers what the app's CSS would, and the canvas records its draws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drawingLinkIcon } from './drawingLinkIcons'

/** What the CSS's `::before` says for a probe, by its `data-kind`. */
let before: (probe: Element) => Record<string, string>
let reads = 0
const draws: string[] = []

beforeEach(() => {
  reads = 0
  draws.length = 0
  document.body.innerHTML = '<div class="app"></div>'
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo !== '::before') return real(element)
    reads++
    const style = { content: '""', display: 'inline-block', backgroundImage: 'none', backgroundColor: '', ...before(element) }
    return { ...style, getPropertyValue: (name: string) => (style as Record<string, string>)[name] ?? '' } as unknown as CSSStyleDeclaration
  })
  // jsdom's image never decodes
  HTMLImageElement.prototype.decode = () => Promise.resolve()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      drawImage: (image: HTMLImageElement) => draws.push(`image ${image.src}`),
      fillRect: () => draws.push('fill'),
      set fillStyle(color: string) {
        draws.push(`color ${color}`)
      },
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D
  } as unknown as HTMLCanvasElement['getContext'])
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,icon')
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("a pill's file icon (YAZ-4110 5B)", () => {
  it('is drawn once from the CSS: undefined while it loads, then onReady once, then the same image', async () => {
    before = () => ({ backgroundImage: 'url("icons/markdown.svg")' })
    const onReady = vi.fn()
    expect(drawingLinkIcon('/v/Plan.md', false, onReady)).toBeUndefined()
    // asked again while it loads: no second read
    expect(drawingLinkIcon('/v/Plan.md', false, onReady)).toBeUndefined()
    await settle()
    expect(onReady).toHaveBeenCalledTimes(1)
    const icon = drawingLinkIcon('/v/Plan.md', false, onReady)!
    expect(icon.url).toBe('data:image/png;base64,icon')
    expect(icon.image).toBeInstanceOf(HTMLCanvasElement)
    expect(drawingLinkIcon('/v/Other.md', false, onReady)).toBe(icon)
    expect(reads).toBe(1)
    expect(draws).toEqual([expect.stringMatching(/^image .*icons\/markdown\.svg$/)])
    // the probe is gone again
    expect(document.querySelector('.app')!.children).toHaveLength(0)
  })

  it('a mask icon is filled in its colour; the theme gives another look', async () => {
    before = () => ({ 'mask-image': 'url(icons/folder.svg)', backgroundColor: 'rgb(1, 2, 3)' })
    document.documentElement.dataset.theme = 'dark'
    drawingLinkIcon('/v/Work', true, () => {})
    await settle()
    expect(draws).toEqual([expect.stringMatching(/^image .*icons\/folder\.svg$/), 'color rgb(1, 2, 3)', 'fill'])
    document.documentElement.dataset.theme = 'light'
    expect(drawingLinkIcon('/v/Work', true, () => {})).toBeUndefined()
    expect(reads).toBe(2)
    delete document.documentElement.dataset.theme
  })

  it('with file icons off the CSS draws nothing: null, no icon, as in a page', () => {
    before = () => ({ content: 'none' })
    document.querySelector<HTMLElement>('.app')!.dataset.sidebarFileIcons = 'off'
    expect(drawingLinkIcon('/v/Plan.md', false, () => {})).toBeNull()
    expect(drawingLinkIcon('/v/Plan.md', false, () => {})).toBeNull()
    expect(reads).toBe(1)
  })

  it('holds at most 64 looks: the oldest is read again', async () => {
    before = () => ({ backgroundImage: 'url(a.svg)' })
    const app = document.querySelector<HTMLElement>('.app')!
    // the icon set is in each look's key: 65 sets, 65 looks
    for (let set = 0; set < 65; set++) {
      app.dataset.sidebarIconSet = `set-${set}`
      drawingLinkIcon('/v/Plan.md', false, () => {})
    }
    await settle()
    expect(reads).toBe(65)
    app.dataset.sidebarIconSet = 'set-64'
    expect(drawingLinkIcon('/v/Plan.md', false, () => {})).toBeDefined()
    app.dataset.sidebarIconSet = 'set-0'
    expect(drawingLinkIcon('/v/Plan.md', false, () => {})).toBeUndefined()
    expect(reads).toBe(66)
  })

  it('YAZ-4074 6A item 20: "no icon" looks count toward the 64 too', () => {
    before = () => ({ content: 'none' })
    const app = document.querySelector<HTMLElement>('.app')!
    for (let set = 0; set < 65; set++) {
      app.dataset.sidebarIconSet = `none-${set}`
      expect(drawingLinkIcon('/v/Plan.md', false, () => {})).toBeNull()
    }
    expect(reads).toBe(65)
    app.dataset.sidebarIconSet = 'none-64'
    drawingLinkIcon('/v/Plan.md', false, () => {})
    expect(reads).toBe(65)
    // the oldest went out: it is read again
    app.dataset.sidebarIconSet = 'none-0'
    drawingLinkIcon('/v/Plan.md', false, () => {})
    expect(reads).toBe(66)
  })

  it('outside the app (no `.app`): undefined, and nothing is read', () => {
    document.body.innerHTML = ''
    expect(drawingLinkIcon('/v/Plan.md', false, () => {})).toBeUndefined()
    expect(reads).toBe(0)
  })
})
