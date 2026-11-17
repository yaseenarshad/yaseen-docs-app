import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * YAZ-5358: the stylesheets of the phone's build, read from the source (the imports), not from a hand list. The contrast
 * test (`src/contrast.screens.test.tsx`) uses it to fail when a stylesheet that the phone loads is in no screen's list,
 * and `src/firstLoad.test.ts` holds it equal to what the real build bundles. Node only: tests read it, the app does not.
 */
export const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(MOBILE, '..')
const SRC = join(MOBILE, 'src')
/** The fixtures and the dev tools (`src/dev/`): only a `--mode fixtures` build loads them. */
const DEV = join(SRC, 'dev') + '/'

const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** Where an import lands, for the repo's own files (`.ts`, `.tsx`, `.css`); null for a package. */
function resolveImport(from: string, spec: string): string | null {
  if (/[?#]/.test(spec)) return null
  const base = spec.startsWith('@client/') ? join(REPO, 'client/src', spec.slice(8)) : spec.startsWith('@shared/') ? join(REPO, 'shared', spec.slice(8)) : spec.startsWith('.') ? resolve(dirname(from), spec) : spec.startsWith('/src/') ? join(MOBILE, spec) : null
  if (base === null) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

/** Every stylesheet that the modules reached from `entries` import (static and lazy imports), in the order found. */
export function stylesheetsFrom(entries: string[]): string[] {
  const seen = new Set<string>()
  const css: string[] = []
  const visit = (file: string) => {
    if (seen.has(file) || file.startsWith(DEV)) return
    seen.add(file)
    if (file.endsWith('.css')) return void css.push(file)
    for (const m of code(file).matchAll(IMPORT)) {
      const next = resolveImport(file, m[1])
      if (next !== null) visit(next)
    }
  }
  for (const e of entries) visit(e)
  return css
}

/** The stylesheets and scripts of an HTML page of the phone (`<link rel="stylesheet">`, `<script src>`), in order. */
export function pageParts(html: string): { sheets: string[]; scripts: string[] } {
  const text = readFileSync(join(MOBILE, html), 'utf8')
  const sheets = [...text.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map((m) => join(MOBILE, m[1]))
  // A script from `public/` (YAZ-5661: `/appearance-boot.js`) is served at the root, not built.
  const scripts = [...text.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => (existsSync(join(MOBILE, m[1])) ? join(MOBILE, m[1]) : join(MOBILE, 'public', m[1])))
  return { sheets, scripts }
}

/** The app (`index.html` and `main.tsx`) and the landing page of shared links (`friend.html`). */
export function appStylesheets(): string[] {
  const app = pageParts('index.html')
  return [...new Set([...app.sheets, ...stylesheetsFrom(app.scripts)])]
}
export function landingStylesheets(): string[] {
  const page = pageParts('friend.html')
  return [...new Set([...page.sheets, ...stylesheetsFrom(page.scripts)])]
}
/** Every stylesheet the phone's production build loads. */
export const phoneStylesheets = (): string[] => [...new Set([...appStylesheets(), ...landingStylesheets()])]
