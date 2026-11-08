import './propertyDefinitionEditor.css'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useLiveGapReorder } from '../../lib/useLiveGapReorder'
import { PROPERTY_KINDS, type PropertyDecl, type PropertyKind } from '@shared/types'
import { orderedPropertyOptions, validPropertyOptionSort } from '@shared/propertyOptions'
import { TextField } from './TextField'
import { DragHandleIcon } from './icons'

export const PROPERTY_LABELS: Record<PropertyKind, string> = {
  text: 'Text', number: 'Number', date: 'Date', checkbox: 'Checkbox', list: 'List',
  link: 'Link', 'multi-link': 'Multi-link', select: 'Select', 'multi-select': 'Multi-select',
}
const DESCRIPTIONS: Record<PropertyKind, string> = {
  text: 'Write any text.', number: 'Store a numeric value.', date: 'Choose a calendar date.', checkbox: 'Check or uncheck.',
  list: 'Keep a list of free-form values.', link: 'Link to one page.', 'multi-link': 'Link to multiple pages.',
  select: 'Choose one option.', 'multi-select': 'Choose multiple options.',
}

/** Shared monochrome type symbols for definitions and property rows. */
export function PropertyTypeIcon({ kind }: { kind: PropertyKind }) {
  const symbols: Record<PropertyKind, ReactNode> = {
    text: <path d="M3 4h12M9 4v11M6 15h6" />,
    number: <path d="M7 3 5 15M13 3l-2 12M3 7h12M2 11h12" />,
    date: <><rect x="3" y="4" width="12" height="11" rx="2" /><path d="M6 2v4m6-4v4M3 8h12" /></>,
    checkbox: <><rect x="3" y="3" width="12" height="12" rx="2" /><path d="m6 9 2 2 4-4" /></>,
    list: <><path d="M7 4h8M7 9h8M7 14h8" /><path d="M3 4h.1M3 9h.1M3 14h.1" strokeWidth="2.5" /></>,
    link: <><path d="m7 11 4-4M6 12l-1 1a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0m2 0 1-1a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0" transform="translate(1 -1)" /></>,
    'multi-link': <><path d="M4 6h10M4 10h7M4 14h5" /><path d="m12 12 2 2 3-4" /></>,
    select: <><circle cx="9" cy="9" r="6" /><path d="m6 8 3 3 3-3" /></>,
    'multi-select': <><path d="M3 4h12M3 9h7M3 14h7" /><path d="m12 12 2 2 3-4" /></>,
  }
  return <svg className="property-kind-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{symbols[kind]}</svg>
}

/**
 * The Select / Multi-select OPTIONS editor: the ordered chip list (drag or arrow keys to reorder
 * under manual order), per-option rename/remove, an "Add option" row, the "Add N existing values"
 * import and the order mode. Every change goes out through `onChange` with the whole definition;
 * WHEN that lands is the caller's business — the definition editor collects it into a draft the
 * host saves, the Properties menu's detail panel (YAZ-1513) writes each change immediately.
 * Carved out of `PropertyDefinitionEditor` so both can hold the one implementation.
 */
