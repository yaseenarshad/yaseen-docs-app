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
