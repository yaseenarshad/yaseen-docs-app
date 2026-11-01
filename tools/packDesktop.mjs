#!/usr/bin/env node
/**
 * USAGE: node tools/packDesktop.mjs --mac | --win
 *
 * Runs electron-builder in desktop/ with the ROOT package.json version stamped in
 * (`extraMetadata.version`). A script that wrote `$npm_package_version` only expanded
 * under a Unix shell; on Windows npm runs scripts through cmd.exe and the literal string
 * reached electron-builder ("Invalid major number"). Reading the version here works on both.
 * The overrides go to electron-builder's `build()` as values (`tools/lib/packConfig.mjs`).
 *
 * The language helpers of the code tab are not packed (YAZ-3500): the app downloads them the first time
 * Settings › Code › "Jump across files" is turned on (`desktop/src/main/lsp/download.ts`).
 *
 * `--mac` then recompresses the dmg zlib → lzma (`lzmaDmg`, YAZ-2181).
 *
 * Two-number versions (YAZ-3209 release, 2.1 on): package.json keeps `2.1.0` (npm and
 * electron-builder need three numbers), but a person sees `2.1` — the installer names and the
 * Mac About box (`bundleShortVersion`) get the short form when the third number is 0.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dmgPath, lzmaDmg } from './lib/dmg.mjs'
import { packConfig } from './lib/packConfig.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node tools/packDesktop.mjs --mac | --win')
  process.exit(2)
}
const { short, config } = packConfig(version)
// desktop/'s own electron-builder, run from desktop/, as `npm exec -w desktop -- electron-builder --mac` ran it: a
// path in its config, such as `afterPack`, is read from the folder it runs in. `mac: []` is `--mac`.
const desktop = join(root, 'desktop')
const { build: pack } = createRequire(join(desktop, 'package.json'))('electron-builder')
process.chdir(desktop)
await pack({
  projectDir: desktop,
  config,
  ...(args.includes('--mac') ? { mac: [] } : {}),
  ...(args.includes('--win') ? { win: [] } : {}),
})
if (args.includes('--mac')) {
  const { build } = JSON.parse(readFileSync(join(root, 'desktop', 'package.json'), 'utf8'))
  const dmg = dmgPath(join(root, 'desktop'), build, short)
  lzmaDmg(dmg, `${build.productName}.app`)
  console.log(`lzma dmg: ${dmg}`)
}