export function PropertyOptionsEditor({ value, onChange, observed = [], onRename }: {
  value: PropertyDecl; onChange: (next: PropertyDecl) => void; observed?: readonly string[]
  /** A rename that also rewrites the notes holding the option (YAZ-4591 S24): the folder's column editor. Absent: a rename is `onChange`, metadata only. */
  onRename?: (next: PropertyDecl, from: string, to: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const panel = useRef<HTMLElement>(null)
  const options = value.options ?? []
  const displayOptions = orderedPropertyOptions(value) ?? []
  const manual = !value.optionSort || value.optionSort === 'manual'
  const available = [...new Set(observed.filter(option => option.trim() !== '' && !options.includes(option)))]
  const setOptions = (next: string[]) => onChange({ ...value, options: next })
  const closeDetail = () => {
    const label = editing === null ? 'Add option' : `Edit option ${editing}`
    setEditing(null); setAdding(false); setDraft(''); setError('')
    requestAnimationFrame(() => {
      const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      ;(buttons.find(button => button.getAttribute('aria-label') === label) ?? buttons.find(button => button.getAttribute('aria-label') === 'Add option'))?.focus()
    })
  }
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= options.length) return
    const next = [...options]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setOptions(next)
  }
  // The tab bar's drag, down the list (YAZ-4606 D58): the options part live, and the list scrolls at its ends.
  const live = useLiveGapReorder<HTMLDivElement>({ axis: 'y', keys: displayOptions, onMove: move })
  /** This list's drag stops here: the editor may sit inside another drag's surface (a table header). */
  const own = (handled: boolean, event: DragEvent) => { if (handled) event.stopPropagation() }
  const saveOption = () => {
    const next = draft.trim()
    if (!next) { setError('Enter an option name.'); return }
    if (options.some(option => option === next && option !== editing)) { setError('That option already exists.'); return }
    if (editing !== null && editing !== next && onRename) onRename({ ...value, options: options.map(option => option === editing ? next : option) }, editing, next)
    else setOptions(editing === null ? [...options, next] : options.map(option => option === editing ? next : option))
    closeDetail()
  }

  return <section className="property-def__options" aria-label="Property options" ref={panel} onKeyDown={event => {
    if (event.key !== 'Escape' || (editing === null && !adding)) return
    event.stopPropagation()
    closeDetail()
  }}>
    <div className="property-def__section-title"><span>Options</span><select className="property-def__order" aria-label="Option order" value={value.optionSort ?? 'manual'} onChange={event => {
      const optionSort = event.target.value
      if (!validPropertyOptionSort(optionSort)) return
      live.end()
      onChange({ ...value, optionSort })
    }}><option value="manual">Manual order</option><option value="ascending">A–Z</option><option value="descending">Z–A</option></select></div>
    {editing !== null ? <div className="property-def__detail">
      <button type="button" className="property-def__back" onClick={closeDetail}><span aria-hidden="true">‹</span> Options</button>
      <form onSubmit={event => { event.preventDefault(); saveOption() }}>
        <label className="property-def__rename-label">Option name<input autoFocus className="property-def__input" aria-label="Option name" value={draft} onChange={event => { setDraft(event.target.value); setError('') }} /></label>
        <div className="property-def__form-actions"><button type="button" onClick={closeDetail}>Cancel</button><button type="submit" className="property-def__save">Save</button></div>
      </form>
      <button type="button" className="property-def__delete" onClick={() => { setOptions(options.filter(option => option !== editing)); closeDetail() }}>Remove option</button>
      <p className="property-def__hint">{onRename ? 'Renaming this option changes it in every note that holds it. Removing it keeps existing note values.' : 'Renaming or removing this option keeps existing note values.'}</p>
    </div> : <>
      <div className="property-def__option-list" {...live.listProps}
        onDragEnter={event => own(live.over(event), event)} onDragOver={event => own(live.over(event), event)} onDrop={event => own(live.drop(event), event)}>
        {displayOptions.map((option, index) => <div key={option} className="property-def__option" {...live.itemProps(index)}
          data-dragging={live.drag?.from === index || undefined}
          data-insert={live.gap === index ? 'before' : live.gap === options.length && index === options.length - 1 ? 'after' : undefined}>
          {manual && <button type="button" draggable className="property-def__grip" aria-label={`Reorder ${option}`} title="Drag or use arrow keys to reorder" onDragStart={event => {
            event.stopPropagation()
            live.start(event, index)
            if (event.dataTransfer) {
              event.dataTransfer.setData('text/plain', option)
              event.dataTransfer.effectAllowed = 'move'
              const row = event.currentTarget.parentElement!
              const rect = row.getBoundingClientRect()
              event.dataTransfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top)
            }
          }} onDragEnd={live.end} onKeyDown={event => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); move(index, index + (event.key === 'ArrowUp' ? -1 : 1)) }
          }}><DragHandleIcon /></button>}
          <button type="button" className="property-def__option-button" aria-label={`Edit option ${option}`} onClick={() => { setEditing(option); setDraft(option); setError('') ; setAdding(false) }}><span className="property-def__chip">{option}</span><span className="property-def__more" aria-hidden="true">•••</span></button>
          <button type="button" className="property-def__remove" aria-label={`Remove option ${option}`} title="Remove option" onClick={() => setOptions(options.filter(other => other !== option))}><span aria-hidden="true">×</span></button>
        </div>)}
      </div>
      {adding ? <form className="property-def__add-form" onSubmit={event => { event.preventDefault(); saveOption() }}><input autoFocus className="property-def__input" aria-label="New option" placeholder="Option name" value={draft} onChange={event => { setDraft(event.target.value); setError('') }} /><div className="property-def__form-actions"><button type="button" onClick={closeDetail}>Cancel</button><button type="submit" className="property-def__save">Add</button></div></form> : <button type="button" className="property-def__action" aria-label="Add option" onClick={() => { setAdding(true); setDraft(''); setError('') }}><span aria-hidden="true">＋</span> Add option</button>}
      {available.length > 0 && <button type="button" className="property-def__action property-def__import" onClick={() => setOptions([...options, ...available])}><span aria-hidden="true">↳</span> Add {available.length} existing {available.length === 1 ? 'value' : 'values'}</button>}
    </>}
    {error && <p className="property-def__error" role="alert">{error}</p>}
  </section>
}

