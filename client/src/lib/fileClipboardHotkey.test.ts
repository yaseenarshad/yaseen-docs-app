/**
 * ⌘C / ⌘X / ⌘V ownership for the file clipboard (D6 amended, YAZ-1674): `ownsCopyPathHotkey`'s
 * sibling on the SAME boundary (`ownsWindowChord`) — the boundary's own cases live in
 * `copyPathHotkey.test.ts`; this pins the verb map and the two rules that are this chord's own:
 * Shift never means us (⌘⇧C is Copy path), and the editor keeps its text copy/paste.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fileClipboardVerb } from './fileClipboardHotkey'

function event(target: EventTarget, over: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: 'c', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, repeat: false, isComposing: false, target, ...over } as KeyboardEvent
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('fileClipboardVerb (YAZ-1674, D6)', () => {
  it.each([
    ['c', 'copy'],
    ['x', 'cut'],
    ['v', 'paste'],
    ['C', 'copy'],
  ] as const)('maps ⌘%s to %s on ordinary chrome', (key, verb) => {
    expect(fileClipboardVerb(event(document.body, { key }))).toBe(verb)
  })

  it.each([
    ['Shift — ⌘⇧C is Copy path', { shiftKey: true }],
    ['Control — the platform menu’s spelling', { metaKey: false, ctrlKey: true }],
    ['Option', { altKey: true }],
    ['another key', { key: 'a' }],
    ['already consumed', { defaultPrevented: true }],
  ])('declines %s', (_name, over) => {
    expect(fileClipboardVerb(event(document.body, over))).toBeNull()
  })

  it('leaves the editor its own copy/paste: a contenteditable target is never ours', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const inside = document.createElement('p')
    editor.append(inside)
    document.body.append(editor)
    expect(fileClipboardVerb(event(inside, { key: 'v' }))).toBeNull()
    expect(fileClipboardVerb(event(inside, { key: 'x' }))).toBeNull()
  })

  it('leaves a field its own copy/paste: the inline rename box keeps ⌘C', () => {
    const input = document.createElement('input')
    document.body.append(input)
    expect(fileClipboardVerb(event(input))).toBeNull()
  })

  describe('a read-only note (YAZ-3127, D8): its body keeps ⌘C / ⌘X / ⌘V — never the FILE clipboard', () => {
    /** A read-only note body as ProseMirror draws it: `contenteditable="false"`, with a text node. */
    function readOnlyBody(parent: HTMLElement = document.body): { body: HTMLElement; text: Text } {
      const body = document.createElement('div')
      body.className = 'ProseMirror'
      body.setAttribute('contenteditable', 'false')
      body.tabIndex = -1
      const text = document.createTextNode('read-only text')
      body.append(text)
      parent.append(body)
      return { body, text }
    }
    afterEach(() => document.getSelection()?.removeAllRanges())

    it('the focus in the read-only body: ⌘C, ⌘X and ⌘V are the note\u2019s', () => {
      const { body } = readOnlyBody()
      for (const key of ['c', 'x', 'v']) expect(fileClipboardVerb(event(body, { key })), key).toBeNull()
    })

    it('the focus on <body> with the reader\u2019s selection in a visible read-only body: still the note\u2019s', () => {
      const { text } = readOnlyBody()
      document.getSelection()!.setBaseAndExtent(text, 0, text, 4)
      for (const key of ['c', 'x', 'v']) expect(fileClipboardVerb(event(document.body, { key })), key).toBeNull()
    })

    it('a selection left in a HIDDEN tab\u2019s read-only body claims nothing: the chrome keeps its chord', () => {
      const layer = document.createElement('div')
      layer.style.visibility = 'hidden'
      document.body.append(layer)
      const { text } = readOnlyBody(layer)
      document.getSelection()!.setBaseAndExtent(text, 0, text, 4)
      expect(fileClipboardVerb(event(document.body))).toBe('copy')
    })
  })
})
