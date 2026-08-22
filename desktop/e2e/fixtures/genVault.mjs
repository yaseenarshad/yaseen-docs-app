#!/usr/bin/env node
/**
 * GRO-2227 (scope pass for the persistent vault-index cache, GRO-2223): synthetic fixture-vault
 * generator for index benchmarks. Deterministic — a given --notes/--seed pair always produces the
 * same vault. Shapes mirror `basesFixture.ts` / `helpers.buildFixtureVault`: realistic frontmatter
 * (status/priority/pillar/tags/aliases on a subset), bodies with `[[wiki links]]` between notes,
 * inline #tags, code fences, `![[embeds]]`, folder depth 0-4, a few `.base` files, png stubs,
 * `.obsidian/types.json` and a `.trash` note.
 *
 * Generated vaults go to a TEMP dir, never the repo — an --out inside the repository is refused.
 *
 * Usage:
 *   node desktop/e2e/fixtures/genVault.mjs --notes 1000 [--out /tmp/vault-1k] [--seed 42]
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------- args ----------

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
const NOTES = Number(argOf('--notes') ?? 1000)
const SEED = Number(argOf('--seed') ?? 42)
if (!Number.isInteger(NOTES) || NOTES < 1) {
  console.error('usage: genVault.mjs --notes <n> [--out <dir outside the repo>] [--seed <n>]')
  process.exit(1)
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const outArg = argOf('--out')
if (outArg !== undefined && (path.resolve(outArg) === REPO_ROOT || path.resolve(outArg).startsWith(REPO_ROOT + path.sep))) {
  console.error(`refusing --out inside the repository (${REPO_ROOT}); generated vaults belong in a temp dir`)
  process.exit(1)
}

// ---------- seeded PRNG (mulberry32) ----------

let prngState = SEED >>> 0
function rand() {
  prngState = (prngState + 0x6d2b79f5) >>> 0
  let t = prngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min, max) => min + Math.floor(rand() * (max - min + 1))
const pick = (list) => list[Math.floor(rand() * list.length)]
const chance = (p) => rand() < p

// ---------- content pools ----------

const FOLDER_NAMES = ['Projects', 'Areas', 'Archive', 'Inbox', 'Content Pillars', 'Weekly Reviews', 'Clients', 'Research', 'Drafts', 'Meetings', 'People', 'Systems']
const TOPICS = ['Idea', 'Meeting', 'Project', 'Review', 'Draft', 'Client Call', 'Research Note', 'Plan', 'Retro', 'Brief']
const STATUSES = ['idea', 'drafting', 'published', 'archived', 'in-review']
const PILLARS = ['Agentic Agency', 'Creator Economy', 'Trust Economy', 'Tech & Silicon Valley']
const TAGS = ['agentic', 'agentic/levels', 'creator', 'pillar', 'attribution', 'gtm', 'gtm/outbound', 'ops', 'writing', 'video']
const SENTENCES = [
  'The compounding effect of small daily improvements is easy to underestimate.',
  'Most funnels leak at the handoff between marketing and sales.',
  'A vault is only as useful as the links between its notes.',
  'Ship the smallest version that proves the mechanism works.',
  'Attribution is hard when every channel claims the same conversion.',
  'The archive is an asset when it is indexed and searchable.',
  'Levels of delegation map cleanly onto levels of agency.',
  'Write the spec before the code and the code writes itself.',
  'Distribution beats product quality more often than founders admit.',
  'A weekly review closes loops that daily work leaves open.',
]

// ---------- vault shape ----------

async function main() {
  const root = outArg !== undefined ? path.resolve(outArg) : await mkdtemp(path.join(tmpdir(), `mdapp-genvault-${NOTES}-`))

  // Folder tree, depth 0-4: root ('') plus ~1 folder per 25 notes, each parented on an existing folder.
  const folders = ['']
  const folderCount = Math.max(6, Math.floor(NOTES / 25))
  for (let i = 0; i < folderCount; i++) {
    const parent = pick(folders)
    if (parent.split('/').filter(Boolean).length >= 4) continue
    const name = `${pick(FOLDER_NAMES)} ${i}`
    folders.push(parent === '' ? name : `${parent}/${name}`)
  }
  await Promise.all(
    [...folders.filter((f) => f !== ''), '.obsidian', '.trash'].map((f) => mkdir(path.join(root, ...f.split('/')), { recursive: true })),
  )

  // Basenames first, so bodies can link to any other note (wiki links resolve by basename).
  const basenames = Array.from({ length: NOTES }, (_, i) => `${pick(TOPICS)} ${String(i).padStart(4, '0')}`)

  const noteFile = (i) => {
    const basename = basenames[i]
    const lines = []
    if (chance(0.65)) {
      lines.push('---')
      lines.push(`status: ${pick(STATUSES)}`)
      if (chance(0.6)) lines.push(`priority: ${int(1, 5)}`)
      if (chance(0.5)) lines.push(`pillar: ${pick(PILLARS)}`)
      if (chance(0.55)) lines.push(`tags: [${Array.from({ length: int(1, 4) }, () => pick(TAGS)).join(', ')}]`)
      if (chance(0.3)) lines.push(`published: ${chance(0.5)}`)
      if (chance(0.4)) lines.push(`date: 2026-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`)
      if (chance(0.15)) lines.push(`aliases: ["${basename} (alias)"]`)
      if (chance(0.15)) lines.push(`related: "[[${basenames[int(0, NOTES - 1)]}]]"`)
      lines.push('---', '')
    }
    lines.push(`# ${basename}`, '')
    const paragraphs = int(1, 6)
    for (let p = 0; p < paragraphs; p++) {
      const parts = Array.from({ length: int(1, 4) }, () => pick(SENTENCES))
      // Wiki links between notes: 0-2 per paragraph, sometimes with |alias or #heading forms.
      for (let l = int(0, 2); l > 0; l--) {
        const target = basenames[int(0, NOTES - 1)]
        parts.push(chance(0.2) ? `See [[${target}|the ${pick(TOPICS).toLowerCase()}]].` : chance(0.2) ? `See [[${target}#Notes]].` : `See [[${target}]].`)
      }
      if (chance(0.3)) parts.push(`#${pick(TAGS)}`)
      lines.push(parts.join(' '), '')
    }
    if (chance(0.1)) lines.push('```', '#not-a-tag inside a code fence', '```', '')
    if (chance(0.1)) lines.push(`![[chart-${int(0, 3)}.png]]`, '')
    return { file: path.join(root, ...pick(folders).split('/').filter(Boolean), `${basename}.md`), content: lines.join('\n') }
  }

  // Write with bounded concurrency, matching the scanner's own pattern.
  let next = 0
  let bytes = 0
  const worker = async () => {
    while (next < NOTES) {
      const { file, content } = noteFile(next++)
      bytes += content.length
      await writeFile(file, content)
    }
  }
  await Promise.all(Array.from({ length: 64 }, worker))

  // Non-record files: .base files, png stubs, types.json, a .trash note (mirrors basesFixture).
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const base = 'views:\n  - type: table\n    name: Table\n  - type: cards\n    name: View\n'
  await Promise.all([
    ...Array.from({ length: Math.max(2, Math.floor(NOTES / 1000)) }, (_, i) =>
      writeFile(path.join(root, ...pick(folders).split('/').filter(Boolean), `Topics DB ${i}.base`), base),
    ),
    ...Array.from({ length: 4 }, (_, i) => writeFile(path.join(root, `chart-${i}.png`), png)),
    writeFile(path.join(root, '.obsidian', 'types.json'), '{"types":{"date":"date","published":"checkbox"}}'),
    writeFile(path.join(root, '.trash', 'Untitled.md'), 'trash'),
  ])

  console.log(`generated vault: ${root}`)
  console.log(`  notes: ${NOTES}, folders: ${folders.length - 1}, ~${(bytes / 1024 / 1024).toFixed(1)} MB of markdown, seed: ${SEED}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
