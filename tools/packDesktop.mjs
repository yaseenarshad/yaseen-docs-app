#!/usr/bin/env node
/**
 * USAGE: node tools/packDesktop.mjs --mac | --win
 *
 * Runs electron-builder in desktop/ with the ROOT package.json version stamped in
 * (-c.extraMetadata.version). A script that wrote `$npm_package_version` only expanded
 * under a Unix shell; on Windows npm runs scripts through cmd.exe and the literal string
 * reached electron-builder ("Invalid major number"). Reading the version here works on both.
 *
 * First it stages the TypeScript 7 language server of each target (`stageTypescript`, YAZ-3453):
 * the Windows binary is not in `node_modules` on a Mac, and electron-builder copies the staged folder.
 * Then the Python helper (`stagePyright`, YAZ-3455): `pyright`, one Node program for every target.
 *
 * `--mac` then recompresses the dmg zlib → lzma (`lzmaDmg`, YAZ-2181).
 *
 * Two-number versions (YAZ-3209 release, 2.1 on): package.json keeps `2.1.0` (npm and
 * electron-builder need three numbers), but a person sees `2.1` — the installer names and the
 * Mac About box (`bundleShortVersion`) get the short form when the third number is 0.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dmgPath, lzmaDmg } from './lib/dmg.mjs'
import { lspTargets, stagePyright, stageTypescript } from './lib/lspPack.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node tools/packDesktop.mjs --mac | --win')
  process.exit(2)
}
const short = version.replace(/^(\d+\.\d+)\.0$/, '$1')
const { build: desktopBuild } = JSON.parse(readFileSync(join(root, 'desktop', 'package.json'), 'utf8'))
for (const target of lspTargets(desktopBuild, args)) {
  const { dir, from } = await stageTypescript({ repo: root, ...target })
  console.log(`[lsp] typescript ${target.os}-${target.arch}: ${dir} (${from})`)
}
{
  // The Python helper (YAZ-3455): one Node program for every target.
  const { dir, from } = await stagePyright({ repo: root })
  console.log(`[lsp] pyright: ${dir} (${from})`)
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const named = [
  `-c.extraMetadata.version=${version}`,
  `-c.mac.bundleShortVersion=${short}`,
  `-c.dmg.artifactName=\${productName}-${short}-arm64.dmg`,
  `-c.nsis.artifactName=\${productName}-${short}-win-x64-setup.\${ext}`,
]
execFileSync(npm, ['exec', '-w', 'desktop', '--', 'electron-builder', ...args, ...named], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (args.includes('--mac')) {
  const { build } = JSON.parse(readFileSync(join(root, 'desktop', 'package.json'), 'utf8'))
  const dmg = dmgPath(join(root, 'desktop'), build, short)
  lzmaDmg(dmg, `${build.productName}.app`)
  console.log(`lzma dmg: ${dmg}`)
}
