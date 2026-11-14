#!/usr/bin/env node
/**
 * rename-note-to-page.mjs (YAZ-5036): the one-time rename of "note" to "page" in the app's code, words and docs.
 *
 * HOW TO, for a branch cut before the rename (an old PR, a parked worktree):
 *   1. Commit your own work first, so the rename sits in a commit of its own.
 *   2. From the repo root, ON YOUR BRANCH and before you pull main, run the script from main:
 *        git show main:tools/rename-note-to-page.mjs > /tmp/rename-note-to-page.mjs
 *        node /tmp/rename-note-to-page.mjs
 *   3. Commit the result ("refactor(rename): run the YAZ-5036 rename script"), then merge or rebase on main.
 *      Your new code now has the new names too (`noteCard` → `card`, `readNote` → `readPageFile`), so most clashes
 *      go away, and a line git merges with no clash still builds.
 *   4. Run the typecheck. Fix by hand what is left.
 *
 * The run is idempotent: a second run changes nothing. It moves tracked files (`git mv`) and rewrites their text:
 * identifiers, file names, CSS classes, strings, comments and test titles.
 *
 *   node tools/rename-note-to-page.mjs            rewrite the tracked files in place
 *   node tools/rename-note-to-page.mjs --dry      say what would change; write nothing
 *   node tools/rename-note-to-page.mjs --left     list each line that still says "note", for review
 *   node tools/rename-note-to-page.mjs <paths…>   only these files or folders (the names list still reads them all)
 *
 * What stays "note", on purpose (KEEP and the word-keeping files below):
 *   - a cell note (a note on a table cell) in every spelling, and the table code, where a bare "note" is a cell note;
 *   - footnotes, release notes ("What's new", the updater), "All notes" of a calendar table;
 *   - the small help line under a control (`settings-section__note`) and the ARIA role `note`;
 *   - remarks in prose ("Note:", "note that");
 *   - the Bases namespace in a view's keys and formulas (`note.status`, `note["my prop"]`): Obsidian's format;
 *   - the vault's word choice "Note" (`client/src/vault/unitWord.ts`) and the old saved names that the one-time moves
 *     read (`shared/legacyNames.ts`).
 * What it never reads (SKIP): `engine/` (the Excalidraw fork), vendored and third-party files, vault fixtures (user
 * content), perf run records.
 *
 * A file opts out with the text `rename-note-to-page: skip-file`; a line with `rename-note-to-page: keep`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---- What the script never reads ----

const SKIP = [
  /^engine\//,
  /^client\/vendor\//,
  /^client\/public\//,
  /^desktop\/e2e\/fixtures\//,
  /^desktop\/drawio-overlay\/(?!js\/yaseen-)/,
  /^tools\/perf\/runs\//,
  /^tools\/perf\/(budget|baseline)\.json$/,
  /^tools\/rename-note-to-page(\.test)?\.mjs$/,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)LICENSE[^/]*$/,
  /(^|\/)CHANGELOG\.md$/,
]
const TEXT = /\.(m?[jt]sx?|cjs|css|md|json|html|ya?ml|snap|patch|swift|txt)$|(^|\/)\.gitignore$/
const SKIP_FILE = 'rename-note-to-page: ' + 'skip-file'
const KEEP_LINE = 'rename-note-to-page: ' + 'keep'

/**
 * Files where a bare "note" means something else: a cell note (the table code) or a release note (the updater). There,
 * the bare word stays, and a longer name changes only when the rest of the code has it too (so imports still match).
 */
const WORD_KEEPING = [
  /^client\/src\/editor\/table\//,
  /(^|\/)(cellNote|tableCellNote)[^/]*$/,
  /^client\/src\/update\//,
  /^desktop\/src\/main\/updater[^/]*$/,
  /^desktop\/src\/main\/ipc\/update[^/]*$/,
  /^desktop\/e2e\/update\.spec\.ts$/,
]

