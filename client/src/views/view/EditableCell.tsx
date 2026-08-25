import { useEffect, useRef, useState } from 'react'
import { matchLinkNames, trailingLinkFragment } from '../../links/completion'
import { type EditorKind } from '../editorType'
import { type Value, fromYaml } from '../expr'
import { writeProperty } from '../writeProperty'
import { cellContent } from './GroupHeader'
import { TextField } from './TextField'

export interface EditableCellProps {
  /** Absolute path of the note this cell belongs to. */
  path: string
  /** Bare frontmatter key (no `note.` prefix), as `writeProperty` wants it. */
  propKey: string
  /** The note's current raw YAML value for `propKey`; undefined when the key is absent. */
  raw: unknown
  /** The engine value, displayed while not editing. */
  value: Value
  /** The inferred editor (`cellEditor`); null renders the plain read-only content. */
  editor: EditorKind | null
  /** Index basenames for the link editor's `[[…]]` completion. */
  basenames: readonly string[]
}

/**
 * One editable property cell (5B, GRO-2142), shared by table cells and card/list property
 * chips: the display (typed like a read-only cell) opens the editor on click — or on Enter,
 * via the host view clicking `[data-edit]` — Enter/blur commit through `writeProperty`, Esc
 * cancels. Commits are optimistic: the committed raw value renders immediately and stays
 * until the index refetch delivers it (`raw` changes); a failed write reverts the cell and
 * shows an inline error. Checkboxes are live and commit on every toggle, no edit mode.
 */
