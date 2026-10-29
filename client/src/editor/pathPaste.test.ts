/**
 * Paste a path, get a link (YAZ-3609) against a real Crepe editor. The scenario keys (P, K, U, L)
 * are the approved tables on the working log YAZ-3610.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { LinkCandidate } from '../links/completion'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { hrefTarget, type PathPasteOptions } from './pathPaste'
import { createWikilinkCandidateSource } from './wikilink/wikilinkPicker'

const row = (path: string, insert: string): LinkCandidate => ({ name: insert, insert, label: insert, path })
const ROWS = [
  row('/v/projects/roadmap-yaz-12.md', 'YAZ-12'),
  row('/v/projects/roadmap-yaz-12.md', 'YAZ-12|Plan'),
  row('/v/research', 'YAZ-7'),
  row('/v/refs/My Report.pdf', 'My Report.pdf'),
]

function optionsFor(root: string, notePath: string, rows: LinkCandidate[] = ROWS): PathPasteOptions {
  const candidates = createWikilinkCandidateSource()
  candidates.update(rows)
  return { root, notePath, candidates, onNotice: vi.fn() }
}

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  for (const { crepe, root } of mounted.splice(0)) {
    await crepe.destroy()
    root.remove()
  }
  document.querySelectorAll('.path-paste-chip').forEach((chip) => chip.remove())
})

async function mount(markdown = 'Next:\n', options = optionsFor('/v', '/v/a/today.md')) {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = createCrepe({ root, defaultValue: markdown, pathPaste: options })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.focus()
  return { crepe, view, options }
}

function paste(view: EditorView, text: string) {
  return view.pasteText(text, { clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') }, preventDefault() {} } as unknown as ClipboardEvent)
}

/** The selection over the first `words` in the document, or a caret just after them. */
function select(view: EditorView, words: string, caret = false) {
  let at = -1
  view.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text!.includes(words)) at = pos + node.text!.indexOf(words)
  })
  expect(at).toBeGreaterThan(-1)
  view.dispatch(view.state.tr.setSelection(caret ? TextSelection.create(view.state.doc, at + words.length) : TextSelection.create(view.state.doc, at, at + words.length)))
}

const atEnd = (view: EditorView) => select(view, 'Next:', true)
const saved = (crepe: Crepe) => getMarkdownForSave(crepe).trim()
const textOf = (view: EditorView) => view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n')
const undoOnce = (view: EditorView) => undo(view.state, view.dispatch)

describe('a pasted path becomes the picker\'s link (D1, D5)', () => {
  it.each([
    ['P1 a note', '/v/projects/roadmap-yaz-12.md', 'Next:[[YAZ-12]]'],
    ['P3 a folder with a trailing slash', '/v/research/', 'Next:[[YAZ-7]]'],
    ['P4 a folder page', '/v/research/.folder.md', 'Next:[[YAZ-7]]'],
    ['P5 a view-only file', '/v/refs/My Report.pdf', 'Next:[[My Report.pdf]]'],
    ['P6 a file no tab can show', '/v/finance/budget v2.zip', 'Next:[budget v2.zip](../finance/budget%20v2.zip)'],
    ['P7 a yaseendocs:// link', 'yaseendocs:///v/projects/roadmap-yaz-12.md', 'Next:[[YAZ-12]]'],
    ['P8 a quoted path', '"/v/projects/roadmap-yaz-12.md"', 'Next:[[YAZ-12]]'],
    ['P8 a Terminal path', '/v/refs/My\\ Report.pdf', 'Next:[[My Report.pdf]]'],
    ['P10 other capital letters', '/V/Projects/ROADMAP-yaz-12.md', 'Next:[[YAZ-12]]'],
  ])('%s', async (_name, text, markdown) => {
    const { crepe, view, options } = await mount()
    atEnd(view)
    expect(paste(view, text)).toBe(true)
    expect(saved(crepe)).toBe(markdown)
    expect(options.onNotice).not.toHaveBeenCalled()
  })

  it('P9 a Windows path, in a vault the app keeps in the Windows form', async () => {
    const options = optionsFor('C:\\v', 'C:\\v\\a\\today.md', [row('C:\\v\\projects\\roadmap-yaz-12.md', 'YAZ-12')])
    const { crepe, view } = await mount('Next:\n', options)
    atEnd(view)
    paste(view, 'C:\\v\\projects\\roadmap-yaz-12.md')
    paste(view, ' C:\\v\\finance\\budget.zip')
    expect(saved(crepe)).toBe('Next:[[YAZ-12]][budget.zip](../finance/budget.zip)')
  })
})

