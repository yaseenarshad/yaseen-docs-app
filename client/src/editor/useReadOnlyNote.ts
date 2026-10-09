/**
 * THE READ-ONLY RENDER OF A NOTE (YAZ-1244), shared by the two surfaces that hold a note up without
 * opening it: the hover card of Table and Board, and the preview panel of the search (YAZ-2662 D5).
 *
 * The instance is a real Crepe with BlockEdit and the Toolbar off and no find/drawing/link-click
 * options — the plugins that exist to EDIT are simply never registered — then `setReadonly(true)`.
 * It does take the window's wikilink resolve source (YAZ-2293): a `[[<id>]]` link has no readable
 * text of its own, so without the source a preview would show bare ids where the note shows titles.
 */
import { useEffect, type RefObject } from 'react'
import { createCrepe } from './createCrepe'
import { CrepeFeature } from './crepe'
import { features } from './featureConfig'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'

/** The note editor's features minus the two that exist to edit blocks. */
const previewFeatures = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

/** Renders `body`, a note's Markdown below its frontmatter, read-only inside `host`; `null` renders nothing. */
export function useReadOnlyNote(host: RefObject<HTMLElement | null>, body: string | null, wikilinks?: WikilinkResolveSource): void {
  useEffect(() => {
    const parent = host.current
    if (body === null || parent === null) return
    // Own wrapper per effect run (StrictMode mounts twice) wearing the note editor's class, so the
    // editor stylesheets apply to the preview unchanged.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    parent.appendChild(el)
    // No `image` options (YAZ-1656): the caller knows the note's path but not the vault root, and a
    // vault-relative src has nothing to resolve against without it — images stay Crepe's stock `<img>`.
    const crepe = createCrepe({ root: el, defaultValue: body, features: previewFeatures, wikilinks })
    const ready = crepe.create().then(() => crepe.setReadonly(true))
    return () => {
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [host, body, wikilinks])
}
