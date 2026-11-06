#!/usr/bin/env node
/**
 * USAGE: node tools/buildSpeller.mjs
 *
 * Compiles the macOS spell checker helper (YAZ-4464): `desktop/build/speller.swift` →
 * `desktop/build/bin/speller`, which the app ships in `Contents/Resources/bin` (extraResources) and
 * `afterPack` signs with the rest. The desktop `dev` and `build` and the root `test` run it first.
 * Not on macOS it does nothing: Windows keeps Chromium's own Hunspell (`webFrame`). A no-op when the
 * binary is newer than its source and this script. Never committed (`.gitignore`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'desktop')
const source = join(desktop, 'build', 'speller.swift')
const out = join(desktop, 'build', 'bin', 'speller')
/** The oldest macOS the helper runs on: Electron 43's own (`LSMinimumSystemVersion` 12.0). Without it swiftc uses the build Mac's version (YAZ-4464 S3). */
const target = 'arm64-apple-macos12.0'

if (process.platform !== 'darwin') process.exit(0)
const built = existsSync(out) ? statSync(out).mtimeMs : 0
if (built >= statSync(source).mtimeMs && built >= statSync(fileURLToPath(import.meta.url)).mtimeMs) process.exit(0)

const run = spawnSync('swiftc', ['-O', '-target', target, source, '-o', out], { stdio: 'inherit' })
if (run.status !== 0) {
  console.error('speller: swiftc failed; install the Xcode command line tools (xcode-select --install)')
  process.exit(run.status ?? 1)
}
console.log('speller: built')
