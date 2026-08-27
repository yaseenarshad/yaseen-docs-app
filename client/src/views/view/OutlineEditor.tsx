/**
 * THE OUTLINE EDITOR (YAZ-901, 🔒 F3): the folder page's outline view is a SECOND, small Milkdown
 * instance — the note editor's own `createCrepe()`, its outliner plugins (bullet glyphs, Tab /
 * Shift-Tab, guide lines, folding) and its wikilink surfaces (live-preview decorations, the `[[`
 * picker, click navigation) — locked by `editor/outline/bulletsOnly.ts` to a document that is
 * exactly one bullet list. Not one plugin is copied: the reuse IS the feature.
 *
 * SEEDED ONCE, from `markdown` at mount. The seed goes through YAZ-900's grammar
 * (`parseOutline` → `serializeOutline`), which is both the empty state — no bullets means ONE empty
 * bullet, so there is something to click and type into — and the guarantee the lock needs: the
 * initial document cannot be anything but bullets. Each seeded line's text goes in through the
 * grammar's `escapeBlockStart`, so text that merely LOOKS like a block — `1. Title`, `# x` — stays
 * the literal text the grammar promises instead of re-parsing into a node the lock drops (YAZ-964).
 * Later `markdown` props are NOT pushed in; the caller owns the string and remounts (a `key`) when
 * it wants a different document, exactly as the note editor remounts per file.
 *
 * ONCHANGE is the note editor's save idiom minus the disk: Crepe's listener debounces
 * `markdownUpdated` ~200ms, this adds the same 500ms `useAutosave` uses, and the caller owns the
 * settings write. Only real edits are reported — the seed's normalisation on the way through
 * Milkdown (`- ` at four spaces becomes `* ` at two) is not a document change and never fires — and
 * on unmount the pending edit is flushed, so switching views never drops the last keystroke.
 */
import { useEffect, useRef } from 'react'
import { lockToBullets, outlineFeatures } from '../../editor/outline/bulletsOnly'
import { createCrepe } from '../../editor/createCrepe'
import type { WikilinkNav } from '../../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { escapeBlockStart, parseOutline, serializeOutline } from '../outlineDoc'
import '../../editor/outline/bullets.css'
import '../../editor/outline/guideLines.css'
import '../../editor/outline/outlineFolding.css'
import '../../editor/outline/zoom.css'
import './outlineEditor.css'

/** Same interval as `useAutosave`'s `delayMs` — one debounce rhythm across the app. */
const DEBOUNCE_MS = 500

export interface OutlineEditorProps {
  /** The outline document (YAZ-900's `views[i].outline`). Read at MOUNT only; empty seeds one bullet. */
  markdown: string
  /** Debounced serialised markdown after every committed edit; the caller owns the settings write. */
  onChange: (markdown: string) => void
  /** Wikilink resolve source (Links A): App's one per window — the very instance the note editor holds. */
  wikilinks?: WikilinkResolveSource
  /** `[[` picker candidates (Links B): same ownership and feed. */
  wikilinkCandidates?: WikilinkCandidateSource
  /**
   * Wiki-link click navigation (Links C), verbatim the note editor's contract. Absent → links
   * render but clicks stay plain editing. Keep the identity STABLE: a new object remounts the
   * editor, and a remount costs the caret and the undo history.
   */
  nav?: WikilinkNav
}

export function OutlineEditor({ markdown, onChange, wikilinks, wikilinkCandidates, nav }: OutlineEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  // The seed is the FIRST markdown only; later props never reach the mount effect (see the docblock).
  const seedRef = useRef(markdown)
  // Read at emit time so a re-rendered parent's fresh callback lands without remounting the editor.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // Own wrapper per instance (StrictMode mounts twice) wearing the note editor's class, so every
    // outline stylesheet applies unchanged — see outlineEditor.css.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    host.appendChild(el)

    let timer: ReturnType<typeof setTimeout> | null = null
    let pending: string | null = null
    const flush = () => {
      timer = null
      if (pending === null) return
      const md = pending
      pending = null
      onChangeRef.current(md)
    }

    const lines = parseOutline(seedRef.current).map((line) => ({ ...line, text: escapeBlockStart(line.text) }))
    const crepe = createCrepe({
      root: el,
      defaultValue: serializeOutline(lines.length > 0 ? lines : [{ depth: 0, text: '' }]),
      features: outlineFeatures,
      onMarkdownUpdated: (md) => {
        pending = md
        if (timer === null) timer = setTimeout(flush, DEBOUNCE_MS)
      },
      wikilinks,
      wikilinkCandidates,
      wikilinkNav: nav,
    })
    lockToBullets(crepe)

    const ready = crepe.create()

    return () => {
      if (timer !== null) clearTimeout(timer)
      flush()
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [wikilinks, wikilinkCandidates, nav])

  return <div className="view-outline-editor" ref={hostRef} />
}
