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
import { crc32, deflateSync } from 'node:zlib'

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

/** A `size`×`size` RGB PNG of seeded noise (no dependency), so a drawing's pictures are real bytes to decode (YAZ-3861). */
export function noisePng(size, seed) {
  const raw = Buffer.alloc((size * 3 + 1) * size) // each row: filter byte 0, then RGB
  let x = seed >>> 0
  for (let i = 0; i < raw.length; i++) {
    if (i % (size * 3 + 1) === 0) continue
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    raw[i] = x >>> 24
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit RGB, no interlace
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** One Excalidraw element with every common field, so the engine restores it as is. */
const element = (id, type, x, y, w, h, extra = {}) => ({
  id, type, x, y, width: w, height: h, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
  roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: id.length * 97, version: 1, versionNonce: 1, isDeleted: false, boundElements: null,
  updated: 1, link: null, locked: false, ...extra,
})

/**
 * `<dir>/<name>.excalidraw`: `boxes` rectangles and `images` pictures (256 px noise PNGs) embedded in `files`, the
 * way a pasted picture is saved (YAZ-3737 D14: the long-day drawing has images). Returns the absolute path.
 */
export function writeDrawing(dir, name, { boxes = 12, images = 3 } = {}) {
  const elements = Array.from({ length: boxes }, (_, i) => element(`box-${i}`, 'rectangle', (i % 4) * 180, Math.floor(i / 4) * 120, 140, 80))
  const files = {}
  for (let i = 0; i < images; i++) {
    const fileId = `perf-image-${i}`
    files[fileId] = { id: fileId, mimeType: 'image/png', dataURL: `data:image/png;base64,${noisePng(256, i + 1).toString('base64')}`, created: 1 }
    elements.push(element(`image-${i}`, 'image', i * 280, 400, 256, 256, { fileId, status: 'saved', scale: [1, 1] }))
  }
  const file = path.join(dir, `${name}.excalidraw`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs-perf', elements, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files })}\n`)
  return file
}

/** Small code bodies (YAZ-3861): a first line that is the file's sentinel as a comment, then `lines` lines of functions. */
const CODE = {
  ts: (name, lines) => [`// ${sentinel(name)}`, ...Array.from({ length: lines }, (_, i) => (i % 4 === 0 ? `export interface Row${i} { id: number; name: string }` : i % 4 === 1 ? `export function make${i}(id: number): Row${i - 1} {` : i % 4 === 2 ? `  return { id, name: '${words(i, 3)}' }` : '}'))],
  py: (name, lines) => [`# ${sentinel(name)}`, ...Array.from({ length: lines }, (_, i) => (i % 3 === 0 ? `def make_${i}(x):` : i % 3 === 1 ? `    """${words(i, 4)}"""` : '    return x * 2'))],
}

/** `<dir>/<name>.<ext>` (ts | py): `lines` lines of code under its sentinel comment. Returns the absolute path. */
export function writeCode(dir, name, ext, lines = 120) {
  const file = path.join(dir, `${name}.${ext}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, `${CODE[ext](name, lines).join('\n')}\n`)
  return file
}
