/**
 * The perf fixtures (YAZ-2131 1C), deterministic so every run and every build measures the same bytes
 * and nothing big is committed. Big notes are written here; whole vaults of N notes come from the
 * e2e generator (`desktop/e2e/fixtures/genVault.mjs`, seeded), plus the notes a scenario opens.
 * Every note ends in its own `sentinel-<slug>` line: a note is painted when that line is on screen.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const E2E_GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../desktop/e2e/fixtures/genVault.mjs')
const WORDS = 'alpha beta gamma delta outline bullet heading vault note sync render frame layout paint budget typing latency editor tree'.split(' ')
const words = (i, n) => Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ')

export const sentinel = (name) => `sentinel-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/**
 * The shapes the YAZ-2132 scope measured, so the numbers line up with its baseline and targets.
 * bullets: its "mixed" outline note (renderer-smoothness): a heading every 25 items, then paragraphs
 * with [[links]], 3-level bullet groups, tasks and the odd code block. 5k lines = 22.6 s on v0.9.27.
 */
function bullets(lines) {
  const out = []
  for (let i = 0, sec = 0; out.length < lines; i++) {
    if (i % 25 === 0) out.push(`## Section ${++sec}`, '')
    const kind = i % 6
    if (kind === 0) out.push(`${words(i, 12)}.${i % 7 === 0 ? ` See [[Note ${i % 200}]] and **bold** text.` : ''}`, '')
    else if (kind <= 3) out.push(`* Parent ${i} ${words(i, 6)}`, `  * Child ${i}a ${words(i + 1, 5)}`, `    * Grandchild ${i} ${words(i + 2, 4)}`, `  * Child ${i}b [[Note ${i % 50}]]`)
    else if (kind === 4) out.push(`* [ ] Task ${i} ${words(i, 5)}`, `* [x] Done ${i} ${words(i + 3, 4)}`)
    else if (i % 30 === 5) out.push('```js', `const x${i} = ${i}`, '```', '')
    else out.push(`${words(i, 20)}.`, '')
  }
  return out
}

/** prose: the scope's "Big 5k prose" (startup-runtime): headings, paragraphs, short nested lists and tasks, no code. 6.1 s. */
function prose(lines) {
  const out = []
  for (let i = 1; out.length < lines; i++) out.push(`## Heading ${i}`, '', `${words(i, 30)}.`, '', `- item one ${words(i, 6)}`, `  - nested ${words(i + 1, 5)}`, `- item two ${words(i + 2, 6)}`, `- [ ] task ${words(i + 3, 4)}`, '', `${words(i + 4, 20)}.`, '')
  return out
}

/** code: the scope's "Big 5k" (startup-runtime): per heading a paragraph, two items and a fenced block. 1.56 s. */
function code(lines) {
  const out = []
  for (let i = 1; out.length < lines; i++) out.push(`## Heading ${i}`, '', `${words(i, 30)}.`, '', `- item one ${words(i, 6)}`, `- item two ${words(i + 1, 6)}`, '', '```python', 'def f(x):', '    return x * 2', '```', '')
  return out
}

const BODIES = { bullets, prose, code }

/** `<dir>/<name>.md`: `lines` lines of `kind` (bullets | prose | code) then its sentinel. Returns the absolute path. */
export function writeNote(dir, name, kind, lines) {
  const file = path.join(dir, `${name}.md`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, `# ${name}\n\n${BODIES[kind](lines).slice(0, lines).join('\n')}\n\n${sentinel(name)}\n`)
  return file
}

/** A vault of `notes` generated notes (folders, frontmatter, links) in `dir`, from the e2e generator. */
export function writeVault(dir, notes) {
  execFileSync(process.execPath, [E2E_GEN, '--notes', String(notes), '--out', dir, '--seed', '42'], { stdio: 'ignore' })
  return dir
}
