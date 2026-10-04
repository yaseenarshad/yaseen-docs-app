import { useRef, useState } from 'react'
import type { WikilinkNav } from '../../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { OutlineEditor } from './OutlineEditor'

/**
 * The OUTLINE skin of a folder's views (YAZ-903): ONE free-form markdown bullet list the user
 * types into (`OutlineEditor`, YAZ-901), held as `views[i].outline` (🔒 D2, YAZ-900). It is a plain
 * document and nothing more (YAZ-2290 D5): a link in it is just a link, and says nothing about
 * what the folder holds — its rows are the notecards that live in it.
 */
export interface OutlineViewProps {
  /** The FIRST outline view's stored document, when it has one. */
  outline?: string
  /** The committed document — ONE settings write, through ViewsPane's `update`. */
  onDocument: (markdown: string) => void
  /** The window's link feed (Links A), for the editor's own wikilink surfaces. */
  wikilinks?: WikilinkResolveSource
  /** `[[` picker candidates (Links B): same ownership and feed. */
  wikilinkCandidates?: WikilinkCandidateSource
  /** Wiki-link click navigation (Links C) — assembled by the host, its identity STABLE (YAZ-901). */
  nav?: WikilinkNav
}

/** What the editor's seed guard (YAZ-974) says out loud: read-only, and the file on disk is untouched. */
const SEED_LOSS_MESSAGE =
  'This outline contains a line the editor cannot display safely. The view is read-only and nothing was written — the file is untouched.'

export function OutlineView({ outline, onDocument, wikilinks, wikilinkCandidates, nav }: OutlineViewProps) {
  /** The seed guard fired (YAZ-974): the editor is read-only and says why. */
  const [lossy, setLossy] = useState(false)
  /** The document: seeded from the settings, advanced by every commit and by the disk moving under the open folder (below). */
  const [doc, setDoc] = useState(outline ?? '')
  /** The document as of the LAST commit, readable SYNCHRONOUSLY — `doc` is the render's string and lags a commit by a render. */
  const docRef = useRef(doc)
  // The disk moved under us (YAZ-1356): a prop that is not the last document THIS component wrote
  // is external, and the editor receives it as a diff. Render-phase, the panel's own idiom: an
  // effect would re-run under StrictMode with the prop one render stale and undo an own commit.
  if (outline !== undefined && outline !== docRef.current) {
    docRef.current = outline
    setDoc(outline)
  }

  return (
    <div className="view-outline">
      {lossy && (
        <p className="views-pane__error" role="alert">
          {SEED_LOSS_MESSAGE}
        </p>
      )}
      {/* `markdown` is LIVE (YAZ-1356): a document the editor did not type lands as a diff; its own edits come OUT through onChange. */}
      <OutlineEditor
        markdown={doc}
        onChange={(markdown) => {
          docRef.current = markdown // first: the render-phase check above must read this commit as our own
          onDocument(markdown)
          setDoc(markdown)
        }}
        onSeedLoss={() => setLossy(true)}
        wikilinks={wikilinks}
        wikilinkCandidates={wikilinkCandidates}
        nav={nav}
      />
    </div>
  )
}
