import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST_ACTIVATE_REFOCUS_MS, RESTORE_FOCUS_FALLBACK_MS, focusSingleWindow, type FocusableWindow } from './singleWindowFocus'

class FakeFocusableWindow implements FocusableWindow {
  destroyed = false
  minimized = false
  visible = true
  focused = true
  private listeners = new Map<'restore' | 'closed', Set<() => void>>()

  constructor(
    public readonly name: string,
    private readonly log: string[],
    init?: { destroyed?: boolean; minimized?: boolean; visible?: boolean; focused?: boolean },
  ) {
    if (init?.destroyed !== undefined) this.destroyed = init.destroyed
    if (init?.minimized !== undefined) this.minimized = init.minimized
    if (init?.visible !== undefined) this.visible = init.visible
    if (init?.focused !== undefined) this.focused = init.focused
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  isMinimized(): boolean {
    return this.minimized
  }

  isVisible(): boolean {
    return this.visible
  }

  isFocused(): boolean {
    return this.focused
  }

  show(): void {
    this.visible = true
    this.log.push(`${this.name}:show`)
  }

  hide(): void {
    this.visible = false
    this.log.push(`${this.name}:hide`)
  }

  restore(): void {
    this.minimized = false
    this.log.push(`${this.name}:restore`)
  }

  moveTop(): void {
    this.log.push(`${this.name}:moveTop`)
  }

  focus(): void {
    this.log.push(`${this.name}:focus`)
  }

  once(event: 'restore' | 'closed', listener: () => void): this {
    let set = this.listeners.get(event)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return this
  }

  off(event: 'restore' | 'closed', listener: () => void): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: 'restore' | 'closed'): void {
    const list = [...(this.listeners.get(event) ?? [])]
    this.listeners.get(event)?.clear()
    if (event === 'closed') this.destroyed = true
    for (const listener of list) listener()
  }

  listenerCount(event: 'restore' | 'closed'): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

describe('focusSingleWindow (YAZ-6595 D1/D2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is a no-op when target is already destroyed', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { destroyed: true })
    const sibling = new FakeFocusableWindow('sibling', log)
    const showApp = vi.fn(() => log.push('app:show'))
    const stealAppFocus = vi.fn(() => log.push('app:stealFocus'))

    focusSingleWindow(target, {
      isMac: true,
      isAppHidden: () => true,
      showApp,
      stealAppFocus,
      siblingWindows: () => [target, sibling],
    })

