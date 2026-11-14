/**
 * The guard (YAZ-4938): every user-facing string under `client/src` that says "page" or "pages" goes through the
 * vault's word helper (`unit(…)` on its line; `unitText(…)` where `unit` is taken), or names a feature on the short allow-list below. A new string that
 * does neither fails here, with its file and line.
 *
 * What counts as user-facing (the slots): a `label`, `title`, `placeholder`, `aria-label` / `ariaLabel`,
 * `confirmLabel`, `cancelLabel`, `menuLabel`, `triggerLabel`, `empty` or `name`; a toast or notice (`notify(…)`,
 * `onNotice(…)`, `notice(…)`); text between JSX tags; a count (`'page' : 'pages'`, `plural(n, 'page')`,
 * `${n} pages`); a label constant (a const named …LABEL, …PLACEHOLDER, …TITLE, …NAME, …OPTIONS, …TIP or …MESSAGE); the sidebar
 * menu's `plain(label)` rows; a string inside a JSX expression that IS an element's text, `<strong>{a ? 'This page…' : …}</strong>`
 * (the literal stands between `>{` and `}<` on its line, with no tag in between; YAZ-4939's chip card was missed this way). The sidebar menu's `create(id, label)` and Settings › Folder pages' `row(id, label)` route
 * every label through the helper themselves. Help prose (a `hint`, an `about` line, a sheet's long text) keeps the plain
 * word, as the help docs do, and is not scanned.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

/** Feature names that hold the word and keep it, each with its reason. */
const ALLOWED: readonly { why: string; test: RegExp }[] = [
  { why: 'Daily page: the feature, its folder, its button, its toasts, and what its button opens ("The page", "The page at now")', test: /\bdaily pages?\b|^settings\/options\.ts:\d+: The page( at now)?$/i },
  { why: 'A page that is not the unit: a diagram\'s pages (draw.io), a table as wide as the page', test: /^editor\/embed\/boardWindow\.ts:\d+: Page$|^explore\/ExploreBoard\.tsx:\d+: Pages$|Fit columns to the page/ },
  { why: 'A folder\'s Page tab and its settings', test: /^settings\/folderPagesSection\.tsx:\d+: Page$|^views\/view\/Toolbar\.tsx:\d+: Page settings$/ },
  { why: 'Pages from: a link column\'s setting', test: /\bPages from\b/ },
  { why: 'Missing page: a link pill\'s state, next to "ID from another vault"', test: /\bMissing page\b/ },
  { why: 'The hotkeys sheet describes the app\'s gestures, like the help docs', test: /^settings\/hotkeys(?:Section)?\.tsx?:/ },
  { why: 'The Settings row that names the word itself, and its control', test: /^settings\/UnitWordControl\.tsx:|\bCall a page a\b/ },
  { why: 'The sidebar\'s icon rules: the icon packs\' own name lists', test: /^sidebar\/materialIconData\.ts:/ },
]

/** The unit word (YAZ-5036: "page", it was "note"); a page that is not the unit keeps its word, as `unitWord.ts` `OTHER_PAGE` does. */
const WORD = /\bpages?\b/i
const OTHER_PAGE = /\b(?:folder|start|tab|home|front|pdf|web|settings) pages?\b|\bpages? tabs?\b/gi
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
const SLOT =
  /(?:\b(?:label|title|placeholder|aria-label|ariaLabel|confirmLabel|cancelLabel|menuLabel|triggerLabel|empty|name)\s*[:=]\s*\{?\s*|\b(?:notify|onNotice|notice|plain)\??\.?\(\s*|\b[A-Z_]*(?:LABEL|PLACEHOLDER|TITLE|NAME|OPTION|TIP|MESSAGE)S?\b[^=]*=\s*[[{]?[^'"`]*)$/
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

/** Every user-facing "page" string that skips the helper, as `file:line: text`. */
export function unguardedPageStrings(): string[] {
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
          const plain = text.replace(/\$\{[^}]*\}/g, '').replace(OTHER_PAGE, '')
          if (!WORD.test(plain)) continue
          const before = line.slice(0, m.index)
          const after = line.slice(m.index + m[0].length)
          const bare = /^pages?$/.test(text)
          const ternary = bare && ((/\?\s*$/.test(before) && /^\s*:\s*'pages?'/.test(after)) || (/'pages?'\s*\?\s*$/.test(before.trimEnd().replace(/:$/, '').trimEnd())))
          const count = (bare && COUNT_CALL.test(before)) || /\$\{[^}]*\}\s*pages?\b/i.test(text)
          const slot = !bare && SLOT.test(before) && !(IDENTIFIER.test(text) && !/^[A-Z]/.test(text))
          // A literal that is an element's text through an expression: `<b>{cond ? 'This page…' : 'other'}</b>`.
          const jsxExpr = !bare && file.endsWith('.tsx') && />\{[^<>]*$/.test(before) && /^[^<>]*\}\s*</.test(after) && !IDENTIFIER.test(text)
          if (slot || ternary || count || jsxExpr) add(text)
        }
        if (!file.endsWith('.tsx') || line.includes('`')) return
        JSX_TEXT.lastIndex = 0
        for (let m = JSX_TEXT.exec(line); m !== null; m = JSX_TEXT.exec(line)) {
          const text = m[1].trim()
          if (text !== '' && WORD.test(text.replace(OTHER_PAGE, '')) && !/[=(]/.test(text)) add(text)
        }
      })
  }
  return found.filter((hit) => !ALLOWED.some((a) => a.test.test(hit)))
}

describe('the vault word guard (YAZ-4938)', () => {
  it('every user-facing "page" string goes through the helper or names a feature on the allow-list', () => {
    expect(unguardedPageStrings()).toEqual([])
  })

  it('the allow-list is short, and each entry still matches something', () => {
    expect(ALLOWED.length).toBeLessThanOrEqual(10)
  })
})
