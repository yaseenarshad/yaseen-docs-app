import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * DRAW.IO ON THE PHONE, THE BUILD SIDE (YAZ-5533). The phone draws a plain `.drawio` with the SAME draw.io read-only
 * viewer as the Mac (`viewer-static.min.js`, the Mac's verified v31.5.2 pack) and the Mac's own renderer
 * (`yaseen-render.js`, `yaseen-links.js`, unchanged), in one hidden same-origin frame (`render.html`).
 *
 * The files go to `dist/drawio/<hash>/`, where `<hash>` is a hash of all of them, so a version of these files keeps
 * its name for as long as its bytes stay (an app update that does not touch draw.io keeps the phone's copy):
 *  - `render` (`render.html`), `phone-config.js`, `phone-shim.js` (the phone's own, `mobile/drawio/`);
 *  - `viewer-static.min.js`, `yaseen-render.js`, `yaseen-links.js`, `LICENSE-drawio.txt` (from the pack, checked);
 *  - `phone-index.js`: the list of libraries and font families;
 *  - `stencils/<library>.js`: `stencils.min.js` split, one file per shape library (204);
 *  - `fonts/<Family>.js`: the Mac's draw.io fonts, one file per family;
 *  - `math/startup.js`: an empty file in MathJax's place (maths labels show their raw TeX).
 *
 * NOTHING HERE IS IN THE INSTALL (Yaseen: nothing about draw.io may bloat the app). The service worker's install list
 * (`shellFiles`) takes `assets/` and the pages only, so these files are not precached: the phone fetches them from
 * this site the first time a `.drawio` is opened, only the libraries and fonts that diagram uses, and the worker keeps
 * them from then on (`swCore.ts`, `notecards-drawio-<hash>`).
 *
 * THE PIN: the phone's draw.io is the Mac's. The build fails when `PHONE_DRAWIO_TAG` is not the Mac's `DRAWIO_TAG`
 * (`shared/drawio.ts`) or the pack's (`tools/packDrawio.mjs`), when the unpacked pack is not stamped with that tag and
 * the pinned archive's sha256, or when the viewer file is not the pinned size and sha256.
 */

/** The phone's draw.io release. It must be the Mac's (`shared/drawio.ts`, `tools/packDrawio.mjs`): the build checks it. */
export const PHONE_DRAWIO_TAG = 'v31.5.2'
/** `js/viewer-static.min.js` of that release, as the pinned `draw.war` holds it. */
export const VIEWER_PIN = { bytes: 4_218_077, sha256: 'ee0c444be46c95dc1842999f133c92598fe43e7cdf279f7095d0f057c48771b1' }

const here = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(here, '..', '..')
const FRAME_SOURCES = join(here, '..', 'drawio')
/** The served folder of every draw.io file, under the site's root. */
export const DRAWIO_ROOT = '/drawio/'

/** The pin pair of the Mac: `DRAWIO_TAG` of `shared/drawio.ts` and of `tools/packDrawio.mjs`, with the archive's sha256. */
export function macPins(repo = REPO): { shared: string; pack: string; warSha256: string } {
  const shared = /export const DRAWIO_TAG = '([^']+)'/.exec(readFileSync(join(repo, 'shared', 'drawio.ts'), 'utf8'))?.[1]
  const packText = readFileSync(join(repo, 'tools', 'packDrawio.mjs'), 'utf8')
  const pack = /export const DRAWIO_TAG = '([^']+)'/.exec(packText)?.[1]
  const warSha256 = /export const WAR_SHA256 = '([0-9a-f]{64})'/.exec(packText)?.[1]
  if (!shared || !pack || !warSha256) throw new Error('drawio (phone): cannot read the Mac\'s draw.io pin (shared/drawio.ts, tools/packDrawio.mjs)')
  return { shared, pack, warSha256 }
}

/** Fails unless the phone's tag is the Mac's, both places. */
export function checkTagPair(phone: string, mac: { shared: string; pack: string }): void {
  if (phone !== mac.shared || phone !== mac.pack)
    throw new Error(`drawio (phone): the phone's draw.io is ${phone}, the Mac's is ${mac.shared} (shared/drawio.ts) and ${mac.pack} (tools/packDrawio.mjs). They must be the same release: change PHONE_DRAWIO_TAG and VIEWER_PIN in mobile/publish/drawioPhone.ts with the Mac's.`)
}

