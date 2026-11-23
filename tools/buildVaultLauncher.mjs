#!/usr/bin/env node
/**
 * USAGE: node tools/buildVaultLauncher.mjs
 *
 * Compiles the macOS Vault App launcher helper (YAZ-5967, YAZ-6373):
 * `desktop/build/vault-launcher.swift` → `desktop/build/bin/vault-launcher`, which the app ships in
 * `Contents/Resources/bin` (extraResources) and `afterPack` signs with the rest. The desktop `dev`
 * and `build` and the root `test` run it first. Not on macOS it does nothing. A no-op when the
 * binary is newer than its source and this script. Never committed (`.gitignore`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'desktop')
const source = join(desktop, 'build', 'vault-launcher.swift')
const out = join(desktop, 'build', 'bin', 'vault-launcher')
/** The oldest macOS the helper runs on: Electron 43's own (`LSMinimumSystemVersion` 12.0). */
const target = 'arm64-apple-macos12.0'

if (process.platform !== 'darwin') process.exit(0)
const built = existsSync(out) ? statSync(out).mtimeMs : 0
if (built >= statSync(source).mtimeMs && built >= statSync(fileURLToPath(import.meta.url)).mtimeMs) process.exit(0)

mkdirSync(dirname(out), { recursive: true })
const run = spawnSync('swiftc', ['-O', '-target', target, source, '-o', out], { stdio: 'inherit' })
if (run.status !== 0) {
  console.error('vault-launcher: swiftc failed; install the Xcode command line tools (xcode-select --install)')
  process.exit(run.status ?? 1)
}
console.log('vault-launcher: built')
