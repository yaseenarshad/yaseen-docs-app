/**
 * The rename script (YAZ-5036, `tools/rename-note-to-page.mjs`), and the guard it gives: the repo is its fixed point.
 * A new "note" in a name, a file name, a CSS class, a string or a comment fails here, with its file and line, unless
 * the script's KEEP list says it means something else (a cell note, release notes, the Bases namespace, …).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { namesOf, renamePath, renameText, skipped } from './rename-note-to-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = (file) => ({ file })

describe('the rename', () => {
  it('names, words and CSS classes, each in its own case', () => {
    expect(renameText('const notePath = readNote(note)', at('a.ts'))).toBe('const pagePath = readPageFile(page)')
    expect(renameText('NOTE_ID_KEY, NotePreview, dailyNotes', at('a.ts'))).toBe('PAGE_ID_KEY, PagePreview, dailyPages')
    expect(renameText("'New note' · 12 notes · Daily note", at('a.ts'))).toBe("'New page' · 12 pages · Daily page")
    expect(renameText('.note-card__side, noteCardLine, NoteCardInbox, a note card', at('a.css'))).toBe('.card__side, cardBlockLine, CardInbox, a card')
    expect(renameText("'---\\nnote: x' and My%20note.md", at('a.ts'))).toBe("'---\\npage: x' and My%20page.md")
  })

  it('keeps what means something else', () => {
    for (const text of ['cellNoteCard, a cell note, CELL_NOTE, cell-note', 'footnote, ReleaseNotes, release notes, update:notes', 'Note: a remark', 'role="note"', 'settings-section__note', 'notebook, noted, isNotEmpty', "'Note shape'", 'tableAllNotesOpensAt'])
      expect(renameText(text, at('a.ts'))).toBe(text)
  })

  it('a help line keeps "note"; a BEM modifier `--note` (a kind of layer) moves to `--page`', () => {
    for (const text of ['.storage__file-note', '.image-studio__filter-note', '.settings-section__note--muted']) expect(renameText(text, at('a.css'))).toBe(text)
    expect(renameText('.explore__layer--note,\n.explore__layer--board', at('a.css'))).toBe('.explore__layer--page,\n.explore__layer--board')
  })

  it('never reads the word-choice files, even on a branch whose copy has no skip-file marker', () => {
    for (const file of ['client/src/vault/unitWord.ts', 'client/src/vault/unitWord.test.tsx', 'client/src/settings/UnitWordControl.tsx', 'client/src/settings/UnitWordControl.test.tsx'])
      expect(skipped(file)).toBe(true)
    expect(skipped('client/src/vault/unitWordOther.ts')).toBe(false)
  })

  it('keeps the Bases namespace of a view, and moves a page key and a code name', () => {
    expect(renameText("filters: 'note.status == 1', key.startsWith('note.'), `note.${k}`, note[\"a b\"]", at('a.txt'))).toBe("filters: 'note.status == 1', key.startsWith('note.'), `note.${k}`, note[\"a b\"]")
    expect(renameText("rowShortcuts(ctx, 'note.bold'), const x = note.querySelector('p')", at('a.ts'))).toBe("rowShortcuts(ctx, 'page.bold'), const x = page.querySelector('p')")
  })

  it('in the table code a bare "note" is a cell note; a name the rest of the code has moves with it', () => {
    const names = new Set(['noteMenu', 'isNoteReadOnly'])
    expect(renameText('const note = cellOf(x); isNoteReadOnly(view); deleteWithNotes()', { file: 'client/src/editor/table/t.ts', names })).toBe('const note = cellOf(x); isPageReadOnly(view); deleteWithNotes()')
  })

  it('file paths, and a second run changes nothing', () => {
    expect(renamePath('client/src/editor/noteCard/noteCardView.ts')).toBe('client/src/editor/card/cardBlockView.ts')
    expect(renamePath('desktop/src/main/notes/note.ts')).toBe('desktop/src/main/pages/page.ts')
    expect(renamePath('client/src/editor/table/cellNoteCard.ts')).toBe('client/src/editor/table/cellNoteCard.ts')
    const once = renameText('readNote(note) in a note card; Daily Note', at('a.ts'))
    expect(renameText(once, at('a.ts'))).toBe(once)
  })
})

describe('the guard: the repo is the fixed point of the rename', () => {
  it('no tracked file says "note" where the script would change it, and no file name does', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\0')
      .filter((f) => f !== '' && !skipped(f))
    const read = (f) => {
      try {
        return readFileSync(path.join(ROOT, f), 'utf8')
      } catch {
        return ''
      }
    }
    const cwd = process.cwd()
    process.chdir(ROOT)
    try {
      const names = namesOf(files, read)
      const left = []
      for (const file of files) {
        if (renamePath(file) !== file) left.push(`${file}: the file name`)
        const before = read(file)
        const after = renameText(before, { file, names })
        if (after === before) continue
        const a = before.split('\n')
        const b = after.split('\n')
        a.forEach((line, i) => line !== b[i] && left.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`))
      }
      expect(left).toEqual([])
    } finally {
      process.chdir(cwd)
    }
  }, 120_000)
})
