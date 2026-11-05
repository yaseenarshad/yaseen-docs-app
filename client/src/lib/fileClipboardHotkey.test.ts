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

  it('⌘Z and ⌘⇧Z stay with every page, also where its own history is empty and it lets the key pass: a note page, a drawing, a diagram (audit 22)', () => {
    const pages = ['data-page', 'editor--drawing', 'editor--diagram'].map((kind) => {
      const page = document.createElement('section')
      if (kind === 'data-page') page.setAttribute('data-page', 'note')
      else page.className = `editor ${kind}`
      const inside = document.createElement('canvas') // the drawing's canvas, a page's margin: focusable, not editable
      inside.tabIndex = 0
      page.append(inside)
      document.body.append(page)
      return inside
    })
    for (const target of pages) {
      expect(fileClipboardVerb(event(target, { key: 'z' }))).toBeNull()
      expect(fileClipboardVerb(event(target, { key: 'z', shiftKey: true }))).toBeNull()
    }
    expect(fileClipboardVerb(event(document.body, { key: 'z' }))).toBe('undo')
  })

  /** ⌘⌫ deletes the selection (YAZ-3272 D20): Finder's Move to Trash. A plain ⌫ is no verb, and every owner of ⌘Z keeps ⌘⌫ too (S68, S69). */
  it('maps ⌘⌫ to delete on ordinary chrome; plain ⌫, ⌘⇧⌫, ⌥⌘⌫, ⌃⌫ and the forward Delete key are no verb (S68)', () => {
    expect(fileClipboardVerb(event(document.body, { key: 'Backspace' }))).toBe('delete')
    expect(fileClipboardVerb(event(document.body, { key: 'Backspace', metaKey: false }))).toBeNull()
    expect(fileClipboardVerb(event(document.body, { key: 'Backspace', shiftKey: true }))).toBeNull()
    expect(fileClipboardVerb(event(document.body, { key: 'Backspace', altKey: true }))).toBeNull()
    expect(fileClipboardVerb(event(document.body, { key: 'Backspace', metaKey: false, ctrlKey: true }))).toBeNull()
    expect(fileClipboardVerb(event(document.body, { key: 'Delete' }))).toBeNull()
    expect(fileClipboardVerb(event(document.body, { key: 'Backspace', repeat: true }))).toBeNull() // a held ⌘⌫ asks once
  })

  it('⌘⌫ stays with the editor, a field, an open sheet, a note page, a drawing and a diagram (S69)', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const input = document.createElement('input')
    document.body.append(editor, input)
    const pages = ['data-page', 'editor--drawing', 'editor--diagram'].map((kind) => {
      const page = document.createElement('section')
      if (kind === 'data-page') page.setAttribute('data-page', 'note')
      else page.className = `editor ${kind}`
      const inside = document.createElement('canvas')
      inside.tabIndex = 0
      page.append(inside)
      document.body.append(page)
      return inside
    })
    for (const target of [editor, input, ...pages]) expect(fileClipboardVerb(event(target, { key: 'Backspace' }))).toBeNull()
    expect(fileClipboardVerb(event(document.body, { key: 'Backspace' }))).toBe('delete')
    const sheet = document.createElement('div')
    sheet.setAttribute('aria-modal', 'true')
    document.body.append(sheet)
    expect(fileClipboardVerb(event(document.body, { key: 'Backspace' }))).toBeNull()
  })

  /** A board's ⌘V pastes the system clipboard's picture, never a copied sidebar file (YAZ-4372). */
  it('⌘V with the focus on a board answers no file verb (YAZ-4372)', () => {
    const page = document.createElement('section')
    page.className = 'editor editor--drawing'
    const container = document.createElement('div') // the engine's `.excalidraw` container: `tabIndex=0`, the focus after a click on the canvas
    container.className = 'excalidraw'
    container.tabIndex = 0
    page.append(container)
    document.body.append(page)
    expect(fileClipboardVerb(event(container, { key: 'v' }))).toBeNull()
  })

  it('a board and a diagram keep ⌘C, ⌘X and ⌘V; a sidebar row and ordinary chrome still get them; a note page keeps today\u2019s rules (YAZ-4372)', () => {
    const inside = (kind: string): HTMLElement => {
      const page = document.createElement('section')
      if (kind === 'data-page') page.setAttribute('data-page', 'note')
      else page.className = `editor ${kind}`
      const el = document.createElement('div') // focusable, not editable: the engine's container, the diagram's host, a note page's margin
      el.tabIndex = 0
      page.append(el)
      document.body.append(page)
      return el
    }
    const board = inside('editor--drawing')
    const diagram = inside('editor--diagram')
    const noteMargin = inside('data-page')
    const row = document.createElement('button')
    row.className = 'tree__row'
    document.body.append(row)
    for (const [key, verb] of [['c', 'copy'], ['x', 'cut'], ['v', 'paste']] as const) {
      expect(fileClipboardVerb(event(board, { key })), `board ${key}`).toBeNull()
      expect(fileClipboardVerb(event(diagram, { key })), `diagram ${key}`).toBeNull()
      expect(fileClipboardVerb(event(row, { key })), `row ${key}`).toBe(verb)
      expect(fileClipboardVerb(event(document.body, { key })), `body ${key}`).toBe(verb)
      // Today's rule for a note page: a focused margin with no text selection in it is no page text, so the sidebar keeps the chord (D6, YAZ-3140).
      expect(fileClipboardVerb(event(noteMargin, { key })), `note ${key}`).toBe(verb)
    }
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
