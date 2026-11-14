import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'
import type { Plugin } from 'vite'
import type { ShellBuild } from '../src/pwa/swCore'

/**
 * The build step of the home-screen app (YAZ-5087): it writes `dist/sw.js`, the service worker, with this build's
 * shell list and version in it. esbuild (already the repo's, the root dev dependency) bundles `src/pwa/sw.ts` into
 * one classic script. No new dependency.
 */

/** The page files under the address the host serves them at (`html_handling: auto-trailing-slash`). */
const SERVED: Record<string, string> = { 'index.html': '/', 'friend.html': '/friend' }

/**
 * What the worker keeps: every build file (ALL chunks, the lazy ones too, so the sync engine and the QR reader work
 * offline), the two pages, the manifest and the icons. Not: the splash pictures (iOS reads them at "Add to Home
 * Screen"), `_headers`, the worker itself, source maps, anything else in `public/`.
 */
export function shellFiles(bundleFiles: string[], publicFiles: string[]): string[] {
  const out = new Set<string>()
  for (const file of bundleFiles) {
    if (file.endsWith('.map')) continue
    if (file in SERVED) out.add(SERVED[file])
    else if (file.startsWith('assets/')) out.add(`/${file}`)
  }
  for (const file of publicFiles) if (file === 'manifest.webmanifest' || file.startsWith('icons/')) out.add(`/${file}`)
  return [...out].sort()
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

export function notecardsPwa(): Plugin {
  let publicDir = ''
  let mode = ''
  return {
    name: 'notecards-pwa',
    apply: 'build',
    // After Vite's own HTML step, so the two pages are in the bundle.
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir
      mode = config.mode
    },
    async generateBundle(_options, bundle) {
      // The screenshot build (`--mode fixtures`) has no worker: `main.tsx` registers one in the real build only.
      if (mode === 'fixtures') return
      const publicFiles = publicDir ? walk(publicDir).map((p) => relative(publicDir, p).replaceAll('\\', '/')) : []
      const files = shellFiles(Object.keys(bundle), publicFiles)
      const entryChunk = Object.values(bundle).find((o) => o.type === 'chunk' && o.isEntry && /\/index\.html$|\/src\/main\.tsx$/.test(o.facadeModuleId ?? ''))
      if (!entryChunk) this.error('notecards-pwa: no entry chunk for index.html')
      const hash = createHash('sha256')
      for (const path of files) {
        const name = Object.entries(SERVED).find(([, served]) => served === path)?.[0] ?? path.slice(1)
        const out = bundle[name]
        const bytes = out ? (out.type === 'chunk' ? out.code : out.source) : readFileSync(join(publicDir, name))
        hash.update(path).update('\0').update(bytes).update('\0')
      }
      const shell: ShellBuild = { version: hash.digest('hex').slice(0, 16), files, entry: `/${entryChunk.fileName}` }
      const result = await esbuild({
        entryPoints: [fileURLToPath(new URL('../src/pwa/sw.ts', import.meta.url))],
        bundle: true,
        write: false,
        format: 'iife',
        minify: true,
        target: 'safari15',
        legalComments: 'none',
        define: { __NOTECARDS_SHELL__: JSON.stringify(shell) },
      })
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `// Notecards service worker, version ${shell.version} (YAZ-5087)\n${result.outputFiles[0].text}` })
    },
  }
}
