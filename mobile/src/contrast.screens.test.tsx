// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { afterAll, describe, expect, it } from 'vitest'
import { audit, type Finding, type Sheet, type Theme } from './dev/cssAudit'
import { mountFixture } from './dev/fixtures'

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

const read = (path: string): Sheet => ({ file: path, css: readFileSync(new URL(path, import.meta.url), 'utf8') })
/** The load order of the build: the first chunk's CSS, then `styles.css`, then each screen's own chunk (lazy). */
export const SHEETS: Sheet[] = [
  read('./status/status.css'),
  read('./screens/discardAnswer.css'),
  read('./search/search.css'),
  read('./pwa/update.css'),
  read('./pwa/landing.css'),
  read('./styles.css'),
  read('../../client/src/editor/card/card.css'),
  read('../../client/src/editor/table/table.css'),
  read('../../client/src/review/cardScreens.css'),
  read('./review/review.css'),
  read('./page/reader.css'),
  read('./friends/ui/friends.css'),
]

const FIXTURES = [
  'sign-in',
  'sign-in-error',
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
  'card',
  'card-file',
  'card-invalid',
  'page-offline',
]

const results: { name: string; ok: boolean; elements: number; findings: Finding[] }[] = []
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
  void mountFixture(root, `#fixture=${name}`)
  const ok = await waitFor(() => document.documentElement.dataset.fixtureReady === name || document.body.dataset.fixtureError !== undefined, 20_000)
  await new Promise((r) => setTimeout(r, 50))
  const findings: Finding[] = []
  let elements = 0
  for (const theme of ['light', 'dark'] as Theme[]) {
    const out = audit(host, SHEETS, { theme })
    elements += out.elements
    findings.push(...out.findings)
  }
  results.push({ name, ok: ok && document.body.dataset.fixtureError === undefined, elements, findings })
  root.unmount()
  host.remove()
}

describe('the contrast of every screen the phone draws (YAZ-5179, YAZ-5338 … YAZ-5341)', () => {
  it('renders each screen fixture, light and dark', { timeout: 300_000 }, async () => {
    for (const name of FIXTURES) await screen(name)
    const broken = results.filter((r) => !r.ok || r.elements < 5).map((r) => r.name)
    expect(broken).toEqual([])
  })

  it('each text 4.5:1 (large text 3:1), each placeholder 4.5:1, each icon and field border 3:1', () => {
    const low = results.flatMap((r) => r.findings.filter((f) => f.ratio < f.need).map((f) => `${r.name} ${f.theme} ${f.what} ${f.ratio}:1 < ${f.need}: "${f.text}" ${f.fg} on ${f.bg} (${f.where})`))
    expect([...new Set(low)]).toEqual([])
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