/** Definition-only edits: the host owns scope, persistence, and all note values. */
export function PropertyDefinitionEditor({ value, onChange, observed = [] }: {
  value: PropertyDecl; onChange: (next: PropertyDecl) => void; observed?: readonly string[]
}) {
  const [choosing, setChoosing] = useState(false)
  const [query, setQuery] = useState('')
  const typeButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const choice = value.kind === 'select' || value.kind === 'multi-select'
  const types = PROPERTY_KINDS.filter(kind => `${PROPERTY_LABELS[kind]} ${DESCRIPTIONS[kind]}`.toLowerCase().includes(query.toLowerCase()))
  const backFromTypes = () => { setChoosing(false); setQuery(''); requestAnimationFrame(() => typeButton.current?.focus()) }

  return <div className="property-def" ref={panel} onKeyDown={event => {
    if (event.key !== 'Escape' || !choosing) return
    event.stopPropagation()
    backFromTypes()
  }}>
    {choosing ? <section className="property-def__picker" aria-label="Property types">
      <button type="button" className="property-def__back" onClick={backFromTypes}><span aria-hidden="true">‹</span> Property type</button>
      <div className="property-def__search"><span aria-hidden="true">⌕</span><input autoFocus aria-label="Search property types" placeholder="Search types…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); panel.current?.querySelector<HTMLButtonElement>('[data-type-option]')?.focus() }
      }} /></div>
      <div className="property-def__type-list">
        {types.map(kind => <button type="button" data-type-option="" key={kind} className="property-def__type-option" aria-pressed={value.kind === kind} onClick={() => {
          onChange({ ...value, kind }); backFromTypes()
        }}><PropertyTypeIcon kind={kind} /><span>{PROPERTY_LABELS[kind]}</span>{value.kind === kind && <span className="property-def__check" aria-hidden="true">✓</span>}</button>)}
        {types.length === 0 && <p className="property-def__empty">No matching types</p>}
      </div>
      <p className="property-def__hint">Changing type keeps existing note values.</p>
    </section> : <>
      <button ref={typeButton} type="button" className="property-def__type-row" aria-label={`Property type: ${PROPERTY_LABELS[value.kind]}`} aria-expanded={false} onClick={() => setChoosing(true)}>
        <span className="property-def__muted">Type</span><span className="property-def__current-type"><PropertyTypeIcon kind={value.kind} />{PROPERTY_LABELS[value.kind]}<span className="property-def__chevron" aria-hidden="true">›</span></span>
      </button>
      {!choice && <p className="property-def__description">{DESCRIPTIONS[value.kind]}</p>}
      {(value.kind === 'link' || value.kind === 'multi-link') && <label className="property-def__target"><span>Link to</span><TextField className="property-def__input" aria-label="Link target" placeholder="Any page, or [[Folder]]" value={value.target ?? ''} onCommit={target => {
        const next = { ...value }
        if (target.trim()) next.target = target.trim(); else delete next.target
        onChange(next)
      }} /></label>}
      {choice && <PropertyOptionsEditor value={value} onChange={onChange} observed={observed} />}
    </>}
  </div>
}
