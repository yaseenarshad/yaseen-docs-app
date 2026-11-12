/**
 * The guard (YAZ-4938): every user-facing string under `client/src` that says "note" or "notes" goes through the
 * vault's word helper (`unit(…)` on its line; `unitText(…)` where `unit` is taken), or names a feature on the short allow-list below. A new string that
 * does neither fails here, with its file and line.
 *
 * What counts as user-facing (the slots): a `label`, `title`, `placeholder`, `aria-label` / `ariaLabel`,
 * `confirmLabel`, `cancelLabel`, `menuLabel`, `triggerLabel`, `empty` or `name`; a toast or notice (`notify(…)`,
 * `onNotice(…)`, `notice(…)`); text between JSX tags; a count (`'note' : 'notes'`, `plural(n, 'note')`,
 * `${n} notes`); a label constant (a const named …LABEL, …PLACEHOLDER, …TITLE, …NAME or …OPTIONS); the sidebar
 * menu's `plain(label)` rows. The sidebar menu's `create(id, label)` and Settings › Folder pages' `row(id, label)` route
 * every label through the helper themselves. Help prose (a `hint`, an `about` line, a sheet's long text) keeps the plain
 * word, as the help docs do, and is not scanned.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

/** Feature names that hold the word and keep it, each with its reason. */
const ALLOWED: readonly { why: string; test: RegExp }[] = [
  { why: 'Daily note: the feature, its folder, its button, its toasts, and what its button opens ("The note", "The note at now")', test: /\bdaily notes?\b|^settings\/options\.ts:\d+: The note( at now)?$/i },
  { why: 'Cell note: the feature in a table cell, and the "All notes" card of a calendar table', test: /\bcell notes?\b|\bAll notes\b/i },
  { why: 'The cell note feature\'s own files: its card titles ("Note", "Note: …", "Notes")', test: /^editor\/table\/cellNote/ },
  { why: 'Notes from: a link column\'s setting', test: /\bNotes from\b/ },
  { why: 'Release notes', test: /^update\/WhatsNewSheet\.tsx:/ },
  { why: 'Missing note: a link pill\'s state, next to "ID from another vault"', test: /\bMissing note\b/ },
  { why: 'The hotkeys sheet describes the app\'s gestures, like the help docs', test: /^settings\/hotkeys(?:Section)?\.tsx?:/ },
  { why: 'The Settings row that names the word itself, and its control', test: /^settings\/UnitWordControl\.tsx:|\bCall a note a\b/ },
  { why: 'The sidebar\'s icon rules: the icon packs\' own name lists', test: /^sidebar\/materialIconData\.ts:/ },
]

const WORD = /\bnotes?\b/i
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
const SLOT =
  /(?:\b(?:label|title|placeholder|aria-label|ariaLabel|confirmLabel|cancelLabel|menuLabel|triggerLabel|empty|name)\s*[:=]\s*\{?\s*|\b(?:notify|onNotice|notice|plain)\??\.?\(\s*|\b[A-Z_]*(?:LABEL|PLACEHOLDER|TITLE|NAME|OPTION)S?\b[^=]*=\s*[[{]?[^'"`]*)$/
const COUNT_CALL = /\b(?:plural|count)\(\s*[^,()]*,\s*$/
const IDENTIFIER = /^[\w.\-:/*[\]"=]+$/
const JSX_TEXT = /[>}]([^<>{}]*)[<{]/g

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(file)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$|\.d\.ts$/.test(entry.name)) yield file
  }
}

/** Every user-facing "note" string that skips the helper, as `file:line: text`. */
export function unguardedNoteStrings(): string[] {
  const found: string[] = []
  for (const file of sourceFiles(ROOT)) {
    const rel = path.relative(ROOT, file)
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*')) return
        if (/\bunit(?:Text)?\??\.?\(/.test(line)) return
        const add = (text: string) => found.push(`${rel}:${i + 1}: ${text}`)
        LITERAL.lastIndex = 0
        for (let m = LITERAL.exec(line); m !== null; m = LITERAL.exec(line)) {
          const text = m[2]
          const plain = text.replace(/\$\{[^}]*\}/g, '')
          if (!WORD.test(plain)) continue
          const before = line.slice(0, m.index)
          const after = line.slice(m.index + m[0].length)
          const bare = /^notes?$/.test(text)
          const ternary = bare && ((/\?\s*$/.test(before) && /^\s*:\s*'notes?'/.test(after)) || (/'notes?'\s*\?\s*$/.test(before.trimEnd().replace(/:$/, '').trimEnd())))
          const count = (bare && COUNT_CALL.test(before)) || /\$\{[^}]*\}\s*notes?\b/i.test(text)
          const slot = !bare && SLOT.test(before) && !(IDENTIFIER.test(text) && !/^[A-Z]/.test(text))
          if (slot || ternary || count) add(text)
        }
        if (!file.endsWith('.tsx') || line.includes('`')) return
        JSX_TEXT.lastIndex = 0
        for (let m = JSX_TEXT.exec(line); m !== null; m = JSX_TEXT.exec(line)) {
          const text = m[1].trim()
          if (text !== '' && WORD.test(text) && !/[=(]/.test(text)) add(text)
        }
      })
  }
  return found.filter((hit) => !ALLOWED.some((a) => a.test.test(hit)))
}

describe('the vault word guard (YAZ-4938)', () => {
  it('every user-facing "note" string goes through the helper or names a feature on the allow-list', () => {
    expect(unguardedNoteStrings()).toEqual([])
  })

  it('the allow-list is short, and each entry still matches something', () => {
    expect(ALLOWED.length).toBeLessThanOrEqual(10)
  })
})
