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

  /** ⌘Z and ⌘⇧Z undo and redo a move (YAZ-3255 D10): the same boundary, so the editor, a field and a sheet keep their own undo (S34). */
  it('maps ⌘Z to undo and ⌘⇧Z to redo on ordinary chrome; Shift is part of each chord, never merely tolerated', () => {
    expect(fileClipboardVerb(event(document.body, { key: 'z' }))).toBe('undo')
    expect(fileClipboardVerb(event(document.body, { key: 'Z', shiftKey: true }))).toBe('redo')
    expect(fileClipboardVerb(event(document.body, { key: 'z', altKey: true }))).toBeNull()
    expect(fileClipboardVerb(event(document.body, { key: 'v', shiftKey: true }))).toBeNull() // ⌘⇧V is no verb of ours
  })

  it('⌘Z and ⌘⇧Z stay with the editor, a field and an open sheet (S34)', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const input = document.createElement('input')
    document.body.append(editor, input)
    for (const target of [editor, input]) {
      expect(fileClipboardVerb(event(target, { key: 'z' }))).toBeNull()
      expect(fileClipboardVerb(event(target, { key: 'z', shiftKey: true }))).toBeNull()
    }
    const sheet = document.createElement('div')
    sheet.setAttribute('aria-modal', 'true')
    document.body.append(sheet)
    expect(fileClipboardVerb(event(document.body, { key: 'z' }))).toBeNull()
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

    it('the focus on <body> with the reader\u2019s selection in a visible read-only body they clicked in: still the note\u2019s', () => {
      const page = document.createElement('div')
      page.dataset.page = 'note'
      document.body.append(page)
      const { body, text } = readOnlyBody(page)
      body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      document.getSelection()!.setBaseAndExtent(text, 0, text, 4)
      for (const key of ['c', 'x', 'v']) expect(fileClipboardVerb(event(document.body, { key })), key).toBeNull()
      // YAZ-3145: a press on blank sidebar space ends the note's claim — ⌘V pastes the copied FILE, as on main.
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      expect(fileClipboardVerb(event(document.body, { key: 'v' }))).toBe('paste')
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

  describe('a page holds the keys (YAZ-3140): the focus on <body>, the selection in a read-only note’s TITLE', () => {
    function titled(): { title: Text } {
      const host = document.createElement('div')
      host.className = 'editor-host'
      host.dataset.page = 'note'
      host.dataset.readOnly = 'true'
      const title = document.createElement('div')
      title.className = 'page-title'
      title.textContent = 'RO doc'
      host.append(title)
      document.body.append(host)
      return { title: title.firstChild as Text }
    }
    afterEach(() => document.getSelection()?.removeAllRanges())

    it('⌘C, ⌘X and ⌘V are the page’s: the native text copy, never the FILE clipboard', () => {
      const { title } = titled()
      title.parentElement!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      document.getSelection()!.setBaseAndExtent(title, 0, title, 2)
      for (const key of ['c', 'x', 'v']) expect(fileClipboardVerb(event(document.body, { key })), key).toBeNull()
    })

    it('a focused sidebar row still copies and pastes files', () => {
      const { title } = titled()
      document.getSelection()!.setBaseAndExtent(title, 0, title, 2)
      const row = document.createElement('button')
      row.className = 'tree__row'
      document.body.append(row)
      expect(fileClipboardVerb(event(row, { key: 'c' }))).toBe('copy')
      expect(fileClipboardVerb(event(row, { key: 'v' }))).toBe('paste')
    })
  })
})
