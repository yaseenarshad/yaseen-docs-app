/**
 * The highlight ▾ panel (`highlightPanel.ts`), unified Google Docs 10×8 `ColourGrid` (`colourGrid.ts`, YAZ-6727),
 * `ColourBox` (`highlightColourBox.ts`, YAZ-4388, YAZ-6693), live preview (`YAZ-6728`), and customizable 3 quick
 * highlight slots (`highlightQuick.ts`, YAZ-6729) on a REAL Crepe selection toolbar (`toolbarTestKit.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import { DEFAULT_QUICK_HIGHLIGHT_COLORS } from '@shared/types'
import { getMarkdownForSave } from './createCrepe'
import { readHex } from './highlightPanel'
import { setQuickHighlightColors } from './highlightQuick'
import { setUsedHighlightColors, setUsedHighlightColorsSaver } from './highlightUsed'
import { litDots, mount, must, order, press, select, selectSpan, settle, SWATCHES, unmountAll } from './toolbarTestKit'

afterEach(unmountAll)

describe('highlight buttons and the unified Google Docs 10×8 ColourGrid panel (YAZ-4348, YAZ-6727, YAZ-6728, YAZ-6729)', () => {
  const panel = () => document.querySelector<HTMLElement>('body > .highlight-panel[data-panel="highlight"]')
  const isOpen = () => panel() !== null && !panel()!.hidden
  const swatch = (label: string) => {
    const el = panel()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (el == null) throw new Error(`no swatch: ${label}`)
    return el
  }
  const activeLabels = () => [...panel()!.querySelectorAll('button.active')].map((b) => b.getAttribute('aria-label'))
  const hexInput = () => panel()!.querySelector<HTMLInputElement>('.colour-grid__hex-input')!
  const box = () => panel()!.querySelector<HTMLElement>('.colour-box')!
  const boxOpen = () => !box().hidden
  const plus = () => panel()!.querySelector<HTMLButtonElement>('button[aria-label="Custom colour…"]')!
  const clickPlus = () => {
    plus().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    plus().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  }
  const click = async (label: string) => {
    const el = swatch(label)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    el.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    await settle()
  }
  const key = (k: string, at: Element = document.activeElement!) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    at.dispatchEvent(event)
    return event
  }
  const field = (name: 'Red' | 'Green' | 'Blue') => box().querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!
  const pointer = (type: string, x: number, y: number, at: EventTarget) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    at.dispatchEvent(event)
    return event
  }
  const holdFrames = () => {
    let queue = new Map<number, FrameRequestCallback>()
    let next = 1
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
      queue.set(next, f)
      return next++
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => void queue.delete(id))
    return {
      run: () => {
        const due = queue
        queue = new Map()
        due.forEach((f) => f(performance.now()))
      },
    }
  }
  const saved = vi.fn()

  beforeEach(() => {
    setUsedHighlightColors([])
    setQuickHighlightColors([...DEFAULT_QUICK_HIGHLIGHT_COLORS])
    saved.mockReset()
    setUsedHighlightColorsSaver(saved)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.querySelectorAll('.highlight-panel').forEach((el) => el.remove())
    setUsedHighlightColors([])
    setUsedHighlightColorsSaver(() => {})
    setQuickHighlightColors([...DEFAULT_QUICK_HIGHLIGHT_COLORS])
  })

  it('the 3 quick highlight buttons use customizable CSS vars defaulting to yellow, green, blue, followed by ▾ (YAZ-4445, YAZ-6729)', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    const tokens = ['--mark-bg', '--mark-bg-green', '--mark-bg-blue']
    const names = ['Highlight yellow (⇧⌘H)', 'Highlight green', 'Highlight blue']
    SWATCHES.forEach((keyId, i) => {
      const tile = must(keyId).querySelector<HTMLElement>('.swatch-tile')
      expect([...tile!.classList]).toEqual(['swatch-tile', 'swatch-tile--on-color'])
      expect(tile!.style.getPropertyValue('--swatch-color')).toBe(`var(--quick-hl-${i}, var(${tokens[i]}))`)
      expect(tile!.querySelector('.swatch-tile__letter')?.textContent).toBe('A')
      expect(must(keyId).title).toBe(names[i])
    })
    const keys = order()
    expect(keys[keys.indexOf('highlight-blue') + 1]).toBe('highlight-more')
    expect(must('highlight-more').getAttribute('aria-label')).toBe('More highlight colours')
    expect(must('highlight-more').querySelector('.swatch-more')?.textContent).toBe('▾')

    // Customizing quick highlight slots updates what the 3 toolbar buttons apply live.
    setQuickHighlightColors(['#cc0000', 'pink', '#000000'])
    await press('highlight')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #cc0000">world</mark>\n')
    await press('highlight-green')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-pink">world</mark>\n')
    await press('highlight-blue')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #000000">world</mark>\n')
  })

  it('the lit button is the selection\'s colour; the ▾ lights for any highlight not on the 3 quick buttons', async () => {
    const { view } = await mount('<mark class="highlight-blue">blue</mark> <mark class="highlight-pink">pink</mark> <mark class="highlight-orange">orange</mark> <mark style="background-color: #3366ff">mine</mark> <mark style="background-color: #3366ff80">half</mark> plain\n')
    await select(view, 'blue')
    expect(litDots()).toEqual(['highlight-blue'])
    expect(must('highlight-more').classList.contains('active')).toBe(false)
    const bar = () => document.querySelector<HTMLElement>('.milkdown-toolbar')!.style.getPropertyValue('--highlight-more-colour')
    for (const [text, colour] of [['pink', 'var(--mark-bg-pink)'], ['orange', 'var(--mark-bg-orange)'], ['mine', '#3366ff'], ['half', '#3366ff80']]) {
      await select(view, text)
      expect(litDots()).toEqual([])
      expect(must('highlight-more').classList.contains('active')).toBe(true)
      expect(bar()).toBe(colour)
    }
    await select(view, 'plain')
    expect(must('highlight-more').classList.contains('active')).toBe(false)
    expect(bar()).toBe('')
  })

  it('the ▾ opens the unified Google Docs 10×8 panel on the body (No highlight + 80 colours + Custom) and keeps selection & focus', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    const before = view.state.selection
    await press('highlight-more')
    expect(isOpen()).toBe(true)
    expect(panel()!.closest('.milkdown-toolbar')).toBeNull()
    expect(panel()!.getAttribute('role')).toBe('dialog')
    expect(panel()!.querySelectorAll('.colour-grid__rows .colour-grid__dot')).toHaveLength(80)
    expect(activeLabels()).toEqual(['No highlight'])
    expect(view.state.selection.eq(before)).toBe(true)
    expect(view.hasFocus()).toBe(true)
    await press('highlight-more')
    expect(isOpen()).toBe(false)
  })

  it('picking Google Docs colours saves solid hex, keeps panel open, moves active checkmark, and undoes in 1 step', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    await click('Red')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #ff0000">world</mark>\n')
    expect(isOpen()).toBe(true)
    expect(activeLabels()).toEqual(['Red'])
    await click('Orange')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #ff9900">world</mark>\n')
    expect(activeLabels()).toEqual(['Orange'])
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #ff0000">world</mark>\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('No highlight removes every highlight colour from the selection', async () => {
    const { crepe, view } = await mount('==a== <mark class="highlight-red">b</mark> <mark style="background-color: #3366ff">c</mark> d\n')
    await selectSpan(view, 'a', 'd')
    await press('highlight-more')
    await click('No highlight')
    expect(getMarkdownForSave(crepe)).toBe('a b c d\n')
    expect(activeLabels()).toEqual(['No highlight'])
  })

  it('CUSTOM row lists recent custom colours most-used first, applies on click, and counts uses', async () => {
    setUsedHighlightColors([
      { color: '#3366ff', uses: 3 },
      { color: '#00aa00', uses: 2 },
    ])
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    const customDots = [...panel()!.querySelectorAll('.colour-grid__custom-row .colour-grid__dot')].map((b) => b.getAttribute('aria-label'))
    expect(customDots).toEqual(['#3366ff', '#00aa00'])
    await click('#00aa00')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #00aa00">world</mark>\n')
    expect(saved.mock.lastCall![0].slice(0, 2)).toEqual([{ color: '#00aa00', uses: 3 }, { color: '#3366ff', uses: 3 }])
  })

  it('+ opens the custom Hex + ColourBox drawer (never system picker), previews drags, and commits on release or Enter', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    expect(boxOpen()).toBe(false)
    clickPlus()
    expect(boxOpen()).toBe(true)
    expect(document.querySelector('input[type="color"]')).toBeNull()

    // Hex code typing + Enter applies and restores focus.
    hexInput().focus()
    hexInput().value = '#ABCDEF'
    key('Enter', hexInput())
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #abcdef">world</mark>\n')
    expect(view.hasFocus()).toBe(true)
    expect(readHex('f80')).toBe('#ff8800')

    // Drag in ColourBox square previews on frames and commits once on release.
    const square = box().querySelector<HTMLElement>('.colour-box__sv')!
    vi.spyOn(square, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    const frames = holdFrames()
    pointer('pointerdown', 100, 0, square)
    pointer('pointermove', 100, 50, document)
    frames.run()
    pointer('pointerup', 100, 50, document)
    await settle()
    expect(getMarkdownForSave(crepe)).toMatch(/background-color: #[0-9a-f]{6}/)
    expect([field('Red').value, field('Green').value, field('Blue').value].every((v) => /^\d+$/.test(v))).toBe(true)

    // Escape closes custom drawer first, second Escape closes panel.
    key('Escape')
    expect(boxOpen()).toBe(false)
    expect(isOpen()).toBe(true)
    key('Escape')
    expect(isOpen()).toBe(false)
    expect(view.state.selection.empty).toBe(false)
  })

  it('works from the keyboard: arrows walk the 10-column grid, Enter picks, and Escape closes', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    must('highlight-more').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))
    expect(isOpen()).toBe(true)
    const current = () => panel()!.querySelector('.is-current')?.getAttribute('aria-label') ?? null
    expect(current()).toBe('No highlight')
    expect(key('ArrowDown').defaultPrevented).toBe(true)
    expect(current()).toBe('Black')
    key('ArrowDown')
    expect(current()).toBe('Red berry')
    key('ArrowRight')
    expect(current()).toBe('Red')
    expect(key('Enter').defaultPrevented).toBe(true)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #ff0000">world</mark>\n')
    expect(isOpen()).toBe(true)
  })

  it('Highlight ColourBox shows an Opacity slider that saves #rrggbbaa, while Text colour has no Opacity slider (YAZ-6695 D8)', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPlus()
    const alpha = box().querySelector<HTMLInputElement>('input[aria-label="Opacity"]')
    expect(alpha).not.toBeNull()
    expect(alpha!.value).toBe('100')
    alpha!.value = '50'
    alpha!.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #ffff0080">world</mark>\n')
    expect(hexInput().value).toBe('ffff0080')
    // Text colour panel uses the same ColourGrid with allowAlpha: false (no Opacity slider).
    await press('text-color')
    const tcPanel = document.querySelector<HTMLElement>('.highlight-panel[data-panel="text-color"]')!
    expect(tcPanel.hidden).toBe(false)
    tcPanel.querySelector<HTMLButtonElement>('button[aria-label="Custom colour…"]')!.click()
    expect(tcPanel.querySelector('input[aria-label="Opacity"]')).toBeNull()
  })

  it('keeps blue selection on panel open, hides it on colour pick, and restores it on No highlight / toggle off / selection change (YAZ-6728)', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    expect(view.dom.hasAttribute('data-colour-preview')).toBe(false)
    // Opening the panel keeps the blue selection visible so you see which word will change.
    await press('highlight-more')
    expect(view.dom.hasAttribute('data-colour-preview')).toBe(false)
    // Picking a colour hides the blue wash to preview cleanly.
    await click('Red')
    expect(view.dom.hasAttribute('data-colour-preview')).toBe(true)
    // Clearing via No highlight restores the blue selection immediately.
    await click('No highlight')
    expect(view.dom.hasAttribute('data-colour-preview')).toBe(false)
    key('Escape')
    // Quick button ON hides blue wash; clicking again to toggle OFF restores blue selection.
    await press('highlight')
    expect(view.dom.hasAttribute('data-colour-preview')).toBe(true)
    await press('highlight')
    expect(view.dom.hasAttribute('data-colour-preview')).toBe(false)
    // Changing selection always clears preview.
    await press('highlight')
    expect(view.dom.hasAttribute('data-colour-preview')).toBe(true)
    await select(view, 'hello')
    expect(view.dom.hasAttribute('data-colour-preview')).toBe(false)
  })

  it('tracks the 3 most recent highlights per page without shuffling on quick clicks, while fresh pages start with defaults (YAZ-6731)', async () => {
    const pageA = await mount('alpha beta\n')
    await select(pageA.view, 'alpha')
    await press('highlight-more')
    await click('Red')
    await click('Purple')
    key('Escape')

    // Page A now has ['#9900ff', '#ff0000', 'yellow'] scoped to its .milkdown container.
    const scopeA = pageA.view.dom.closest<HTMLElement>('.milkdown')!
    expect(scopeA.style.getPropertyValue('--quick-hl-0')).toBe('#9900ff')
    expect(scopeA.style.getPropertyValue('--quick-hl-1')).toBe('#ff0000')
    expect(scopeA.style.getPropertyValue('--quick-hl-2')).toBe('var(--mark-bg)')

    // Clicking an existing quick button applies that colour WITHOUT shuffling the 3 slots.
    await select(pageA.view, 'beta')
    await press('highlight-green')
    expect(getMarkdownForSave(pageA.crepe)).toContain('<mark style="background-color: #ff0000">beta</mark>')
    expect(scopeA.style.getPropertyValue('--quick-hl-0')).toBe('#9900ff')
    expect(scopeA.style.getPropertyValue('--quick-hl-1')).toBe('#ff0000')

    // A fresh Page B starts cleanly with the default 3 slots (yellow, green, blue).
    const hostA = pageA.view.dom.closest('.milkdown')?.parentElement
    await pageA.crepe.destroy()
    hostA?.remove()
    const pageB = await mount('fresh page\n')
    await select(pageB.view, 'fresh')
    await press('highlight')
    expect(getMarkdownForSave(pageB.crepe)).toBe('==fresh== page\n')
  })

  it('auto-contrasts dark and light solid highlights via data-mark-tone, skipping <50% washes (YAZ-6733)', async () => {
    const { view } = await mount(
      '<mark style="background-color: #000000">dark</mark> ' +
      '<mark style="background-color: #ffff00">light</mark> ' +
      '<mark style="background-color: #0000004d">translucent</mark>\n',
    )
    const marks = [...view.dom.querySelectorAll<HTMLElement>('mark')]
    expect(marks.map((m) => [m.textContent, m.getAttribute('data-mark-tone')])).toEqual([
      ['dark', 'dark'],
      ['light', 'light'],
      ['translucent', null],
    ])
  })

  it('right-clicking any swatch shows instant Name + Hex, Copy hex, Pin to Custom / Remove (YAZ-6734, YAZ-6736)', async () => {
    setUsedHighlightColors([{ color: '#e11d48', uses: 3 }, { color: '#0284c7', uses: 1 }])
    const saved: unknown[] = []
    setUsedHighlightColorsSaver((next) => saved.push(next))
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    // Right-click a palette dot -> shows instant name + hex + Copy hex + Pin to Custom
    const grayDot = panel()!.querySelector<HTMLButtonElement>('button[aria-label="Dark grey 2"]')!
    grayDot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(panel()!.querySelector('.colour-grid__ctx-name')!.textContent).toBe('Dark grey 2')
    expect(panel()!.querySelector('.colour-grid__ctx-hex')!.textContent).toBe('#999999')
    const pinBtn = [...panel()!.querySelectorAll<HTMLButtonElement>('.colour-grid__ctx-item')].find((b) => b.textContent?.includes('Pin to Custom'))!
    pinBtn.click()
    expect(panel()!.querySelector('button[aria-label="#999999"]')).not.toBeNull()
    // Right-click a CUSTOM dot -> shows Remove and deletes it globally
    const dot = panel()!.querySelector<HTMLButtonElement>('button[aria-label="#e11d48"]')!
    dot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const removeBtn = panel()!.querySelector<HTMLButtonElement>('.colour-grid__remove')!
    expect(removeBtn.textContent).toContain('Remove #e11d48')
    removeBtn.click()
    expect(panel()!.querySelector('button[aria-label="#e11d48"]')).toBeNull()
    expect(panel()!.querySelector('button[aria-label="#0284c7"]')).not.toBeNull()
    expect(saved.at(-1)).toEqual([{ color: '#999999', uses: 1 }, { color: '#0284c7', uses: 1 }])
  })
})
