#!/usr/bin/env node
/**
 * USAGE: node tools/lspPins.mjs [--check]
 *
 * Writes `desktop/src/main/lsp/pins.ts` from the root package-lock.json: the version, the tarball URL and the
 * sha512 of each language helper the app downloads (YAZ-3500, `tools/lib/lspPins.mjs`). `--check` writes
 * nothing and exits 1 when the file is not what the lockfile gives.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pinsSource } from './lib/lspPins.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'desktop', 'src', 'main', 'lsp', 'pins.ts')
const source = pinsSource(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')))
const now = (() => {
  try {
    return readFileSync(out, 'utf8')
  } catch {
    return null
  }
})()
if (process.argv.includes('--check')) {
  if (now !== source) {
    console.error(`${out} is not what package-lock.json gives: run node tools/lspPins.mjs`)
    process.exit(1)
  }
  console.log('lsp pins: up to date')
} else if (now === source) {
  console.log('lsp pins: up to date')
} else {
  writeFileSync(out, source)
  console.log(`lsp pins: wrote ${out}`)
}
