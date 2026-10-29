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
import { EXTERNAL_EDIT_META } from './external/applyExternalMarkdown'
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

async function mount(markdown = 'Next:\n', options: PathPasteOptions | null = optionsFor('/v', '/v/a/today.md')) {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = createCrepe({ root, defaultValue: markdown, pathPaste: options ?? undefined })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.focus()
  return { crepe, view, options: options! }
}

function paste(view: EditorView, text: string, html = '') {
  const event = { clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : '') }, preventDefault() {} } as unknown as ClipboardEvent
  return html === '' ? view.pasteText(text, event) : view.pasteHTML(html, event)
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
    ['P11 a note the index does not have yet', '/v/new.md', "Can't find new.md yet, so it stays a path"],
    ['P12, W5 a known kind in a vault not open in this window', '/w/plan.md', 'plan.md is not in a vault open in this window, so it stays a path'],
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

describe('the cases the checker named (YAZ-3632) and the fixed bugs', () => {
  it('P2 a vault without IDs: the picker spells the note by its name', async () => {
    const { crepe, view } = await mount('Next:\n', optionsFor('/v', '/v/a/today.md', [row('/v/Roadmap.md', 'Roadmap')]))
    atEnd(view)
    paste(view, '/v/Roadmap.md')
    expect(saved(crepe)).toBe('Next:[[Roadmap]]')
  })

  it('P20 the plain text decides when the clipboard holds HTML too', async () => {
    const { crepe, view } = await mount()
    atEnd(view)
    paste(view, '/v/research', '<a href="file:///v/research">/v/research</a>')
    expect(saved(crepe)).toBe('Next:[[YAZ-7]]')
  })

  it('P21 a read-only note takes no paste', async () => {
    const { crepe, view } = await mount()
    atEnd(view)
    crepe.setReadonly(true)
    paste(view, '/v/research')
    expect(saved(crepe)).toBe('Next:')
  })

  it('P22 an editor with no path options (the folder outline, a comment) keeps the path as text', async () => {
    const { crepe, view } = await mount('Next:\n', null)
    atEnd(view)
    paste(view, '/v/research')
    expect(textOf(view)).toBe('Next:/v/research')
    expect(saved(crepe)).not.toContain('[[')
  })

  it('K5 no chip after several paths, or after a paste over words that the link replaces', async () => {
    const { view } = await mount('Next:\n\nRead a|b first.\n')
    atEnd(view)
    paste(view, '/v/research\n/v/projects/roadmap-yaz-12.md')
    expect(document.querySelector('.path-paste-chip')).toBeNull()
    select(view, 'a|b')
    paste(view, '/v/research')
    expect(document.querySelector('.path-paste-chip')).toBeNull()
  })

  it('YAZ-3631 several paths in a table cell go on the line, one space apart', async () => {
    const { crepe, view } = await mount('| A | B |\n| - | - |\n| cell | x |\n')
    select(view, 'cell', true)
    paste(view, '/v/research\n/v/projects/roadmap-yaz-12.md')
    expect(saved(crepe)).toContain('| cell[[YAZ-7]] [[YAZ-12]] |')
  })

  it('YAZ-3634 a path with other capital letters keeps the shared folders: no detour through the vault folder', async () => {
    const { crepe, view } = await mount()
    atEnd(view)
    paste(view, '/V/Finance/budget.zip')
    expect(saved(crepe)).toBe('Next:[budget.zip](../Finance/budget.zip)')
  })

  it('YAZ-3635 an accent in the other Unicode form finds its page', async () => {
    const nfc = '/v/caf\u00e9.md'
    const { crepe, view } = await mount('Next:\n', optionsFor('/v', '/v/a/today.md', [row(nfc, 'YAZ-30')]))
    atEnd(view)
    paste(view, nfc.normalize('NFD'))
    expect(saved(crepe)).toBe('Next:[[YAZ-30]]')
  })

  it('YAZ-3636 the second undo takes the paste away and keeps the typing before it', async () => {
    const { crepe, view } = await mount()
    atEnd(view)
    view.dispatch(view.state.tr.insertText(' see '))
    paste(view, '/v/research')
    undoOnce(view)
    undoOnce(view)
    expect(saved(crepe)).toBe('Next: see')
  })

  it('YAZ-3633 a path of a file no tab can show, pasted over words, keeps the words as its text', async () => {
    const { crepe, view } = await mount('Read the budget first.\n')
    select(view, 'the budget')
    paste(view, '/v/finance/budget.zip')
    expect(saved(crepe)).toBe('Read [the budget](../finance/budget.zip) first.')
  })

  it('a parenthesis in a file name is escaped, so the link does not end early', async () => {
    const { crepe, view } = await mount()
    atEnd(view)
    paste(view, '/v/finance/q4 (draft.zip')
    expect(saved(crepe)).toBe('Next:[q4 (draft.zip](../finance/q4%20%28draft.zip)')
  })

  it('a paste of more than 500 lines is read as text, not as paths', async () => {
    const { crepe, view } = await mount()
    atEnd(view)
    paste(view, Array.from({ length: 501 }, () => '/v/research').join('\n'))
    expect(saved(crepe)).not.toContain('[[')
  })

  it('the chip closes when its editor goes away', async () => {
    const { crepe, view } = await mount()
    atEnd(view)
    paste(view, '/v/research')
    expect(document.querySelector('.path-paste-chip')).not.toBeNull()
    await crepe.destroy()
    mounted.splice(mounted.findIndex((m) => m.crepe === crepe), 1)
    expect(document.querySelector('.path-paste-chip')).toBeNull()
  })

  it('U4 a URL with no selection, and U6 a URL over words in code, are a normal paste', async () => {
    const { crepe, view } = await mount('Read the guide.\n\n```\ncode words\n```\n')
    select(view, 'guide', true)
    paste(view, ' https://milkdown.dev')
    select(view, 'code words')
    paste(view, 'https://milkdown.dev')
    expect(saved(crepe)).not.toContain('](https://milkdown.dev)')
    expect(saved(crepe)).toContain('https://milkdown.dev')
  })
})

