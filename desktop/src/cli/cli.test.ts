/**
 * `yaseendocs` (YAZ-1617): the program runs in-process against real temp files — `main(argv, io)`
 * with captured stdio — so every receipt, refusal and exit code is pinned without spawning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readComments } from '@shared/comments'
import { IDS_FILE, isNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import { createStore } from '../main/store'
import { sweepIds } from '../main/vaultIndex/idSweep'
import { macId } from '../main/vaultIndex/mint'
import { scanFile } from '../main/vaultIndex/scan'
import { dailyNoteName } from '@shared/dailyNote'
import { settingsFileText } from '@shared/settingsSync'
import type { SettingsState } from '@shared/types'
import { HELP, USAGE, dayOf, find, label, main, transformOnDisk } from './cli'

let dir: string
beforeEach(async () => {
  // realpath: macOS's tmpdir is a symlink (`/var` → `/private/var`) and `resolve()` in the CLI does not follow it.
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-1617-')))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

interface Run {
  code: number
  out: string
  err: string
}

async function run(argv: string[], stdin = ''): Promise<Run> {
  let out = ''
  let err = ''
  const code = await main(argv, { stdin: async () => stdin, stdout: (t) => (out += t), stderr: (t) => (err += t) })
  return { code, out, err }
}

async function page(name: string, content: string): Promise<string> {
  const p = path.join(dir, name)
  await writeFile(p, content, 'utf8')
  return p
}

/**
 * A vault under the temp dir (`.yaseendocs/` exists) holding `files`, keyed by vault-relative path.
 * It gives its notes IDs unless `ids` says no (false) or leaves the question unanswered (null).
 */
async function vault(name: string, files: Record<string, string>, ids: boolean | null = true): Promise<string> {
  const root = path.join(dir, name)
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  // A vault that gives IDs has its letters (YAZ-2677 R9).
  if (ids !== null) await writeFile(path.join(root, VAULT_CONFIG_DIR, IDS_FILE), JSON.stringify(ids ? { enabled: true, letters: 'YAZ' } : { enabled: ids }))
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), content, 'utf8')
  }
  return root
}

const at = (n: number) => `2026-09-11T18:22:0${n}Z`
const PERSON_AND_AGENT = `---
title: Weekly
comments:
  - id: aa1
    n: 1
    at: ${at(1)}
    body: Person's comment
  - id: bb2
    n: 2
    at: ${at(2)}
    by: agent
    title: Numbers
    body: Agent's comment
  - id: cc3
    n: 1
    at: ${at(3)}
    reply_to: bb2
    by: agent
    body: Agent's reply
---
# Weekly
`

describe('help and usage', () => {
  it('no arguments, `help`, `--help` and `-h` print the contract and exit 0', async () => {
    for (const argv of [[], ['help'], ['--help'], ['comment', '-h']]) {
      const r = await run(argv)
      expect(r).toEqual({ code: 0, out: HELP, err: '' })
    }
  })

  it('the contract names every verb and both rules an agent must know', () => {
    for (const word of ['comment ', 'comments ', 'edit ', 'delete ', 'yaseendocs id ', 'yaseendocs links ', 'yaseendocs mentions ', 'yaseendocs due ', 'yaseendocs vaults ', '[[<id>]]', '(missing)', 'id: <id>', '--body', '--title', '--reply-to', '--by', '--json', 'by: agent', 'never in the body', 'Exit codes']) {
      expect(HELP).toContain(word)
    }
  })

  it('says, in one paragraph, that a value is the page’s own top-level field, that columns flow down, and that `in:` holds only a "Separate value for <folder>" value, in the block named by the folder’s id (YAZ-4713 C1, 7A 14)', () => {
    const lines = HELP.split('\n')
    const first = lines.findIndex((line) => line.includes('value for a column is a top-level field'))
    expect(first).toBeGreaterThan(-1)
    const said = lines.slice(first, first + 6).join(' ')
    for (const words of ['one value per key', 'every folder page below it', 'Only a column set to "Separate value for <folder>"', "named by the folder's id", '`id` in `<folder>/.folder.md`']) expect(said).toContain(words)
    // Nowhere else: that paragraph is the whole of it.
    expect(lines.filter((line, i) => (i < first || i >= first + 6) && /`in:`|\.folder\.md/.test(line))).toEqual([])
  })

  it('E: says that a page\'s title is its `title:` line, that the app builds the file name from the title and the id, and that a page is found from an id by its file name (YAZ-2420 D14)', () => {
    const help = HELP.replace(/\s+/g, ' ')
    for (const said of ['`title:` line', '`<kebab-title>-<id>.md`', "search the vault's file names for it", 'a file the app did not name is found by its `id: <id>` line']) expect(help).toContain(said)
  })

  it('usage errors exit 2 with the reason and the usage block on stderr, nothing on stdout', async () => {
    const p = await page('a.md', '')
    for (const [argv, reason] of [
      [['frobnicate', p], 'unknown command: frobnicate'],
      [['comment'], 'comment needs a page'],
      [['id'], 'id needs a page'],
      [['id', p, '--jsno'], 'unknown flag: --jsno'],
      [['links'], 'links needs a page'],
      [['links', p, '--jsno'], 'unknown flag: --jsno'],
      [['mentions'], 'mentions needs a page'],
      [['mentions', p, '--title', 'x'], 'mentions does not take --title'],
      [['comment', p], '--body is required'],
      [['comment', p, '--body'], '--body needs a value'],
      [['comment', p, '--titel', 'Numbers', '--body', 'x'], 'unknown flag: --titel'],
      [['comment', p, '--body', 'x', '--replyto', '2'], 'unknown flag: --replyto'],
      [['edit', p], 'edit needs a comment (#3, #3.1, or its id)'],
      [['delete', p], 'delete needs a comment (#3, #3.1, or its id)'],
    ] as const) {
      const r = await run([...argv])
      expect(r.code, argv.join(' ')).toBe(2)
      expect(r.out).toBe('')
      expect(r.err).toBe(`${reason}\n${USAGE}\n`)
    }
  })
})

