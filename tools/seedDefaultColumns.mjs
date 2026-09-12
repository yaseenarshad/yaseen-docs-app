#!/usr/bin/env node
/**
 * ONE-SHOT seed for EXISTING folder pages (YAZ-1513): every folder page is born with a `status`
 * Select column now (`DEFAULT_COLUMNS`, `client/src/views/folderPageSettings.ts`), and this gives
 * the pages born BEFORE that rule the same column — idempotently.
 *
 *   node tools/seedDefaultColumns.mjs --vault <path>            # dry run — the DEFAULT
 *   node tools/seedDefaultColumns.mjs --vault <path> --apply    # execute
 *
 * IT REFUSES TO RUN unless the vault is a git repository with a CLEAN working tree — the same
 * rule `migrateFolderPages.mjs` runs under: the undo button is `git checkout .`, so there must be
 * something to check out back to.
 *
 * WHAT IT DOES, for every `.md` / `.markdown` whose frontmatter carries `folder_page: true`:
 *  · COLUMN — if `folder_page_settings.columns.status` is absent, it is added as
 *    `{ kind: select, options: [1-Backlog, 2-Todo, 3-In-Progress, 4-Done] }`; the settings map and
 *    the columns map are created when missing, and every sibling key rides along untouched.
 *  · ORDER — every view in `folder_page_settings.views` whose `type` is NOT `outline` and that HAS
 *    an `order` list gets `note.status` appended, unless `note.status` or `status` is already in
 *    it. An outline view's `order` is a list of WIKILINKS (the [D5] ordering rule) and is never
 *    touched; a view with no `order` shows every key already and needs nothing.
 *
 * WRITES ARE PER-KEY, through `shared/frontmatter.ts`'s `setFrontmatterProperty` — the app's own
 * one-key writer — so untouched keys, comments, key order, quoting and the body survive byte for
 * byte. A page whose frontmatter will not parse, or whose settings are not a map, is reported and
 * left exactly as it is. Member notes are NOT written to: the app's presence-invariant
 * reconciliation (YAZ-999) stamps `status:` onto them when the folder page is next opened.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// `shared/` is TypeScript, and Node 22.18+ strips the types on import with no flag and no build
// step — so this script uses the app's OWN frontmatter mechanics rather than a second copy of
// them. The one cost is a `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr (the root package.json
// has no `"type"`), which is noise in a CLI's output and is muted here alone.
const emitWarning = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const opts = rest[0]
  const code = typeof opts === 'object' && opts !== null ? opts.code : rest[1]
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return
  emitWarning.call(process, warning, ...rest)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const shared = async (file) => {
  try {
    return await import(pathToFileURL(path.join(HERE, '../shared/', file)).href)
  } catch (err) {
    console.error(
      `Could not load shared/${file} (node ${process.version}). This script reads the app's own` +
        ` TypeScript modules directly and needs Node 22.6 or newer.\n${err.message}`,
    )
    process.exit(1)
  }
}
const { setFrontmatterProperty, splitFrontmatter, parseFrontmatter, FrontmatterWriteError } = await shared('frontmatter.ts')

// ---------------------------------------------------------------------------
// Vocabulary (the ONE spelling of every key this script touches)
// ---------------------------------------------------------------------------

const FOLDER_PAGE_KEY = 'folder_page'
const SETTINGS_KEY = 'folder_page_settings'
const COLUMN = 'status'
/** `DEFAULT_COLUMNS.status` in `client/src/views/folderPageSettings.ts`, spelled the same. */
const DEFAULT_STATUS = { kind: 'select', options: ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'] }
/** The column key as a view's `order` names it, and the bare spelling that also counts as present. */
const ORDER_KEY = `note.${COLUMN}`
const OUTLINE_TYPE = 'outline'

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const posix = (p) => p.split(path.sep).join('/')
const isSkipped = (name) => name.startsWith('.') || name === 'node_modules'
const isMarkdown = (name) => /\.(md|markdown)$/i.test(name)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

// ---------------------------------------------------------------------------
// Git preflight
// ---------------------------------------------------------------------------

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** `null` when the vault is a git repo whose tree is clean, else the sentence explaining why not. */
export function gitDirtReason(root) {
  try {
    if (git(root, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true') {
      return `${root} is not inside a git working tree`
    }
  } catch {
    return `${root} is not a git repository (or git is unavailable) — this script needs one to undo into`
  }
  let status
  try {
    status = git(root, ['status', '--porcelain', '--', '.'])
  } catch (err) {
    return `could not read git status: ${err.message}`
  }
  const dirty = status.split('\n').filter((line) => line.trim() !== '')
  if (dirty.length === 0) return null
  return `the working tree is not clean:\n${dirty.map((line) => `  ${line}`).join('\n')}`
}

// ---------------------------------------------------------------------------
// Scan + plan
// ---------------------------------------------------------------------------

/** Every markdown file under the root, dotfolders and node_modules skipped, sorted for a stable report. */
function markdownFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (isSkipped(entry.name)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && isMarkdown(entry.name)) out.push(abs)
    }
  }
  walk(root)
  return out
}