describe('a path that stays text (D6, P11 to P15)', () => {
  it.each([
    ['P11 a note the index does not have yet', '/v/new.md', "Can't find new.md in this vault yet, so it stays a path"],
    ['P12 a known kind in another vault', '/w/plan.md', 'plan.md is not in this vault, so it stays a path. Links stay inside one vault'],
    ['P13 an unknown kind outside the vault', '/usr/bin/env', null],
    ['P13 a folder outside the vault', '/w/projects', null],
    ['P14 text that is no path', 'see the plan', null],
  ])('%s', async (_name, text, notice) => {
    const { crepe, view, options } = await mount()
    atEnd(view)
    paste(view, text)
    expect(textOf(view)).toBe(`Next:${text}`)
    if (notice === null) expect(options.onNotice).not.toHaveBeenCalled()
    else expect(options.onNotice).toHaveBeenCalledWith(notice)
  })

  it('P15 code keeps the path: a code block, and the inline-code mark at the caret', async () => {
    const { crepe, view } = await mount('```\nx\n```\n\nSee `code here` now\n')
    select(view, 'x', true)
    paste(view, '/v/projects/roadmap-yaz-12.md')
    select(view, 'code', true)
    paste(view, '/v/projects/roadmap-yaz-12.md')
    expect(saved(crepe)).not.toContain('[[')
    expect(saved(crepe)).toContain('x/v/projects/roadmap-yaz-12.md')
  })
})

describe('the paste over words, several paths, and the way back (D2, D3, D4)', () => {
  it('P16 words become the link text, and one undo gives them back', async () => {
    const { crepe, view } = await mount('Read the plan first.\n')
    select(view, 'the plan')
    paste(view, '/v/projects/roadmap-yaz-12.md')
    expect(saved(crepe)).toBe('Read [[YAZ-12|the plan]] first.')
    expect(document.querySelector('.path-paste-chip')).toBeNull()
    undoOnce(view)
    expect(saved(crepe)).toBe('Read the plan first.')
  })

  it('P17 words with brackets are replaced by the link', async () => {
    const { crepe, view } = await mount('Read a|b first.\n')
    select(view, 'a|b')
    paste(view, '/v/projects/roadmap-yaz-12.md')
    expect(saved(crepe)).toBe('Read [[YAZ-12]] first.')
  })

  it.each([
    ['P18 at the end of a line: a new list below it', 'Next:\n', 'Next:', 'Next:\n\n* [[YAZ-12]]\n* [[YAZ-7]]'],
    ['P18 in an empty line: the list takes its place', 'Next:\n\n<br />\n', '', 'Next:\n\n* [[YAZ-12]]\n* [[YAZ-7]]'],
    ['P18 at the end of a bullet: its siblings', '* one\n', 'one', '* one\n* [[YAZ-12]]\n* [[YAZ-7]]'],
  ])('%s', async (_name, markdown, after, expected) => {
    const { crepe, view } = await mount(markdown)
    if (after === '') view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    else select(view, after, true)
    paste(view, '/v/projects/roadmap-yaz-12.md\n/v/research\n')
    expect(saved(crepe)).toBe(expected)
    undoOnce(view)
    expect(saved(crepe)).not.toContain('[[')
  })

  it('P19 one line that is no path keeps the whole paste text, with no notice', async () => {
    const { view, options } = await mount()
    atEnd(view)
    paste(view, '/v/research\nhello')
    expect(textOf(view)).not.toContain('[[')
    expect(textOf(view)).toContain('/v/research')
    expect(options.onNotice).not.toHaveBeenCalled()
  })

  it('K1 to K4: the chip gives the path back, ⌘Z does too, and the next key closes the chip', async () => {
    const { crepe, view } = await mount()
    atEnd(view)
    paste(view, '/v/projects/roadmap-yaz-12.md')
    const chip = document.querySelector<HTMLElement>('.path-paste-chip')!
    expect(chip.textContent).toBe('Keep as path')
    chip.querySelector('button')!.click()
    expect(saved(crepe)).toBe('Next:/v/projects/roadmap-yaz-12.md')
    expect(document.querySelector('.path-paste-chip')).toBeNull()

    paste(view, '/v/research')
    undoOnce(view)
    expect(saved(crepe)).toBe('Next:/v/projects/roadmap-yaz-12.md/v/research')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    expect(document.querySelector('.path-paste-chip')).toBeNull()
  })

  it('K4 the chip changes nothing after an edit, and it closes on a click outside', async () => {
    const { crepe, view } = await mount()
    atEnd(view)
    paste(view, '/v/research')
    const keep = document.querySelector<HTMLElement>('.path-paste-chip button')!
    view.dispatch(view.state.tr.insertText('!'))
    keep.click()
    expect(saved(crepe)).toBe('Next:[[YAZ-7]]!')
    paste(view, '/v/research')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.path-paste-chip')).toBeNull()
  })
})