/** Fails unless `bytes` are the pinned viewer. */
export function checkViewer(bytes: Buffer, pin = VIEWER_PIN): void {
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length !== pin.bytes || sha !== pin.sha256) throw new Error(`drawio (phone): viewer-static.min.js is ${bytes.length} bytes, sha256 ${sha}; the pin is ${pin.bytes} bytes, sha256 ${pin.sha256}. Refusing it.`)
}

/** `stencils.min.js` (one map of library → deflated base64 text) as one file per library: `[key, file name, text]`. */
export function splitStencils(source: string): { key: string; file: string; text: string }[] {
  const out: { key: string; file: string; text: string }[] = []
  for (const m of source.matchAll(/^f\['([^']+)'\] = '([A-Za-z0-9+/=]*)';$/gm)) {
    const key = m[1]
    if (!/^[\w./-]+\.xml$/.test(key) || key.includes('..')) throw new Error(`drawio (phone): a strange library name in stencils.min.js: ${key}`)
    out.push({ key, file: `${key.slice(0, -'.xml'.length).replaceAll('/', '__')}.js`, text: m[2] })
  }
  if (out.length < 100) throw new Error(`drawio (phone): stencils.min.js held ${out.length} libraries; its format changed`)
  return out
}

/** The Mac's draw.io fonts (`yaseen-fonts/fonts.css`, in its order): each family with its files and weights. */
export function fontFamilies(css: string): { family: string; folder: string; faces: { file: string; weight: number }[] }[] {
  const families: { family: string; folder: string; faces: { file: string; weight: number }[] }[] = []
  for (const m of css.matchAll(/font-family: '([^']+)'; src: url\('[^']*\/yaseen-fonts\/([^/]+)\/([^']+\.woff2)'\) format\('woff2'\); font-weight: (\d+);/g)) {
    const [, family, folder, file, weight] = m
    let held = families.find((f) => f.family === family)
    if (held === undefined) families.push((held = { family, folder, faces: [] }))
    held.faces.push({ file, weight: Number(weight) })
  }
  return families
}

export interface DrawioFiles {
  /** `/drawio/<hash>/`: where the files are served. */
  base: string
  /** Each file under the base: its path (`render`, `stencils/aws4.js`) and bytes. */
  files: Map<string, Buffer>
  /** Each library's file and size, for the report. */
  libraries: { key: string; file: string; bytes: number }[]
}

/** The unpacked pack (`desktop/.cache/drawio/<tag>/`), checked; unpacked first (`tools/packDrawio.mjs`) when it is not there. */
export function packDir(repo = REPO): string {
  const mac = macPins(repo)
  checkTagPair(PHONE_DRAWIO_TAG, mac)
  const dir = join(repo, 'desktop', '.cache', 'drawio', PHONE_DRAWIO_TAG)
  const stamped = () => {
    try {
      const stamp = JSON.parse(readFileSync(join(dir, '.yaseen-pack.json'), 'utf8')) as { tag?: string; sha256?: string }
      return stamp.tag === PHONE_DRAWIO_TAG && stamp.sha256 === mac.warSha256 && existsSync(join(dir, 'yaseen-fonts', 'fonts.css'))
    } catch {
      return false
    }
  }
  // The Mac's own pack step: it downloads the pinned draw.war, checks its size and sha256, and unpacks it.
  if (!stamped()) execFileSync(process.execPath, [join(repo, 'tools', 'packDrawio.mjs')], { stdio: 'inherit' })
  if (!stamped()) throw new Error(`drawio (phone): ${dir} is not the verified ${PHONE_DRAWIO_TAG} pack (run \`npm run drawio:pack\`)`)
  return dir
}

let made: DrawioFiles | null = null

