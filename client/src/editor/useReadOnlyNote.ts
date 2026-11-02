/**
 * THE READ-ONLY RENDER OF A NOTE (YAZ-1244), shared by the surfaces that hold a note up without
 * opening it: through `ReadOnlyNote`, the preview panel of the search (YAZ-2662 D5) and the sidebar's
 * hover preview (YAZ-3075 D1), which the folder views also show (YAZ-3403, YAZ-3743).
 *
 * The instance is a real Crepe with BlockEdit and the Toolbar off and no find/drawing/link-click
 * options — the plugins that exist to EDIT are simply never registered — then `setReadonly(true)`.
 * It does take the window's wikilink resolve source (YAZ-2293): a `[[<id>]]` link has no readable
 * text of its own, so without the source a preview would show bare ids where the note shows titles.
 *
 * The note's own "Guide lines" and "Folding" (YAZ-4094 G4) go on its `.editor-instance`, as a note's host
 * carries them, and win over the app defaults on `:root` (guideLines.css). Folding is set at mount, from the
 * note's key, else Settings › "Folding default": a preview is read once and never redrawn (C26).
 */
import { useEffect, type RefObject } from 'react'
import type { PageSwitches } from '@shared/pageSwitches'
import { storage } from '../lib/storage'
import { createCrepe } from './createCrepe'
import { CrepeFeature } from './crepe'
import { features } from './featureConfig'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'

/** The note editor's features minus the two that exist to edit blocks. */
const previewFeatures = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

/** A note with no page switch of its own: one object, so the effect below does not run again for it. */
const NO_SWITCHES: PageSwitches = {}

/** Renders `body`, a note's Markdown below its frontmatter, read-only inside `host`; `null` renders nothing. `switches` are the note's own page switches. */
export function useReadOnlyNote(host: RefObject<HTMLElement | null>, body: string | null, wikilinks?: WikilinkResolveSource, switches: PageSwitches = NO_SWITCHES): void {
  useEffect(() => {
    const parent = host.current
    if (body === null || parent === null) return
    // Own wrapper per effect run (StrictMode mounts twice) wearing the note editor's class, so the
    // editor stylesheets apply to the preview unchanged.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    if (switches['guide-lines'] !== undefined) el.dataset.guideLines = switches['guide-lines'] ? 'on' : 'off'
    if (switches.folding !== undefined) el.dataset.folding = switches.folding ? 'on' : 'off'
    parent.appendChild(el)
    // No `image` options (YAZ-1656): the caller knows the note's path but not the vault root, and a
    // vault-relative src has nothing to resolve against without it — images stay Crepe's stock `<img>`.
    const foldingOn = switches.folding ?? storage.getSettings().foldingOnByDefault
    const crepe = createCrepe({ root: el, defaultValue: body, features: previewFeatures, wikilinks, foldingOn: () => foldingOn })
    const ready = crepe.create().then(() => crepe.setReadonly(true))
    return () => {
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [host, body, wikilinks, switches])
}
