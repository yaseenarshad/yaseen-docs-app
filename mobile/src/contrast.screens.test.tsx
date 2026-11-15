// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
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
// YAZ-5533: a diagram's picture is a `blob:` URL; jsdom has none.
URL.createObjectURL ??= () => 'blob:contrast'
URL.revokeObjectURL ??= () => {}

/**
 * YAZ-5533: jsdom loads no frame, so draw.io's viewer is faked here: each diagram is a made-up picture of two pages
 * with a shape library still to come. The rest of the diagram chunk is real (its figure and its stylesheet).
 */
vi.mock('./drawing/diagram/drawDiagram', async () => {
  const real = await vi.importActual<typeof import('./drawing/diagram/figure')>('./drawing/diagram/figure')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dae8fc"/></svg>'
  return { ...real, DiagramUnavailable: class extends Error {}, drawDiagram: async () => ({ svg, width: 320, height: 180, pages: [{ id: 'a', name: 'Overview' }, { id: 'b', name: 'Details' }], page: 'a', missing: ['aws4.xml'] }) }
})

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
  // YAZ-5495: the end of Due today.
  'review-due-missed',
  'review-due-done',
  'review-due-clear',
  // YAZ-5500: the last answer in the hint line.
  'review-last',
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
  // YAZ-5534: the Type filter's tree and its menu of checks.
  'search-types',
  'search-types-menu',
  'search-types-favorites',
  'search-none',
  'page',
  'page-comments',
  'card',
  'card-file',
  'card-file-comments',
  'card-invalid',
  'page-offline',
  // YAZ-5533: plain draw.io diagrams (the viewer's frame faked below: jsdom runs no frame), with a page picker and a note.
  'page-diagrams',
  'page-copied',
  'page-copy-by-hand',
  'page-last',
  'card-next',
  'page-tables',
  'page-table-full',
  // YAZ-5455, YAZ-5456, YAZ-5459: links and "Linked mentions", the vault's pills, the ⋯ tools, find, the headings,
  // the properties panel.
  'page-links',
  'page-linked-from',
  'page-pills',
  'page-tools',
  'page-find',
  'page-headings',
  'page-properties',
  'page-properties-closed',
  'page-properties-title',
  // YAZ-5458: the reading look, every block.
  'page-look',
  // YAZ-5504: the card's ⋯ in the card view (a row armed: "Tap again to archive") and on a page card.
  'card-menu',
  'page-card-menu',
  // YAZ-5548: a card's ⋯ in an Explore panel, its menu open.
  'sheet-card-menu',
  // YAZ-5472: Explore's sheets.
  'explore-one',
  'explore-stack',
  'explore-mentions',
  // YAZ-5460: a held folder's menu, the folder page and its views, in a sheet too.
  'folder-hold',
  'folder-page',
  'folder-grouped',
  'folder-board',
  'folder-cards',
  'folder-calendar',
  'folder-sheet',
  // YAZ-5549: the table as the vault's folder-pages.json says: Tall rows, the # numbers, a subfolder's "1 inside".
  'folder-table-look',
  // YAZ-5532: a finger's band on a table row (the frozen cells too), in a page, full screen, and a folder's table.
  'page-table-band',
  'page-table-band-full',
  'folder-table-band',
  // Last: it makes this page's navigator say iPhone.
  'sign-in-iphone',
]

const results: { name: string; ok: boolean; elements: number; outside: number; findings: Finding[]; unresolved: string[]; unstyled: string[] }[] = []

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
  const before = new Set(document.body.children)
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
  let outside = 0
  // YAZ-5523: everything drawn on the page, not only the app root: sheets, menus and the full-screen table are
  // portals into `document.body`.
  for (const theme of ['light', 'dark'] as Theme[]) {
    const out = audit(document.body, sheets, { theme })
    elements += out.elements
    outside += out.elements - audit(host, sheets, { theme }).elements
    findings.push(...out.findings)
    for (const u of out.unresolved) unresolved.add(`${theme} ${u}`)
  }
  // YAZ-5363: a class that a phone stylesheet styles, drawn on a screen that does not load that stylesheet.
  const own = classesOf(sheets)
  const unstyled = [...new Set([...document.body.querySelectorAll('[class]')].flatMap((el) => [...el.classList]))].filter((c) => STYLED_ANYWHERE.has(c) && !own.has(c))
  results.push({ name, ok: ok && document.body.dataset.fixtureError === undefined, elements, outside, findings, unresolved: [...unresolved], unstyled })
  root.unmount()
  host.remove()
  // A portal the screen left behind is not drawn on the next screen.
  for (const el of [...document.body.children]) if (!before.has(el)) el.remove()
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
  results.push({ name: 'landing', ok: true, elements, outside: 0, findings, unresolved, unstyled: [] })
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

  it('the contrast test audits everything drawn on the page, sheets included', () => {
    // YAZ-5523: the sheets are portals into document.body, outside the app root. Each sheet fixture has audited items there.
    const sheetScreens = ['folder-sheet', 'explore-stack', 'explore-one', 'folder-hold', 'page-table-full']
    expect(sheetScreens.filter((n) => !(results.find((r) => r.name === n)!.outside > 0))).toEqual([])
  })

  it('every .css file under mobile/src (outside dev/) is in phoneStylesheets()', () => {
    // YAZ-5523: a stylesheet nobody imports is in no screen's list, so no check would read it.
    const src = resolve(REPO, 'mobile/src')
    const onDisk = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.css') && !f.startsWith('dev/'))
      .map((f) => relative(REPO, resolve(src, f)))
    const listed = new Set(phoneStylesheets().map((f) => relative(REPO, f)))
    expect(onDisk.length).toBeGreaterThan(20)
    expect(onDisk.filter((f) => !listed.has(f)).sort()).toEqual([])
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

  it("YAZ-5532: a banded row's text is checked on the band (the frozen cell too), light and dark", () => {
    for (const [name, text] of [['page-table-band', 'Pine Hollow 1'], ['page-table-band-full', 'Pine Hollow 1'], ['folder-table-band', 'Lisbon weekend']]) {
      const found = results.find((r) => r.name === name)?.findings.filter((f) => f.text.startsWith(text)) ?? []
      for (const [theme, page] of [['light', '#ffffff'], ['dark', '#1e1e1e']]) {
        const on = found.filter((f) => f.theme === theme)
        expect([name, theme, on.length > 0 && on.every((f) => f.bg !== page && f.ratio >= f.need)]).toEqual([name, theme, true])
      }
    }
  })

  afterAll(() => {
    for (const theme of ['light', 'dark'] as const) {
      const text = results.flatMap((r) => r.findings.filter((f) => f.theme === theme && f.what !== 'field border' && f.what !== 'icon').map((f) => ({ ...f, screen: r.name }))).sort((a, b) => a.ratio - b.ratio)[0]
      const border = results.flatMap((r) => r.findings.filter((f) => f.theme === theme && f.what === 'field border')).sort((a, b) => a.ratio - b.ratio)[0]
      if (text) console.info(`${theme}: lowest real text ${text.ratio}:1 ("${text.text}", ${text.screen}, ${text.fg} on ${text.bg}); lowest field border ${border?.ratio}:1; ${results.reduce((n, r) => n + r.findings.filter((f) => f.theme === theme).length, 0)} pairs`)
    }
  })
})
