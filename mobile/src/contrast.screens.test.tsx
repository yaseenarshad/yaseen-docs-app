// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRoot } from 'react-dom/client'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { landingStylesheets, pageParts, phoneStylesheets } from '../publish/stylesheets'
import { audit, type Finding, type Sheet, type Theme } from './dev/cssAudit'

/**
 * YAZ-5179 round 4: the contrast of what the phone's screens REALLY draw. jsdom renders each screen fixture (the same
 * made-up screens as the screenshots). `dev/cssAudit.ts` computes, for each element with text, each placeholder, each
 * icon and each field border, its colour and the fills under it (ancestors, alpha, `opacity`), from the phone's
 * stylesheets in their load order, light and dark (jsdom's own computed styles do not resolve `var()` or
 * `color-mix()`). Limits (WCAG 2.1 AA): text and placeholders 4.5:1, large text 3:1, icons and field borders 3:1.
 *
 * Buttons: a button with a text label needs no border (WCAG 1.4.11: the label identifies it), so its border is not
 * checked, and every button keeps the Mac's light line (YAZ-5340: one rule for every button). Its text is checked.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
// jsdom has no layout: a fixture's scroll to its part does nothing here.
Element.prototype.scrollIntoView ??= function () {}

const read = (file: string): Sheet => ({ file: relative(REPO, file), css: readFileSync(file, 'utf8') })
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..') + '/'

/**
 * YAZ-5358: the stylesheets of each screen come from the imports, not from a hand list. `vitest.config.ts` turns each
 * stylesheet import into a call of `__notecardsCss`, so the test hears each stylesheet the code loads, in load order.
 * The first load: the stylesheets of `index.html` and of `main.tsx`'s static imports. Then each screen: the module
 * registry is reset, and the fixture loads its own code (its lazy chunks) again; the stylesheets it adds come after.
 */
const heard: string[] = []
;(globalThis as { __notecardsCss?: (file: string) => void }).__notecardsCss = (file) => void heard.push(file)

/** `main.tsx`'s static imports in order, run without `main.tsx` itself (which would start the app). */
async function firstLoadSheets(): Promise<string[]> {
  vi.resetModules()
  heard.length = 0
  const main = readFileSync(resolve(REPO, 'mobile/src/main.tsx'), 'utf8')
  for (const m of main.matchAll(/^import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) await import(/* @vite-ignore */ m[1])
  return [...new Set([...pageParts('index.html').sheets, ...heard])]
}
let FIRST: string[] = []
const loadedBy = new Map<string, string[]>()

const FIXTURES = [
  'sign-in',
  'sign-in-error',
  'sign-in-typed',
  'repo-pick',
  'repo-pick-many',
  'repo-none',
  'guide',
  'scan',
  'download',
  'token-ended',
  'settings',
  'erase',
  'dot-all',
  'dot-lost-sheet',
  'dot-attention-sheet',
  'dot-token-sheet',
  'review-shown',
  'review-filter',
  'review-more',
  'review-table',
  'review-code',
  'review-picture',
  'review-offline',
  'review-done',
  'review-lost',
  'friends-empty',
  'friends-states',
  'friends-removing',
  'friends-offline',
  'friends-group',
  'friends-add',
  'friends-vs',
  'friends-remove',
  'search',
  'search-typed',
  'search-type',
  'search-none',
  'page',
  'page-comments',
  'card',
  'card-file',
  'card-file-comments',
  'card-invalid',
  'page-offline',
  'page-copied',
  'page-copy-by-hand',
  'page-last',
  'card-next',
  'page-tables',
  'page-table-full',
  // YAZ-5455, YAZ-5456, YAZ-5459, YAZ-5467: links and "Linked from", the vault's pills, the ⋯ tools, find, the headings,
  // the properties panel, the jump pill.
  'page-links',
  'page-linked-from',
  'page-pills',
  'page-tools',
  'page-find',
  'page-headings',
  'page-properties',
  'page-jump',
  // YAZ-5472: Explore's sheets.
  'explore-one',
  'explore-stack',
  // Last: it makes this page's navigator say iPhone.
  'sign-in-iphone',
]

const results: { name: string; ok: boolean; elements: number; findings: Finding[]; unresolved: string[]; unstyled: string[] }[] = []

/** The classes that some stylesheet of the phone styles: the class of each selector's last part. */
const ALL_SHEETS = phoneStylesheets().map(read)
const classesOf = (sheets: Sheet[]) => new Set(sheets.flatMap((sh) => [...sh.css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z][\w-]*)(?=[^{}]*\{)/g)].map((m) => m[1])))
const STYLED_ANYWHERE = classesOf(ALL_SHEETS)
const waitFor = async (test: () => boolean, ms: number) => {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) return false
    await new Promise((r) => setTimeout(r, 25))
  }
  return true
}

async function screen(name: string) {
  const host = document.createElement('div')
  host.id = 'root'
  document.body.append(host)
  const root = createRoot(host)
  delete document.documentElement.dataset.fixtureReady
  delete document.body.dataset.fixtureError
  // A fresh module registry: the screen loads its own code (and so its own stylesheets) as a fresh page does.
  vi.resetModules()
  heard.length = 0
  const { mountFixture } = await import('./dev/fixtures')
  void mountFixture(root, `#fixture=${name}`)
  const ok = await waitFor(() => document.documentElement.dataset.fixtureReady === name || document.body.dataset.fixtureError !== undefined, 20_000)
  await new Promise((r) => setTimeout(r, 50))
  const files = [...new Set([...FIRST, ...heard])]
  loadedBy.set(name, files)
  const sheets = files.map(read)
  const findings: Finding[] = []
  const unresolved = new Set<string>()
  let elements = 0
  for (const theme of ['light', 'dark'] as Theme[]) {
    const out = audit(host, sheets, { theme })
    elements += out.elements
    findings.push(...out.findings)
    for (const u of out.unresolved) unresolved.add(`${theme} ${u}`)
  }
  // YAZ-5363: a class that a phone stylesheet styles, drawn on a screen that does not load that stylesheet.
  const own = classesOf(sheets)
  const unstyled = [...new Set([...host.querySelectorAll('[class]')].flatMap((el) => [...el.classList]))].filter((c) => STYLED_ANYWHERE.has(c) && !own.has(c))
  results.push({ name, ok: ok && document.body.dataset.fixtureError === undefined, elements, findings, unresolved: [...unresolved], unstyled })
  root.unmount()
  host.remove()
}