describe('comment', () => {
  it('grows a page with no frontmatter, writes `by: agent`, numbers it and prints the receipt', async () => {
    const p = await page('fresh.md', '# Fresh\n\nBody stays.\n')
    const r = await run(['comment', p, '--body', 'First!'])
    expect(r).toEqual({ code: 0, out: `#1 added to ${p}\n`, err: '' })
    const content = await readFile(p, 'utf8')
    expect(content.endsWith('---\n# Fresh\n\nBody stays.\n')).toBe(true)
    const [c] = readComments(content)
    expect(c).toMatchObject({ n: 1, by: 'agent', body: 'First!' })
    expect(c.id).toMatch(/^[0-9a-f]{8}$/)
    expect(c.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    expect(content).toMatch(/    at: [^\n]+\n    by: agent\n    body: First!\n/)
  })

  it('a reply files under the top-level parent and reads as #2.2; --title and --by are honoured', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    const r = await run(['comment', p, '--reply-to', 'cc3', '--title', 'Follow-up', '--by', 'codex', '--body', 'Seen.'])
    expect(r).toEqual({ code: 0, out: `#2.2 added to ${p}\n`, err: '' })
    const added = readComments(await readFile(p, 'utf8')).find((c) => c.body === 'Seen.')
    expect(added).toMatchObject({ n: 2, reply_to: 'bb2', by: 'codex', title: 'Follow-up' })
    // A blank --by is not a declaration: it falls back to `agent`, so the comment stays the agent's to edit or delete.
    await run(['comment', p, '--by', '  ', '--body', 'blank by'])
    expect(readComments(await readFile(p, 'utf8')).find((c) => c.body === 'blank by')?.by).toBe('agent')
  })

  it('--reply-to takes the number the app shows (#2, or bare 2) as well as the id; an unknown target is refused, nothing written', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    expect((await run(['comment', p, '--reply-to', '#2', '--body', 'by number'])).out).toBe(`#2.2 added to ${p}\n`)
    expect((await run(['comment', p, '--reply-to', '2', '--body', 'bare number'])).out).toBe(`#2.3 added to ${p}\n`)
    expect(readComments(await readFile(p, 'utf8')).filter((c) => c.reply_to === 'bb2')).toHaveLength(3)
    const before = await readFile(p, 'utf8')
    expect(await run(['comment', p, '--reply-to', '9', '--body', 'orphan?'])).toEqual({ code: 1, out: '', err: `no comment 9 on ${p}\n` })
    expect(await readFile(p, 'utf8')).toBe(before)
  })

  it('`--body -` takes the comment from stdin, multi-line and all', async () => {
    const p = await page('s.md', '')
    const r = await run(['comment', p, '--body', '-'], 'line one\nline two\n')
    expect(r.code).toBe(0)
    expect(readComments(await readFile(p, 'utf8'))[0].body).toBe('line one\nline two')
  })

  it('a relative page path resolves against the working directory', async () => {
    const p = await page('rel.md', '')
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      expect((await run(['comment', 'rel.md', '--body', 'x'])).out).toBe(`#1 added to ${p}\n`)
    } finally {
      process.chdir(cwd)
    }
  })

  it('refuses a foreign `comments:` value and a broken block — exit 1, bytes untouched', async () => {
    const foreign = await page('f.md', '---\ncomments: 3\n---\n')
    const broken = await page('b.md', '---\ntitle: [\n---\n')
    for (const [p, reason] of [
      [foreign, 'the comments property is not a comment list (foreign)'],
      [broken, 'the properties block does not parse (invalid)'],
    ] as const) {
      const before = await readFile(p, 'utf8')
      const r = await run(['comment', p, '--body', 'x'])
      expect(r).toEqual({ code: 1, out: '', err: `${reason}\n` })
      expect(await readFile(p, 'utf8')).toBe(before)
    }
  })

  it("the first comment on a folder creates its settings file (YAZ-2290 D1); `edit` and `delete`, and a folder that is not there, fail as any missing page does; `comments` reads it as empty", async () => {
    await mkdir(path.join(dir, 'Projects'))
    const p = path.join(dir, 'Projects', '.folder.md')
    for (const argv of [['edit', p, '#1', '--body', 'x'], ['delete', p, '#1']]) {
      expect((await run(argv)).code, argv[0]).toBe(1)
    }
    expect((await run(['comments', p])).code).toBe(0)
    const r = await run(['comment', p, '--body', 'On the folder'])
    expect(r).toEqual({ code: 0, out: `#1 added to ${p}\n`, err: '' })
    expect(readComments(await readFile(p, 'utf8'))).toMatchObject([{ n: 1, by: 'agent', body: 'On the folder' }])
    expect((await run(['comment', path.join(dir, 'Gone', '.folder.md'), '--body', 'x'])).code).toBe(1)
  })

  it('a page that is not markdown is refused by EVERY verb before any I/O; a missing page with exit 1', async () => {
    const txt = await page('notes.txt', 'hi')
    for (const argv of [['comment', txt, '--body', 'x'], ['comments', txt], ['edit', txt, '#1', '--body', 'x'], ['delete', txt, '#1'], ['id', txt], ['links', txt]]) {
      const r = await run(argv)
      expect(r.code, argv[0]).toBe(1)
      expect(r.err).toBe('only .md/.markdown files are editable\n')
    }
    expect(await readFile(txt, 'utf8')).toBe('hi')
    const missing = await run(['comment', path.join(dir, 'nope.md'), '--body', 'x'])
    expect(missing.code).toBe(1)
    expect(missing.err).not.toBe('')
  })
})

describe('comments', () => {
  it('lists every thread: label, stamp, writer, title or first line; replies indented', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    const r = await run(['comments', p])
    expect(r).toEqual({
      code: 0,
      err: '',
      out: `#1  aa1  ${at(1)}  Person's comment\n#2  bb2  ${at(2)}  (agent)  Numbers\n  #2.1  cc3  ${at(3)}  (agent)  Agent's reply\n`,
    })
  })

  it('--json prints the threads shape; an empty page says so', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    const threads = JSON.parse((await run(['comments', p, '--json'])).out)
    expect(threads).toHaveLength(2)
    expect(threads[1].comment.id).toBe('bb2')
    expect(threads[1].replies[0].id).toBe('cc3')
    const empty = await page('e.md', '# Nothing\n')
    expect((await run(['comments', empty])).out).toBe(`no comments on ${empty}\n`)
    expect(JSON.parse((await run(['comments', empty, '--json'])).out)).toEqual([])
  })

  it('`comments <folder>/.folder.md` when the file is missing and the folder exists: `no comments on <path>`, `[]` with --json, and nothing is written', async () => {
    await mkdir(path.join(dir, 'Projects'))
    const p = path.join(dir, 'Projects', FOLDER_SETTINGS_FILE)
    expect(await run(['comments', p])).toEqual({ code: 0, out: `no comments on ${p}\n`, err: '' })
    expect(await run(['comments', p, '--json'])).toEqual({ code: 0, out: '[]\n', err: '' })
    await expect(stat(p)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('the same when the folder does not exist: the not-found error, as for any missing page', async () => {
    const missing = await run(['comments', path.join(dir, 'nope.md')])
    const gone = await run(['comments', path.join(dir, 'Gone', FOLDER_SETTINGS_FILE)])
    expect(gone).toEqual(missing)
    expect(gone).toEqual({ code: 1, out: '', err: 'path does not exist\n' })
  })
})

describe('edit and delete (🔒 D4: only what an agent wrote)', () => {
  it('edit replaces the body, keeps the title when --title is absent, blank --title removes it, and stamps `edited`', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    expect(await run(['edit', p, 'bb2', '--body', 'Fixed.'])).toEqual({ code: 0, out: '#2 edited\n', err: '' })
    let c = readComments(await readFile(p, 'utf8')).find((x) => x.id === 'bb2')
    expect(c).toMatchObject({ body: 'Fixed.', title: 'Numbers', by: 'agent' })
    expect(c?.edited).toMatch(/Z$/)
    await run(['edit', p, 'bb2', '--body', 'Again.', '--title', ''])
    c = readComments(await readFile(p, 'utf8')).find((x) => x.id === 'bb2')
    expect(c?.title).toBeUndefined()
    expect(c?.body).toBe('Again.')
  })

  it('delete removes the comment and its replies, and says how many', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    expect(await run(['delete', p, 'bb2'])).toEqual({ code: 0, out: '#2 deleted (and 1 reply)\n', err: '' })
    const left = readComments(await readFile(p, 'utf8'))
    expect(left.map((c) => c.id)).toEqual(['aa1'])
    const p2 = await page('w2.md', PERSON_AND_AGENT)
    expect((await run(['delete', p2, 'cc3'])).out).toBe('#2.1 deleted\n')
  })

  it("refuses a person's comment (no `by`) for both verbs — exit 1, bytes untouched", async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    for (const argv of [
      ['edit', p, 'aa1', '--body', 'nope'],
      ['delete', p, 'aa1'],
    ]) {
      const r = await run(argv)
      expect(r).toEqual({ code: 1, out: '', err: '#1 was left by a person — only its writer can edit or delete it (--by)\n' })
    }
    expect(await readFile(p, 'utf8')).toBe(PERSON_AND_AGENT)
  })

  it('edit and delete take the number too (#2.1), and an unknown name is refused with exit 1', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    expect((await run(['edit', p, '#2.1', '--body', 'by number'])).out).toBe('#2.1 edited\n')
    expect(readComments(await readFile(p, 'utf8')).find((c) => c.id === 'cc3')?.body).toBe('by number')
    expect((await run(['delete', p, '2.1'])).out).toBe('#2.1 deleted\n')
    expect(await run(['delete', p, 'zz9'])).toEqual({ code: 1, out: '', err: `no comment zz9 on ${p}\n` })
    expect(await run(['delete', p, '#7'])).toEqual({ code: 1, out: '', err: `no comment #7 on ${p}\n` })
  })
})

