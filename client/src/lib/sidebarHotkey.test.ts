import { afterEach, describe, expect, it } from 'vitest'
import { ownsSidebarHotkey } from './sidebarHotkey'

function event(target: EventTarget, over: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'b',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    target,
    ...over,
  } as KeyboardEvent
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('ownsSidebarHotkey', () => {
  it('accepts plain Meta+B case-insensitively on ordinary application chrome', () => {
    const button = document.createElement('button')
    document.body.append(button)
    expect(ownsSidebarHotkey(event(button))).toBe(true)
    expect(ownsSidebarHotkey(event(document.body, { key: 'B' }))).toBe(true)
  })

  it('follows the key the user gave it (YAZ-3397 D2): ⌃⌥S, by its physical key; ⌘B then is not it; "No key" owns nothing', () => {
    const button = document.createElement('button')
    document.body.append(button)
    const moved = { toggleSidebar: 'Control+Alt+S' }
    // ⌥ changes `key` on a Mac (⌥S is 'ß'): the physical key is what counts.
    expect(ownsSidebarHotkey(event(button, { key: 'ß', code: 'KeyS', metaKey: false, ctrlKey: true, altKey: true }), moved)).toBe(true)
    expect(ownsSidebarHotkey(event(button), moved)).toBe(false)
    expect(ownsSidebarHotkey(event(button), { toggleSidebar: null })).toBe(false)
  })

  it('a saved key that is not a letter fires (YAZ-3410 item 1): ⌘Space, ⌘⇧↑ and ⌘⇧1 by their physical key; a different key does not', () => {
    const button = document.createElement('button')
    document.body.append(button)
    // `key` is ' ', 'ArrowUp' and '!' (⇧1 on a US Mac): none of them spells the accelerator key.
    expect(ownsSidebarHotkey(event(button, { key: ' ', code: 'Space' }), { toggleSidebar: 'CmdOrCtrl+Space' })).toBe(true)
    expect(ownsSidebarHotkey(event(button, { key: 'ArrowUp', code: 'ArrowUp', shiftKey: true }), { toggleSidebar: 'CmdOrCtrl+Shift+Up' })).toBe(true)
    expect(ownsSidebarHotkey(event(button, { key: '!', code: 'Digit1', shiftKey: true }), { toggleSidebar: 'CmdOrCtrl+Shift+1' })).toBe(true)
    // The default ⌘B still fires, and another key with the same modifiers does not.
    expect(ownsSidebarHotkey(event(button, { code: 'KeyB' }))).toBe(true)
    expect(ownsSidebarHotkey(event(button, { key: 'ArrowDown', code: 'ArrowDown', shiftKey: true }), { toggleSidebar: 'CmdOrCtrl+Shift+Up' })).toBe(false)
    expect(ownsSidebarHotkey(event(button, { key: '@', code: 'Digit2', shiftKey: true }), { toggleSidebar: 'CmdOrCtrl+Shift+1' })).toBe(false)
    // A letter is matched by what it types, never by its place: Dvorak's ⌘B is on the physical N key.
    expect(ownsSidebarHotkey(event(button, { key: 'n', code: 'KeyB' }))).toBe(false)
  })

  it.each([
    ['no Command', { metaKey: false }],
    ['Control', { ctrlKey: true }],
    ['Option', { altKey: true }],
    ['Shift', { shiftKey: true }],
    ['another key', { key: 'k' }],
    ['already consumed', { defaultPrevented: true }],
    ['repeat', { repeat: true }],
    ['composition', { isComposing: true }],
  ])('declines %s', (_name, over) => {
    expect(ownsSidebarHotkey(event(document.body, over))).toBe(false)
  })

  it.each(['input', 'textarea', 'select'])('declines a %s target or descendant', (tag) => {
    const field = document.createElement(tag)
    const child = document.createElement('span')
    field.append(child)
    document.body.append(field)
    expect(ownsSidebarHotkey(event(field))).toBe(false)
    expect(ownsSidebarHotkey(event(child))).toBe(false)
  })

  it('declines an enabled contenteditable target or descendant, but not contenteditable=false', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    editable.append(child)
    const disabled = document.createElement('div')
    disabled.setAttribute('contenteditable', 'false')
    document.body.append(editable, disabled)
    expect(ownsSidebarHotkey(event(editable))).toBe(false)
    expect(ownsSidebarHotkey(event(child))).toBe(false)
    expect(ownsSidebarHotkey(event(disabled))).toBe(true)
  })

  it('declines everywhere while an aria-modal tool is open, including canvas/overlay targets', () => {
    const canvas = document.createElement('canvas')
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    modal.append(canvas)
    const outside = document.createElement('button')
    document.body.append(modal, outside)
    expect(ownsSidebarHotkey(event(canvas))).toBe(false)
    expect(ownsSidebarHotkey(event(outside))).toBe(false)
  })

  it('declines a non-Element target instead of guessing ownership', () => {
    expect(ownsSidebarHotkey(event(window))).toBe(false)
  })
})