export function EditableCell({ path, propKey, raw, value, editor, basenames }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  /** Committed-but-not-yet-indexed value; cleared when `raw` catches up (or the write fails). */
  const [pending, setPending] = useState<{ v: unknown } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const closedRef = useRef(false)

  // The index refetch after our write delivers the new value; drop the optimistic copy then.
  const rawKey = JSON.stringify(raw ?? null)
  useEffect(() => setPending(null), [rawKey])

  // Closing hands focus back to the table cell (4B nav) or the display button elsewhere.
  useEffect(() => {
    if (!closedRef.current || editing) return
    closedRef.current = false
    const el = wrapRef.current
    ;(el?.closest<HTMLElement>('[data-cell]') ?? el?.querySelector<HTMLElement>('[data-edit]'))?.focus()
  }, [editing])

  if (editor === null) return <>{cellContent(value)}</>

  const current = pending !== null ? pending.v : raw

  const commit = (next: unknown) => {
    if (JSON.stringify(next) === JSON.stringify(raw ?? null)) return
    setError(null)
    setPending({ v: next })
    writeProperty(path, propKey, next).catch((err: unknown) => {
      setPending(null)
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  const close = () => {
    closedRef.current = true
    setEditing(false)
  }

  const failure = error !== null && (
    <span className="view-table__chip view-table__chip--error view-cell-edit__error" role="alert" title={error}>
      Save failed
    </span>
  )

  // Checkboxes toggle in place: no edit mode, every click is one typed commit.
  if (editor === 'checkbox') {
    return (
      <span ref={wrapRef} className="view-cell-edit">
        <input
          type="checkbox"
          data-edit=""
          aria-label={`Edit ${propKey}`}
          checked={current === true}
          onChange={() => commit(current !== true)}
        />
        {failure}
      </span>
    )
  }

  const label = `Edit ${propKey}`
  const text = current === undefined || current === null ? '' : typeof current === 'string' ? current : String(current)

  return (
    <span ref={wrapRef} className="view-cell-edit">
      {!editing ? (
        <>
          <button
            type="button"
            className="view-cell-edit__display"
            data-edit=""
            onClick={() => {
              setError(null)
              setEditing(true)
            }}
          >
            {pending !== null ? cellContent(fromYaml(pending.v)) : cellContent(value)}
          </button>
          {failure}
        </>
      ) : editor === 'list' || editor === 'multi-link' ? (
        <ChipsEditor
          initial={Array.isArray(current) ? current.map(String) : text === '' ? [] : [text]}
          label={label}
          basenames={editor === 'multi-link' ? basenames : undefined}
          onCommit={commit}
          onDone={close}
        />
      ) : editor === 'link' ? (
        <LinkEditor initial={text} basenames={basenames} label={label} onCommit={commit} onDone={close} />
      ) : (
        <TextField
          className="view-input view-cell-edit__input"
          type={editor === 'text' ? undefined : editor}
          inputMode={editor === 'number' ? 'decimal' : undefined}
          autoFocus
          aria-label={label}
          value={editor === 'number' ? (typeof current === 'number' ? String(current) : '') : editor === 'date' ? text.slice(0, 10) : text}
          onCommit={(s) => {
            if (editor === 'number') {
              const n = Number(s)
              if (s.trim() !== '' && Number.isFinite(n)) commit(n)
            } else if (editor === 'date') {
              if (s !== '') commit(s)
            } else {
              commit(s)
            }
          }}
          onDone={close}
        />
      )}
    </span>
  )
}

interface ChipsEditorProps {
  initial: string[]
  label: string
  /** Present for multi-link (5E, GRO-2217): an unclosed trailing `[[fragment` offers these basenames, like LinkEditor. */
  basenames?: readonly string[]
  /** The whole list, once, on commit (Enter with an empty input, or blur out of the editor). */
  onCommit: (next: string[]) => void
  onDone: () => void
}

/**
 * List/tags chip editor: Enter adds the typed chip, empty Enter or blur commits, Esc cancels.
 * An untouched editor (no chip added/removed, no pending text) never commits: the seed
 * stringifies `initial`, so a no-op commit would rewrite a numeric list as strings.
 * With `basenames` (a multi-link relation column) the input completes `[[…]]` exactly like
 * LinkEditor — Enter picks the highlighted suggestion first, then adds the chip.
 */
function ChipsEditor({ initial, label, basenames, onCommit, onDone }: ChipsEditorProps) {
  const [items, setItems] = useState(initial)
  const [text, setText] = useState('')
  const [sel, setSel] = useState(0)
  const done = useRef(false)
  const dirty = useRef(false)

  const fragment = basenames === undefined ? null : trailingLinkFragment(text)
  const matches = fragment === null ? [] : matchLinkNames(basenames ?? [], fragment)

  const change = (next: string[]) => {
    dirty.current = true
    setItems(next)
  }

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit && (dirty.current || text.trim() !== '')) onCommit(text.trim() === '' ? items : [...items, text.trim()])
    onDone()
  }

  const pick = (name: string) => {
    setText(text.replace(/\[\[[^[\]]*$/, `[[${name}]]`))
    setSel(0)
  }

  return (
    <span
      className="view-cell-edit__chips"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          finish(false)
        }
      }}
    >
      {items.map((item, i) => (
        <span key={`${item}:${i}`} className="view-table__chip">
          {item}
          <button
            type="button"
            className="view-cell-edit__chip-x"
            aria-label={`Remove ${item}`}
            onClick={() => change(items.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="view-input view-cell-edit__input"
        autoFocus
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setSel(0)
        }}
        onKeyDown={(e) => {
          if (matches.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((sel + 1) % matches.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((sel + matches.length - 1) % matches.length)
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              pick(matches[sel])
              return
            }
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (text.trim() === '') finish(true)
            else {
              change([...items, text.trim()])
              setText('')
            }
          } else if (e.key === 'Backspace' && text === '' && items.length > 0) {
            change(items.slice(0, -1))
          }
        }}
      />
      {matches.length > 0 && (
        <span className="view-popover view-cell-edit__complete" role="listbox" aria-label={`${label} suggestions`}>
          {matches.map((name, i) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={i === sel}
              className="view-popover__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(name)}
            >
              {name}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

interface LinkEditorProps {
  initial: string
  basenames: readonly string[]
  label: string
  onCommit: (next: string) => void
  onDone: () => void
}

/**
 * Link editor: a text input whose unclosed trailing `[[fragment` offers index basenames
 * (through the shared matcher, `links/completion.ts` — GRO-2191); ArrowUp/Down pick, Enter
 * completes to `[[basename]]` (then Enter again commits the string).
 */
function LinkEditor({ initial, basenames, label, onCommit, onDone }: LinkEditorProps) {
  const [text, setText] = useState(initial)
  const [sel, setSel] = useState(0)
  const done = useRef(false)

  const fragment = trailingLinkFragment(text)
  const matches = fragment === null ? [] : matchLinkNames(basenames, fragment)

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit && text !== initial) onCommit(text)
    onDone()
  }

  const pick = (name: string) => {
    setText(text.replace(/\[\[[^[\]]*$/, `[[${name}]]`))
    setSel(0)
  }

  return (
    <span className="view-cell-edit__link">
      <input
        className="view-input view-cell-edit__input"
        autoFocus
        aria-label={label}
        value={text}
        onChange={(e) => {
          done.current = false
          setText(e.target.value)
          setSel(0)
        }}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            finish(false)
            return
          }
          if (matches.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((sel + 1) % matches.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((sel + matches.length - 1) % matches.length)
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              pick(matches[sel])
              return
            }
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(true)
          }
        }}
      />
      {matches.length > 0 && (
        <span className="view-popover view-cell-edit__complete" role="listbox" aria-label={`${label} suggestions`}>
          {matches.map((name, i) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={i === sel}
              className="view-popover__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(name)}
            >
              {name}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