    expect(log).toEqual([])
    expect(showApp).not.toHaveBeenCalled()
    expect(stealAppFocus).not.toHaveBeenCalled()
  })

  it('calls moveTop, focus, and stealAppFocus on macOS for a visible target without calling show or hiding siblings', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { visible: true, focused: true })
    const sibling = new FakeFocusableWindow('sibling', log, { visible: true })

    focusSingleWindow(target, {
      isMac: true,
      isAppHidden: () => false,
      showApp: () => log.push('app:show'),
      stealAppFocus: () => log.push('app:stealFocus'),
      siblingWindows: () => [target, sibling],
    })

    expect(log).toEqual(['target:moveTop', 'target:focus', 'app:stealFocus'])
    expect(sibling.isVisible()).toBe(true)

    // When target is already focused after stealAppFocus, the post-activation timer is a no-op.
    vi.advanceTimersByTime(POST_ACTIVATE_REFOCUS_MS + 10)
    expect(log).toEqual(['target:moveTop', 'target:focus', 'app:stealFocus'])
    expect(target.listenerCount('closed')).toBe(0)
  })

  it('re-focuses target once after stealAppFocus if macOS cross-display activation left target unfocused', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { visible: true, focused: false })

    focusSingleWindow(target, {
      isMac: true,
      isAppHidden: () => false,
      stealAppFocus: () => log.push('app:stealFocus'),
    })

    expect(log).toEqual(['target:moveTop', 'target:focus', 'app:stealFocus'])
    vi.advanceTimersByTime(POST_ACTIVATE_REFOCUS_MS - 1)
    expect(log).toEqual(['target:moveTop', 'target:focus', 'app:stealFocus'])

    vi.advanceTimersByTime(1)
    expect(log).toEqual(['target:moveTop', 'target:focus', 'app:stealFocus', 'target:moveTop', 'target:focus'])
    expect(target.listenerCount('closed')).toBe(0)
  })

  it('cancels a prior window post-activation refocus when another window is focused immediately after', () => {
    const log: string[] = []
    const winA = new FakeFocusableWindow('winA', log, { visible: true, focused: false })
    const winB = new FakeFocusableWindow('winB', log, { visible: true, focused: true })

    focusSingleWindow(winA, { isMac: true, stealAppFocus: () => log.push('app:stealFocus') })
    vi.advanceTimersByTime(20)
    focusSingleWindow(winB, { isMac: true, stealAppFocus: () => log.push('app:stealFocus') })
    vi.advanceTimersByTime(POST_ACTIVATE_REFOCUS_MS + 20)

    expect(log).toEqual(['winA:moveTop', 'winA:focus', 'app:stealFocus', 'winB:moveTop', 'winB:focus', 'app:stealFocus'])
    expect(winA.listenerCount('closed')).toBe(0)
    expect(winB.listenerCount('closed')).toBe(0)
  })

  it('calls show before moveTop, focus, and stealAppFocus when recalling a hidden target on macOS', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { visible: false, focused: true })

    focusSingleWindow(target, {
      isMac: true,
      isAppHidden: () => false,
      stealAppFocus: () => log.push('app:stealFocus'),
    })

    expect(log).toEqual(['target:show', 'target:moveTop', 'target:focus', 'app:stealFocus'])
    expect(target.isVisible()).toBe(true)
  })

  it('on macOS, waits for restore event before raising a minimized target and cleans up listeners and timer', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { minimized: true })

    focusSingleWindow(target, { isMac: true, stealAppFocus: () => log.push('app:stealFocus') })

    expect(log).toEqual(['target:restore'])
    expect(target.listenerCount('restore')).toBe(1)
    expect(target.listenerCount('closed')).toBe(1)

    target.emit('restore')

    expect(log).toEqual(['target:restore', 'target:moveTop', 'target:focus', 'app:stealFocus'])
    expect(target.listenerCount('restore')).toBe(0)

    // Advancing past both the post-activation refocus and fallback windows cleans up closed listener and never raises twice.
    vi.advanceTimersByTime(RESTORE_FOCUS_FALLBACK_MS + 100)
    expect(target.listenerCount('closed')).toBe(0)
    expect(log).toEqual(['target:restore', 'target:moveTop', 'target:focus', 'app:stealFocus'])
  })

  it('on macOS, raises via fallback timer if restore event never fires', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { minimized: true })

    focusSingleWindow(target, { isMac: true, stealAppFocus: () => log.push('app:stealFocus') })

    vi.advanceTimersByTime(RESTORE_FOCUS_FALLBACK_MS - 1)
    expect(log).toEqual(['target:restore'])

    vi.advanceTimersByTime(1)
    expect(log).toEqual(['target:restore', 'target:moveTop', 'target:focus', 'app:stealFocus'])
    expect(target.listenerCount('restore')).toBe(0)

    vi.advanceTimersByTime(POST_ACTIVATE_REFOCUS_MS)
    expect(target.listenerCount('closed')).toBe(0)

    // Late restore event after fallback is ignored.
    target.emit('restore')
    expect(log).toEqual(['target:restore', 'target:moveTop', 'target:focus', 'app:stealFocus'])
  })

  it('on macOS, cancels fallback timer and listeners if minimized target closes before restore', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { minimized: true })

    focusSingleWindow(target, { isMac: true })
    expect(target.listenerCount('restore')).toBe(1)
    expect(target.listenerCount('closed')).toBe(1)

    target.emit('closed')
    expect(target.listenerCount('restore')).toBe(0)
    expect(target.listenerCount('closed')).toBe(0)

    vi.advanceTimersByTime(RESTORE_FOCUS_FALLBACK_MS + 100)
    expect(log).toEqual(['target:restore'])
  })

  it('on non-macOS, raises a minimized target synchronously after restore without listeners', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { minimized: true })

    focusSingleWindow(target, { isMac: false })

    expect(log).toEqual(['target:restore', 'target:moveTop', 'target:focus'])
    expect(target.listenerCount('restore')).toBe(0)
    expect(target.listenerCount('closed')).toBe(0)
  })

  it('under Cmd+H (isAppHidden true on macOS), hides non-minimized non-destroyed siblings, calls showApp, raises target, and calls stealAppFocus', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { visible: false })
    const openSibling = new FakeFocusableWindow('openSibling', log, { visible: true })
    const minimizedSibling = new FakeFocusableWindow('minimizedSibling', log, { minimized: true })
    const destroyedSibling = new FakeFocusableWindow('destroyedSibling', log, { destroyed: true })

    focusSingleWindow(target, {
      isMac: true,
      isAppHidden: () => true,
      showApp: () => log.push('app:show'),
      stealAppFocus: () => log.push('app:stealFocus'),
      siblingWindows: () => [target, openSibling, minimizedSibling, destroyedSibling],
    })

    expect(log).toEqual([
      'openSibling:hide',
      'app:show',
      'target:show',
      'target:moveTop',
      'target:focus',
      'app:stealFocus',
    ])
    expect(openSibling.isVisible()).toBe(false)
    expect(minimizedSibling.isMinimized()).toBe(true)
  })

  it('under Cmd+H with a minimized target on macOS, hides siblings and calls showApp BEFORE restore(), then steals focus after restore', () => {
    const log: string[] = []
    let appHidden = true
    const target = new FakeFocusableWindow('target', log, { minimized: true })
    const openSibling = new FakeFocusableWindow('openSibling', log, { visible: true })
    const hiddenSiblings: string[] = []
    const shownTargets: string[] = []

    focusSingleWindow(target, {
      isMac: true,
      isAppHidden: () => appHidden,
      showApp: () => {
        appHidden = false
        log.push('app:show')
      },
      stealAppFocus: () => log.push('app:stealFocus'),
      siblingWindows: () => [target, openSibling],
      onSiblingHidden: (s) => hiddenSiblings.push(s === openSibling ? 'openSibling' : 'other'),
      onTargetShown: (t) => shownTargets.push(t === target ? 'target' : 'other'),
    })

    expect(log).toEqual(['openSibling:hide', 'app:show', 'target:restore'])
    expect(hiddenSiblings).toEqual(['openSibling'])
    expect(shownTargets).toEqual([])

    target.emit('restore')

    expect(log).toEqual([
      'openSibling:hide',
      'app:show',
      'target:restore',
      'target:moveTop',
      'target:focus',
      'app:stealFocus',
    ])
    expect(shownTargets).toEqual(['target'])
  })

  it('dedupes rapid repeated focusSingleWindow calls while a minimized target is restoring on macOS', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { minimized: true })

    focusSingleWindow(target, { isMac: true, restoreFallbackMs: 800 })
    // Simulate macOS still reporting isMinimized() = true while deminiaturization animates.
    target.minimized = true
    focusSingleWindow(target, { isMac: true, restoreFallbackMs: 800 })

    expect(target.listenerCount('restore')).toBe(1)
    expect(target.listenerCount('closed')).toBe(1)

    target.emit('restore')
    vi.advanceTimersByTime(1000)

    expect(log).toEqual(['target:restore', 'target:restore', 'target:moveTop', 'target:focus'])
    expect(target.listenerCount('restore')).toBe(0)
    expect(target.listenerCount('closed')).toBe(0)
  })

  it('preserves Cmd+H stealAppFocus across rapid repeated triggers on a minimized target on macOS', () => {
    const log: string[] = []
    let appHidden = true
    const target = new FakeFocusableWindow('target', log, { minimized: true })
    const sibling = new FakeFocusableWindow('sibling', log, { visible: true })
    const opts = {
      isMac: true,
      isAppHidden: () => appHidden,
      showApp: () => {
        appHidden = false
        log.push('app:show')
      },
      stealAppFocus: () => log.push('app:stealFocus'),
      siblingWindows: () => [target, sibling],
    }

    focusSingleWindow(target, opts)
    target.minimized = true
    focusSingleWindow(target, opts)

    expect(target.listenerCount('restore')).toBe(1)
    target.emit('restore')

    expect(log).toEqual([
      'sibling:hide',
      'app:show',
      'target:restore',
      'target:restore',
      'target:moveTop',
      'target:focus',
      'app:stealFocus',
    ])
  })

  it('does not hide siblings or call showApp/stealAppFocus on non-macOS even if isAppHidden returns true', () => {
    const log: string[] = []
    const target = new FakeFocusableWindow('target', log, { visible: true })
    const sibling = new FakeFocusableWindow('sibling', log, { visible: true })

    focusSingleWindow(target, {
      isMac: false,
      isAppHidden: () => true,
      showApp: () => log.push('app:show'),
      stealAppFocus: () => log.push('app:stealFocus'),
      siblingWindows: () => [target, sibling],
    })

    expect(log).toEqual(['target:moveTop', 'target:focus'])
    expect(sibling.isVisible()).toBe(true)
  })
})
