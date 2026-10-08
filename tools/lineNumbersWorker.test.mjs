import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * THE LINE-NUMBER WORKER RUNS WHERE THERE IS NO DOM (YAZ-2643). The worker has no DOM, and jsdom
 * has no `Worker`, so no client suite loads it. This bundles the worker the way the renderer build
 * does (a browser bundle: `micromark` resolves to its browser entry, which wants a
 * `document`) and runs the result in a context that has `self` and nothing else.
 */
const SOURCES = fileURLToPath(new URL('../client/src', import.meta.url))
const ENTRY = join(SOURCES, 'editor/lineNumbers/lineNumbers.worker.ts')

let code
beforeAll(async () => {
  const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, lib: { entry: ENTRY, formats: ['iife'], name: 'lineNumbersWorker' } } })
  code = [built].flat()[0].output[0].code
}, 120_000)

/** Loads the bundle as a worker would, and returns what it posts for one request. */
function ask(text) {
  const posted = []
  const self = { postMessage: (message) => posted.push(message) }
  self.self = self
  runInNewContext(code, self)
  self.onmessage({ data: { id: 7, text } })
  return posted
}

describe('the line-number worker bundle', () => {
  it('loads without a document and answers with the block lines, under the id it was asked with', () => {
    expect(ask('# Title\n\nFish &amp; chips.\n\n* a\n*\n\n| a |\n| - |\n')).toEqual([{ id: 7, lines: [1, 3, 5, 6, 8], kinds: 'hpppt' }])
  })

  it('holds the parser only: no editor, no React', () => {
    expect(code).not.toMatch(/prosemirror|milkdown|codemirror|react/i)
  })

  // The parse runs in the worker only (S62). The size gate cannot see a break of this: `micromark`
  // is in the main chunk already, for the editor's own parser.
  it('is the only source module that imports the parse: every other one takes the `BlockLines` type, which the build erases', () => {
    const importers = readdirSync(SOURCES, { recursive: true })
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => /^(?!import type\b).*['"][^'"\n]*\/blockLines['"]/m.test(readFileSync(join(SOURCES, file), 'utf8')))
    expect(importers).toEqual([join('editor', 'lineNumbers', 'lineNumbers.worker.ts')])
  })
})
