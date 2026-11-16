// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { DRAWING_FILES } from '../dev/drawingVault'
import { forgetSearch } from './searchState'
import { diagramPictureIcon } from './rowIcon'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5545: a drawing and a diagram show the Mac's default icons, Material Icon Theme's `excalidraw` and `drawio`, the
 * same SVG and colours (an image, not a mask); a draw.io picture (`.drawio.svg`, `.drawio.png`) the Mac's image icon
 * (`svg`, `image`); an icon of the user's own (a pick, a rule) still wins; a colour the vault picked draws the icon as a
 * silhouette in it. Made-up vault only.
 */
const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const css = src('../styles.css')
const macIcon = (id: string) => src(`../../../client/public/material-icons/${id}.svg`).trim()

/** The body of the rule whose selector is exactly `selector`. */
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`)
  if (at === -1) throw new Error(`no rule ${selector}`)
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}
/** The SVG a `--material-<id>` data URI holds, with the Mac file's double quotes. */
const inlineIcon = (id: string): string => {
  const m = new RegExp(`--material-${id}: url\\("data:image/svg\\+xml,([^"]+)"\\);`).exec(css)
  if (m === null) throw new Error(`no --material-${id}`)
  return decodeURIComponent(m[1]).replace(/'/g, '"')
}

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function openSearch(files: Record<string, string | Uint8Array>): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  return x
}
const iconOf = (x: Harness, label: string) => [...x.host.querySelectorAll<HTMLElement>('.tree .tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === label)?.querySelector<HTMLElement>('.file-icon')
const FILES = { ...READER_FILES, ...DRAWING_FILES }

describe('drawing and diagram icons are the Mac’s Material icons (YAZ-5545)', () => {
  it('the inline icons are Material’s files byte for byte, drawn as images in their own colours', () => {
    expect(inlineIcon('excalidraw')).toBe(macIcon('excalidraw'))
    expect(inlineIcon('drawio')).toBe(macIcon('drawio'))
    expect(rule(".file-icon[data-kind='drawing']").trim()).toBe('background: var(--material-excalidraw) center / 16px 16px no-repeat;')
    expect(rule(".file-icon[data-kind='diagram']").trim()).toBe('background: var(--material-drawio) center / 16px 16px no-repeat;')
    // The Line glyphs and their colours are gone: the phone cannot know the Mac's icon set.
    expect(css).not.toMatch(/--kind-(drawing|diagram):\s*#/)
  })

  it('a colour the vault picked draws the icon as a silhouette in it, as the Mac', () => {
    expect(rule("[data-icon-colors~='drawing'] .file-icon[data-kind='drawing']")).toContain('background: var(--kind-drawing);')
    expect(rule("[data-icon-colors~='drawing'] .file-icon[data-kind='drawing']")).toContain('mask: var(--material-excalidraw)')
    expect(rule("[data-icon-colors~='diagram'] .file-icon[data-kind='diagram']")).toContain('background: var(--kind-diagram);')
    expect(rule("[data-icon-colors~='diagram'] .file-icon[data-kind='diagram']")).toContain('mask: var(--material-drawio)')
  })

  it('a draw.io picture is the Mac’s image icon; any other name none', () => {
    expect(diagramPictureIcon('flow.drawio.svg')).toBe('svg')
    expect(diagramPictureIcon('Flow.DRAWIO.PNG')).toBe('image')
    expect(diagramPictureIcon('old plan.drawio')).toBeNull()
    expect(diagramPictureIcon('garden.excalidraw')).toBeNull()
  })

  it('the Search tree: drawing and diagram rows are their kinds’ Material icons; a draw.io picture Material’s svg', async () => {
    h = await openSearch(FILES)
    await waitFor(h, () => iconOf(h!, 'flow.drawio')?.tagName === 'IMG')
    expect(iconOf(h, 'garden')?.tagName).toBe('SPAN')
    expect(iconOf(h, 'garden')?.getAttribute('data-kind')).toBe('drawing')
    expect(iconOf(h, 'old plan')?.getAttribute('data-kind')).toBe('diagram')
    expect(iconOf(h, 'flow.drawio')?.getAttribute('src')).toBe('/material-icons/svg.svg')
    expect(h.host.querySelector('.tree')?.hasAttribute('data-icon-colors')).toBe(false)
  })

  it('an icon of the user’s own still wins: a pick, then a rule', async () => {
    const icons = { version: 2, paths: { 'garden.excalidraw': 'lua' }, rules: [{ match: '*.drawio', kind: 'file', icon: 'python' }, { match: '*.drawio.svg', kind: 'file', icon: 'go' }] }
    h = await openSearch({ ...FILES, '.yaseendocs/icons.json': JSON.stringify(icons) })
    await waitFor(h, () => iconOf(h!, 'garden')?.tagName === 'IMG')
    expect(iconOf(h, 'garden')?.getAttribute('src')).toBe('/material-icons/lua.svg')
    expect(iconOf(h, 'old plan')?.getAttribute('src')).toBe('/material-icons/python.svg')
    expect(iconOf(h, 'flow.drawio')?.getAttribute('src')).toBe('/material-icons/go.svg')
    // A drawing with no pick keeps Material's icon.
    expect(iconOf(h, 'broken')?.getAttribute('data-kind')).toBe('drawing')
  })

  it('a vault colour for drawings and diagrams: the tree names the kinds and sets their colours', async () => {
    h = await openSearch({ ...FILES, '.yaseendocs/icons.json': JSON.stringify({ version: 2, paths: {}, colors: { drawing: '#123456', diagram: '#654321' } }) })
    await waitFor(h, () => h!.host.querySelector('.tree')?.hasAttribute('data-icon-colors') === true)
    const tree = h.host.querySelector<HTMLElement>('.tree')!
    expect(tree.getAttribute('data-icon-colors')).toBe('drawing diagram')
    expect(tree.style.getPropertyValue('--kind-drawing')).toBe('#123456')
    expect(iconOf(h, 'garden')?.getAttribute('data-kind')).toBe('drawing')
  })
})
