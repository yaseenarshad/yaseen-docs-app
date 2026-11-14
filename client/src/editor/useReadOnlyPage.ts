/**
 * THE READ-ONLY RENDER OF A PAGE (YAZ-1244), shared by the surfaces that hold a page up without
 * opening it: through `ReadOnlyPage`, the preview panel of the search (YAZ-2662 D5) and the sidebar's
 * hover preview (YAZ-3075 D1), which the folder views also show (YAZ-3403, YAZ-3743).
 *
 * The instance is a real Crepe with BlockEdit and the Toolbar off and no find/drawing/link-click
 * options — the plugins that exist to EDIT are simply never registered — then `setReadonly(true)`.
 * It does take the window's wikilink resolve source (YAZ-2293): a `[[<id>]]` link has no readable
 * text of its own, so without the source a preview would show bare ids where the page shows titles.
 *
 * The page's own "Guide lines", "Folding" (YAZ-4094 G4) and "Bullet threading" (YAZ-4432) go on its `.editor-instance`,
 * as a page's host carries them, and win over the app defaults on `:root` (guideLines.css, bulletThreading.css). Folding is set at mount, from the
 * page's key, else Settings › "Folding default": a preview is read once and never redrawn (C26).
 */
import { useEffect, type RefObject } from 'react'
import type { PageSwitches } from '@shared/pageSwitches'
import { storage } from '../lib/storage'
import { createCrepe } from './createCrepe'
import { CrepeFeature } from './crepe'
import { features } from './featureConfig'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'

/** The page editor's features minus the two that exist to edit blocks. */
const previewFeatures = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

/** A page with no page switch of its own: one object, so the effect below does not run again for it. */
const NO_SWITCHES: PageSwitches = {}

/** Renders `body`, a page's Markdown below its frontmatter, read-only inside `host`; `null` renders nothing. `switches` are the page's own page switches. */
export function useReadOnlyPage(host: RefObject<HTMLElement | null>, body: string | null, wikilinks?: WikilinkResolveSource, switches: PageSwitches = NO_SWITCHES): void {
  useEffect(() => {
    const parent = host.current
    if (body === null || parent === null) return
    // Own wrapper per effect run (StrictMode mounts twice) wearing the page editor's class, so the
    // editor stylesheets apply to the preview unchanged.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    if (switches['guide-lines'] !== undefined) el.dataset.guideLines = switches['guide-lines'] ? 'on' : 'off'
    if (switches.folding !== undefined) el.dataset.folding = switches.folding ? 'on' : 'off'
    if (switches['bullet-threading'] !== undefined) el.dataset.threading = switches['bullet-threading'] ? 'on' : 'off'
    parent.appendChild(el)
    // No `image` options (YAZ-1656): the caller knows the page's path but not the vault root, and a
    // vault-relative src has nothing to resolve against without it — images stay Crepe's stock `<img>`.
    const foldingOn = switches.folding ?? storage.getSettings().foldingOnByDefault
    const crepe = createCrepe({ root: el, defaultValue: body, features: previewFeatures, wikilinks, foldingOn: () => foldingOn })
    const ready = crepe.create().then(() => crepe.setReadonly(true))
    return () => {
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [host, body, wikilinks, switches])
}