describe('id (YAZ-2293)', () => {
  it('a page that has an id, in a vault that gives its notes IDs: prints it and writes nothing — bytes and mtime as they were', async () => {
    const content = '---\nid: k3m9x2pq7abc\n---\n# Has one\n'
    const p = path.join(await vault('ids', { 'has.md': content }), 'has.md')
    const before = (await stat(p)).mtimeMs
    expect(await run(['id', p])).toEqual({ code: 0, out: 'k3m9x2pq7abc\n', err: '' })
    expect(await readFile(p, 'utf8')).toBe(content)
    expect((await stat(p)).mtimeMs).toBe(before)
  })

  it('the vault is the nearest folder above the page that has ANSWERED: a folder in between that only holds app settings does not hide it (YAZ-2523 V10)', async () => {
    const root = await vault('outer', { 'Inner/a.md': '# A\n', 'Inner/.yaseendocs/favorites.json': '[]\n' })
    const r = await run(['id', path.join(root, 'Inner', 'a.md')])
    expect(r.code).toBe(0)
    expect(isNoteId(r.out.trim())).toBe(true)
  })

  it('a page whose vault does not give its notes IDs — it said no, it has not answered, or there is no vault above — is refused whether or not it holds an `id`: exit 1, nothing written (YAZ-2523)', async () => {
    for (const content of ['---\nid: 42\ntitle: Kickoff\n---\n# Kickoff\n', '---\nid: k3m9x2pq7abc\n---\n# Has one\n']) {
      const said = await vault('no', { 'Kickoff.md': content, 'Projects/a.png': 'png' }, false)
      const pages = [path.join(said, 'Kickoff.md'), path.join(await vault('unanswered', { 'Kickoff.md': content }, null), 'Kickoff.md'), await page('Kickoff.md', content)]
      for (const p of pages) {
        expect(await run(['id', p])).toEqual({ code: 1, out: '', err: `${p}'s vault does not give its notes IDs (turn on "Give this vault's notes IDs" in the app's Settings)\n` })
        expect(await readFile(p, 'utf8')).toBe(content)
      }
      // A folder is given no settings file there either.
      expect((await run(['id', path.join(said, 'Projects', FOLDER_SETTINGS_FILE)])).code).toBe(1)
      expect(await readdir(path.join(said, 'Projects'))).toEqual(['a.png'])
    }
  })

  it('a page with no id, in a vault that gives its notes IDs: is given the vault\'s next number, and no other byte changes (YAZ-2677 S40)', async () => {
    const content = '---\ntitle: Kickoff # kept\n---\n# Kickoff\n'
    const p = path.join(await vault('mine', { 'Projects/Kickoff.md': content }), 'Projects/Kickoff.md')
    expect(await run(['id', p])).toEqual({ code: 0, out: 'YAZ-1\n', err: '' })
    expect(await readFile(p, 'utf8')).toBe('---\ntitle: Kickoff # kept\nid: YAZ-1\n---\n# Kickoff\n')
    // Asked again, it prints the id the page holds and takes no number.
    expect((await run(['id', p])).out).toBe('YAZ-1\n')
    expect(await run(['id', path.join(path.dirname(p), '..', 'Projects', 'Kickoff.md')])).toMatchObject({ code: 0, out: 'YAZ-1\n' })
  })

  it('R20, S40: the command gives the number the app would give — the highest number in the vault plus 1 — and uses the one count file of this Mac, as the app does', async () => {
    const root = await vault('shared', { 'held.md': '---\nid: YAZ-41\n---\n', 'old.md': '---\nid: k3m9x2pq7abc\n---\n', 'by-command.md': '# A\n', 'by-app.md': '# B\n', 'by-command-2.md': '# C\n' })
    expect((await run(['id', path.join(root, 'by-command.md')])).out).toBe('YAZ-42\n')
    // The app, on this Mac, meets another note of the same vault: its sweep takes the next number from the same door.
    const file = path.join(root, 'by-app.md')
    const records = new Map<string, IndexRecord>()
    for (const name of ['held.md', 'old.md', 'by-command.md', 'by-app.md']) records.set(path.join(root, name), await scanFile(root, path.join(root, name)))
    await sweepIds(root, records, [records.get(file)!], () => undefined)
    expect(await readFile(file, 'utf8')).toBe('---\nid: YAZ-43\n---\n# B\n')
    expect((await run(['id', path.join(root, 'by-command-2.md')])).out).toBe('YAZ-44\n')
    // One count file: this Mac's. It holds what the command and the app gave.
    const counts = await readdir(path.join(root, VAULT_CONFIG_DIR, 'ids'))
    expect(counts).toEqual([`${await macId()}.json`])
    const count = JSON.parse(await readFile(path.join(root, VAULT_CONFIG_DIR, 'ids', counts[0]), 'utf8')) as { last: number; made: { from: number; to: number }[] }
    expect(count.last).toBe(44)
    expect(count.made.map(({ from, to }) => [from, to])).toEqual([[42, 42], [43, 43], [44, 44]])
  })

  it('S28: a number that a deleted note had is not given again by the command', async () => {
    const root = await vault('gone', { 'a.md': '# A\n', 'b.md': '# B\n' })
    expect((await run(['id', path.join(root, 'a.md')])).out).toBe('YAZ-1\n')
    await rm(path.join(root, 'a.md'))
    expect((await run(['id', path.join(root, 'b.md')])).out).toBe('YAZ-2\n')
  })

  it('a vault that has no letters yet uses the default of its folder name, and the command saves it with the first number (R11)', async () => {
    const root = path.join(dir, 'notebook')
    await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
    await writeFile(path.join(root, VAULT_CONFIG_DIR, IDS_FILE), '{"enabled":true}')
    await writeFile(path.join(root, 'a.md'), '# A\n')
    expect((await run(['id', path.join(root, 'a.md')])).out).toBe('NOT-1\n')
    expect(JSON.parse(await readFile(path.join(root, VAULT_CONFIG_DIR, IDS_FILE), 'utf8'))).toEqual({ enabled: true, letters: 'NOT' })
  })

  it('a page that holds a number ID: printed as the app writes it, whatever its case in the file, and nothing is written (S18)', async () => {
    const content = '---\nid: yaz-12\n---\n'
    const p = path.join(await vault('cased', { 'a.md': content }), 'a.md')
    expect(await run(['id', p])).toEqual({ code: 0, out: 'YAZ-12\n', err: '' })
    expect(await readFile(p, 'utf8')).toBe(content)
  })

  it("`id <folder>/.folder.md` when the file is missing: the folder is given a settings file that holds only its id, the vault's next number, and the id is printed; a folder that does not exist is not found", async () => {
    const root = await vault('mine', {})
    const p = path.join(root, 'Projects', FOLDER_SETTINGS_FILE)
    await mkdir(path.dirname(p))
    expect(await run(['id', p])).toEqual({ code: 0, out: 'YAZ-1\n', err: '' })
    expect(await readFile(p, 'utf8')).toBe('---\nid: YAZ-1\n---\n')
    expect(await run(['id', path.join(root, 'Gone', FOLDER_SETTINGS_FILE)])).toEqual({ code: 1, out: '', err: 'path does not exist\n' })
  })

  it("a page whose `id` is another tool's (`id: 42`, or another vault's letters), in a vault that gives its notes IDs: the vault's next number is written over it, and printed (YAZ-2420 D30, YAZ-2677 R7)", async () => {
    const root = await vault('mine', { 'Projects/Kickoff.md': '---\nid: 42\ntitle: Kickoff\n---\n# Kickoff\n', 'moved-in.md': '---\nid: BUS-12\n---\n' })
    const p = path.join(root, 'Projects/Kickoff.md')
    expect(await run(['id', p])).toEqual({ code: 0, out: 'YAZ-1\n', err: '' })
    expect(await readFile(p, 'utf8')).toBe('---\nid: YAZ-1\ntitle: Kickoff\n---\n# Kickoff\n')
    expect((await run(['id', path.join(root, 'moved-in.md')])).out).toBe('YAZ-2\n')
    expect(await readFile(path.join(root, 'moved-in.md'), 'utf8')).toBe('---\nid: YAZ-2\n---\n')
  })

  it('a page whose properties block does not parse cannot take an id — exit 1, bytes untouched', async () => {
    const content = '---\nid: 42\ntitle: [\n---\n'
    const p = path.join(await vault('mine', { 'broken.md': content }), 'broken.md')
    expect(await run(['id', p])).toEqual({ code: 1, out: '', err: 'the properties block does not parse (invalid)\n' })
    expect(await readFile(p, 'utf8')).toBe(content)
  })
})

