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

/** The files the publish needs. */
export const PARTS = ['index.html', 'friend.html', '_headers', 'sw.js', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']
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
  const fileOf = (served: string) => (served === '/' ? 'index.html' : served === '/friend' ? 'friend.html' : served.slice(1))
  const sum = (list: string[]) => list.map(size).reduce((a, b) => ({ raw: a.raw + b.raw, gz: a.gz + b.gz }), { raw: 0, gz: 0 })

  console.log('\nNotecards build (YAZ-5087)')
  for (const p of first) console.log(`  first load  ${p.padEnd(34)} ${kb(size(p).raw).padStart(10)}  gzip ${kb(size(p).gz)}`)
  const f = sum(first)
  console.log(`  first load  total ${''.padEnd(28)} ${kb(f.raw).padStart(10)}  gzip ${kb(f.gz)}`)
  for (const p of lazy) console.log(`  lazy        ${p.padEnd(34)} ${kb(size(p).raw).padStart(10)}  gzip ${kb(size(p).gz)}`)
  const fr = sum(friend)
  console.log(`  friend page (/friend: friend.html and ${friend.length} files) ${kb(fr.raw)}  gzip ${kb(fr.gz)}`)
  const s = sum(shell.map(fileOf))
  console.log(`  sw.js       ${kb(size('sw.js').raw)} (gzip ${kb(size('sw.js').gz)}); the worker keeps ${shell.length} files: ${kb(s.raw)} (gzip ${kb(s.gz)} on the wire)`)

  if (problems.length > 0) {
    console.error(`\nThe build check FAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log('  check: no fixtures, no localhost, no source maps, no token; all publish parts present\n')
}

