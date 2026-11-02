import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * YAZ-4071 7J: the page cog's menu and the engine's text toolbar (`.contextual-properties-toolbar`) are in one
 * stacking context (`.layer-ui__wrapper`). The toolbar is `z-index: var(--zIndex-ui-top)` (100); the app's menu
 * rule is 10, so the toolbar covered the cog's rows. jsdom does not stack boxes, so this reads both stylesheets.
 */
const engineCss = readFileSync(join(dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'index.css'), 'utf8')
const drawingCss = readFileSync(join(__dirname, 'drawingEditor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const engineVar = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)`).exec(engineCss)?.[1])
/** A z-index value with the engine's variables put in (`calc(var(--x) + 1)` included). */
const resolve = (value: string) =>
  Function(`return ${value.replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g, (_, name: string) => String(engineVar(name))).replace(/calc/g, '')}`)() as number

describe('YAZ-4071 7J: the page cog menu and its panel on a drawing open over the engine toolbars', () => {
  it('its z-index is above the text toolbar and below the main menu', () => {
    const toolbar = /\.contextual-properties-toolbar\s*\{[^}]*?z-index:\s*([^;}]+)/.exec(engineCss)?.[1]
    expect(toolbar).toBeDefined()
    // the menu, and its "i" panel left of it (over the toolbar too)
    for (const part of ['page-settings__menu', 'page-settings__tip']) {
      const rule = new RegExp(`\\.editor--drawing \\.excalidraw \\.drawing-editor__chips \\.${part}[^{]*\\{[^}]*?z-index:\\s*([^;}]+)`)
      const value = rule.exec(drawingCss)?.[1]
      expect(value, part).toBeDefined()
      expect(resolve(value!), part).toBeGreaterThan(resolve(toolbar!))
      expect(resolve(value!), part).toBeLessThan(engineVar('--zIndex-ui-main-menu'))
    }
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