describe('links (YAZ-2293)', () => {
  const NOTE = 'k3m9x2pq7abc'
  const FOLDER = 'f7d2m4n8q1rs'
  const DEAD = 'z9z9z9z9z9z9'
  const mine = () =>
    vault('mine', {
      'Home.md': `---\nalso_in:\n  - ${FOLDER}\n  - 7\n---\nSee [[${NOTE}]], [[${NOTE}|the kickoff]], [[Some Title]] and [[${DEAD}]].\n`,
      'Projects/Alpha/Kickoff notes.md': `---\nid: ${NOTE}\n---\n# Kickoff\n`,
      [`Areas/${FOLDER_SETTINGS_FILE}`]: `---\nid: ${FOLDER}\n---\n`,
      // What the app's index never sees does not carry an id: a dot-folder, node_modules.
      '.trash/Old.md': `---\nid: ${DEAD}\n---\n`,
      'node_modules/pkg/readme.md': `---\nid: ${DEAD}\n---\n`,
      'Plain.md': '# Plain\n\n[[Some Title]]\n',
      'Scalar.md': `---\nalso_in: ${FOLDER}\n---\n`,
    })

  it('lists every id on the page once — links first, then also_in — with the page or folder it names now; a name link is not an id', async () => {
    const home = path.join(await mine(), 'Home.md')
    expect(await run(['links', home])).toEqual({
      code: 0,
      err: '',
      out: `${NOTE}  Kickoff notes  Projects/Alpha/Kickoff notes.md\n${DEAD}  (missing)\n${FOLDER}  Areas  Areas/  (also in)\n`,
    })
  })

  it('S92: lists number IDs and old IDs, each with the title and path it names now; a number ID is read in any case and with letters the vault had before, and other LETTERS-NUMBER text is a name (YAZ-2677 R5, R6)', async () => {
    const root = await vault('numbers', {
      'Home.md': `---\nalso_in:\n  - yaz-3\n---\nSee [[YAZ-12]], [[yaz-12|again]], [[OLD-7]], [[${NOTE}]], [[GPT-4]], [[BUS-12]] and [[YAZ-99]].\n`,
      'plan-yaz-12.md': '---\nid: YAZ-12\ntitle: Plan\n---\n',
      'before.md': '---\nid: OLD-7\ntitle: Before\n---\n',
      'Projects/Alpha/Kickoff notes.md': `---\nid: ${NOTE}\n---\n`,
      [`Areas/${FOLDER_SETTINGS_FILE}`]: '---\nid: YAZ-3\n---\n',
      // A note NAMED like an ID of another vault: `[[GPT-4]]` is a name link to it, never an ID.
      'GPT-4.md': '---\nid: YAZ-4\n---\n',
    })
    await writeFile(path.join(root, VAULT_CONFIG_DIR, IDS_FILE), JSON.stringify({ enabled: true, letters: 'YAZ', was: ['OLD'] }))
    expect(await run(['links', path.join(root, 'Home.md')])).toEqual({
      code: 0,
      err: '',
      out: `YAZ-12  Plan  plan-yaz-12.md\nYAZ-7  Before  before.md\n${NOTE}  Kickoff notes  Projects/Alpha/Kickoff notes.md\nYAZ-99  (missing)\nYAZ-3  Areas  Areas/  (also in)\n`,
    })
  })

  it('--json prints the same rows under `links`; a page with no ids says so', async () => {
    const root = await mine()
    const r = await run(['links', path.join(root, 'Home.md'), '--json'])
    expect(JSON.parse(r.out)).toEqual({
      links: [
        { id: NOTE, kind: 'note', title: 'Kickoff notes', path: 'Projects/Alpha/Kickoff notes.md' },
        { id: DEAD, kind: 'missing' },
        { id: FOLDER, kind: 'folder', title: 'Areas', path: 'Areas' },
      ],
      in: [],
    })
    expect(r.out).toContain('\n    {\n      "id"') // 2-space indented, as `comments --json` is
    const plain = path.join(root, 'Plain.md')
    expect(await run(['links', plain])).toEqual({ code: 0, out: `no ids on ${plain}\n`, err: '' })
    expect(JSON.parse((await run(['links', plain, '--json'])).out)).toEqual({ links: [], in: [] })
  })

  it('also lists the folders of the note’s `in:` block, each by id and current name, in a group of their own (and under `in` in --json); a block whose id no folder has is listed by id with no name', async () => {
    const root = await mine()
    const held = path.join(root, 'Held.md')
    // A link in a folder's value is a link of the page; a note's id names no folder.
    await writeFile(held, `---\nin:\n  ${FOLDER}:\n    Status: Interview\n    owner: "[[${NOTE}]]"\n  ${DEAD}:\n    Status: Old\n  ${NOTE}:\n    Status: x\n---\n`, 'utf8')
    expect(await run(['links', held])).toEqual({
      code: 0,
      err: '',
      out: `${NOTE}  Kickoff notes  Projects/Alpha/Kickoff notes.md\n\nin:\n${FOLDER}  Areas  Areas/\n${DEAD}\n${NOTE}\n`,
    })
    expect(JSON.parse((await run(['links', held, '--json'])).out)).toEqual({
      links: [{ id: NOTE, kind: 'note', title: 'Kickoff notes', path: 'Projects/Alpha/Kickoff notes.md' }],
      in: [{ id: FOLDER, title: 'Areas', path: 'Areas' }, { id: DEAD }, { id: NOTE }],
    })
    // Values and no ids: the links say so, and the folders are still listed.
    const only = path.join(root, 'Only.md')
    await writeFile(only, `---\nin:\n  ${FOLDER}:\n    Status: Interview\n---\n`, 'utf8')
    expect((await run(['links', only])).out).toBe(`no ids on ${only}\n\nin:\n${FOLDER}  Areas  Areas/\n`)
  })

  it('E: each id is followed by the title of the note or folder it names now, then its path — in the `in:` group too, and as `title` in --json (YAZ-2420 D14)', async () => {
    const root = await vault('titled', {
      'Home.md': `---\nalso_in:\n  - ${FOLDER}\nin:\n  ${FOLDER}:\n    Status: Interview\n---\nSee [[${NOTE}]] and [[${DEAD}]].\n`,
      [`candidates/up-001-abdul-${NOTE}.md`]: `---\nid: ${NOTE}\ntitle: UP-001 - Abdul\n---\n`,
      [`upwork-2026/${FOLDER_SETTINGS_FILE}`]: `---\nid: ${FOLDER}\ntitle: Upwork 2026\n---\n`,
    })
    const home = path.join(root, 'Home.md')
    expect((await run(['links', home])).out).toBe(
      `${NOTE}  UP-001 - Abdul  candidates/up-001-abdul-${NOTE}.md\n${DEAD}  (missing)\n${FOLDER}  Upwork 2026  upwork-2026/  (also in)\n\nin:\n${FOLDER}  Upwork 2026  upwork-2026/\n`,
    )
    expect(JSON.parse((await run(['links', home, '--json'])).out)).toEqual({
      links: [
        { id: NOTE, kind: 'note', title: 'UP-001 - Abdul', path: `candidates/up-001-abdul-${NOTE}.md` },
        { id: DEAD, kind: 'missing' },
        { id: FOLDER, kind: 'folder', title: 'Upwork 2026', path: 'upwork-2026' },
      ],
      in: [{ id: FOLDER, title: 'Upwork 2026', path: 'upwork-2026' }],
    })
  })

  it('a scalar `also_in` is one entry, as the app reads it', async () => {
    const scalar = path.join(await mine(), 'Scalar.md')
    expect((await run(['links', scalar])).out).toBe(`${FOLDER}  Areas  Areas/  (also in)\n`)
  })

  it('a page whose vault does not use IDs — it said no, it has not answered, or there is no vault above — has no ID links to list: exit 1 (YAZ-2523)', async () => {
    const content = `[[${NOTE}]]\n`
    for (const p of [path.join(await vault('no', { 'loose.md': content }, false), 'loose.md'), path.join(await vault('unanswered', { 'loose.md': content }, null), 'loose.md'), await page('loose.md', content)]) {
      expect(await run(['links', p])).toEqual({ code: 1, out: '', err: `${p}'s vault does not use IDs, so there are no ID links to list\n` })
    }
  })
})

