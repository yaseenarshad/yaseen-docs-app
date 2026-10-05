/**
 * `yaseendocs` (YAZ-1617): the program runs in-process against real temp files — `main(argv, io)`
 * with captured stdio — so every receipt, refusal and exit code is pinned without spawning.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readComments } from '@shared/comments'
import { isNoteId } from '@shared/noteId'
import { addReview } from '@shared/reviews'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR } from '@shared/types'
import { sweepIds } from '../main/vaultIndex/idSweep'
import { scanFile } from '../main/vaultIndex/scan'
import { HELP, USAGE, find, label, main, transformOnDisk } from './cli'

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

/** An ADOPTED vault under the temp dir (`.yaseendocs/` exists) holding `files`, keyed by vault-relative path. */
async function vault(name: string, files: Record<string, string>): Promise<string> {
  const root = path.join(dir, name)
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
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
    for (const word of ['comment ', 'comments ', 'edit ', 'delete ', 'yaseendocs id ', 'yaseendocs links ', 'yaseendocs due ', '[[<id>]]', '(missing)', 'id: <id>', '--body', '--title', '--reply-to', '--by', '--json', 'by: agent', 'never in the body', 'Exit codes']) {
      expect(HELP).toContain(word)
    }
  })

  it('says, in at most three lines, that a folder’s values for a note are under `in:` in the block named by the folder’s id, and that a folder’s id is the `id` in `<folder>/.folder.md`', () => {
    const lines = HELP.split('\n')
    const first = lines.findIndex((line) => line.includes('`in:`'))
    expect(first).toBeGreaterThan(-1)
    const said = lines.slice(first, first + 3).join(' ')
    expect(said).toContain("named by the folder's id")
    expect(said).toContain('`id` in `<folder>/.folder.md`')
    // Nowhere else: those three lines are the whole of it.
    expect(lines.filter((line, i) => (i < first || i >= first + 3) && /`in:`|\.folder\.md/.test(line))).toEqual([])
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
      expect(r).toEqual({ code: 1, out: '', err: '#1 was left by a person — edit or delete it in the app\n' })
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
  it('a page that has an id: prints it and writes nothing — bytes and mtime as they were, vault or no vault', async () => {
    const content = '---\nid: k3m9x2pq7abc\n---\n# Has one\n'
    const p = await page('has.md', content)
    const before = (await stat(p)).mtimeMs
    expect(await run(['id', p])).toEqual({ code: 0, out: 'k3m9x2pq7abc\n', err: '' })
    expect(await readFile(p, 'utf8')).toBe(content)
    expect((await stat(p)).mtimeMs).toBe(before)
  })

  it("a page with no id, in an adopted vault: is given the id the app's sweep would give it, and no other byte changes", async () => {
    const content = '---\ntitle: Kickoff # kept\n---\n# Kickoff\n'
    const p = path.join(await vault('mine', { 'Projects/Kickoff.md': content }), 'Projects/Kickoff.md')
    const r = await run(['id', p])
    const id = r.out.trimEnd()
    expect(r).toEqual({ code: 0, out: `${id}\n`, err: '' })
    expect(isNoteId(id)).toBe(true)
    expect(await readFile(p, 'utf8')).toBe(`---\ntitle: Kickoff # kept\nid: ${id}\n---\n# Kickoff\n`)
    expect((await run(['id', p])).out).toBe(`${id}\n`)
    // The same note at the same place in another copy of the vault, met by the APP: the same id, so the two edits merge.
    const theirs = await vault('theirs', { 'Projects/Kickoff.md': content })
    const twin = path.join(theirs, 'Projects/Kickoff.md')
    const record = await scanFile(theirs, twin)
    await sweepIds(theirs, new Map([[twin, record]]), [record], () => undefined)
    expect(await readFile(twin, 'utf8')).toBe(await readFile(p, 'utf8'))
  })

  it("`id <folder>/.folder.md` when the file is missing: the folder is given the settings file the app's sweep would give it, and its id printed; a folder that does not exist is not found", async () => {
    const p = path.join(await vault('mine', {}), 'Projects', FOLDER_SETTINGS_FILE)
    await mkdir(path.dirname(p))
    const r = await run(['id', p])
    const id = r.out.trimEnd()
    expect(r).toEqual({ code: 0, out: `${id}\n`, err: '' })
    expect(await readFile(p, 'utf8')).toBe(`---\nid: ${id}\n---\n`)
    const theirs = path.join(await vault('theirs', {}), 'Projects')
    await mkdir(theirs)
    await sweepIds(path.dirname(theirs), new Map(), [], () => undefined, [theirs])
    expect(await readFile(path.join(theirs, FOLDER_SETTINGS_FILE), 'utf8')).toBe(await readFile(p, 'utf8'))
    expect(await run(['id', path.join(path.dirname(theirs), 'Gone', FOLDER_SETTINGS_FILE)])).toEqual({ code: 1, out: '', err: 'path does not exist\n' })
  })

  it("a page whose `id` is another tool's (`id: 42`), in an adopted vault: the app's id is written over it, the one the app's sweep would write, and printed (YAZ-2420 D30)", async () => {
    const content = '---\nid: 42\ntitle: Kickoff\n---\n# Kickoff\n'
    const p = path.join(await vault('mine', { 'Projects/Kickoff.md': content }), 'Projects/Kickoff.md')
    const r = await run(['id', p])
    const id = r.out.trimEnd()
    expect(r).toEqual({ code: 0, out: `${id}\n`, err: '' })
    expect(isNoteId(id)).toBe(true)
    expect(await readFile(p, 'utf8')).toBe(`---\nid: ${id}\ntitle: Kickoff\n---\n# Kickoff\n`)
    const theirs = await vault('theirs', { 'Projects/Kickoff.md': content })
    const twin = path.join(theirs, 'Projects/Kickoff.md')
    const record = await scanFile(theirs, twin)
    await sweepIds(theirs, new Map([[twin, record]]), [record], () => undefined)
    expect(await readFile(twin, 'utf8')).toBe(await readFile(p, 'utf8'))
  })

  it('a page that cannot take an id — no vault above it, a block that does not parse — exit 1, bytes untouched', async () => {
    const bare = await page('bare.md', '# No vault here\n')
    const root = await vault('mine', { 'broken.md': '---\nid: 42\ntitle: [\n---\n' })
    for (const [p, reason] of [
      [bare, `${bare} has no id and is in no vault (no ${VAULT_CONFIG_DIR} folder above it)`],
      [path.join(root, 'broken.md'), 'the properties block does not parse (invalid)'],
    ] as const) {
      const before = await readFile(p, 'utf8')
      expect(await run(['id', p])).toEqual({ code: 1, out: '', err: `${reason}\n` })
      expect(await readFile(p, 'utf8')).toBe(before)
    }
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

  it('a page in no vault has nothing to resolve its ids against — exit 1', async () => {
    const p = await page('loose.md', `[[${NOTE}]]\n`)
    expect(await run(['links', p])).toEqual({ code: 1, out: '', err: `${p} is in no vault (no ${VAULT_CONFIG_DIR} folder above it)\n` })
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

describe('due (YAZ-2322)', () => {
  const DAY = 86_400_000
  const day = (ms: number): string => new Date(ms).toLocaleDateString('en-CA')
  /** A note last changed `daysOld` days ago. */
  async function aged(name: string, daysOld: number, content = `Body of ${name}.\n`): Promise<{ file: string; changed: number }> {
    const file = path.join(dir, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
    const changed = Math.floor((Date.now() - daysOld * DAY) / 1000) * 1000 // whole seconds, so the file's mtime is exactly this
    await utimes(file, changed / 1000, changed / 1000)
    return { file, changed }
  }

  async function reviewJson(settings: Record<string, unknown>): Promise<void> {
    await mkdir(path.join(dir, VAULT_CONFIG_DIR), { recursive: true })
    await writeFile(path.join(dir, VAULT_CONFIG_DIR, 'review.json'), JSON.stringify(settings))
  }
  /** The vault's `review.json` turns upkeep on, and says whatever else a test sets. */
  const upkeepOn = (settings: Record<string, unknown> = {}): Promise<void> => reviewJson({ enabled: true, ...settings })

  it('a page: prints the date it is next due, from the defaults for what the vault\'s settings do not say', async () => {
    await upkeepOn()
    const { file, changed } = await aged('fresh.md', 2)
    expect(await run(['due', file])).toEqual({ code: 0, out: `${day(changed + 30 * DAY)}  ${file}\n`, err: '' })
  })

  it('upkeep off: `due <page>` and `due <folder>` report nothing due — no review.json, one with no `enabled` or a bad one, one that says false', async () => {
    const { file } = await aged('old.md', 90)
    const kept = await aged('sub/kept.md', 400, '---\nreview: true\n---\nKept.\n')
    const nothing = async (): Promise<void> => {
      for (const page of [file, kept.file]) {
        expect(await run(['due', page])).toEqual({ code: 0, out: `${page} is not in review\n`, err: '' })
        expect(JSON.parse((await run(['due', page, '--json'])).out)).toEqual({ path: page, inReview: false, due: null })
      }
      expect(await run(['due', dir])).toEqual({ code: 0, out: `nothing is due under ${dir}\n`, err: '' })
      expect(JSON.parse((await run(['due', path.join(dir, 'sub'), '--json'])).out)).toEqual([])
    }
    await nothing()
    for (const settings of [{ baseDays: 7 }, { enabled: 'yes', baseDays: 7 }, { enabled: false }]) {
      await reviewJson(settings)
      await nothing()
    }
    await upkeepOn()
    expect((await run(['due', dir])).out).toContain(`  ${file}\n`)
  })

  it('a page: a review on the same text pushes the date out from the review', async () => {
    await upkeepOn()
    const reviewedAt = '2026-01-10T12:00:00Z'
    const { file } = await aged('kept.md', 1, addReview('Kept.\n', reviewedAt))
    expect((await run(['due', file])).out).toBe(`${day(Date.parse(reviewedAt) + 60 * DAY)}  ${file}\n`)
  })

  it('a page: uses the settings of the vault it is in', async () => {
    await upkeepOn({ baseDays: 7 })
    const { file, changed } = await aged('notes/deep/quick.md', 2)
    expect((await run(['due', file])).out).toBe(`${day(changed + 7 * DAY)}  ${file}\n`)
  })

  it('a page that is not in review says so; --json gives the raw shape', async () => {
    await upkeepOn()
    const { file } = await aged('off.md', 90, '---\nreview: false\n---\nOff.\n')
    expect((await run(['due', file])).out).toBe(`${file} is not in review\n`)
    expect(JSON.parse((await run(['due', file, '--json'])).out)).toEqual({ path: file, inReview: false, due: null })
    const on = await aged('on.md', 2)
    expect(JSON.parse((await run(['due', on.file, '--json'])).out)).toEqual({ path: on.file, inReview: true, due: new Date(on.changed + 30 * DAY).toISOString() })
  })

  it('a folder: lists what is due now under it, most overdue first', async () => {
    await upkeepOn()
    const old = await aged('old.md', 90)
    const older = await aged('sub/older.md', 120)
    await aged('fresh.md', 2)
    await aged('off.md', 200, '---\nreview: false\n---\nOff.\n')
    await aged('sub/.folder.md', 300, '---\nviews: []\n---\n') // a folder's settings file is never a note
    expect((await run(['due', dir])).out).toBe(`${day(older.changed + 30 * DAY)}  older  ${older.file}\n${day(old.changed + 30 * DAY)}  old  ${old.file}\n`)
    expect(JSON.parse((await run(['due', path.join(dir, 'sub'), '--json'])).out)).toEqual([{ title: 'older', path: older.file, due: new Date(older.changed + 30 * DAY).toISOString() }])
  })

  it('E: a folder: each page is listed by its title, then its path, and --json carries `title` (YAZ-2420 D14)', async () => {
    await upkeepOn()
    const abdul = await aged('candidates/up-001-abdul-k3m9x2pq7abc.md', 120, '---\ntitle: UP-001 - Abdul\n---\nBody.\n')
    expect((await run(['due', dir])).out).toBe(`${day(abdul.changed + 30 * DAY)}  UP-001 - Abdul  ${abdul.file}\n`)
    expect(JSON.parse((await run(['due', dir, '--json'])).out)).toEqual([{ title: 'UP-001 - Abdul', path: abdul.file, due: new Date(abdul.changed + 30 * DAY).toISOString() }])
  })

  it('a folder with nothing due says so', async () => {
    await upkeepOn()
    await aged('fresh.md', 2)
    expect((await run(['due', dir])).out).toBe(`nothing is due under ${dir}\n`)
  })

  it('refuses a missing path and a file that is not Markdown', async () => {
    expect((await run(['due', path.join(dir, 'nope.md')])).code).toBe(1)
    expect((await run(['due', await page('notes.txt', 'x')])).code).toBe(1)
    expect((await run(['due'])).code).toBe(2)
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
