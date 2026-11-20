import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'
import type { Plugin } from 'vite'
import type { ShellBuild } from '../src/pwa/swCore'
import { drawioFiles } from './drawioPhone'

/**
 * The build step of the home-screen app (YAZ-5087): it writes `dist/sw.js`, the service worker, with this build's
 * shell list and version in it. esbuild (already the repo's, the root dev dependency) bundles `src/pwa/sw.ts` into
 * one classic script. No new dependency.
 */

/** The page files under the address the host serves them at (`html_handling: auto-trailing-slash`). */
const SERVED: Record<string, string> = { 'index.html': '/', 'friend.html': '/friend', 'group.html': '/group', 'join.html': '/join' }
/** YAZ-5290: the landing page serves the three shared links; `group.html` and `join.html` are copies of `friend.html`. */
const LANDING_COPIES = ['group.html', 'join.html']
/**
 * YAZ-5303: the worker's own code is part of the version. A change of the worker alone (no app file changed) is then a
 * new version with its own cache; with the same version, a failed install would delete the cache that the running
 * version uses.
 */
export const WORKER_SOURCES = ['../src/pwa/sw.ts', '../src/pwa/swCore.ts', '../src/pwa/swKill.ts', '../src/pwa/killSwitch.ts']

/**
 * What the worker keeps: every build file (ALL chunks, the lazy ones too, so the sync engine and the QR reader work
 * offline), the two pages, the manifest, the icons and the head's Appearance script (YAZ-5661). Not: the splash pictures (iOS reads them at "Add to Home
 * Screen"), `_headers`, the worker itself, source maps, anything else in `public/`, and NO draw.io file (YAZ-5533:
 * `drawio/<hash>/…` is fetched the first time a diagram is opened, then kept by the worker's draw.io cache; so is
 * the app's own small diagram chunk, `notInstalled`).
 */
export function shellFiles(bundleFiles: string[], publicFiles: string[], notInstalled: string[] = []): string[] {
  const out = new Set<string>()
  for (const file of bundleFiles) {
    if (file.endsWith('.map') || notInstalled.includes(file)) continue
    if (file in SERVED) out.add(SERVED[file])
    else if (file.startsWith('assets/')) out.add(`/${file}`)
  }
  for (const file of publicFiles) if (file === 'manifest.webmanifest' || file === 'appearance-boot.js' || file.startsWith('icons/')) out.add(`/${file}`)
  return [...out].sort()
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

/** The short commit of the build, with "-dirty" when the tree has uncommitted changes; "unknown" outside git. */
export function commitOf(): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
    return dirty ? `${hash}-dirty` : hash
  } catch {
    return 'unknown'
  }
}

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
      // Only the app's own build: another build with this config (the phone wall tests build single files) has no page.
      if (!('index.html' in bundle)) return
      const friendPage = bundle['friend.html']
      if (!friendPage || friendPage.type !== 'asset') this.error('notecards-pwa: no friend.html in the build')
      for (const copy of LANDING_COPIES) this.emitFile({ type: 'asset', fileName: copy, source: friendPage.source })
      const publicFiles = publicDir ? walk(publicDir).map((p) => relative(publicDir, p).replaceAll('\\', '/')) : []
      // YAZ-5533: the app's diagram chunk (the frame's host) is kept on first use, as draw.io's own files.
      const diagram = Object.values(bundle).filter((o) => o.type === 'chunk' && /\/mobile\/src\/drawing\/diagram\/drawDiagram\.ts$/.test(o.facadeModuleId ?? ''))
      if (diagram.length !== 1 || diagram[0].type !== 'chunk' || diagram[0].imports.length > 0) this.error('notecards-pwa: the diagram code is not ONE lazy chunk that imports nothing (YAZ-5533)')
      // The chunk and its stylesheet.
      const drawioChunks = diagram.flatMap((o) => (o.type === 'chunk' ? [o.fileName, ...(o.viteMetadata?.importedCss ?? [])] : []))
      // YAZ-6008 🔒 D9: Excalidraw (`drawPicture` + 30 base64 font chunks, 2.49 MB) also loads on first use, not at SW install.
      const drawingChunks = Object.values(bundle).flatMap((o) =>
        o.type === 'chunk' &&
        (/\/mobile\/src\/drawing\/engine\/drawPicture\.ts$/.test(o.facadeModuleId ?? '') ||
          Object.keys(o.modules).some((m) => /engine\/packages\/excalidraw\/fonts\/[^/]+\/[^/]+\.woff2\?inline$/.test(m)))
          ? [o.fileName, ...(o.viteMetadata?.importedCss ?? [])]
          : [],
      )
      const files = shellFiles([...Object.keys(bundle), ...LANDING_COPIES], publicFiles, [...drawioChunks, ...drawingChunks])
      const landingChunk = Object.values(bundle).find((o) => o.type === 'chunk' && o.isEntry && /\/friend\.html$/.test(o.facadeModuleId ?? ''))
      if (!landingChunk) this.error('notecards-pwa: no entry chunk for friend.html')
      const entryChunk = Object.values(bundle).find((o) => o.type === 'chunk' && o.isEntry && /\/index\.html$|\/src\/main\.tsx$/.test(o.facadeModuleId ?? ''))
      if (!entryChunk) this.error('notecards-pwa: no entry chunk for index.html')
      const hash = createHash('sha256')
      // YAZ-5533: the draw.io folder of this build (its files are not in the shell; the worker keeps them on first use).
      const drawio = drawioFiles().base
      hash.update(drawio).update('\0')
      for (const source of WORKER_SOURCES) hash.update(readFileSync(fileURLToPath(new URL(source, import.meta.url)))).update('\0')
      for (const path of files) {
        const name = Object.entries(SERVED).find(([, served]) => served === path)?.[0] ?? path.slice(1)
        const out = bundle[LANDING_COPIES.includes(name) ? 'friend.html' : name]
        const bytes = out ? (out.type === 'chunk' ? out.code : out.source) : readFileSync(join(publicDir, name))
        hash.update(path).update('\0').update(bytes).update('\0')
      }
      const entry = `/${entryChunk.fileName}`
      const landing = `/${landingChunk.fileName}`
      const shell: ShellBuild = {
        version: hash.digest('hex').slice(0, 16),
        files,
        entry,
        pages: { '/': entry, '/friend': landing, '/group': landing, '/join': landing },
        drawio,
        drawioChunks: drawioChunks.map((f) => `/${f}`),
        drawingChunks: drawingChunks.map((f) => `/${f}`),
      }
      // YAZ-5285: the kill switch replaces the worker (`npm run mobile:publish:preview:kill-switch`).
      const kill = process.env.NOTECARDS_KILL_SWITCH === '1'
      const result = await esbuild({
        entryPoints: [fileURLToPath(new URL(kill ? '../src/pwa/swKill.ts' : '../src/pwa/sw.ts', import.meta.url))],
        bundle: true,
        write: false,
        format: 'iife',
        minify: true,
        target: 'safari15',
        legalComments: 'none',
        define: { __NOTECARDS_SHELL__: JSON.stringify(shell) },
      })
      // `/version.txt`: which build runs (the commit, "-dirty" with uncommitted changes, and the worker version). Not a
      // secret; it tells Yaseen which build his phone runs.
      this.emitFile({ type: 'asset', fileName: 'version.txt', source: `${commitOf()}\n${kill ? 'kill-switch' : shell.version}\n` })
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `// Yaseen Docs service worker, ${kill ? 'THE KILL SWITCH (YAZ-5285)' : `version ${shell.version} (YAZ-5087)`}\n${result.outputFiles[0].text}` })
    },
  }
}
