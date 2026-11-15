import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

/**
 * The build check (YAZ-5087), run after each `vite build` of the real app (`npm run mobile:build`). It fails on what
 * must never be published, and prints the size report.
 */

export interface DistFile {
  path: string
  text?: string
}

const NEVER: { what: string; test: RegExp }[] = [
  // The screen fixtures (the dev-only route of 4A and its fakes): only a `--mode fixtures` build has them.
  { what: 'the screen fixtures (dev only)', test: /mountFixture|#fixture|fakeSync\(|fakeScanner\(|fakeFriends\(/ },
  { what: 'a localhost address', test: /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b|\[::1\]/ },
  { what: 'a GitHub token', test: /\b(github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{30,})/ },
  { what: 'a source map link', test: /sourceMappingURL=/ },
]

export function checkDist(files: DistFile[]): string[] {
  const problems: string[] = []
  for (const file of files) {
    if (file.path.endsWith('.map')) problems.push(`${file.path}: a source map (the build must have none)`)
    if (file.text === undefined) continue
    for (const rule of NEVER) {
      const m = rule.test.exec(file.text)
      if (m) problems.push(`${file.path}: ${rule.what === 'a source map link' ? 'a source map link' : rule.what} ("${m[0].slice(0, 24)}")`)
    }
  }
  return problems
}

/**
 * YAZ-5377: the ceiling of the first load's JavaScript (`index.html`'s scripts and the chunks they import), in bytes.
 * The measured build after the fix (290,297 bytes at `d9248de99` + the fix) plus 3%. `npm run mobile:build` fails over it, and so does `src/firstLoad.test.ts`.
 * A change that shrinks the first load lowers it in the same commit; raising it needs Yaseen's OK.
 */
export const FIRST_LOAD_JS_MAX = 299_006

/** YAZ-5377: modules that only a lazy screen needs. `src/firstLoad.test.ts` names each one in the first load, with its import chain. */
export const NOT_FIRST_LOAD: RegExp[] = [
  /^shared\/friend[A-Za-z]*\.ts$/, // the friends data layer (YAZ-5362)
  /^mobile\/src\/friends\/(?!ui\/lazy\.ts$)/, // the friends code, except the lazy door to it
  /^shared\/cardSchedule\.ts$/,
  /^node_modules\/ts-fsrs\//, // the review schedule
  /^node_modules\/yaml\//, // the YAML parser (the card line, the front matter)
  /^node_modules\/(marked|dompurify)\//, // the reader's Markdown
  /^mobile\/src\/(page\/pageRender|media\/(ahead|plan|refs)|scan\/qrDecode)\.ts$/,
  /^node_modules\/qr\//, // the QR reader
  /^mobile\/src\/settings\/(whatsNew\.ts|WhatsNewList\.tsx)$/, // Settings › What's new, loaded when opened (YAZ-5446)
  /^mobile\/src\/status\/passWords\.ts$/, // the words of the dot's toast, after a tap (YAZ-5469)
  /^mobile\/src\/daily\/today\.ts$/, /^shared\/dailyPagesFile\.ts$/, // the Today button's page, after a tap (YAZ-5470)
  /^mobile\/src\/screens\/(Settings\.tsx|eraseWords\.ts)$/, /^mobile\/src\/settings\/buildInfo\.ts$/, // Settings, after a tap on the gear
]

/**
 * YAZ-5377: modules that no production chunk may hold: dev-only and test-only code, and the fixtures. YAZ-5092 C3: the
 * test helpers (`testing.ts`, `*.testing.ts`), the research tools (`*.research.ts`) and every friends checker folder
 * (`check3` to `check6`, and any later one).
 */
export const NEVER_BUNDLED: RegExp[] = [/^mobile\/src\/dev\//, /\.test\.[cm]?[jt]sx?$/, /(^|\/|\.)testing\.[cm]?[jt]sx?$/, /\.research\.[cm]?[jt]sx?$/, /fixture/i, /cssAudit/, /^mobile\/src\/friends\/check\d+\//]

/** The files the publish needs. */
export const PARTS = ['index.html', 'friend.html', 'group.html', 'join.html', '_headers', 'sw.js', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'version.txt']
export const missingParts = (paths: string[]) => PARTS.filter((p) => !paths.includes(p))

const TEXT = /\.(html|js|css|webmanifest|json|svg|txt)$|^_headers$/
const kb = (n: number) => `${(n / 1000).toFixed(2)} kB`

/** The check on `mobile/dist/` (`checkBuildCli.ts` runs it after `vite build`). */
export function main() {
  const dist = new URL('../dist/', import.meta.url).pathname
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
  const paths = walk(dist).map((p) => relative(dist, p))
  const files = paths.map((path) => ({ path, text: TEXT.test(path.split('/').pop()!) ? readFileSync(join(dist, path), 'utf8') : undefined }))
  const problems = [...checkDist(files), ...missingParts(paths).map((p) => `${p}: missing`)]

  const size = (p: string) => {
    const bytes = readFileSync(join(dist, p))
    return { raw: bytes.length, gz: gzipSync(bytes).length }
  }
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const first = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1])
  const friendHtml = readFileSync(join(dist, 'friend.html'), 'utf8')
  const friend = [...friendHtml.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1])
  const lazy = paths.filter((p) => p.startsWith('assets/') && !first.includes(p) && !friend.includes(p) && p.endsWith('.js'))
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8')
  const shell = JSON.parse(/\bfiles:(\[[^\]]*\])/.exec(sw)?.[1] ?? '[]') as string[]
  if (/THE KILL SWITCH/.test(sw)) console.log('  sw.js is THE KILL SWITCH (YAZ-5285): it clears the shell caches and unregisters')
  const fileOf = (served: string) => (served === '/' ? 'index.html' : /^\/(friend|group|join)$/.test(served) ? `${served.slice(1)}.html` : served.slice(1))
  const sum = (list: string[]) => list.map(size).reduce((a, b) => ({ raw: a.raw + b.raw, gz: a.gz + b.gz }), { raw: 0, gz: 0 })

  console.log('\nYaseen Docs build (YAZ-5087)')
  for (const p of first) console.log(`  first load  ${p.padEnd(34)} ${kb(size(p).raw).padStart(10)}  gzip ${kb(size(p).gz)}`)
  const f = sum(first)
  console.log(`  first load  total ${''.padEnd(28)} ${kb(f.raw).padStart(10)}  gzip ${kb(f.gz)}`)
  for (const p of lazy) console.log(`  lazy        ${p.padEnd(34)} ${kb(size(p).raw).padStart(10)}  gzip ${kb(size(p).gz)}`)
  const fr = sum(friend)
  console.log(`  friend page (/friend: friend.html and ${friend.length} files) ${kb(fr.raw)}  gzip ${kb(fr.gz)}`)
  const s = sum(shell.map(fileOf))
  console.log(`  sw.js       ${kb(size('sw.js').raw)} (gzip ${kb(size('sw.js').gz)}); the worker keeps ${shell.length} files: ${kb(s.raw)} (gzip ${kb(s.gz)} on the wire)`)

  const firstJs = sum(first.filter((p) => p.endsWith('.js')))
  if (firstJs.raw > FIRST_LOAD_JS_MAX) problems.push(`the first load's JavaScript is ${kb(firstJs.raw)}, over its ceiling of ${kb(FIRST_LOAD_JS_MAX)} (YAZ-5377; src/firstLoad.test.ts names what came in)`)
  console.log(`  first load  JavaScript ${kb(firstJs.raw)} of its ceiling ${kb(FIRST_LOAD_JS_MAX)}`)

  if (problems.length > 0) {
    console.error(`\nThe build check FAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`  version.txt ${readFileSync(join(dist, 'version.txt'), 'utf8').trim().replace('\n', ' (worker ')})`)
  console.log('  check: no fixtures, no localhost, no source maps, no token; all publish parts present; the first load under its ceiling\n')
}

