import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * YAZ-4071 7J: the page cog's menu and its (i) box must open over the engine's text toolbar
 * (`.contextual-properties-toolbar`, `z-index: var(--zIndex-ui-top)`, 100). Since YAZ-4748 (the YAZ-4776 fix from
 * YAZ-3746) both render on `document.body`, out of the engine's stacking context, as fixed boxes at the app's top
 * layer. jsdom does not stack boxes, so this reads both stylesheets.
 */
const engineCss = readFileSync(join(dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'index.css'), 'utf8')
const drawingCss = readFileSync(join(__dirname, 'drawingEditor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const engineVar = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)`).exec(engineCss)?.[1])
/** A z-index value with the engine's variables put in (`calc(var(--x) + 1)` included). */
const resolve = (value: string) =>
  Function(`return ${value.replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g, (_, name: string) => String(engineVar(name))).replace(/calc/g, '')}`)() as number
const appCss = readFileSync(join(__dirname, '..', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('YAZ-4071 7J: the page cog menu and its (i) box on a drawing open over the engine toolbars', () => {
  it('each is a fixed box on the page, with a z-index above the text toolbar', () => {
    const toolbar = /\.contextual-properties-toolbar\s*\{[^}]*?z-index:\s*([^;}]+)/.exec(engineCss)?.[1]
    expect(toolbar).toBeDefined()
    for (const selector of ['\\.page-settings__menu\\.page-settings__menu--placed', '\\.page-settings__tip\\.page-settings__tip--hint']) {
      const body = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(appCss)?.[1]
      expect(body, selector).toBeDefined()
      expect(body, selector).toMatch(/position:\s*fixed/)
      const z = Number(/z-index:\s*(\d+)/.exec(body!)?.[1])
      expect(z, selector).toBeGreaterThan(resolve(toolbar!))
    }
  })

  it('drawingEditor.css no longer sets a z-index on them: inside the engine it would not apply', () => {
    expect(drawingCss).not.toMatch(/page-settings__(menu|tip)/)
  })
})

/**
 * YAZ-4071 7P: the engine's top row (`.App-menu_top`, `1fr 2fr 1fr`) never got smaller than the main toolbar, so in a
 * narrow pane the cog (in the row's right column) was off the window. jsdom has no layout: this reads the rules that let
 * the toolbar's column take only the room that is left. The numbers on screen are on YAZ-4152.
 */
describe('YAZ-4071 7P: in a narrow pane the toolbar gets smaller, and the page cog stays in the window', () => {
  /** The body of the rule whose selector list holds `selector` exactly. */
  const rule = (selector: string) => {
    const body = [...drawingCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, list]) => list.split(',').some((s) => s.trim().replace(/\s+/g, ' ') === selector))?.[2]
    expect(body, selector).toBeDefined()
    return body!
  }
  const scope = '.editor--drawing .excalidraw .App-menu_top'

  it('the side columns keep their content and the toolbar column gets the rest', () => {
    // the engine's own rule, which this overrides
    expect(engineCss).toMatch(/\.excalidraw \.App-menu_top\s*\{\s*grid-template-columns:\s*1fr 2fr 1fr/)
    expect(rule(scope)).toMatch(/grid-template-columns:\s*1fr auto 1fr/)
  })

  it('each box from the column down to the toolbar can be narrower than its tools', () => {
    expect(rule(`${scope} > .shapes-section`)).toMatch(/min-width:\s*0/)
    expect(rule(`${scope} > .shapes-section > div`)).toMatch(/min-width:\s*0/)
    const container = rule(`${scope} .App-toolbar-container`)
    expect(container).toMatch(/max-width:\s*100%/)
    expect(container).toMatch(/grid-auto-columns:\s*minmax\(0,\s*max-content\)/)
  })

  it('the tools scroll sideways in their own row, under the Island, so the "more tools" menu is not cut', () => {
    expect(rule(`${scope} .App-toolbar > .Stack_horizontal`)).toMatch(/overflow-x:\s*auto/)
    // the menu and the hint are positioned on the Island: it must stay the box they are placed in, and not scroll
    expect(engineCss).toMatch(/\.excalidraw \.Island\s*\{[^}]*position:\s*relative/)
    expect(drawingCss).not.toMatch(/\.App-toolbar\s*\{[^}]*overflow/)
  })
})

/**
 * YAZ-4277 (round 2): with a board's Add panel open, Settings opened over it showed the panel on top. The panel is the
 * engine's sidebar, `z-index: var(--zIndex-ui-library)` (120), and no box between it and the page made a stacking
 * context, so it competed with the Settings overlay (70) and won. The surface now holds every engine layer.
 */
describe('YAZ-4277: a board never paints over the app\'s overlays', () => {
  const settingsCss = readFileSync(join(__dirname, '../settings/settings.css'), 'utf8')

  it('the engine panel is above the Settings overlay by number, so the surface must be its own stacking context', () => {
    const panel = /\.excalidraw \.sidebar\s*\{[^}]*?z-index:\s*([^;}]+)/.exec(engineCss)?.[1]
    const overlay = Number(/\.settings-overlay[^{]*\{[^}]*?z-index:\s*(\d+)/.exec(settingsCss)?.[1])
    expect(resolve(panel!)).toBeGreaterThan(overlay)
    const surface = [...drawingCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, list]) => list.trim() === '.drawing-surface')?.[2]
    expect(surface).toMatch(/isolation:\s*isolate/)
  })
})