/** Every draw.io file of the phone, made once for a build (about a second). */
export function drawioFiles(repo = REPO): DrawioFiles {
  if (made !== null && repo === REPO) return made
  const pack = packDir(repo)
  const files = new Map<string, Buffer>()
  const viewer = readFileSync(join(pack, 'js', 'viewer-static.min.js'))
  checkViewer(viewer)
  // The Mac's renderer and link pills, unchanged: the pack's copies are the overlay's own (`desktop/drawio-overlay/js/`).
  for (const name of ['yaseen-render.js', 'yaseen-links.js']) {
    const bytes = readFileSync(join(pack, 'js', name))
    if (!bytes.equals(readFileSync(join(repo, 'desktop', 'drawio-overlay', 'js', name)))) throw new Error(`drawio (phone): the pack's ${name} is not the Mac's (run \`npm run drawio:pack\`)`)
    files.set(name, bytes)
  }
  files.set('viewer-static.min.js', viewer)
  files.set('LICENSE-drawio.txt', readFileSync(join(pack, 'LICENSE-drawio.txt')))
  // `render.html` is served as `render`: the host drops `.html` from an address (`html_handling`).
  files.set('render', readFileSync(join(FRAME_SOURCES, 'render.html')))
  for (const name of ['phone-config.js', 'phone-shim.js']) files.set(name, readFileSync(join(FRAME_SOURCES, name)))
  files.set('math/startup.js', readFileSync(join(FRAME_SOURCES, 'math', 'startup.js')))

  const libraries = splitStencils(readFileSync(join(pack, 'js', 'stencils.min.js'), 'utf8'))
  for (const lib of libraries) files.set(`stencils/${lib.file}`, Buffer.from(`(window.__stencils=window.__stencils||{})[${JSON.stringify(lib.key)}]='${lib.text}';\n`))

  const families = fontFamilies(readFileSync(join(pack, 'yaseen-fonts', 'fonts.css'), 'utf8'))
  if (families.length === 0) throw new Error('drawio (phone): no fonts in yaseen-fonts/fonts.css')
  for (const { family, folder, faces } of families) {
    const list = faces.map((face) => ({ weight: face.weight, b64: readFileSync(join(pack, 'yaseen-fonts', folder, face.file)).toString('base64') }))
    files.set(`fonts/${folder}.js`, Buffer.from(`(window.__yaseenFonts=window.__yaseenFonts||{})[${JSON.stringify(family)}]=${JSON.stringify(list)};\n`))
  }
  const index = { stencils: Object.fromEntries(libraries.map((l) => [l.key, l.file])), fonts: families.map((f) => [f.family, `${f.folder}.js`]) }
  files.set('phone-index.js', Buffer.from(`window.__yaseenDrawioIndex=${JSON.stringify(index)};\n`))

  const hash = createHash('sha256')
  for (const path of [...files.keys()].sort()) hash.update(path).update('\0').update(files.get(path)!).update('\0')
  const out: DrawioFiles = { base: `${DRAWIO_ROOT}${hash.digest('hex').slice(0, 12)}/`, files, libraries: libraries.map((l) => ({ key: l.key, file: l.file, bytes: files.get(`stencils/${l.file}`)!.length })) }
  if (repo === REPO) made = out
  return out
}

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8' }

/**
 * The Vite side: the base path as `__NOTECARDS_DRAWIO__` (the app's frame address), the files into the build
 * (`dist/drawio/<hash>/`, NOT in the worker's install list), and the dev server's copy.
 */
export function drawioPhone(): Plugin {
  return {
    name: 'notecards-drawio',
    // After Vite's own HTML step, so the app's page is in the bundle.
    enforce: 'post',
    config() {
      return { define: { __NOTECARDS_DRAWIO__: JSON.stringify(drawioFiles().base) } }
    },
    configureServer(server) {
      server.middlewares.use(DRAWIO_ROOT, (req, res, next) => {
        const { base, files } = drawioFiles()
        const path = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
        const inside = `${DRAWIO_ROOT}${path}`.startsWith(base) ? `${DRAWIO_ROOT}${path}`.slice(base.length) : null
        const bytes = inside === null ? undefined : files.get(inside)
        if (bytes === undefined) return next()
        res.setHeader('Content-Type', inside === 'render' ? 'text/html; charset=utf-8' : (TYPES[inside!.slice(inside!.lastIndexOf('.'))] ?? 'application/octet-stream'))
        res.end(bytes)
      })
    },
    generateBundle(_options, bundle) {
      // The app's own build only (a wall test of single files has no page).
      if (!('index.html' in bundle)) return
      const { base, files } = drawioFiles()
      for (const [path, bytes] of files) this.emitFile({ type: 'asset', fileName: `${base.slice(1)}${path === 'render' ? 'render.html' : path}`, source: bytes })
    },
  }
}

/** The served path of each draw.io file of a build (`dist/drawio/<hash>/…`). */
export function drawioServedFiles(distFiles: string[]): string[] {
  return distFiles.filter((f) => f.startsWith(DRAWIO_ROOT.slice(1))).map((f) => `/${f.replace(/\.html$/, '')}`)
}

/** For the report: every file of `dir` under `drawio/`. */
export function listDrawio(dist: string): string[] {
  const root = join(dist, 'drawio')
  if (!existsSync(root)) return []
  const walk = (d: string, rel: string): string[] => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name), `${rel}${e.name}/`) : [`drawio/${rel}${e.name}`]))
  return walk('', '')
}