describe('a web link pasted over words (D7)', () => {
  it.each([
    ['U1 https', 'https://milkdown.dev/guide', 'Read [the guide](https://milkdown.dev/guide) first.'],
    ['U2 mailto', 'mailto:a@b.co', 'Read [the guide](mailto:a@b.co) first.'],
    ['U5 text that is no URL', 'note: hi', 'Read note: hi first.'],
  ])('%s', async (_name, text, markdown) => {
    const { crepe, view } = await mount('Read the guide first.\n')
    select(view, 'the guide')
    paste(view, text)
    expect(saved(crepe)).toBe(markdown)
  })

  it('U1 is one undo step', async () => {
    const { crepe, view } = await mount('Read the guide first.\n')
    select(view, 'the guide')
    paste(view, 'https://milkdown.dev/guide')
    undoOnce(view)
    expect(saved(crepe)).toBe('Read the guide first.')
  })

  it('U3 a selection across two paragraphs is a normal paste', async () => {
    const { crepe, view } = await mount('One two\n\nThree four\n')
    let from = -1
    let to = -1
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'One two') from = pos + 4
      if (node.isText && node.text === 'Three four') to = pos + 5
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
    paste(view, 'https://milkdown.dev')
    expect(saved(crepe)).not.toContain('](https://milkdown.dev)')
  })
})

describe('a Markdown link\'s target in this vault (D8)', () => {
  const mac = optionsFor('/v', '/v/a/today.md')
  it.each([
    ['L1 a relative note', '../projects/roadmap-yaz-12.md', '/v/projects/roadmap-yaz-12.md'],
    ['L2 %20, #heading and ?query', '../refs/My%20Report.pdf#page=2', '/v/refs/My Report.pdf'],
    ['L2 ./ inside the note folder', './../research', '/v/research'],
    ['L3 a file:// URL', 'file:///v/projects/roadmap-yaz-12.md', '/v/projects/roadmap-yaz-12.md'],
    ['L3 an absolute path', '/v/research/', '/v/research'],
    ['L6 a file no tab can show', '../finance/budget.zip', null],
    ['L7 a missing file', './nope.md', null],
    ['L8 a file outside the vault', '/w/plan.md', null],
    ['L9 a web link', 'https://example.com/a.md', null],
    ['L9 a bad escape', '../%E0%A4%A.md', null],
  ])('%s', (_name, href, path) => {
    expect(hrefTarget(href, mac)).toBe(path)
  })

  it('L13 the Windows forms', () => {
    const win = optionsFor('C:\\v', 'C:\\v\\a\\today.md', [row('C:\\v\\projects\\roadmap-yaz-12.md', 'YAZ-12')])
    expect(hrefTarget('../projects/roadmap-yaz-12.md', win)).toBe('C:\\v\\projects\\roadmap-yaz-12.md')
    expect(hrefTarget('file:///C:/v/projects/roadmap-yaz-12.md', win)).toBe('C:\\v\\projects\\roadmap-yaz-12.md')
  })
})
