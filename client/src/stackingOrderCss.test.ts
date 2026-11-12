/**
 * THE STACKING ORDER OVER EXPLORE (YAZ-4987). Yaseen: "if i rename a page when im in explore, the rename confirmation
 * comes behind the explore window". The Explore stack is a fixed layer over the whole window; a sheet App opens while
 * it shows (Rename, Delete, the read-only ask: every `ConfirmSheet`), a toast with Undo, and the ask of a table cell's
 * change are drawn in `document.body` beside it, so only their `z-index` decides which is on top. jsdom lays nothing
 * out, so the order is read from the CSS, as `statusChipsStackingCss.test.ts` reads the bar's.
 */
import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'
import exploreCss from './explore/explore.css?inline'
import settingsCss from './settings/settings.css?inline'
import drawingCss from './drawings/drawingModal.css?inline'
import historyCss from './history/history.css?inline'
import shareCss from './share/share.css?inline'
import viewsCss from './views/views.css?inline'

const sheets = [appCss, exploreCss, settingsCss, drawingCss, historyCss, shareCss, viewsCss].map((css) => css.replace(/\/\*.*?\*\//gs, '')).join('\n')
/** The app's stacking variables (`--z-…` on `:root`). */
const vars = new Map([...sheets.matchAll(/(--z-[\w-]+):\s*(\d+)\s*;/g)].map(([, name, z]) => [name, Number(z)]))

/** The z-index of the rule whose selector is exactly `selector`, a `var(--z-…)` read through `:root`. */
const zOf = (selector: string): number => {
  const rule = [...sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => sel.trim() === selector)
  expect(rule, selector).toBeDefined()
  const value = /z-index:\s*([^;]+);/.exec(rule![2])?.[1].trim() ?? '0'
  const v = /^var\((--z-[\w-]+)\)$/.exec(value)
  return v === null ? Number(value) : (vars.get(v[1]) ?? NaN)
}

describe('every ask and notice App draws shows over the Explore window (YAZ-4987)', () => {
  const explore = () => zOf('.explore')

  it('a confirm sheet (Rename, Delete, "This vault is read only", every `ConfirmSheet`) is over Explore', () => {
    expect(zOf('.confirm-overlay')).toBeGreaterThan(explore())
  })

  it('the corner\'s toasts (an Undo, a notice) are over Explore, and under a sheet\'s scrim', () => {
    expect(zOf('.corner-notices')).toBeGreaterThan(explore())
    expect(zOf('.corner-notices')).toBeLessThan(zOf('.confirm-overlay'))
  })

  it('a table cell\'s "Confirm changes" ask (an Explore layer in edit) is over Explore', () => {
    expect(zOf('.change-ask')).toBeGreaterThan(explore())
  })

  it('a sheet is over the other big windows too (Settings, a drawing, Version history, Share), and under the menus', () => {
    const sheet = zOf('.confirm-overlay')
    for (const window of ['.settings-overlay,\n.whats-new-overlay', '.drawing-modal-overlay', '.confirm-overlay.history-overlay', '.confirm-overlay.share-overlay']) expect(sheet, window).toBeGreaterThan(zOf(window))
    expect(sheet).toBeLessThan(zOf('.ctx-menu.share-menu'))
  })
})
