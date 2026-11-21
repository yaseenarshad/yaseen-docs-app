// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatCardLine, parseCardLine } from '@shared/cardLine'
import CardActionRows from './CardActionRows'
import { cardActions, type CardAction, type CardActionMarks } from './cardActions'
import { TWO_TAP_MS, UNARMED, twoTap } from './twoTap'

/**
 * YAZ-5505: every card setting on the phone needs TWO taps. The first turns the row into "Tap again to …" in place (YAZ-5966: Archive card and a Title in review choice too, as the Mac's click-twice rows);
 * the second within about 3 s does it; anything else cancels. VoiceOver's double tap is ONE activation. Made-up data.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NONE: CardActionMarks = { off: false, next: false, fix: false, notitle: false }

describe('the rule, pure', () => {
  it('one tap arms; the same row again in time fires; late, it arms again; another row arms that one', () => {
    const a = twoTap(UNARMED, 'off', 1000)
    expect(a).toEqual({ state: { armed: 'off', at: 1000 }, fire: false })
    expect(twoTap(a.state, 'off', 1000 + TWO_TAP_MS).fire).toBe(true)
    expect(twoTap(a.state, 'off', 1001 + TWO_TAP_MS)).toEqual({ state: { armed: 'off', at: 1001 + TWO_TAP_MS }, fire: false })
    expect(twoTap(a.state, 'fix', 1500)).toEqual({ state: { armed: 'fix', at: 1500 }, fire: false })
  })
})

describe('the rows: the Mac\'s card menu, its order and words', () => {
  it('Up next (with review on), Archive card, Fix later, Title in review › (hint: the choice now; YAZ-5697 round 2: the one card menu\'s rows)', () => {
    expect(cardActions(NONE, { upNext: true }).map((r) => [r.label, r.hint ?? ''])).toEqual([
      ['Move to Up next', ''],
      ['Archive card', ''],
      ['Fix later', ''],
      ['Title in review', 'Default'],
    ])
    expect(cardActions({ off: true, next: true, fix: true, notitle: true }, { upNext: true }).map((r) => [r.label, r.hint ?? '', r.on])).toEqual([
      ['Remove from Up next', '', false],
      ['Unarchive card', '', false],
      ['Remove Fix later', '', false],
      ['Title in review', 'Never', true],
    ])
    expect(cardActions(NONE, { upNext: false }).map((r) => r.kind)).toEqual(['off', 'fix', 'title'])
  })
  it('each row changes ONLY its own word on the line', () => {
    const line = parseCardLine('<!-- card: NC-1, title "T", 2026-11-01T09:00:00.000Z good -->')!
    const want: Record<string, string> = {
      next: '<!-- card: NC-1, title "T", next, 2026-11-01T09:00:00.000Z good -->',
      off: '<!-- card: NC-1, title "T", off, 2026-11-01T09:00:00.000Z good -->',
      fix: '<!-- card: NC-1, title "T", fix, 2026-11-01T09:00:00.000Z good -->',
      'title-never': '<!-- card: NC-1, title "T", notitle, 2026-11-01T09:00:00.000Z good -->',
    }
    const rows = cardActions(NONE, { upNext: true }).flatMap((r) => r.children ?? [r]).filter((r) => want[r.key] !== undefined)
    expect(rows.map((r) => r.key)).toEqual(['next', 'off', 'fix', 'title-never'])
    for (const row of rows) {
      expect(formatCardLine(row.change(line))).toBe(want[row.key])
      // And its Undo takes it out again.
      expect(formatCardLine(row.undo(row.change(line)))).toBe(formatCardLine(line))
    }
    for (const row of rows.slice(0, 3)) {
      // And the row of the marked card takes it out again.
      const back = cardActions({ ...NONE, [row.kind]: true }, { upNext: true }).find((r) => r.kind === row.kind)!
      expect(formatCardLine(back.change(row.change(line)))).toBe(formatCardLine(line))
    }
  })
})

describe('the rows on the screen', () => {
  let host: HTMLDivElement
  let root: Root
  let done: CardAction[]
  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    done = []
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })
  const draw = (marks: CardActionMarks | null = NONE, show = true) =>
    act(() => root.render(show ? createElement('div', { role: 'menu' }, createElement(CardActionRows, { marks, upNext: true, onAction: (a: CardAction) => void done.push(a) })) : null))
  const row = (kind: string) => host.querySelector<HTMLButtonElement>(`[data-action="${kind}"]`)!
  const live = () => host.querySelector('[aria-live]')!.textContent
  const click = (el: Element) => act(() => (el as HTMLElement).click())
  const down = (el: Element) => act(() => void el.dispatchEvent(new Event('pointerdown', { bubbles: true })))

  it('YAZ-5966: Archive card and a Title in review choice are two taps too (the Mac\'s card menu is click-twice there): "Tap again to …"; no ask; the choice now (✓) does nothing', () => {
    draw()
    click(row('off'))
    expect(done).toEqual([])
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect([row('off').textContent, live()]).toEqual(['Tap again to archive', 'Tap again to archive'])
    // A tap outside cancels.
    down(document.body)
    expect(row('off').textContent).toBe('Archive card')
    click(row('title'))
    click(row('title-never'))
    expect(row('title-never').textContent).toBe('Tap again to never show the title')
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(row('title-never').textContent).toBe('Never')
    click(row('title-default'))
    expect(row('title-default').hasAttribute('data-armed')).toBe(false)
    click(row('title-never'))
    click(row('title-never'))
    click(row('off'))
    click(row('off'))
    expect(done.map((a) => [a.key, a.on])).toEqual([['title-never', true], ['off', true]])
  })

  it('one tap does nothing but arm: the row says "Tap again to mark Fix later" in place, and VoiceOver hears it', () => {
    draw()
    const fix = row('fix')
    click(fix)
    expect(done).toEqual([])
    expect(row('fix')).toBe(fix) // the same element: focus stays
    expect(fix.textContent).toBe('Tap again to mark Fix later')
    expect(fix.hasAttribute('data-armed')).toBe(true)
    expect(live()).toBe('Tap again to mark Fix later')
    expect(host.querySelectorAll('[role="dialog"], [role="alertdialog"]')).toHaveLength(0) // no pop-up
  })

  it('two taps do it; the row is back to its words after', () => {
    draw()
    click(row('next'))
    expect(row('next').textContent).toBe('Tap again to move it to Up next')
    click(row('next'))
    expect(done.map((a) => [a.kind, a.on])).toEqual([['next', true]])
    expect(row('next').textContent).toBe('Move to Up next')
    expect(live()).toBe('')
  })

  it('the time passes (3 s): the row disarms; a tap after that only arms again', () => {
    draw()
    click(row('fix'))
    act(() => void vi.advanceTimersByTime(TWO_TAP_MS - 100))
    expect(row('fix').textContent).toBe('Tap again to mark Fix later')
    act(() => void vi.advanceTimersByTime(200))
    expect(row('fix').textContent).toBe('Fix later')
    expect(live()).toBe('')
    click(row('fix'))
    expect(done).toEqual([])
    click(row('fix'))
    expect(done.map((a) => a.kind)).toEqual(['fix'])
  })

  it('cancels: another row (which arms instead), a tap outside, Escape, and the menu closing', () => {
    draw()
    click(row('next'))
    click(row('fix'))
    expect(row('next').textContent).toBe('Move to Up next')
    expect(row('fix').textContent).toBe('Tap again to mark Fix later')
    click(row('next'))
    expect(done).toEqual([]) // Up next was disarmed by the other row: this tap only arms it

    down(document.body)
    expect(row('fix').textContent).toBe('Fix later')
    click(row('fix'))
    expect(done).toEqual([])
    down(document.body)
    click(row('fix'))
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(row('fix').textContent).toBe('Fix later')
    click(row('fix'))
    expect(done).toEqual([])

    click(row('next'))
    draw(NONE, false) // the menu closes
    draw()
    expect(row('next').textContent).toBe('Move to Up next')
    click(row('next'))
    expect(done).toEqual([])
  })

  it('a tap on the armed row itself (its pointerdown) does not cancel it', () => {
    draw()
    click(row('fix'))
    down(row('fix').querySelector('span')!)
    click(row('fix'))
    expect(done.map((a) => a.kind)).toEqual(['fix'])
  })

  it('VoiceOver: its double tap is ONE activation (one click, or Enter), so a change needs two', () => {
    draw()
    const fix = row('fix')
    fix.focus()
    click(fix) // VoiceOver's first double tap
    expect(done).toEqual([])
    expect(document.activeElement).toBe(fix)
    expect(live()).toBe('Tap again to mark Fix later')
    click(fix) // the second
    expect(done.map((a) => a.kind)).toEqual(['fix'])
  })

  it('while the marks are read, the rows wait (disabled)', () => {
    draw(null)
    expect([...host.querySelectorAll('button')].every((b) => b.disabled)).toBe(true)
  })
})
