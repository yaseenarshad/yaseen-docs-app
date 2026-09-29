import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const vendor = fileURLToPath(new URL('../client/vendor/', import.meta.url))
/**
 * The pinned Milkdown packages we carry a patch for (one pipeline for all of them): the upstream npm
 * archive and its integrity, the readable `.patch` next to the tgz, and the stale source maps the
 * patch invalidates (the compiled runtime is patched directly).
 */
const packages = {
  components: {
    name: 'milkdown-components-7.22.1-yaz1410',
    url: 'https://registry.npmjs.org/@milkdown/components/-/components-7.22.1.tgz',
    integrity: '6IA8fcFcBTm/x1X1typz73yUoT1JuN4srmifGAIeWEtCnayEwRjFxpQOoQrfvMgBYx4DSHcPVLhJUlR/xbBtxg==',
    maps: ['lib/table-block/index.js.map', 'lib/list-item-block/index.js.map'],
  },
  'plugin-tooltip': {
    name: 'milkdown-plugin-tooltip-7.22.1-yaz2238',
    url: 'https://registry.npmjs.org/@milkdown/plugin-tooltip/-/plugin-tooltip-7.22.1.tgz',
    integrity: 'drdWA/7WlrDr2B+ABYf4tY9xTiwg/CJMUCydfD05dR2d8wOkaF6oOHZwJbWnkWLMtAJWdieOYgfXGPhQRwXxCg==',
    maps: ['lib/index.js.map'],
  },
}
const usage = `Usage: node tools/buildMilkdownPatch.mjs <${Object.keys(packages).join('|')}> [--source upstream.tgz] [--output patched.tgz]`
const pkg = packages[process.argv[2]]
if (!pkg) throw new Error(usage)
const { name, url, integrity, maps } = pkg
const options = {}
for (let i = 3; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  const value = process.argv[i + 1]
  if (!['--source', '--output'].includes(key) || !value || value.startsWith('--') || options[key]) throw new Error(usage)
  options[key] = resolve(value)
}
const output = options['--output'] ?? join(vendor, `${name}.tgz`)
const temp = await mkdtemp(join(tmpdir(), 'milkdown-patch-'))
try {
  let upstream
  if (options['--source']) {
    upstream = await readFile(options['--source'])
  } else {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Upstream download failed: ${response.status}`)
    upstream = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha512').update(upstream).digest('base64') !== integrity) {
    throw new Error('Upstream tarball integrity mismatch')
  }
  const archive = join(temp, 'upstream.tgz')
  await writeFile(archive, upstream)
  execFileSync('tar', ['-xzf', archive, '-C', temp])
  const packageRoot = join(temp, 'package')
  execFileSync('git', ['apply', join(vendor, `${name}.patch`)], { cwd: packageRoot })
  for (const map of maps) await unlink(join(packageRoot, map))
  const packed = JSON.parse(execFileSync('npm', [
    'pack', packageRoot, '--pack-destination', temp, '--ignore-scripts', '--json',
  ], { encoding: 'utf8' }))
  await mkdir(dirname(output), { recursive: true })
  await rename(join(temp, packed[0].filename), output)
  process.stdout.write(`${output}\n`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