/**
 * ONE folder page's plan: `{ changes: string[], value }` where `value` is the settings map to
 * write (spread-then-reassign, so every untouched key keeps its value AND its position), or
 * `{ skip: string }` when the page must be left alone. Pure over the parsed properties.
 */
export function planSettings(properties) {
  const raw = properties[SETTINGS_KEY]
  if (raw !== undefined && raw !== null && !isRecord(raw)) return { skip: `${SETTINGS_KEY} is not a map` }
  const settings = isRecord(raw) ? raw : {}
  if (settings.columns !== undefined && settings.columns !== null && !isRecord(settings.columns)) {
    return { skip: `${SETTINGS_KEY}.columns is not a map` }
  }
  const changes = []
  const value = { ...settings }

  const columns = isRecord(settings.columns) ? settings.columns : {}
  if (!hasOwn(columns, COLUMN)) {
    value.columns = { ...columns, [COLUMN]: structuredClone(DEFAULT_STATUS) }
    changes.push(`added columns.${COLUMN} (select: ${DEFAULT_STATUS.options.join(', ')})`)
  }

  if (Array.isArray(settings.views)) {
    let touched = false
    value.views = settings.views.map((view, i) => {
      if (!isRecord(view) || view.type === OUTLINE_TYPE || !Array.isArray(view.order)) return view
      if (view.order.some((entry) => entry === ORDER_KEY || entry === COLUMN)) return view
      touched = true
      const label = typeof view.name === 'string' ? `"${view.name}"` : `[${i}]`
      changes.push(`appended ${ORDER_KEY} to views${label}.order`)
      return { ...view, order: [...view.order, ORDER_KEY] }
    })
    if (!touched) value.views = settings.views
  }

  return { changes, value }
}

function scan(root) {
  const files = markdownFiles(root)
  const pages = []
  for (const abs of files) {
    const content = fs.readFileSync(abs, 'utf8')
    const { frontmatter } = splitFrontmatter(content)
    const { properties, error } = parseFrontmatter(frontmatter)
    const rel = posix(path.relative(root, abs))
    // The flag rule (`links/folderPages.ts`): the boolean `true` and nothing else.
    if (error === undefined && properties[FOLDER_PAGE_KEY] !== true) continue
    if (error !== undefined) {
      // Unparsable frontmatter can not say whether it is a folder page; report it, never write it.
      pages.push({ abs, rel, content, skip: `frontmatter does not parse: ${error}` })
      continue
    }
    pages.push({ abs, rel, content, ...planSettings(properties) })
  }
  return { scanned: files.length, pages }
}

// ---------------------------------------------------------------------------
// Apply + report
// ---------------------------------------------------------------------------