/** Phrases that mean a page even in a word-keeping file. */
const PAGE_PHRASES = [
  // A page key's ID (`note.foldHere`): the keys moved to `page.`.
  [/(?<![A-Za-z0-9_$.])note(?=\.(heading|bold|italic|underline|strikethrough|highlight|inlineCode|clearFormatting|text|quote|codeBlock|bulletList|cycleTask|indent|outdent|foldHere|unfoldHere|foldAll|unfoldAll|zoomIn|zoomOut|openCellNote|nextCellNote|previousCellNote|cellNoteBack|cellNoteForward|allCellNotes|nextTimeBlock|previousTimeBlock|copyVisible|find|toc|undo|redo|selectAll|enter|lineBreak|embedPick|tab|delete|deleteMore|lineStartEnd|selectLines|escape|popupMove)\b)/g, 'page'],
  // A module path: the file moved.
  [/(?<=(?:from|import\(|mock\() ?['"][^'"\n]*\/)note(?=['"])/g, 'page'],
  [/\bnote table(s?)\b/g, 'page table$1'],
  [/\bNote table(s?)\b/g, 'Page table$1'],
  [/\b(read-only|editable|open|whole) note\b/g, '$1 page'],
  [/\bnote's (right-click|own) menu\b/g, "page's $1 menu"],
  [/\bnote menu\b/g, 'page menu'],
  [/\bnoteMenu\b/g, 'pageMenu'],
]

// ---- What stays, wherever it is (each match is set aside before the rename and put back after) ----

const KEEP = [
  // A remark about this rename itself names the old words (a comment line that says YAZ-5036).
  /^\s*(?:\/\/|\*|\/\*).*\bYAZ-5036\b.*$/gm,
  // The cell note settings' keywords (before "cell note" itself is set aside).
  /(?<='cell note', (?:'new note', )?)'note'|(?<='template', 'cell note', )'new note'/g,
  // The release notes' bridge call (`update.notes`), before "ReleaseNotes" is set aside below.
  /\bnotes(?=: invoke<\[\], ReleaseNotes>)/g,
  // A cell note: a note on a table cell, in every spelling (`cellNote`, `CELL_NOTE`, `cell-note`, "cell note").
  /[cC]ell[ _-]?(?:[nN]otes?(?![a-z])|NOTES?(?![A-Z]))/g,
  /CELL_NOTES?(?![A-Z])/g,
  // "All notes" of a calendar table (cell notes).
  /[aA]ll ?[nN]otes(?![a-z])/g,
  /ALL_NOTES(?![A-Z])/g,
  // Footnotes, release notes and the "What's new" notes.
  /[fF]oot[_-]?(?:[nN]otes?(?![a-z])|NOTES?(?![A-Z]))/g,
  /FOOT_?NOTES?(?![A-Z])/g,
  /[rR]elease[ _-]?(?:[nN]otes?(?![a-z])|NOTES?(?![A-Z]))/g,
  /RELEASE_NOTES?(?![A-Z])/g,
  /update:notes/g,
  /\bupdater?\.notes\b/g,
  /\bnotes(?=: async \(\) => \(\{ current:)/g,
  /whats-new__notes/g,
  // The small help line under a control (a BEM element called "note").
  /[a-z][a-z-]*__(?:[a-z-]*-)?notes?\b(?<!(?:backlinks|quicklook)__notes?)/g,
  // The Bases namespace as a keyword of a view's formula (`note.status`, `note["my prop"]`; see BASES for the keys).
  /['"]note['"](?= \| ['"]formula['"])/g,
  /(?<=(?:case|ns ===|name ===) )['"]note['"]/g,
  /(?<=new Set\(\[)['"]note['"](?=, ['"]file['"])/g,
  /(?<=\bid\()['"]note['"]/g,
  // The ARIA role.
  /\brole(?:=|: ?|\(|=\{)["'`]note["'`]/g,
  /\bgetByRole\(["'`]note/g,
  // Remarks in prose: "Note:", "NOTE:", "note that", "Note, …", "of note".
  /(?<=(?:^|\/\/|\/\*|\*|[.!?;({—–-])\s*)\b(?:Note|NOTE)(?=:\s)/gm,
  /(?<!\b(?:[Aa]n?|[Tt]he|[Ee]ach|[Ee]very|[Aa]ny|[Oo]ne|[Tt]his|[Tt]hat|[Nn]o|[Ii]ts|[Tt]heir|[Aa]nother|[Oo]ther|[Ww]hich|[Ww]hose|[Ss]ame|[Oo]pen|[Nn]ew|[Ff]irst|[Ll]ast|[Nn]ext|[Oo]nly|[Oo]wn|[Dd]aily|[Ee]mpty|[Oo]ld|[Cc]urrent|[Rr]ead-only|of|in|to) )\b(?:Note|note)(?= (?:that|how|which|whether)\b)/g,
  // draw.io's own actions and shape (a diagram's key rows).
  /'Note shape'|'Edit note'|\bS \(note\)/g,
  // A remark, not a page.
  /\b(?:one-line|prop-stability|anti-ping-pong) notes?\b/g,
  // A cell note named by its context: its mark, the cell's note, a calendar block's note, the cell note settings' words.
  /\b(?:cell's|cell with a|its) note(?= (?:there|mark|when it has none)\b|,|$)/gm,
  /\bnote mark\b/g,
  /\badds a note(?=\. Off: right-click a cell)/g,
  // The vault's word choice "Note" (Settings › This vault), in its keywords.
  /(?<='page', 'doc', )'note'/g,
  /(?<=getAttribute\(['"]role['"]\)\)\.toBe\()['"]note['"]/g,
  // Musical and sticky notes, notebooks, Excalidraw's names.
  /\b(?:musical|bank|sticky|post-it) notes?\b/gi,
  /\bworking notes\b/g,
  /\bnoteLicense\b/g,
]

/**
 * Names picked by hand: a new name that is taken already, a name that would read badly ("pagePage"), or a verb
 * ("note" as in "record"). Whole names only; checked before the general rules.
 */
const NAMES = {
  // Verbs: "note" here means "record".
  noteUsed: 'recordUsed',
  noteOwnWrite: 'recordOwnWrite',
  noteWritten: 'recordWritten',
  noteHighlightColorUse: 'recordHighlightColorUse',
  noteCrepeIcons: 'recordCrepeIcons',
  // Would read "page page".
  notePageSwitches: 'readPageSwitches',
  setNotePageSwitch: 'writePageSwitch',
  NOTE_PAGE: 'PAGE_SURFACE',
  notePage: 'mountedPage',
  // draw.io's own action names.
  insertNote: 'insertNote',
  editNote: 'editNote',
  // The page's own switches, read from and written to its text (`shared/pageSwitches.ts`).
  noteFindFolds: 'readFindFolds',
  setNoteFindFolds: 'writeFindFolds',
  noteOutsideGlow: 'readOutsideGlow',
  setNoteOutsideGlow: 'writeOutsideGlow',
  noteBlockWidth: 'readBlockWidth',
  setNoteBlockWidth: 'writeBlockWidth',
  // Taken already: `readPage` (the ID sweep), `changeCardLine` (a card file's text), `CardLink` (`@shared/cardLinks`),
  // `CardEditor` (the card's own editor), `CardAnswer` (`@shared/cardSchedule`), `CardReviewDoor` (its context),
  // `cardDeps` and `openCard` (locals beside them), `cardPlugins` (the card editor's).
  readNote: 'readPageFile',
  writeNote: 'writePageFile',
  changeNoteCardLine: 'changeCardLineAt',
  noteCardLine: 'cardBlockLine',
  NoteCardLink: 'CardRenderLink',
  NoteCardEditor: 'CardPaneEditor',
  NoteCardAnswer: 'CardAnswerView',
  NoteCardReviewDoor: 'CardReviewDoorApi',
  noteCardDeps: 'cardDepsOf',
  openNoteCard: 'openCardAt',
  noteCardPlugins: 'cardBlockPlugins',
}

// ---- The general rules, in order. `(?<![A-Za-z0-9])note` starts a word or a camelCase name; `Note` starts a
// camelCase part; `NOTE` an UPPER_CASE part. A following lower-case letter ends the match (`notebook`, `noted`). ----

const RULES = [
  // The card block's node view (the ```card block in a page): `cardView` is the cell note card's.
  [/(?<![A-Za-z0-9])noteCardView/g, 'cardBlockView'],
  [/(?<![A-Z])NoteCardView/g, 'CardBlockView'],
  // "Note card" → "Card".
  [/(?<![A-Za-z0-9])note(?:[ _-]?card|Card)(s?)(?![a-z])/g, 'card$1'],
  [/(?<![A-Z])Note(?:[ -]?[Cc]ard)(s?)(?![a-z])/g, 'Card$1'],
  [/(?<![A-Z])NOTE_CARD(S?)(?![A-Z])/g, 'CARD$1'],
  // After an escape in a string ("---\\nnote: x").
  [/(?<=\\[ntr])note(?:[ _-]?card|Card)(s?)(?![a-z])/g, 'card$1'],
  [/(?<=\\[ntr])note(s?)(?![a-z])/g, 'page$1'],
  // After a percent escape in a link ("My%20note.md").
  [/(?<=%[0-9A-F]{2})note(s?)(?![a-z])/g, 'page$1'],
  // Every other "note" → "page", in its own case.
  [/(?<![A-Za-z0-9])note(s?)(?![a-z])/g, 'page$1'],
  [/(?<![A-Z])Note(s?)(?![a-z])/g, 'Page$1'],
  [/(?<![A-Z])NOTE(S?)(?![A-Z])/g, 'PAGE$1'],
]

/** A hit of any rule. */
const HAS_NOTE = /(?<![A-Za-z0-9]|\\[ntr])notes?(?![a-z])|(?<=\\[ntr]|%[0-9A-F]{2})notes?(?![a-z])|(?<![A-Z])Notes?(?![a-z])|(?<![A-Z])NOTES?(?![A-Z])/
const NAME = /[A-Za-z_$][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*/g
const BARE = new Set(['note', 'notes', 'Note', 'Notes', 'NOTE', 'NOTES'])

/**
 * The page keys' IDs (`shared/keys/note.ts`, `page.<x>` after the rename): `note.bold` is a key. Any other
 * `note.<x>` in a string or a comment is the Bases namespace of a view (`note.status`) and stays.
 */
const KEY_IDS = new Set(
  'heading bold italic underline strikethrough highlight inlineCode clearFormatting text heading1 heading2 heading3 heading4 heading5 heading6 quote codeBlock bulletList cycleTask indent outdent foldHere unfoldHere foldAll unfoldAll zoomIn zoomOut openCellNote nextCellNote previousCellNote cellNoteBack cellNoteForward allCellNotes nextTimeBlock previousTimeBlock copyVisible find toc undo redo selectAll enter lineBreak embedPick tab delete deleteMore lineStartEnd selectLines escape popupMove'.split(
    ' ',
  ),
)
/** A file name: `note.md` is a page's file, never a Bases key. */
const EXT = /^(md|markdown|mdx|txt|ts|tsx|js|css|json|html|excalidraw|drawio|pdf|png|jpe?g|gif|svg)$/i
const BASES = /(?<![A-Za-z0-9_$.])note(?=\.([A-Za-z_$][A-Za-z0-9_$]*|\$\{)|\[["'`])|(?<=["'`])note(?=\.["'`])|(?<![A-Za-z0-9_$.])note(?=\\+\.)/g

let ts = null
function typescript() {
  if (ts === null) ts = createRequire(path.join(process.cwd(), 'package.json'))('typescript')
  return ts
}

/** The offsets of the code identifiers `note` in a script (not in a string or a comment). */
function codeNoteOffsets(file, text) {
  const t = typescript()
  const kind = /x$/.test(file) ? t.ScriptKind.TSX : /\.m?js$|\.cjs$/.test(file) ? t.ScriptKind.JS : t.ScriptKind.TS
  const sf = t.createSourceFile(file, text, t.ScriptTarget.Latest, false, kind)
  const at = new Set()
  const visit = (n) => {
    if (t.isIdentifier(n) && n.text === 'note') at.add(n.getStart(sf))
    t.forEachChild(n, visit)
  }
  visit(sf)
  return at
}

/**
 * The rename of one file's text. `names`: every longer name with "note" in the files that are not word-keeping (the
 * run reads them all); a word-keeping file renames only those. With no `names`, it renames them all.
 */
export function renameText(text, { file = 'x.ts', names = null } = {}) {
  if (text.includes(SKIP_FILE) || !HAS_NOTE.test(text)) return text
  const keepWords = WORD_KEEPING.some((re) => re.test(file))
  const kept = []
  const hold = (m) => `${kept.push(m) - 1}`
  let out = text
  // The Bases namespace: kept unless it is code (`note.querySelector`) or a page key (`note.bold`).
  BASES.lastIndex = 0
  const code = /\.(m?[jt]sx?|cjs)$/.test(file) && BASES.test(text) ? codeNoteOffsets(file, text) : new Set()
  BASES.lastIndex = 0
  out = out.replace(BASES, (m, member, offset) => (code.has(offset) || KEY_IDS.has(member) || EXT.test(member ?? '') ? m : hold(m)))
  out = out.replace(/^.*$/gm, (line) => (line.includes(KEEP_LINE) ? hold(line) : line))
  if (keepWords) for (const [re, to] of PAGE_PHRASES) out = out.replace(re, to)
  for (const re of KEEP) out = out.replace(re, hold)
  // A doc line about cell notes: its bare "note" is a cell note too (`[^cell-1]` and "the note right under the table").
  if (/\.md$/.test(file)) out = out.replace(/^.*\uE000.*$/gm, (line) => (/cell[ -]?notes?/i.test(line.replace(/\uE000(\d+)\uE001/g, (_, n) => kept[Number(n)])) ? line.replace(/(?<![A-Za-z0-9_$`.-])(?:notes?|Notes?)(?![A-Za-z0-9_$`-]|[ -]?[Cc]ards?\b)/g, hold) : line))
  out = out.replace(NAME, (name) => {
    if (Object.hasOwn(NAMES, name)) return hold(NAMES[name])
    if (keepWords && HAS_NOTE.test(name) && (BARE.has(name) || (names !== null && !names.has(name)))) return hold(name)
    return name
  })
  for (const [re, to] of RULES) out = out.replace(re, to)
  for (let i = 0; i < 3 && out.includes(''); i++) out = out.replace(/(\d+)/g, (_, n) => kept[Number(n)])
  return out
}

/** The new path of a tracked file: each part renamed as a name. A word-keeping file keeps its path. */
export function renamePath(file) {
  if (WORD_KEEPING.some((re) => re.test(file))) return file
  return file
    .split('/')
    .map((part) => renameText(part, { file: 'x.txt' }))
    .join('/')
}

export const skipped = (file) => SKIP.some((re) => re.test(file)) || !TEXT.test(file)

/** Every longer name with "note" in the files that are not word-keeping. */
export function namesOf(files, read) {
  const names = new Set()
  for (const file of files) {
    if (WORD_KEEPING.some((re) => re.test(file))) continue
    for (const name of read(file).match(NAME) ?? []) if (!BARE.has(name) && HAS_NOTE.test(name)) names.add(name)
  }
  return names
}

// ---- The run ----

function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const left = args.includes('--left')
  const only = args.filter((a) => !a.startsWith('--'))
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  process.chdir(root)
  const tracked = (paths) =>
    execFileSync('git', ['ls-files', '-z', ...paths], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\0')
      .filter((f) => f !== '' && !skipped(f) && existsSync(f) && statSync(f).isFile())
  const all = tracked([])
  const files = only.length === 0 ? all : tracked(only)
  const cache = new Map()
  const read = (f) => cache.get(f) ?? (cache.set(f, readFileSync(f, 'utf8')), cache.get(f))

  if (left) {
    for (const file of files) {
      const text = read(file)
      if (text.includes(SKIP_FILE)) continue
      text.split('\n').forEach((line, i) => {
        if (/note/i.test(line) && !line.includes(KEEP_LINE)) console.log(`${file}:${i + 1}: ${(line.match(/[A-Za-z_$.-]*[Nn][Oo][Tt][Ee][A-Za-z0-9_$-]*/g) ?? []).join(' ')}`)
      })
    }
    return
  }

  const names = namesOf(all, read)
  const moves = []
  const targets = new Set(all)
  for (const file of files) {
    const to = renamePath(file)
    if (to === file) continue
    if (targets.has(to) || existsSync(to)) throw new Error(`rename clash: ${file} → ${to} exists already`)
    targets.add(to)
    moves.push([file, to])
  }
  let changed = 0
  for (const file of files) {
    const before = read(file)
    const after = renameText(before, { file, names })
    if (after === before) continue
    changed++
    if (dry) console.log(`change ${file}`)
    else writeFileSync(file, after)
  }
  for (const [from, to] of moves) {
    if (dry) console.log(`move ${from} → ${to}`)
    else {
      execFileSync('mkdir', ['-p', path.dirname(to)])
      execFileSync('git', ['mv', from, to])
    }
  }
  console.log(`${dry ? 'would change' : 'changed'} ${changed} files; ${dry ? 'would move' : 'moved'} ${moves.length}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
