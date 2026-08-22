/**
 * The React half of a `base` code block (6B, GRO-2146), portalled into the node view's slot by
 * `CrepeHost`. The YAML arrives as a prop (the block's own text — nothing to resolve or read),
 * parses through the 1B `.base` parser and renders the read-only `<BaseView>` (view switcher
 * only, like 6A's embeds). The toggle flips to the raw-YAML editing surface: a textarea whose
 * every change commits through `onCommit` (the node view's transaction → markdownUpdated →
 * autosave, so a file switch mid-edit never loses text); toggling back re-parses and re-renders.
 * Invalid YAML or an invalid base definition shows the error inline — the toggle (and the raw
 * text) stays reachable, never a crash, never data loss. `this` = the CONTAINING note:
 * `thisFile` is the note's path, so `file.hasLink(this)` filters from the note the block sits in.
 */
import { useState } from 'react'
import { BaseParseError, parseBase, type ParsedBase } from '../../bases/baseFile'
import { BaseView } from '../../bases/BaseView'
import { useIndex } from '../../bases/useIndex'
import type { WatchSource } from '../../hooks/useWatch'
import '../../bases/bases.css'

export interface BaseCodeBlockProps {
  root: string
  watch: WatchSource
  /** Absolute path of the note the block sits in; `this` in the block's expressions. */
  thisFile: string
  /** The block's exact text (the YAML between the fences). */
  text: string
  /** Replace the block's text (the slot's normal-markdown write path). */
  onCommit: (text: string) => void
  onOpenFile: (path: string) => void
}

type Parsed = { ok: true; parsed: ParsedBase } | { ok: false; message: string }

function tryParse(text: string): Parsed {
  try {
    return { ok: true, parsed: parseBase(text) }
  } catch (err) {
    if (err instanceof BaseParseError) return { ok: false, message: err.message.split('\n')[0] ?? err.message }
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function BaseCodeBlock({ root, watch, thisFile, text, onCommit, onOpenFile }: BaseCodeBlockProps) {
  const index = useIndex(root, watch)
  /** Transient view state only (hard constraint: never persisted). */
  const [editing, setEditing] = useState(false)
  const parsed = editing ? null : tryParse(text)

  return (
    <>
      <div className="base-code-block__bar">
        <span className="base-code-block__lang">base</span>
        <button
          type="button"
          className="base-code-block__toggle"
          aria-pressed={editing}
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? 'Preview' : 'Edit YAML'}
        </button>
      </div>
      {editing ? (
        <textarea
          className="base-code-block__source"
          aria-label="Base YAML source"
          value={text}
          spellCheck={false}
          onChange={(e) => onCommit(e.target.value)}
        />
      ) : parsed?.ok === true ? (
        <BaseView
          parsed={parsed.parsed}
          onChange={() => {}}
          readOnly
          root={root}
          thisFile={thisFile}
          records={index.records}
          indexStatus={index.status}
          indexError={index.error ?? undefined}
          types={index.types}
          onOpenFile={onOpenFile}
        />
      ) : (
        <p className="base-code-block__error" role="alert">
          Invalid base: {parsed?.message}
        </p>
      )}
    </>
  )
}
