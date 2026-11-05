/**
 * The highlight ▾ panel (`highlightPanel.ts`) and its colour box (`highlightColourBox.ts`), YAZ-4348 demo round 2 and
 * YAZ-4388, on a REAL Crepe's selection toolbar (`toolbarTestKit.ts`). Moved out of `headingToolbar.test.ts`
 * (YAZ-4366), so the panel's tests sit beside the panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import { getMarkdownForSave } from './createCrepe'
import { HIGHLIGHT_HEX } from './marks/highlight'
import { readHex, shadesOf } from './highlightPanel'
import { fromHsv, toHsv } from './highlightColourBox'
import { setUsedHighlightColors, setUsedHighlightColorsSaver } from './highlightUsed'
import { litDots, mount, must, order, press, select, selectSpan, settle, SWATCHES, unmountAll } from './toolbarTestKit'

afterEach(unmountAll)

/**
 * The highlight buttons' look and their ▾ panel (YAZ-4348 demo round 2, `highlightPanel.ts`): each button is a bold
 * "A" on a square of its wash token, yellow, green and blue; the ▾ opens the board's colour popup on the body — most
 * used custom colours, the 8 colours and None, shades, a hex code — so the toolbar's `overflow: hidden` cannot cut
 * it off, without taking the selection, and open for the next pick.
 */
