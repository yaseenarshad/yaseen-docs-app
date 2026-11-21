import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PHONE_DRAWIO_TAG, VIEWER_PIN, checkTagPair, checkViewer, drawioFiles, fontFamilies, macPins, splitStencils } from './drawioPhone'

/**
 * YAZ-5533: the phone's draw.io is the Mac's. The pin pair, the viewer's own pin, the split of the stencil sets into one
 * file per library, the fonts, and the files of a build (the real pack: `npm run drawio:pack` makes it).
 */

const repo = fileURLToPath(new URL('../../', import.meta.url))

describe("the phone's draw.io is the Mac's (YAZ-5533)", () => {
  it("the phone's tag is the Mac's, in shared/drawio.ts and tools/packDrawio.mjs", () => {
    const mac = macPins(repo)
    expect(PHONE_DRAWIO_TAG).toBe(mac.shared)
    expect(PHONE_DRAWIO_TAG).toBe(mac.pack)
    expect(mac.warSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the build fails when the tags differ (either place)', () => {
    expect(() => checkTagPair('v31.5.2', { shared: 'v31.5.2', pack: 'v31.5.2' })).not.toThrow()
    expect(() => checkTagPair('v31.5.2', { shared: 'v32.0.0', pack: 'v31.5.2' })).toThrow(/must be the same release/)
    expect(() => checkTagPair('v31.5.2', { shared: 'v31.5.2', pack: 'v32.0.0' })).toThrow(/must be the same release/)
  })

  it('a viewer that is not the pinned one (size or sha256) is refused', () => {
    const fake = Buffer.from('not the viewer')
    expect(() => checkViewer(fake, { bytes: fake.length, sha256: createHash('sha256').update(fake).digest('hex') })).not.toThrow()
    expect(() => checkViewer(fake)).toThrow(/Refusing it/)
    expect(() => checkViewer(Buffer.from('not the viewe!'), { bytes: fake.length, sha256: createHash('sha256').update(fake).digest('hex') })).toThrow(/Refusing it/)
  })
})

describe('the split and the fonts (YAZ-5533)', () => {
  it('stencils.min.js becomes one file per library; a strange name is refused', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `f['lib${i}.xml'] = 'QUJD';`)
    const out = splitStencils(`(function() {\nvar f = {};\nf['aws4.xml'] = 'vL1b';\nf['rack/hpe_aruba/switches.xml'] = 'eJw=';\n${lines.join('\n')}\n})();`)
    expect(out.slice(0, 2)).toEqual([
      { key: 'aws4.xml', file: 'aws4.js', text: 'vL1b' },
      { key: 'rack/hpe_aruba/switches.xml', file: 'rack__hpe_aruba__switches.js', text: 'eJw=' },
    ])
    expect(() => splitStencils(`f['../x.xml'] = 'QQ==';\n${lines.join('\n')}`)).toThrow(/strange library name/)
    expect(() => splitStencils("f['a.xml'] = 'QQ==';")).toThrow(/format changed/)
  })

  it("the fonts are the Mac's sheet, in its order, family by family", () => {
    const css = [
      "@font-face { font-family: 'Assistant'; src: url('app://drawio/yaseen-fonts/Assistant/Assistant-Bold.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }",
      "@font-face { font-family: 'IBM Plex Mono'; src: url('app://drawio/yaseen-fonts/IBMPlexMono/IBMPlexMono-Regular.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }",
    ].join('\n')
    expect(fontFamilies(css)).toEqual([
      { family: 'Assistant', folder: 'Assistant', faces: [{ file: 'Assistant-Bold.woff2', weight: 700 }] },
      { family: 'IBM Plex Mono', folder: 'IBMPlexMono', faces: [{ file: 'IBMPlexMono-Regular.woff2', weight: 400 }] },
    ])
  })
})

describe('the files of a build (the real pack)', () => {
  const { base, files, libraries } = drawioFiles()

  it('one folder named by their hash; the viewer is the pinned one; the Mac renderer and link pills unchanged', () => {
    expect(base).toMatch(/^\/drawio\/[0-9a-f]{12}\/$/)
    expect(files.get('viewer-static.min.js')!.length).toBe(VIEWER_PIN.bytes)
    for (const name of ['yaseen-render.js', 'yaseen-links.js']) expect(files.get(name)!.equals(readFileSync(`${repo}desktop/drawio-overlay/js/${name}`))).toBe(true)
    expect(files.get('LICENSE-drawio.txt')!.toString()).toMatch(/Apache License/)
  })

  it('every library of the Mac is a file (204 in v31.5.2); the index names each; the AWS one is the biggest', () => {
    expect(libraries.length).toBe(204)
    for (const lib of libraries) expect(files.has(`stencils/${lib.file}`)).toBe(true)
    const index = files.get('phone-index.js')!.toString()
    for (const lib of libraries) expect(index).toContain(JSON.stringify(lib.key))
    const biggest = [...libraries].sort((a, b) => b.bytes - a.bytes)[0]
    expect(biggest.key).toBe('aws4.xml')
  })

  it("the renderer page loads the phone's paths and shim before the Mac's renderer, and nothing from another host", () => {
    const page = files.get('render')!.toString()
    const scripts = [...page.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])
    expect(scripts).toEqual(['phone-config.js', 'viewer-static.min.js', 'phone-index.js', 'phone-shim.js', 'yaseen-links.js', 'yaseen-render.js'])
    expect(page).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
    expect(files.get('phone-config.js')!.toString()).not.toMatch(/https?:/)
  })

  it('the fonts are the five families of the Mac, each a file', () => {
    expect([...files.keys()].filter((f) => f.startsWith('fonts/')).sort()).toEqual(['fonts/Assistant.js', 'fonts/IBMPlexMono.js', 'fonts/Inter.js', 'fonts/LiberationSerif.js', 'fonts/Roboto.js'])
  })
})
