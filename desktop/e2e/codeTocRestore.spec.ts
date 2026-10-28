/**
 * YAZ-3527 (bug): a code tab restored at launch shows its table of contents, every launch, with no edit.
 *
 * Monaco sets a language's smart help up lazily, after the first model of that language exists (a dynamic
 * import). Before the fix the table of contents read the symbols once, at the tab's mount, and that read often
 * came before the language was ready: the TS worker accessor rejected ("TypeScript not registered!", about half
 * of the launches), and a JSON or CSS file had no symbol provider yet (every launch). The empty answer counted
 * as "no symbol", and nothing read again until an edit.
 *
 * Each launch is a fresh app on the same temp profile and vault, with one code tab restored at startup, and
 * Settings › Table of contents = Always. The rows must show with no click and no key in the code.
 *
 * Hidden windows (`YASEEN_DOCS_E2E_HIDDEN=1`), a temp `--user-data-dir`, a temp vault.
 */
import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, emitOpenFile, launchApp, layer, quitApp, seededState } from './helpers'

/** A small TS file with several functions, as in the report (`recipes.ts`). */
const TS_BODY = `export interface Recipe {
  id: string
  minutes: number
}

export const MAX_MINUTES = 60

export const recipes: Recipe[] = [{ id: 'pasta', minutes: 25 }]

export function quickRecipes(limit: number = MAX_MINUTES): Recipe[] {
  return recipes.filter((recipe) => recipe.minutes <= limit)
}

export function findRecipe(id: string): Recipe | undefined {
  return recipes.find((recipe) => recipe.id === id)
}
`

interface Restored {
  file: string
  body: string
  /** A word of the file: the code shows. */
  text: string
  /** Rows the table of contents must show; empty = any row (HTML's rows are tags). */
  rows: string[]
}
const TS: Restored = { file: 'web/src/recipes.ts', body: TS_BODY, text: 'quickRecipes', rows: ['Recipe', 'MAX_MINUTES', 'recipes', 'quickRecipes', 'findRecipe'] }
const JSON_FILE: Restored = { file: 'web/data.json', body: '{\n  "name": "box",\n  "items": [1, 2],\n  "owner": { "id": 3 }\n}\n', text: 'owner', rows: ['name', 'items', 'owner'] }
const CSS: Restored = { file: 'web/site.css', body: '.card { color: red; }\n.title { margin: 0; }\n', text: '.title', rows: ['.card', '.title'] }
const JS: Restored = { file: 'web/app.js', body: 'export function alpha() { return 1 }\nexport function beta() { return 2 }\n', text: 'beta', rows: ['alpha', 'beta'] }
const HTML: Restored = { file: 'web/index.html', body: '<!doctype html>\n<html>\n<head><title>t</title></head>\n<body>\n<div id="main"><p>hi</p></div>\n</body>\n</html>\n', text: 'main', rows: [] }
/** The TS race lost in about half of the launches (2 of 4 in the report): 4 TS launches, then JSON, CSS, JS and HTML (the checker's cases). */
const LAUNCHES: Restored[] = [TS, TS, TS, TS, JSON_FILE, CSS, JS, HTML]

let userData: string
let vault: string

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'codeTocRestore-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'codeTocRestore-vault-'))
  await mkdir(path.join(vault, 'web', 'src'), { recursive: true })
  await Promise.all([
    ...[TS, JSON_FILE, CSS, JS, HTML].map(({ file, body }) => writeFile(path.join(vault, file), body)),
    writeFile(path.join(vault, 'web', 'package.json'), '{ "name": "recipe-box", "private": true }\n'),
    writeFile(path.join(vault, 'README.md'), '# Recipe box\n'),
  ])
})

test.afterAll(async () => {
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('YAZ-3527: a code tab restored at launch shows its table of contents, every launch, with no edit', async () => {
  test.setTimeout(LAUNCHES.length * 40_000)
  const results: string[] = []
  for (const { file, text, rows } of LAUNCHES) {
    const state = seededState(vault, path.join(vault, file))
    state.settings.tableOfContents = 'pinned'
    const app = await launchApp({ userData, seedState: state })
    try {
      const win = await appWindow(app, 'w1')
      await expect(layer(win).locator('.editor--code .monaco-editor .view-lines')).toContainText(text, { timeout: 20_000 })
      const names = layer(win).locator('nav.outline .outline__row .outline__name')
      // No click, no key: the restored tab must read its symbols by itself.
      const shown = await expect
        .poll(async () => {
          const now = await names.allInnerTexts()
          return rows.length === 0 ? now.length > 0 : rows.every((row) => now.includes(row))
        }, { timeout: 10_000 })
        .toBe(true)
        .then(() => true)
        .catch(() => false)
      results.push(`${file}: ${shown ? 'rows' : `no rows ${JSON.stringify(await names.allInnerTexts())}`}`)
    } finally {
      await quitApp(app)
    }
  }
  expect(results).toEqual(LAUNCHES.map(({ file }) => `${file}: rows`))
})

test('YAZ-3527: the first JSON file opened in a session shows its table of contents, with no edit', async () => {
  test.setTimeout(60_000)
  const state = seededState(vault, path.join(vault, 'README.md'))
  state.settings.tableOfContents = 'pinned'
  const app = await launchApp({ userData, seedState: state })
  try {
    const win = await appWindow(app, 'w1')
    await expect(layer(win).locator('.ProseMirror')).toContainText('Recipe box', { timeout: 20_000 })
    await emitOpenFile(app, path.join(vault, JSON_FILE.file))
    await expect(layer(win).locator('.editor--code .monaco-editor .view-lines')).toContainText(JSON_FILE.text, { timeout: 20_000 })
    const names = layer(win).locator('nav.outline .outline__row .outline__name')
    await expect
      .poll(async () => {
        const now = await names.allInnerTexts()
        return JSON_FILE.rows.every((row) => now.includes(row))
      }, { timeout: 10_000 })
      .toBe(true)
  } finally {
    await quitApp(app)
  }
})