describe('links across the vaults of a window (D14, D15, D16)', () => {
  const PLAN = '/w/plan.md'
  const workspace = () => {
    const other = createWikilinkCandidateSource()
    other.update([{ name: 'Plan', insert: 'Plan', label: 'Plan', path: PLAN }])
    const options = optionsFor('/v', '/v/a/today.md')
    return { ...options, candidatesOf: (path: string) => (path.startsWith('/w/') ? other : path.startsWith('/v/') ? options.candidates : null) }
  }

  it('W3 a path of a note in another vault of the window is a relative link named after it; W4 over words, the words', async () => {
    const { crepe, view } = await mount('Next:\n\nRead the plan first.\n', workspace())
    atEnd(view)
    paste(view, PLAN)
    select(view, 'the plan')
    paste(view, PLAN)
    expect(saved(crepe)).toBe('Next:[Plan](../../w/plan.md)\n\nRead [the plan](../../w/plan.md) first.')
  })

  it('W1 a Markdown link into another vault of the window resolves; W2 one into a vault not in the window does not', () => {
    const options = workspace()
    expect(hrefTarget('../../w/plan.md', options)).toBe(PLAN)
    expect(hrefTarget('../../x/plan.md', options)).toBeNull()
    expect(hrefTarget('../research/.folder.md', options)).toBe('/v/research')
    expect(hrefTarget('file://localhost/w/plan.md', options)).toBe(PLAN)
  })

  it('R1 a full path set in the link box is saved relative; R2 a web address and a path outside the window are saved as typed', async () => {
    const { crepe, view } = await mount('Plan here and site and else\n', workspace())
    const link = (words: string, href: string) => {
      select(view, words)
      const { from, to } = view.state.selection
      view.dispatch(view.state.tr.addMark(from, to, view.state.schema.marks.link!.create({ href })))
    }
    link('Plan', '/w/plan.md')
    link('site', 'https://milkdown.dev')
    link('else', '/x/else.md')
    expect(saved(crepe)).toBe('[Plan](../../w/plan.md) here and [site](https://milkdown.dev) and [else](/x/else.md)')
  })

  it('R1 a file no tab can show is saved relative too', async () => {
    const { crepe, view } = await mount('Budget here\n', workspace())
    select(view, 'Budget')
    const { from, to } = view.state.selection
    view.dispatch(view.state.tr.addMark(from, to, view.state.schema.marks.link!.create({ href: '/v/finance/budget.zip' })))
    expect(saved(crepe)).toBe('[Budget](../finance/budget.zip) here')
  })

  it('YAZ-3649 a full-path link that an outside edit writes, or that the caret types inside, stays as it is; a pasted one is saved relative', async () => {
    const { crepe, view } = await mount('[Plan](/w/plan.md) here\n\nSecond line\n', workspace())
    expect(saved(crepe)).toBe('[Plan](/w/plan.md) here\n\nSecond line') // as loaded
    select(view, 'Plan', true)
    view.dispatch(view.state.tr.insertText('s'))
    expect(saved(crepe)).toContain('[Plans](/w/plan.md) here') // typing inside an older link
    select(view, 'here', true)
    const end = view.state.selection.from
    view.dispatch(view.state.tr.insertText(' and ', end).addMark(end + 1, end + 4, view.state.schema.marks.link!.create({ href: '/w/plan.md' })).setMeta(EXTERNAL_EDIT_META, true))
    expect(saved(crepe)).toContain('[and](/w/plan.md)') // an outside edit
    select(view, 'Second line', true)
    paste(view, ' x', '<a href="/w/plan.md">the plan</a>')
    expect(saved(crepe)).toContain('[the plan](../../w/plan.md)') // a paste
  })
})