/**
 * `mentions` (YAZ-4740 L6): the page's Linked mentions, from the same scan as `links`, resolved and gathered by the
 * app's own shared code (`@shared/linkResolver`, `@shared/mentions`) — the map the app's section and column read.
 */
describe('mentions (YAZ-4740)', () => {
  /** The app's map over the same files: the index's split of notes and folders, its resolver, its one pass. */
  const appMap = async (root: string, page: string, letters?: readonly string[]): Promise<string[]> => {
    const { makeResolver } = await import('@shared/linkResolver')
    const { mentionsOf } = await import('@shared/mentions')
    const { scanAll } = await import('../main/vaultIndex/reconcile')
    const { walk } = await import('../main/vaultIndex/scan')
    const files: string[] = []
    await walk(root, files)
    const all = [...(await scanAll(root, files)).values()].sort((a, b) => (a.path < b.path ? -1 : 1)).map((r) => (letters === undefined ? (({ id: _id, ...rest }) => ({ ...rest, title: rest.name === FOLDER_SETTINGS_FILE ? path.basename(path.dirname(rest.path)) : rest.basename }))(r) : r))
    const records = all.filter((r) => r.name !== FOLDER_SETTINGS_FILE)
    const folders = all.filter((r) => r.name === FOLDER_SETTINGS_FILE)
    const resolve = makeResolver(records.map((record) => ({ record })), root, { folders, letters })
    return (mentionsOf(records, folders, (t) => resolve(t)?.record.path ?? null).get(page) ?? []).map((r) => r.path)
  }

  it('a vault with IDs: every note and folder linking to the page — by id, title or alias, body or properties, embeds too — once each, path-sorted', async () => {
    const root = await vault('ids', {
      'Schema/total-yaz-1.md': '---\nid: YAZ-1\ntitle: Orders total\naliases: [total]\n---\n',
      'API/post-orders-yaz-2.md': '---\nid: YAZ-2\ntitle: POST orders\nreads_writes:\n  - "[[YAZ-1]]"\n---\nWrites [[YAZ-1]] and [[Orders total]].\n',
      'Web/use-orders-yaz-3.md': '---\nid: YAZ-3\ntitle: useOrders\n---\nShows ![[total]].\n',
      'Web/other-yaz-4.md': '---\nid: YAZ-4\ntitle: Other\n---\nNothing here.\n',
      [`API/${FOLDER_SETTINGS_FILE}`]: '---\nid: YAZ-5\ntitle: API\n---\nThe routes, around [[YAZ-1]].\n',
    })
    const page = path.join(root, 'Schema/total-yaz-1.md')
    expect(await run(['mentions', page])).toEqual({ code: 0, err: '', out: 'API  API/\nPOST orders  API/post-orders-yaz-2.md\nuseOrders  Web/use-orders-yaz-3.md\n' })
    const json = JSON.parse((await run(['mentions', page, '--json'])).out) as { title: string; path: string; kind: string }[]
    expect(json).toEqual([
      { title: 'API', path: 'API', kind: 'folder' },
      { title: 'POST orders', path: 'API/post-orders-yaz-2.md', kind: 'note' },
      { title: 'useOrders', path: 'Web/use-orders-yaz-3.md', kind: 'note' },
    ])
    // The app's map over the same vault answers the same pages.
    expect(json.map((r) => path.join(root, r.kind === 'folder' ? `${r.path}/${FOLDER_SETTINGS_FILE}` : r.path))).toEqual(await appMap(root, page, ['YAZ']))
    expect(await run(['mentions', path.join(root, 'Web/other-yaz-4.md')])).toEqual({ code: 0, err: '', out: `nothing links to ${path.join(root, 'Web/other-yaz-4.md')}\n` })
  })

  it('a vault without IDs: a name link resolves as the app resolves it — the shallowest of two notes of one name — and an `id:` is no id', async () => {
    const root = await vault('plain', {
      'Total.md': '---\nid: YAZ-1\n---\n',
      'Deep/Total.md': '',
      'A.md': 'See [[Total]] and [[YAZ-1]].\n',
      'Deep/B.md': 'See [[Deep/Total]].\n',
    }, false)
    const page = path.join(root, 'Total.md')
    expect(await run(['mentions', page])).toEqual({ code: 0, err: '', out: 'A  A.md\n' })
    expect((await run(['mentions', path.join(root, 'Deep/Total.md')])).out).toBe('B  Deep/B.md\n')
    expect([path.join(root, 'A.md')]).toEqual(await appMap(root, page))
  })

  it('YAZ-4954: words that only LOOK like an ID — the left side wins when it is a note, in the body and a property; the other order and a vault with only one side', async () => {
    const root = await vault('covid', {
      'Covid notes.md': '',
      'COVID-19.md': '',
      'A.md': 'See [[Covid notes|COVID-19]].\n',
      'B.md': 'See [[COVID-19|Covid notes]].\n',
      'C.md': '---\nrelated: "[[Covid notes|COVID-19]]"\n---\n',
    }, false)
    expect((await run(['mentions', path.join(root, 'Covid notes.md')])).out).toBe('A  A.md\nC  C.md\n')
    expect((await run(['mentions', path.join(root, 'COVID-19.md')])).out).toBe('B  B.md\n')
    expect(await appMap(root, path.join(root, 'Covid notes.md'))).toEqual([path.join(root, 'A.md'), path.join(root, 'C.md')])
    // Only the ID side is a note: the right side is the page.
    const lone = await vault('only-id', { 'COVID-19.md': '', 'A.md': 'See [[Covid notes|COVID-19]].\n' }, false)
    expect((await run(['mentions', path.join(lone, 'COVID-19.md')])).out).toBe('A  A.md\n')
    // Only the words side is a note: the left side is the page.
    const named = await vault('only-name', { 'Covid notes.md': '', 'A.md': 'See [[Covid notes|COVID-19]].\n' }, false)
    expect((await run(['mentions', path.join(named, 'Covid notes.md')])).out).toBe('A  A.md\n')
  })

  it('a page in no vault is refused: exit 1', async () => {
    const lone = await page('lone.md', '# Lone\n')
    expect(await run(['mentions', lone])).toEqual({ code: 1, out: '', err: `${lone} is in no vault (no ${VAULT_CONFIG_DIR} folder above it)\n` })
  })
})