describe('highlight buttons and the ▾ panel (YAZ-4348 demo round 2)', () => {
  const panel = () => document.querySelector<HTMLElement>('body > .highlight-panel')
  const isOpen = () => panel() !== null && !panel()!.hidden
  const swatch = (label: string) => {
    const el = panel()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (el == null) throw new Error(`no swatch: ${label}`)
    return el
  }
  const labels = (section: number) => [...panel()!.querySelectorAll('.highlight-panel__section')[section].querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
  const headings = () => [...panel()!.querySelectorAll<HTMLElement>('.highlight-panel__section:not([hidden]) .highlight-panel__heading')].map((h) => h.textContent)
  const ringed = () => [...panel()!.querySelectorAll('.highlight-panel__swatch.active')].map((b) => b.getAttribute('aria-label'))
  const shades = () => [...panel()!.querySelectorAll<HTMLButtonElement>('.highlight-panel__section:nth-child(3) .highlight-panel__swatch')].map((b) => b.title.split(' ').pop())
  const hexInput = () => panel()!.querySelector<HTMLInputElement>('.highlight-panel__hex-input')!
  /** A real click on a swatch: the mousedown the panel cancels, then the click. */
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
  const box = () => panel()!.querySelector<HTMLElement>('.colour-box')!
  const boxOpen = () => !box().hidden
  const pencil = () => panel()!.querySelector<HTMLButtonElement>('button[aria-label="Custom colour…"]')!
  const clickPencil = () => {
    pencil().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    pencil().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  }
  const field = (name: 'Red' | 'Green' | 'Blue') => box().querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!
  /** A pointer on the box's square or slider, at (x, y) in a 100 × 100 box at the window's top left. */
  const pointer = (type: string, x: number, y: number, at: EventTarget) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    at.dispatchEvent(event)
    return event
  }
  /** Animation frames held until `run()`, as the browser's next paint would run them. */
  const holdFrames = () => {
    let queue = new Map<number, FrameRequestCallback>()
    let next = 1
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
      queue.set(next, f)
      return next++
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => void queue.delete(id))
    return {
      pending: () => queue.size,
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
    saved.mockReset()
    setUsedHighlightColorsSaver(saved)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.querySelectorAll('.highlight-panel').forEach((el) => el.remove())
    setUsedHighlightColors([])
    setUsedHighlightColorsSaver(() => {})
  })

  it('each highlight button is the board\'s tile — a dark "A" on its own wash token, yellow, green, blue, named as on the board — and the ▾ follows them (YAZ-4445)', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    const tokens = ['--mark-bg', '--mark-bg-green', '--mark-bg-blue']
    const names = ['Highlight yellow (⇧⌘H)', 'Highlight green', 'Highlight blue']
    SWATCHES.forEach((key, i) => {
      const tile = must(key).querySelector<HTMLElement>('.swatch-tile')
      expect([...tile!.classList]).toEqual(['swatch-tile', 'swatch-tile--on-color'])
      expect(tile!.style.getPropertyValue('--swatch-color')).toBe(`var(${tokens[i]})`)
      expect(tile!.querySelector('.swatch-tile__letter')?.textContent).toBe('A')
      expect(must(key).title).toBe(names[i])
    })
    const keys = order()
    expect(keys[keys.indexOf('highlight-blue') + 1]).toBe('highlight-more')
    expect(must('highlight-more').getAttribute('aria-label')).toBe('More highlight colours')
    // the board's ▾: its glyph, no tile
    expect(must('highlight-more').querySelector('.swatch-more')?.textContent).toBe('▾')
  })

  it('the lit button is the selection\'s colour (the ring); the ▾ lights for pink, a panel colour or a custom one', async () => {
    const { view } = await mount('<mark class="highlight-blue">blue</mark> <mark class="highlight-pink">pink</mark> <mark class="highlight-orange">orange</mark> <mark style="background-color: #3366ff">mine</mark> plain\n')
    await select(view, 'blue')
    expect(litDots()).toEqual(['highlight-blue'])
    expect(must('highlight-more').classList.contains('active')).toBe(false)
    // YAZ-4445: as the board's ▾, a bar of that colour under it (the toolbar's `--highlight-more-colour`)
    const bar = () => document.querySelector<HTMLElement>('.milkdown-toolbar')!.style.getPropertyValue('--highlight-more-colour')
    for (const [text, colour] of [['pink', 'var(--mark-bg-pink)'], ['orange', 'var(--mark-bg-orange)'], ['mine', 'rgba(51, 102, 255, 0.4)']]) {
      await select(view, text)
      expect(litDots()).toEqual([])
      expect(must('highlight-more').classList.contains('active')).toBe(true)
      expect(bar()).toBe(colour)
    }
    await select(view, 'plain')
    expect(must('highlight-more').classList.contains('active')).toBe(false)
    expect(bar()).toBe('')
  })

  it('the ▾ opens the panel on the body: Colours (None and the 8), Shades, Hex code — and keeps the selection and the focus', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    const before = view.state.selection
    await press('highlight-more')
    expect(isOpen()).toBe(true)
    expect(panel()!.closest('.milkdown-toolbar')).toBeNull()
    expect(panel()!.getAttribute('role')).toBe('dialog')
    // No custom colour used yet: no "Most used custom colours" row.
    expect(headings()).toEqual(['Colours', 'Shades', 'Hex code'])
    expect(labels(1)).toEqual(['None', 'Highlight yellow', 'Highlight green', 'Highlight blue', 'Highlight pink', 'Highlight orange', 'Highlight purple', 'Highlight red', 'Highlight gray'])
    expect(swatch('None').classList.contains('is-none')).toBe(true)
    expect(swatch('Highlight pink').style.getPropertyValue('--swatch')).toBe('var(--mark-bg-pink)')
    expect(swatch('Highlight yellow').style.getPropertyValue('--swatch')).toBe('var(--mark-bg)')
    // Nothing highlighted: None wears the ring, no shades, an empty hex.
    expect(ringed()).toEqual(['None'])
    expect(panel()!.querySelector('.highlight-panel__no-shades')?.textContent).toBe('No shades available for this colour')
    expect(hexInput().value).toBe('')
    expect(view.state.selection.eq(before)).toBe(true)
    expect(view.hasFocus()).toBe(true)
    // A second press closes it.
    await press('highlight-more')
    expect(isOpen()).toBe(false)
  })

  it('a colour saves its class form, pink included; the panel stays open, the ring moves, and each pick is one undo step', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    await click('Highlight pink')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-pink">world</mark>\n')
    expect(isOpen()).toBe(true)
    expect(ringed()).toEqual(['Highlight pink'])
    expect(hexInput().value).toBe(HIGHLIGHT_HEX.pink.slice(1))
    expect(shades()[2]).toBe(HIGHLIGHT_HEX.pink)
    await click('Highlight orange')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-orange">world</mark>\n')
    expect(ringed()).toEqual(['Highlight orange'])
    // Picking the lit colour again keeps it: the panel is not a toggle.
    await click('Highlight orange')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-orange">world</mark>\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-pink">world</mark>\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('None takes every colour off the selection', async () => {
    const { crepe, view } = await mount('==a== <mark class="highlight-red">b</mark> <mark style="background-color: #3366ff">c</mark> d\n')
    await selectSpan(view, 'a', 'd')
    await press('highlight-more')
    expect(ringed()).toEqual(['Highlight yellow', 'Highlight red'])
    await click('None')
    expect(getMarkdownForSave(crepe)).toBe('a b c d\n')
    expect(ringed()).toEqual(['None'])
  })

  it('a shade is a custom colour: it saves the style form, keeps its row of shades, and counts as a use', async () => {
    const { crepe, view } = await mount('<mark class="highlight-blue">world</mark>\n')
    await select(view, 'world')
    await press('highlight-more')
    const row = shades()
    expect(row).toEqual(shadesOf(HIGHLIGHT_HEX.blue))
    // Lighter to darker: each step's channels add up to less than the one before.
    const light = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0)
    const lights = row.map((s) => light(s!))
    expect(lights).toEqual([...lights].sort((a, b) => b - a))
    expect(new Set(lights).size).toBe(5)
    await click(`Shade 4 ${row[3]}`)
    expect(getMarkdownForSave(crepe)).toBe(`<mark style="background-color: ${row[3]}">world</mark>\n`)
    expect(shades()).toEqual(row)
    expect(swatch(`Shade 4 ${row[3]}`).classList.contains('active')).toBe(true)
    expect(swatch('Highlight blue').classList.contains('active')).toBe(false)
    expect(saved).toHaveBeenLastCalledWith([{ color: row[3], uses: 1 }])
    // The row of most used custom colours shows it now.
    expect(headings()).toEqual(['Most used custom colours', 'Colours', 'Shades', 'Hex code'])
    expect(labels(0)).toEqual([row[3]])
  })

  it('the most used row: most used first, a click applies and counts; at most five', async () => {
    setUsedHighlightColors([
      { color: '#3366ff', uses: 3 },
      { color: '#00aa00', uses: 2 },
      { color: '#111111', uses: 1 },
      { color: '#222222', uses: 1 },
      { color: '#333333', uses: 1 },
      { color: '#444444', uses: 1 },
    ])
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    expect(labels(0)).toEqual(['#3366ff', '#00aa00', '#111111', '#222222', '#333333'])
    await click('#00aa00')
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #00aa00">world</mark>\n')
    // Three uses each now: the latest goes first.
    expect(saved.mock.lastCall![0].slice(0, 2)).toEqual([{ color: '#00aa00', uses: 3 }, { color: '#3366ff', uses: 3 }])
    expect(swatch('#00aa00').classList.contains('active')).toBe(true)
  })

  it('Hex code: a valid hex and Enter applies it with the focus back in the note; an invalid one does nothing', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    hexInput().focus()
    hexInput().value = 'zz12'
    expect(key('Enter', hexInput()).defaultPrevented).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    hexInput().value = '#ABCDEF'
    key('Enter', hexInput())
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #abcdef">world</mark>\n')
    expect(view.hasFocus()).toBe(true)
    expect(isOpen()).toBe(true)
    expect(hexInput().value).toBe('abcdef')
    // Three digits read as six.
    expect(readHex('f80')).toBe('#ff8800')
    // Escape in the field closes the panel and gives the focus back to the note.
    hexInput().focus()
    key('Escape', hexInput())
    expect(isOpen()).toBe(false)
    expect(view.hasFocus()).toBe(true)
  })

  it('the pencil and the field open the panel\'s own colour box right under the Hex code field, never the system picker', async () => {
    const { view } = await mount('<mark class="highlight-green">hello</mark> world\n')
    await select(view, 'world')
    await press('highlight-more')
    expect(boxOpen()).toBe(false)
    clickPencil()
    expect(boxOpen()).toBe(true)
    // Inside the panel, right after the Hex code field, in its section.
    const hexField = panel()!.querySelector('.highlight-panel__hex')!
    expect(hexField.nextElementSibling).toBe(box())
    expect(pencil().getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('input[type="color"]')).toBeNull()
    expect(box().querySelector('[aria-label="Saturation and brightness"] .colour-box__sv-handle')).not.toBeNull()
    expect(box().querySelector('[aria-label="Hue"] .colour-box__hue-handle')).not.toBeNull()
    // Nothing on the selection: the box starts on yellow.
    expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['255', '213', '0'])
    expect(view.hasFocus()).toBe(true)
    // The pencil again closes just the box.
    clickPencil()
    expect(boxOpen()).toBe(false)
    expect(isOpen()).toBe(true)

    // A mousedown on the field opens it too, on the field's colour.
    await select(view, 'hello')
    await press('highlight-more')
    hexInput().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(boxOpen()).toBe(true)
    expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['80', '200', '120'])
    // A hex typed in the field moves the box.
    hexInput().value = '3366ff'
    hexInput().dispatchEvent(new Event('input', { bubbles: true }))
    expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['51', '102', '255'])
  })

  it('a drag in the box previews, and its release is one pick: one undo step, one use; the box stays open', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    const square = box().querySelector<HTMLElement>('.colour-box__sv')!
    const hue = box().querySelector<HTMLElement>('.colour-box__hue')!
    for (const el of [square, hue]) vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    const frames = holdFrames()
    // The square keeps the selection and the focus.
    expect(pointer('mousedown', 50, 50, square).defaultPrevented).toBe(true)
    pointer('pointerdown', 50, 50, square)
    pointer('pointermove', 100, 0, document)
    frames.run()
    // Yellow's hue, full saturation and brightness: the hex field and R G B follow, the text does not yet.
    expect(hexInput().value).toBe('ffd500')
    pointer('pointermove', 100, 50, document)
    frames.run()
    expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['128', '106', '0'])
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    expect(saved).not.toHaveBeenCalled()
    pointer('pointerup', 100, 50, document)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #806a00">world</mark>\n')
    expect(saved).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenLastCalledWith([{ color: '#806a00', uses: 1 }])
    expect(isOpen()).toBe(true)
    expect(boxOpen()).toBe(true)
    expect(view.hasFocus()).toBe(true)
    // A move after the release does nothing (the editor's own frames run first).
    frames.run()
    pointer('pointermove', 0, 100, document)
    expect(frames.pending()).toBe(0)
    expect(hexInput().value).toBe('806a00')
    // The hue slider: red, the same saturation and brightness.
    pointer('pointerdown', 0, 5, hue)
    pointer('pointerup', 0, 5, document)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #800000">world</mark>\n')
    expect(saved).toHaveBeenCalledTimes(2)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #806a00">world</mark>\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('a drag draws once a frame, at the latest pointer, by transform alone, and rebuilds no swatch; a cancel picks nothing', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    const square = box().querySelector<HTMLElement>('.colour-box__sv')!
    const thumb = square.querySelector<HTMLElement>('.colour-box__thumb')!
    const hueThumb = box().querySelector<HTMLElement>('.colour-box__hue .colour-box__thumb')!
    vi.spyOn(square, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    const frames = holdFrames()
    const swatches = [...panel()!.querySelectorAll('.highlight-panel__swatch')]
    const watch = new MutationObserver(() => {})
    watch.observe(panel()!, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    // The press draws at once.
    pointer('pointerdown', 0, 0, square)
    expect(hexInput().value).toBe('ffffff')
    watch.takeRecords()
    for (let i = 1; i <= 40; i++) pointer('pointermove', i, i, document)
    // Forty moves: one frame asked for, nothing drawn before it.
    expect(frames.pending()).toBe(1)
    expect(watch.takeRecords()).toEqual([])
    expect(hexInput().value).toBe('ffffff')
    frames.run()
    // One draw, at the last move: the square's handle moves by transform, the colour changes; the hue's handle, the
    // square's hue and every row of swatches are left alone.
    expect(watch.takeRecords().map((r) => r.target)).toEqual([thumb, box()])
    expect(thumb.style.transform).toBe('translate(40%, 40%)')
    expect(hueThumb.style.transform).toBe(`translateX(${(toHsv(HIGHLIGHT_HEX.yellow).h / 360) * 100}%)`)
    const at40 = fromHsv({ ...toHsv(HIGHLIGHT_HEX.yellow), s: 0.4, v: 0.6 })
    expect(hexInput().value).toBe(at40.slice(1))
    expect([...panel()!.querySelectorAll('.highlight-panel__swatch')]).toEqual(swatches)
    expect(frames.pending()).toBe(0)
    // A cancelled drag (the pointer lost) drops its frame and picks nothing.
    pointer('pointermove', 90, 90, document)
    pointer('pointercancel', 90, 90, document)
    expect(frames.pending()).toBe(0)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    expect(saved).not.toHaveBeenCalled()
    watch.disconnect()
  })

  it('a pick moves the ring, not the nodes: the Colours row is never rebuilt, the same pick again and a second open make nothing', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    const grid = (n: number) => panel()!.querySelectorAll('.highlight-panel__grid')[n]
    const colours = [...grid(1).children]
    const watch = new MutationObserver(() => {})
    watch.observe(panel()!, { childList: true, subtree: true })
    await click('Highlight pink')
    // Only the Shades row changes: pink's shades take the place of "No shades".
    expect(watch.takeRecords().every((r) => r.target === grid(2))).toBe(true)
    expect([...grid(1).children]).toEqual(colours)
    expect(ringed()).toEqual(['Highlight pink'])
    const pinkShades = [...grid(2).children]
    await click('Highlight orange')
    expect([...grid(1).children]).toEqual(colours)
    expect(ringed()).toEqual(['Highlight orange'])
    watch.takeRecords()
    await click('Highlight orange')
    expect(watch.takeRecords()).toEqual([])
    // Closed and opened again on pink: the same nodes, none made.
    await click('Highlight pink')
    expect([...grid(2).children]).toEqual(pinkShades.map((el) => grid(2).querySelector(`[aria-label="${el.getAttribute('aria-label')}"]`)))
    watch.takeRecords()
    await press('highlight-more')
    await press('highlight-more')
    expect(isOpen()).toBe(true)
    expect(watch.takeRecords()).toEqual([])
    watch.disconnect()
  })

  it('R G B from the keyboard: typing previews, Enter is one pick with the focus back in the note', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    const type = (name: 'Red' | 'Green' | 'Blue', value: string) => {
      field(name).focus()
      field(name).value = value
      field(name).dispatchEvent(new Event('input', { bubbles: true }))
    }
    type('Red', '51')
    type('Green', '102')
    type('Blue', '255')
    expect(hexInput().value).toBe('3366ff')
    // Keys in a field are its own: a letter does not close the panel.
    expect(key('x', field('Blue')).defaultPrevented).toBe(false)
    expect(isOpen()).toBe(true)
    // The up arrow steps the channel.
    key('ArrowUp', field('Blue'))
    expect(field('Blue').value).toBe('255')
    key('ArrowDown', field('Red'))
    expect(hexInput().value).toBe('3266ff')
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    expect(key('Enter', field('Red')).defaultPrevented).toBe(true)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #3266ff">world</mark>\n')
    expect(saved).toHaveBeenCalledTimes(1)
    expect(view.hasFocus()).toBe(true)
    expect(boxOpen()).toBe(true)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('Escape closes only the box — from the note, the hex field or an R G B field — and a second one the panel', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    expect(key('Escape').defaultPrevented).toBe(true)
    expect(boxOpen()).toBe(false)
    expect(isOpen()).toBe(true)
    key('Escape')
    expect(isOpen()).toBe(false)

    await press('highlight-more')
    clickPencil()
    field('Green').focus()
    key('Escape', field('Green'))
    expect(boxOpen()).toBe(false)
    expect(isOpen()).toBe(true)
    expect(view.hasFocus()).toBe(true)

    hexInput().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    hexInput().focus()
    key('Escape', hexInput())
    expect(boxOpen()).toBe(false)
    expect(isOpen()).toBe(true)
    expect(view.state.selection.empty).toBe(false)
    // Closing the panel takes the box with it: the next open starts without it.
    clickPencil()
    key('Escape', hexInput())
    key('Escape', hexInput())
    expect(isOpen()).toBe(false)
    await press('highlight-more')
    expect(boxOpen()).toBe(false)
  })

  it('the eyedropper: hidden without the browser\'s EyeDropper; with it, its colour is one pick', async () => {
    const win = window as unknown as { EyeDropper?: unknown }
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    const dropper = () => box().querySelector<HTMLButtonElement>('button[aria-label="Pick a colour from the screen"]')!
    expect(dropper().hidden).toBe(true)
    clickPencil()
    win.EyeDropper = class {
      open = () => Promise.resolve({ sRGBHex: '#123456' })
    }
    try {
      clickPencil()
      expect(dropper().hidden).toBe(false)
      dropper().click()
      await settle()
      expect(getMarkdownForSave(crepe)).toBe('hello <mark style="background-color: #123456">world</mark>\n')
      expect(saved).toHaveBeenCalledTimes(1)
      expect([field('Red').value, field('Green').value, field('Blue').value]).toEqual(['18', '52', '86'])
      // Cancelled (Escape in the eyedropper): nothing.
      win.EyeDropper = class {
        open = () => Promise.reject(new DOMException('cancelled', 'AbortError'))
      }
      dropper().click()
      await settle()
      expect(saved).toHaveBeenCalledTimes(1)
    } finally {
      delete win.EyeDropper
    }
  })

  it('a box pick after its text was deleted does nothing: the panel and the box are gone', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    clickPencil()
    const enter = field('Red')
    const from = view.state.doc.textContent.indexOf('world') + 1
    view.dispatch(view.state.tr.delete(from, from + 5))
    expect(isOpen()).toBe(false)
    key('Enter', enter)
    expect(getMarkdownForSave(crepe)).not.toContain('<mark')
    expect(view.state.doc.textContent).toBe('hello ')
    expect(saved).not.toHaveBeenCalled()
  })

  it('Escape closes it and goes no further; a mousedown outside closes it; a new selection closes it', async () => {
    const { view } = await mount('hello world\n')
    await select(view, 'world')
    await press('highlight-more')
    const esc = key('Escape')
    expect(esc.defaultPrevented).toBe(true)
    expect(isOpen()).toBe(false)
    expect(view.state.selection.empty).toBe(false)

    await press('highlight-more')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(isOpen()).toBe(false)

    await press('highlight-more')
    await select(view, 'hello')
    expect(isOpen()).toBe(false)
  })

  it('works from the keyboard: the arrows walk the swatches as a grid, Enter picks and the panel stays; a key press on the ▾ opens it on the first swatch', async () => {
    const { crepe, view } = await mount('hello world\n')
    await select(view, 'world')
    // Enter or Space on a focused ▾ is a click with no pointer (detail 0).
    must('highlight-more').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))
    expect(isOpen()).toBe(true)
    const current = () => panel()!.querySelector('.is-current')?.getAttribute('aria-label') ?? null
    expect(current()).toBe('None')
    expect(key('ArrowRight').defaultPrevented).toBe(true)
    expect(current()).toBe('Highlight yellow')
    key('ArrowDown')
    expect(current()).toBe('Highlight purple')
    expect(key('Enter').defaultPrevented).toBe(true)
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <mark class="highlight-purple">world</mark>\n')
    expect(isOpen()).toBe(true)
    expect(current()).toBe('Highlight purple')
    // Purple has shades now: down again is its second shade.
    key('ArrowDown')
    expect(current()).toBe(`Shade 2 ${shadesOf(HIGHLIGHT_HEX.purple)[1]}`)
    key('ArrowDown')
    expect(panel()!.querySelector('.is-current')?.classList.contains('highlight-panel__pencil')).toBe(true)
    key('End')
    expect(current()).toBe('Custom colour…')
    key('Home')
    expect(current()).toBe('None')
    key('ArrowLeft')
    expect(current()).toBe('Custom colour…')
    // Any other key closes it and goes on to the note.
    expect(key('x').defaultPrevented).toBe(false)
    expect(isOpen()).toBe(false)
  })
})