function apply(pages) {
  const failures = []
  for (const page of pages) {
    if (page.skip !== undefined || page.changes.length === 0) continue
    let content
    try {
      content = setFrontmatterProperty(page.content, SETTINGS_KEY, page.value)
    } catch (err) {
      failures.push({ rel: page.rel, why: err instanceof FrontmatterWriteError ? err.message : String(err) })
      continue
    }
    if (content !== page.content) fs.writeFileSync(page.abs, content, 'utf8')
  }
  return failures
}

function renderReport(root, { scanned, pages }, { applied, failures }) {
  const lines = []
  lines.push(`# Default status column — ${applied ? 'APPLIED' : 'DRY RUN'}`)
  lines.push('')
  lines.push(`Vault: ${root}`)
  lines.push(`Markdown files scanned: ${scanned}`)
  lines.push(`Folder pages found: ${pages.length}`)
  const changing = pages.filter((p) => p.skip === undefined && p.changes.length > 0)
  const skipped = pages.filter((p) => p.skip !== undefined)
  lines.push(`Folder pages ${applied ? 'changed' : 'to change'}: ${changing.length}`)
  lines.push('')
  for (const page of pages) {
    if (page.skip !== undefined) lines.push(`- ${page.rel}: SKIPPED — ${page.skip}`)
    else if (page.changes.length === 0) lines.push(`- ${page.rel}: nothing to do`)
    else {
      lines.push(`- ${page.rel}:`)
      for (const change of page.changes) lines.push(`    · ${change}`)
    }
  }
  if (skipped.length > 0) lines.push('', `${skipped.length} folder page(s) skipped — repair by hand and rerun.`)
  if (failures.length > 0) {
    lines.push('', `${failures.length} write(s) FAILED:`)
    for (const f of failures) lines.push(`- ${f.rel}: ${f.why}`)
  }
  if (!applied && changing.length > 0) lines.push('', 'Dry run — nothing was written. Rerun with --apply to write these changes.')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node tools/seedDefaultColumns.mjs --vault <path> [--apply]

  --vault <path>   the vault to seed (must be a git repo with a clean tree)
  --apply          write the changes; without it this is a DRY RUN (the default)
  --dry-run        explicit no-op form of the default
  -h, --help       this message

Adds the default \`status\` Select column to every EXISTING folder page's
\`folder_page_settings\`, and appends \`note.status\` to each non-outline view's \`order\`.
Member notes are left alone — the app stamps \`status:\` on them when the page is next opened.`

export function parseArgs(argv) {
  const options = { vault: null, apply: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') options.apply = true
    else if (arg === '--dry-run') options.apply = false
    else if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--vault') options.vault = argv[++i] ?? null
    else if (arg.startsWith('--vault=')) options.vault = arg.slice('--vault='.length)
    else return { error: `unknown argument: ${arg}`, ...options }
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  if (options.error) {
    console.error(`${options.error}\n\n${USAGE}`)
    return 1
  }
  if (!options.vault) {
    console.error(`--vault is required.\n\n${USAGE}`)
    return 1
  }
  const root = path.resolve(options.vault)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`Not a directory: ${root}`)
    return 1
  }

  const dirt = gitDirtReason(root)
  if (dirt !== null) {
    console.error(`REFUSING TO RUN — ${dirt}\n\nCommit or stash first: this script's undo button is \`git checkout .\`.`)
    return 1
  }

  const scanned = scan(root)
  let failures = []
  if (options.apply) {
    // Re-verify immediately before the first write: the tree must still be the one the user committed.
    const stillClean = gitDirtReason(root)
    if (stillClean !== null) {
      console.error(`REFUSING TO APPLY — ${stillClean}`)
      return 1
    }
    failures = apply(scanned.pages)
  }

  console.log(renderReport(root, scanned, { applied: options.apply, failures }))
  return failures.length > 0 ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main()
}
