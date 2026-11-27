// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ARROW_SCROLL_FRACTION, ARROW_SCROLL_MIN_PX, BLANK_BOTTOM_MARGIN_PX, LAND_LINE, SPACE_PAGE_FRACTION } from '@client/review/inboxScroll'
import { glideCard, resetCardScroll, tapMove } from './cardScroll'

const rect = (top: number, bottom: number): DOMRect => ({ top, bottom, left: 0, right: 390, width: 390, height: bottom - top, x: 0, y: top, toJSON: () => ({}) })

function makeStage({ height = 640, footHeight = 40, scrollHeight = 2640, scrollTop = 0 }: { height?: number; footHeight?: number; scrollHeight?: number; scrollTop?: number } = {}) {
  const stage = document.createElement('div')
  const scrollTo = vi.fn()
  stage.scrollTo = scrollTo as unknown as typeof stage.scrollTo
  stage.getBoundingClientRect = () => rect(0, height)
  Object.defineProperty(stage, 'clientHeight', { value: height, configurable: true })
  Object.defineProperty(stage, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(stage, 'scrollTop', { value: scrollTop, writable: true, configurable: true })

  const foot = document.createElement('div')
  foot.className = 'review__foot'
  foot.getBoundingClientRect = () => rect(height - footHeight, height)
  stage.append(foot)

  return { stage, scrollTo }
}

describe('YAZ-6598: mobile tapMove parity with desktop planSpaceMove', () => {
  it('step-scrolls off-screen blanks in scroll mode (default) and jumps directly in jump mode', () => {
    // Stage height 640, foot 40 -> room [0, 600], land line 200, readStep = round(640 * 0.35) = 224.
    const { stage } = makeStage({ height: 640, footHeight: 40, scrollHeight: 2640 })
    const blank = document.createElement('span')
    blank.dataset.hidden = '0'
    blank.getBoundingClientRect = () => rect(1100, 1120)
    stage.append(blank)

    const readStep = Math.max(ARROW_SCROLL_MIN_PX, Math.round(640 * ARROW_SCROLL_FRACTION))
    expect(tapMove(stage, 0)).toBe(readStep)
    expect(tapMove(stage, 0, 'scroll')).toBe(readStep)
    expect(tapMove(stage, 0, 'jump')).toBe(1100 - Math.round(600 * LAND_LINE))
  })

  it('requires 32 px bottom breathing room in scroll mode when scroll room remains, and reveals at scroll bottom', () => {
    // room [0, 600], bottom margin threshold = 568.
    const { stage } = makeStage({ height: 640, footHeight: 40, scrollHeight: 1640, scrollTop: 0 })
    const blank = document.createElement('span')
    blank.dataset.hidden = '0'
    // Sitting inside the bottom 32 px strip above the hint line (575..595).
    blank.getBoundingClientRect = () => rect(600 - BLANK_BOTTOM_MARGIN_PX + 7, 595)
    stage.append(blank)

    const readStep = Math.max(ARROW_SCROLL_MIN_PX, Math.round(640 * ARROW_SCROLL_FRACTION))
    expect(tapMove(stage, 0, 'scroll')).toBe(readStep)
    expect(tapMove(stage, 0, 'jump')).toBe(0)

    // At scroll bottom (no remainingDown): reveals immediately even inside the bottom 32 px strip.
    stage.scrollTop = 1000
    expect(tapMove(stage, 0, 'scroll')).toBe(0)
  })

  it('step-scrolls side and end targets in scroll mode vs direct/70% page in jump mode', () => {
    const { stage } = makeStage({ height: 640, footHeight: 40, scrollHeight: 2640 })
    const body = document.createElement('div')
    body.className = 'phone-card__body'
    body.getBoundingClientRect = () => rect(20, 1100)
    stage.append(body)

    const readStep = Math.max(ARROW_SCROLL_MIN_PX, Math.round(640 * ARROW_SCROLL_FRACTION))
    expect(tapMove(stage, 'side', 'scroll')).toBe(readStep)
    expect(tapMove(stage, 'side', 'jump')).toBe(1100 - 200)

    expect(tapMove(stage, 'end', 'scroll')).toBe(readStep)
    expect(tapMove(stage, 'end', 'jump')).toBe(Math.round(600 * SPACE_PAGE_FRACTION))
  })

  it('chains rapid taps within 300 ms from the pending glide target without stalling or prematurely revealing', () => {
    // Stage height 600, foot 0 -> room [0, 600], readStep = 210, bottom margin = 568.
    const { stage, scrollTo } = makeStage({ height: 600, footHeight: 0, scrollHeight: 2600, scrollTop: 0 })
    const blank = document.createElement('span')
    blank.dataset.hidden = '0'
    // Live rect stays at [800, 820] while scrollTop stays 0 (smooth scroll in flight).
    blank.getBoundingClientRect = () => rect(800, 820)
    stage.append(blank)

    // Tap 1: blank at 800..820 -> step 210 -> target 210 (predicted blank: 590..610).
    const m1 = tapMove(stage, 0, 'scroll')
    expect(m1).toBe(210)
    glideCard(stage, m1)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 210, behavior: 'smooth' })

    // Tap 2: predicted blank 590..610 (still below 600) -> step 210 -> target 420 (predicted blank: 380..400).
    const m2 = tapMove(stage, 0, 'scroll')
    expect(m2).toBe(210)
    glideCard(stage, m2)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 420, behavior: 'smooth' })

    // Tap 3: predicted blank 380..400 (comfortably <= 568) -> returns 0 (reveal!).
    expect(tapMove(stage, 0, 'scroll')).toBe(0)

    // Resetting scroll chain (e.g. next card) clears pending target so tapMove reads live scrollTop (0) again.
    resetCardScroll(stage)
    expect(tapMove(stage, 0, 'scroll')).toBe(210)
  })
})