/** The landing page of shared links (`friend.html`, `group.html`, `join.html`): its own HTML and its own stylesheets. Each part shows. */
async function landing() {
  const host = document.createElement('div')
  const html = readFileSync(resolve(REPO, 'mobile/friend.html'), 'utf8')
  host.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script[\s\S]*?<\/script>/g, '')
  for (const el of host.querySelectorAll('[hidden]')) el.removeAttribute('hidden')
  document.body.append(host)
  const files = landingStylesheets()
  loadedBy.set('landing', files)
  const sheets = files.map(read)
  const findings: Finding[] = []
  const unresolved: string[] = []
  let elements = 0
  for (const theme of ['light', 'dark'] as Theme[]) {
    const out = audit(host, sheets, { theme })
    elements += out.elements
    findings.push(...out.findings)
    unresolved.push(...out.unresolved.map((u) => `${theme} ${u}`))
  }
  results.push({ name: 'landing', ok: true, elements, findings, unresolved, unstyled: [] })
  host.remove()
}

describe('the contrast of every screen the phone draws (YAZ-5179, YAZ-5338 … YAZ-5341)', () => {
  it('renders each screen fixture, light and dark', { timeout: 600_000 }, async () => {
    FIRST = await firstLoadSheets()
    for (const name of FIXTURES) await screen(name)
    await landing()
    const broken = results.filter((r) => !r.ok || r.elements < 5).map((r) => r.name)
    expect(broken).toEqual([])
  })

  it('each text 4.5:1 (large text 3:1), each placeholder 4.5:1, each icon and field border 3:1', () => {
    const low = results.flatMap((r) => r.findings.filter((f) => f.ratio < f.need).map((f) => `${r.name} ${f.theme} ${f.what} ${f.ratio}:1 < ${f.need}: "${f.text}" ${f.fg} on ${f.bg} (${f.where})`))
    expect([...new Set(low)]).toEqual([])
  })

  it('YAZ-5358: every stylesheet the phone loads is in the list of some screen; the first load has no lazy one', () => {
    const used = new Set([...loadedBy.values()].flat())
    expect(phoneStylesheets().filter((f) => !used.has(f)).map((f) => relative(REPO, f))).toEqual([])
    expect(FIRST.map((f) => relative(REPO, f))).toContain('mobile/src/styles.css')
    // The link pills' sheet comes with the reader and Review (cardPill.ts), not in the first load; Review does not load reader.css.
    expect(loadedBy.get('page')!.map((f) => relative(REPO, f))).toContain('client/src/editor/wikilink/wikilink.css')
    expect(loadedBy.get('review-shown')!.map((f) => relative(REPO, f))).not.toContain('mobile/src/page/reader.css')
    expect(loadedBy.get('settings')!.map((f) => relative(REPO, f))).not.toContain('mobile/src/pwa/landing.css')
  })

  it('YAZ-5359: the engine read every colour value of every screen (none unresolved)', () => {
    expect([...new Set(results.flatMap((r) => r.unresolved.map((u) => `${r.name}: ${u}`)))]).toEqual([])
  })

  it('YAZ-5363: each class a screen draws has its style in a stylesheet that screen loads', () => {
    expect(results.filter((r) => r.unstyled.length > 0).map((r) => `${r.name}: ${r.unstyled.join(' ')}`)).toEqual([])
  })

  it('found the pairs it must (each kind, both themes)', () => {
    const all = results.flatMap((r) => r.findings)
    for (const theme of ['light', 'dark']) for (const what of ['text', 'placeholder', 'field border']) expect([theme, what, all.some((f) => f.theme === theme && f.what === what)]).toEqual([theme, what, true])
    // The shown answer word on its mark (YAZ-5338) and the sign-in placeholders (YAZ-5339) are among them.
    expect(all.some((f) => f.where.includes('card__hidden') && f.theme === 'dark')).toBe(true)
    expect(all.some((f) => f.what === 'placeholder' && f.text === 'owner/repo')).toBe(true)
  })

  afterAll(() => {
    for (const theme of ['light', 'dark'] as const) {
      const text = results.flatMap((r) => r.findings.filter((f) => f.theme === theme && f.what !== 'field border' && f.what !== 'icon').map((f) => ({ ...f, screen: r.name }))).sort((a, b) => a.ratio - b.ratio)[0]
      const border = results.flatMap((r) => r.findings.filter((f) => f.theme === theme && f.what === 'field border')).sort((a, b) => a.ratio - b.ratio)[0]
      if (text) console.info(`${theme}: lowest real text ${text.ratio}:1 ("${text.text}", ${text.screen}, ${text.fg} on ${text.bg}); lowest field border ${border?.ratio}:1; ${results.reduce((n, r) => n + r.findings.filter((f) => f.theme === theme).length, 0)} pairs`)
    }
  })
})