describe('transformOnDisk (🔒 D8 on disk)', () => {
  it('a file that changes under the first write is re-read and the transform recomputed once', async () => {
    const p = await page('c.md', 'v1\n')
    let calls = 0
    const content = await transformOnDisk(p, (fresh) => {
      calls++
      if (calls === 1) writeFileSync(p, 'v2\n') // someone else lands between the read and the write
      return `${fresh}+\n`
    })
    expect(calls).toBe(2)
    expect(content).toBe('v2\n+\n')
    expect(await readFile(p, 'utf8')).toBe('v2\n+\n')
  })

  it('a second conflict is not retried: the CONFLICT surfaces and the file keeps the other writer\'s bytes', async () => {
    const p = await page('c.md', 'v1\n')
    let n = 0
    await expect(transformOnDisk(p, (fresh) => {
      writeFileSync(p, `v${++n + 1}\n`)
      return `${fresh}+\n`
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(p, 'utf8')).toBe('v3\n')
  })

  it('a no-op transform writes nothing', async () => {
    const p = await page('c.md', 'same\n')
    expect(await transformOnDisk(p, (fresh) => fresh)).toBe('same\n')
  })
})

describe('label and find', () => {
  it('find: by id, by #n / n, by #n.m / n.m; an id wins over a number that happens to match', () => {
    const comments = readComments(PERSON_AND_AGENT)
    expect(find(comments, 'cc3')?.id).toBe('cc3')
    expect(find(comments, '#2')?.id).toBe('bb2')
    expect(find(comments, '2')?.id).toBe('bb2')
    expect(find(comments, '#2.1')?.id).toBe('cc3')
    expect(find(comments, '2.1')?.id).toBe('cc3')
    expect(find(comments, '#3')).toBeUndefined()
    expect(find(comments, '#2.9')).toBeUndefined()
    const clash = readComments(`---\ncomments:\n  - id: "2"\n    n: 1\n    at: ${at(1)}\n    body: my id is the digit two\n  - id: b\n    n: 2\n    at: ${at(2)}\n    body: I am #2\n---\n`)
    expect(find(clash, '2')?.id).toBe('2')
  })

  it('label: #n, #parent.n, and the id when there is no number', () => {
    const comments = readComments(PERSON_AND_AGENT)
    expect(comments.map((c) => label(comments, c))).toEqual(['#1', '#2', '#2.1'])
    const bare = readComments('---\ncomments:\n  - id: h1\n    at: 2026-01-01T00:00:00Z\n    body: hand-written\n---\n')
    expect(label(bare, bare[0])).toBe('h1')
  })
})

// DUE_TESTS

describe('vaults (YAZ-2556 D2)', () => {
  /** The app's state file, in a profile of its own: the temp dir stands in for the user-data folder (S13), so no test reads the real one. */
  let stateFile: string
  beforeEach(() => {
    vi.stubEnv('YASEEN_DOCS_USER_DATA_DIR', dir)
    stateFile = path.join(dir, 'yaseendocs.json')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /**
   * A state file as the APP writes it — through the real store: two recent vaults (`/v/wiki` used
   * last), a window on `/v/notes` and one on `/v/old` (open, not among the recents), `/v/notes`
   * renamed "Notes ✎" with number 1, and `/v/archive` with number 7 and nothing else.
   */
  async function seedState(file = stateFile): Promise<void> {
    const store = createStore(file)
    const win = (id: string, root: string | null) => ({ id, root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } })
    store.pushRecent('/v/notes', 1000)
    store.pushRecent('/v/wiki', 2000)
    store.upsertWindow(win('w1', '/v/notes'))
    store.upsertWindow(win('w2', '/v/old'))
    store.upsertWindow(win('w3', null))
    store.setFolder('/v/notes', { name: 'Notes ✎', key: 1 })
    store.setFolder('/v/archive', { key: 7 })
    await store.flush()
  }

  const ROWS = [
    { path: '/v/wiki', name: 'wiki', key: null, open: false, lastUsed: 2000 },
    { path: '/v/notes', name: 'Notes ✎', key: 1, open: true, lastUsed: 1000 },
    { path: '/v/old', name: 'old', key: null, open: true, lastUsed: null },
    { path: '/v/archive', name: 'archive', key: 7, open: false, lastUsed: null },
  ]

  it('S9, S14: `--json` prints `{ path, name, key, open, lastUsed }` per vault, in the order of the app\'s list, from the file alone — which it never writes', async () => {
    await seedState()
    const before = { bytes: await readFile(stateFile, 'utf8'), mtime: (await stat(stateFile)).mtimeMs }
    expect(await run(['vaults', '--json'])).toEqual({ code: 0, out: `${JSON.stringify(ROWS, null, 2)}\n`, err: '' })
    expect({ bytes: await readFile(stateFile, 'utf8'), mtime: (await stat(stateFile)).mtimeMs }).toEqual(before)
    expect(await readdir(dir)).toEqual(['yaseendocs.json'])
  })

  it('S10: without `--json`, one line per vault: its name and folder, then its number and `(open)`', async () => {
    await seedState()
    expect(await run(['vaults'])).toEqual({ code: 0, out: 'wiki  /v/wiki\nNotes ✎  /v/notes  ⌘1  (open)\nold  /v/old  (open)\narchive  /v/archive  ⌘7\n', err: '' })
  })

  it('S11: no state file (the app never ran) is no vaults, exit 0 — and none is made', async () => {
    expect(await run(['vaults', '--json'])).toEqual({ code: 0, out: '[]\n', err: '' })
    expect(await run(['vaults'])).toEqual({ code: 0, out: 'no vaults\n', err: '' })
    expect(await readdir(dir)).toEqual([])
  })

  it.each([
    ['not JSON', '{ "version": 1, "recents": ['],
    ['not a version-1 state', '{ "version": 2, "recents": [] }'],
  ])('S12: a damaged state file (%s) is refused with the reason, exit 1, and left as it is for the app to move aside', async (_name, raw) => {
    await writeFile(stateFile, raw, 'utf8')
    for (const argv of [['vaults'], ['vaults', '--json']]) {
      expect(await run(argv)).toEqual({ code: 1, out: '', err: `${stateFile} is not a valid app state\n` })
    }
    expect(await readdir(dir)).toEqual(['yaseendocs.json'])
    expect(await readFile(stateFile, 'utf8')).toBe(raw)
  })

  it('S13: reads the state file of the folder YASEEN_DOCS_USER_DATA_DIR names', async () => {
    const other = path.join(dir, 'other profile')
    await seedState(path.join(other, 'yaseendocs.json'))
    expect((await run(['vaults', '--json'])).out).toBe('[]\n') // `dir` holds no state file
    vi.stubEnv('YASEEN_DOCS_USER_DATA_DIR', ` ${other} `)
    expect(JSON.parse((await run(['vaults', '--json'])).out)).toEqual(ROWS)
  })

  it('the contract names each field of a row — `path`, `name`, `key`, `open`, `lastUsed` — and says the tool never writes the state file', () => {
    const help = HELP.replace(/\s+/g, ' ')
    for (const said of ['`path`', '`name`', '`key`', '`open`', '`lastUsed`', 'never writes']) expect(help).toContain(said)
  })
})

describe('the door stays Electron-free (🔒 D1)', () => {
  it('nothing cli.ts reaches, directly or through main/fs, imports electron', () => {
    const seen = new Set<string>()
    const walk = (file: string): void => {
      if (seen.has(file)) return
      seen.add(file)
      for (const m of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
        const spec = m[1]
        expect(spec, `${path.relative(process.cwd(), file)} imports ${spec}`).not.toBe('electron')
        if (spec.startsWith('.')) walk(`${path.resolve(path.dirname(file), spec)}.ts`)
      }
    }
    walk(path.resolve(__dirname, 'index.ts'))
    expect(seen.size).toBeGreaterThan(3) // index → cli → main/fs/file → fsUtils, boundedRead …
  })
})

describe('YAZ-4615: signed comments, resolve, open comments under a folder', () => {
  const SIGNED = `---\ncomments:\n  - id: p1\n    n: 1\n    at: ${at(1)}\n    by: yaseen\n    body: Yaseen's\n  - id: c2\n    n: 2\n    at: ${at(2)}\n    by: claude\n    body: Claude's\n  - id: r3\n    n: 1\n    at: ${at(3)}\n    reply_to: p1\n    by: agent\n    body: A reply\n---\n`

  it('D2: edit and delete change only the caller\'s own comments — a person\'s signed comment is refused, an agent\'s own name works', async () => {
    const p = await page('s.md', SIGNED)
    expect(await run(['edit', p, '#1', '--body', 'nope'])).toEqual({ code: 1, out: '', err: '#1 was left by yaseen — only its writer can edit or delete it (--by)\n' })
    expect(await run(['delete', p, '#2'])).toMatchObject({ code: 1, err: expect.stringContaining('was left by claude') })
    expect(await readFile(p, 'utf8')).toBe(SIGNED)
    expect((await run(['edit', p, '#2', '--body', 'Claude, edited', '--by', 'claude'])).out).toBe('#2 edited\n')
    expect((await run(['delete', p, '#1.1'])).out).toBe('#1.1 deleted\n') // `agent`, the default caller
  })

  it('D3: resolve marks any writer\'s comment, with the caller as resolver; --reopen opens it again', async () => {
    const p = await page('r.md', SIGNED)
    expect((await run(['resolve', p, '#1', '--by', 'claude'])).out).toBe('#1 resolved\n')
    expect(readComments(await readFile(p, 'utf8'))[0]).toMatchObject({ id: 'p1', resolved_by: 'claude', resolved: expect.stringMatching(/Z$/) })
    expect((await run(['resolve', p, '#1', '--reopen'])).out).toBe('#1 reopened\n')
    expect(await readFile(p, 'utf8')).toBe(SIGNED)
    expect(await run(['resolve', p])).toMatchObject({ code: 2 })
  })

  it('item 6: comments --open drops a resolved comment and the replies of a resolved parent; a folder lists each note with comments', async () => {
    const root = await vault('v', { 'a/one.md': SIGNED, 'a/two.md': '---\ntitle: Two\n---\nNo comments\n' })
    await run(['resolve', path.join(root, 'a/one.md'), '#1'])
    const open = await run(['comments', path.join(root, 'a/one.md'), '--open', '--json'])
    expect(JSON.parse(open.out).map((t: { comment: { id: string } }) => t.comment.id)).toEqual(['c2'])
    const folder = JSON.parse((await run(['comments', path.join(root, 'a'), '--open', '--json'])).out)
    expect(folder).toEqual([expect.objectContaining({ path: path.join(root, 'a/one.md'), threads: [expect.objectContaining({ comment: expect.objectContaining({ id: 'c2' }) })] })])
    expect((await run(['comments', path.join(root, 'a')])).out).toContain('[resolved]')
  })
})

describe('daily and new (YAZ-4269)', () => {
  const TUE = new Date(2026, 10, 3)
  // The comment hint (YAZ-4615 D10) is off here, so these keep to the bytes they always pinned; its own test turns it on.
  const DAILY = { dailyNotes: true, dailyNoteFolder: 'daily', dailyNoteFormat: 'MM_DD- ddd', dailyNoteDayFolder: false, commentsHint: false }
  beforeEach(() => {
    // The app's profile in the temp dir: its state file, this Mac's ID and the locks (S13).
    vi.stubEnv('YASEEN_DOCS_USER_DATA_DIR', dir)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** The app's state file as the app writes it, with the Daily notes settings `daily`, and a settings folder when given. */
  async function settings(daily: Partial<SettingsState> = DAILY, folder?: string): Promise<void> {
    const store = createStore(path.join(dir, 'yaseendocs.json'))
    store.setSettings({ ...store.get().settings, ...daily }, 1000)
    if (folder !== undefined) store.setSettingsFolder(folder, 1000)
    await store.flush()
  }
  const today = () => dailyNoteName(DAILY.dailyNoteFormat, new Date())
  const notes = async (folder: string) => (await readdir(folder)).filter((name) => name.endsWith('.md') && !name.startsWith('.')).sort()

  it('daily makes today\'s note by the app\'s settings and its template, then finds it: `made`, then `found`, the same path', async () => {
    await settings()
    const root = await vault('v', { 'daily/.template.md': 'PLAN\n' })

    const made = await run(['daily', root])
    const again = await run(['daily', root])

    const [name] = await notes(path.join(root, 'daily'))
    expect(made).toEqual({ code: 0, out: `made ${path.join(root, 'daily', name)}\n`, err: '' })
    expect(again).toEqual({ code: 0, out: `found ${path.join(root, 'daily', name)}\n`, err: '' })
    expect(await readFile(path.join(root, 'daily', name), 'utf8')).toMatch(new RegExp(`^---\\ntitle: ${today()}\\nid: YAZ-\\d+\\n---\\nPLAN\\n$`))
  })

  it('five runs at one moment make ONE note (D2)', async () => {
    await settings()
    const root = await vault('v', { 'daily/.keep.md': '' })

    const all = await Promise.all(Array.from({ length: 5 }, () => run(['daily', root, '--date', '2026-11-03', '--json'])))

    expect(all.map((r) => r.code)).toEqual([0, 0, 0, 0, 0])
    const answers = all.map((r) => JSON.parse(r.out) as { path: string; created: boolean })
    expect(answers.filter((a) => a.created)).toHaveLength(1)
    expect(await notes(path.join(root, 'daily'))).toEqual([path.basename(answers[0].path)])
    expect(answers[0]).toMatchObject({ title: '11_03- Tue', others: [] })
  })

  it('--date: the words and a day; a day that is not one is a usage error (D9)', async () => {
    expect(dayOf(undefined, TUE)).toEqual(TUE)
    expect(dayOf('today', new Date(2026, 10, 3, 23, 59))).toEqual(TUE)
    expect(dayOf('tomorrow', TUE)).toEqual(new Date(2026, 10, 4))
    expect(dayOf('yesterday', new Date(2026, 10, 1))).toEqual(new Date(2026, 9, 31))
    expect(dayOf('2026-12-31', TUE)).toEqual(new Date(2026, 11, 31))
    await settings()
    const root = await vault('v', { 'daily/.keep.md': '' })
    for (const bad of ['2026-02-30', '0099-01-01', '11/03', 'next week']) expect((await run(['daily', root, '--date', bad])).code).toBe(2)
  })

  it('--find only finds: no note is exit 1 with the title it looked for, and nothing is made (D6)', async () => {
    await settings()
    const root = await vault('v', { 'daily/11-02-mon-yaz-9.md': '---\ntitle: 11_02- Mon\nid: YAZ-9\n---\n' })

    expect(await run(['daily', root, '--date', '2026-11-02', '--find'])).toEqual({ code: 0, out: `found ${path.join(root, 'daily', '11-02-mon-yaz-9.md')}\n`, err: '' })
    expect(await run(['daily', root, '--date', '2026-11-03', '--find'])).toEqual({ code: 1, out: '', err: `no daily note "11_03- Tue" in ${root}\n` })
    expect(await notes(path.join(root, 'daily'))).toEqual(['11-02-mon-yaz-9.md'])
  })

  it('two notes of the day: the first is the answer, each other is a warning, and `others` in --json (D8)', async () => {
    await settings()
    const a = '---\ntitle: 11_03- Tue\nid: YAZ-1\n---\n'
    const root = await vault('v', { 'daily/a-yaz-1.md': a, 'daily/11-03-tue/b-yaz-2.md': a.replace('YAZ-1', 'YAZ-2') })

    const plain = await run(['daily', root, '--date', '2026-11-03'])
    const json = await run(['daily', root, '--date', '2026-11-03', '--json'])

    expect(plain).toEqual({ code: 0, out: `found ${path.join(root, 'daily', 'a-yaz-1.md')}\n`, err: `warning: also ${path.join(root, 'daily', '11-03-tue', 'b-yaz-2.md')}\n` })
    expect(JSON.parse(json.out)).toEqual({ path: path.join(root, 'daily', 'a-yaz-1.md'), title: '11_03- Tue', id: 'YAZ-1', created: false, others: [path.join(root, 'daily', '11-03-tue', 'b-yaz-2.md')] })
  })

  it('refused with the setting to change: Daily notes off, or no daily notes folder', async () => {
    const root = await vault('v', {})
    await settings({ ...DAILY, dailyNotes: false })
    expect(await run(['daily', root])).toMatchObject({ code: 1, err: 'Daily notes are off. Turn them on in Settings › Files & Links › Daily notes\n' })
    await settings()
    expect((await run(['daily', root])).err).toMatch(/has no folder "daily"/)
    expect((await run(['daily'])).code).toBe(2)
    expect(await run(['daily', path.join(dir, 'gone')])).toMatchObject({ code: 1, err: `no vault folder ${path.join(dir, 'gone')}\n` })
    // A flag the verb does not take is refused, never ignored.
    expect(await run(['daily', root, '--body', 'x'])).toMatchObject({ code: 2, err: expect.stringMatching(/^daily does not take --body\n/) })
    expect(await run(['new', root, '--title', 'X', '--find'])).toMatchObject({ code: 2, err: expect.stringMatching(/^new does not take --find\n/) })
  })

  it('D3: the newest settings of another Mac in the settings folder win over an older state file', async () => {
    const sync = path.join(dir, 'sync')
    await mkdir(sync)
    await settings(DAILY, sync)
    await writeFile(path.join(sync, 'settings-aaaaaaaaaaaa.json'), settingsFileText('Other Mac', 5000, { ...createStore(path.join(dir, 'yaseendocs.json')).get().settings, dailyNoteFolder: 'journal' }))
    const root = await vault('v', { 'journal/.keep.md': '' })

    const made = await run(['daily', root, '--date', '2026-11-03'])

    expect(made.out).toMatch(new RegExp(`^made ${root}/journal/11-03-tue-yaz-\\d+\\.md\\n$`))
  })

  it('--open hands the note\'s yaseendocs:// link to the system after the note is ready (D10)', async () => {
    await settings()
    const root = await vault('v', { 'daily/my plan #1-yaz-4.md': '---\ntitle: 11_03- Tue\nid: YAZ-4\n---\n' })
    const opened: string[] = []

    let out = ''
    const code = await main(['daily', root, '--date', '2026-11-03', '--find', '--open'], { stdin: async () => '', stdout: (t) => (out += t), stderr: () => undefined, open: async (link) => void opened.push(link) })

    expect(code).toBe(0)
    expect(opened).toEqual([`yaseendocs://${encodeURI(path.join(root, 'daily', 'my plan '))}%231-yaz-4.md`])
    expect(out).toBe(`found ${path.join(root, 'daily', 'my plan #1-yaz-4.md')}\n`)
  })

  it('new makes a note as New note does: the template, the title, an id; --body - takes the template body\'s place, its properties go over the template\'s (D4)', async () => {
    await settings()
    const root = await vault('v', { 'projects/.template.md': '---\nstatus: todo\nowner: me\n---\n## Template body\n' })

    const made = await run(['new', path.join(root, 'projects'), '--title', 'Gym plan', '--body', '-', '--json'], '---\nstatus: doing\n---\n## Plan\n- Gym\n')

    const answer = JSON.parse(made.out) as { path: string; id: string }
    expect(answer).toMatchObject({ title: 'Gym plan', created: true, others: [], path: expect.stringMatching(/\/projects\/gym-plan-yaz-\d+\.md$/) })
    expect(await readFile(answer.path, 'utf8')).toBe(`---\nstatus: doing\nowner: me\ntitle: Gym plan\nid: ${answer.id}\n---\n## Plan\n- Gym\n`)
  })

  it('YAZ-4615 D10: with the comment hint on (the default), a new note carries it as the first line of its frontmatter — in both kinds of vault', async () => {
    const ids = await vault('v', { 'projects/.keep.md': '' })
    await run(['new', path.join(ids, 'projects'), '--title', 'Gym plan'])
    const made = (await notes(path.join(ids, 'projects'))).find((n) => n.startsWith('gym-plan'))
    expect(await readFile(path.join(ids, 'projects', made ?? ''), 'utf8')).toMatch(/^---\n# comments: - \{by: <name>, body: <text>\}\n(?:title|id): /)
    const plain = await vault('plain', { 'projects/.keep.md': '' }, false)
    await run(['new', path.join(plain, 'projects'), '--title', 'Gym plan', '--body', 'Hello'])
    expect(await readFile(path.join(plain, 'projects', 'Gym plan.md'), 'utf8')).toBe('---\n# comments: - {by: <name>, body: <text>}\n---\nHello')
  })

  it('new again with the same title finds the note and makes nothing; --body is then not written, and says so (D7)', async () => {
    const root = await vault('v', { 'projects/.keep.md': '' })

    const first = await run(['new', path.join(root, 'projects'), '--title', 'Gym plan'])
    const again = await run(['new', path.join(root, 'projects'), '--title', 'Gym plan', '--body', 'new text'])
    const both = await Promise.all([run(['new', path.join(root, 'projects'), '--title', 'Run plan']), run(['new', path.join(root, 'projects'), '--title', 'Run plan'])])

    const made = first.out.replace(/^made /, '').trim()
    expect(again).toEqual({ code: 0, out: `found ${made}\n`, err: `warning: --body was not written: ${made} was already there\n` })
    expect(both.map((r) => r.out.split(' ')[0]).sort()).toEqual(['found', 'made'])
    expect(await notes(path.join(root, 'projects'))).toHaveLength(2)
  })

  it('new in a vault without IDs: the file is the title, and a properties block that does not parse is refused with nothing made', async () => {
    await settings()
    const root = await vault('plain', { 'projects/.template.md': '---\nstatus: todo\n---\nBody\n' }, false)

    expect(await run(['new', path.join(root, 'projects'), '--title', 'Gym plan', '--json'])).toMatchObject({ code: 0, out: expect.stringContaining('"id": null') })
    expect(await readFile(path.join(root, 'projects', 'Gym plan.md'), 'utf8')).toBe('---\nstatus: todo\n---\nBody\n')
    expect(await run(['new', path.join(root, 'projects'), '--title', 'Bad', '--body', '---\n: [\n---\n'])).toEqual({ code: 1, out: '', err: 'the properties block of --body does not parse\n' })
    expect(await notes(path.join(root, 'projects'))).toEqual(['Gym plan.md'])
    expect((await run(['new', path.join(root, 'projects')])).code).toBe(2)
    expect((await run(['new', path.join(root, 'projects', 'Gym plan.md'), '--title', 'X'])).err).toMatch(/is not a folder/)
    expect((await run(['new', path.join(root, 'gone'), '--title', 'X'])).err).toBe(`no folder ${path.join(root, 'gone')}\n`)
  })
})
