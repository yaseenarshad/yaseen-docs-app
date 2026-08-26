/**
 * THE PROPERTIES PANEL (⚡ YAZ-883) — block ONE of the note's own scroller, between the page
 * title (⚡ YAZ-888) and `.editor-mount`. It shows the page's frontmatter as RAW YAML TEXT and
 * writes it back the same way. Typed key/value rows are the next rung (YAZ-884); this one is the
 * escape hatch underneath them, and stays honest by staying literal.
 *
 * 🔒 VERBATIM: a save writes the user's own bytes through `replaceFrontmatter` — never a
 * parse→reformat — so comments, key order and quoting styles survive a round trip. What the panel
 * DOES enforce is that the block still parses: `parseFrontmatter` runs over the candidate content
 * and an `error` BLOCKS the write, because a broken block would corrupt every index that reads it
 * (`shared/frontmatter.ts`'s header). Valid-yet-weird YAML saves untouched.
 *
 * The write is `writeProperty`'s dance (GRO-2141), whole-block instead of one key: read the file
 * FRESH, rewrite, write with `expectedMtime`, and on CONFLICT re-read once and retry — the user's
 * YAML wins over a concurrent edit, whose body is preserved because only the block is rewritten.
 * The page's own open editor absorbs the resulting frontmatter-only `change` silently (GRO-2186),
 * so nothing here talks to the editor at all.
 *
 * The panel owns its ERROR SURFACE: bad YAML, a `FrontmatterWriteError` and a failed bridge call
 * all land on one inline line under the textarea. App's passive notice is for gestures that have
 * no place of their own to speak; this one has one.
 *
 * Open state is session-only component state (BacklinksSection's rule): an open panel is not part
 * of a note's identity and never reaches disk.
 */
import { useState } from 'react'
import { frontmatterInterior, parseFrontmatter, replaceFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import type { FileResponse } from '@shared/types'
import { BridgeRequestError, api } from '../api'

export interface FrontmatterPanelProps {
  /** The open note as the Editor loaded it — the panel's disk truth until its own write moves it. */
  file: Pick<FileResponse, 'path' | 'content' | 'mtime'>
}

/** The interior of a whole file's frontmatter block; '' when the page carries none. */
const interiorOf = (content: string): string => frontmatterInterior(splitFrontmatter(content).frontmatter)

interface Snapshot {
  /** The `file.content` PROP this was last derived from — the re-derive trigger, and nothing else. */
  seen: string
  /** Whole-file bytes the panel believes are on disk; its own write moves this AHEAD of `seen`. */
  content: string
  /** The user's unsaved text; null = clean, i.e. showing `content`'s own interior. */
  draft: string | null
}

export function FrontmatterPanel({ file }: FrontmatterPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [snap, setSnap] = useState<Snapshot>(() => ({ seen: file.content, content: file.content, draft: null }))

  // The file was (re)loaded under us: follow the new bytes, keeping a dirty draft — text the user
  // typed is never thrown away by a load. Compared against the PROP we last saw, so the panel's
  // own write (which runs ahead of it) does not read as an external change and bounce back.
  if (snap.seen !== file.content) setSnap({ seen: file.content, content: file.content, draft: snap.draft })

  const disk = interiorOf(snap.content)
  const text = snap.draft ?? disk
  const dirty = snap.draft !== null && snap.draft !== disk

  const cancel = (): void => {
    setSnap((s) => ({ ...s, draft: null }))
    setError(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const fresh = await api.readFile(file.path)
      const next = replaceFrontmatter(fresh.content, text)
      // Validate what will actually be WRITTEN, fences and all — never a hand-wrapped copy.
      const parsed = parseFrontmatter(splitFrontmatter(next).frontmatter)
      if (parsed.error !== undefined) {
        setError(`Not valid YAML: ${parsed.error}`)
        return
      }
      // Identity never touches disk, same as the editor's autosave and `writeProperty`.
      if (next !== fresh.content) await writeBlock(file.path, next, fresh.mtime, text)
      setSnap((s) => ({ seen: s.seen, content: next, draft: null }))
      setError(null)
    } catch (err) {
      setError(`Could not save the properties: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const { properties, error: parseError } = parseFrontmatter(splitFrontmatter(snap.content).frontmatter)
  const count = parseError === undefined ? Object.keys(properties).length : 0
  const empty = disk === '' && snap.draft === null

  return (
    <section className="frontmatter-panel">
      <button type="button" className="frontmatter-panel__header" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <svg className="frontmatter-panel__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        {/* A page with nothing to show offers the act instead of the noun — one control, not two. */}
        <span className="frontmatter-panel__title">
          {empty ? 'Add properties' : 'Properties'}
          {count > 0 && <span className="frontmatter-panel__count"> ({count})</span>}
        </span>
      </button>
      {expanded && (
        <div className="frontmatter-panel__body">
          <textarea
            className="frontmatter-panel__text"
            aria-label="Properties (YAML)"
            spellCheck={false}
            value={text}
            onChange={(e) => {
              const draft = e.currentTarget.value
              setSnap((s) => ({ ...s, draft }))
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              // The textarea owns Esc while focused: it reverts to disk rather than reaching
              // whatever else in the window listens for it.
              e.preventDefault()
              e.stopPropagation()
              cancel()
            }}
          />
          {error !== null && (
            <p className="frontmatter-panel__error" role="alert">
              {error}
            </p>
          )}
          {dirty && (
            <div className="frontmatter-panel__actions">
              <button type="button" className="frontmatter-panel__btn" disabled={saving} onClick={() => void save()}>
                Save
              </button>
              <button type="button" className="frontmatter-panel__btn" disabled={saving} onClick={cancel}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** `writeProperty`'s CONFLICT dance (GRO-2141), whole-block: retry once over the fresh bytes. */
async function writeBlock(path: string, content: string, expectedMtime: number, yamlText: string): Promise<{ mtime: number }> {
  try {
    return { mtime: (await api.writeFile({ path, content, expectedMtime })).mtime }
  } catch (err) {
    if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT') throw err
    const fresh = await api.readFile(path)
    const merged = replaceFrontmatter(fresh.content, yamlText)
    // A second conflict throws: two racing writers means something else is fighting us.
    return { mtime: (await api.writeFile({ path, content: merged, expectedMtime: fresh.mtime })).mtime }
  }
}
