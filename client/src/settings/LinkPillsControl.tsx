/**
 * Settings › Link pills (YAZ-4924): how every link pill of THIS vault looks, saved in the vault
 * (`.yaseendocs/link-pills.json`, `useLinkPills`). The preview at the top draws a sentence with four pills under the
 * look as the rows change it: a note, a board, a pill into another vault and a missing note. Each row writes one field
 * through `withLinkPills`, so the file holds only changes; Plain strips the background, the colour and the icon in one
 * click, and Reset brings today's look back. Every default is today's look.
 */
import { useContext, useEffect, useState } from 'react'
import { LINK_PILL_COLORS, LINK_PILL_QUICK_PICKS, LINK_PILL_TEXT_MAX, isDefaultLinkPills, isPlainLinkPills, plainLinkPills, withLinkPills, type LinkPillColor, type LinkPills } from '@shared/linkPills'
import { linkPillVars, pillParts } from '../editor/wikilink/linkPillLook'
import { PillHead, PillTail } from '../editor/wikilink/LinkPillParts'
import { capital, fillSwatch, textSwatch } from '../editor/table/colours'
import { IconsContext, fileIconAttrs } from '../sidebar/FileIcon'
import { Segmented } from './controls'
import type { Option } from './options'
import type { LinkPillsState } from './useLinkPills'

interface RowProps {
  look: LinkPillsState
}

const ACCENT_NONE_COLOUR: readonly Option<'accent' | 'none' | 'colour'>[] = [
  { label: 'Accent', value: 'accent' },
  { label: 'None', value: 'none' },
  { label: 'Colour', value: 'colour' },
]
const TEXT_OPTIONS: readonly Option<'accent' | 'same' | 'colour'>[] = [
  { label: 'Accent', value: 'accent' },
  { label: 'Same as text', value: 'same' },
  { label: 'Colour', value: 'colour' },
]
const STRENGTH_OPTIONS: readonly Option<'light' | 'medium' | 'strong'>[] = [
  { label: 'Light', value: 'light' },
  { label: 'Medium', value: 'medium' },
  { label: 'Strong', value: 'strong' },
]
const ICON_OPTIONS: readonly Option<'show' | 'hide'>[] = [
  { label: 'Show', value: 'show' },
  { label: 'Hide', value: 'hide' },
]
const VAULT_OPTIONS: readonly Option<'other' | 'always' | 'never'>[] = [
  { label: 'Other vaults only', value: 'other' },
  { label: 'Always', value: 'always' },
  { label: 'Never', value: 'never' },
]
const VAULT_PLACE_OPTIONS: readonly Option<'after' | 'before'>[] = [
  { label: 'After', value: 'after' },
  { label: 'Before', value: 'before' },
]
const ID_OPTIONS: readonly Option<'off' | 'show'>[] = [
  { label: 'Off', value: 'off' },
  { label: 'Show', value: 'show' },
]
const FOLDER_OPTIONS: readonly Option<'off' | 'parent' | 'full'>[] = [
  { label: 'Off', value: 'off' },
  { label: 'Parent folder', value: 'parent' },
  { label: 'Full path', value: 'full' },
]
const SHAPE_OPTIONS: readonly Option<'pill' | 'square' | 'underline'>[] = [
  { label: 'Pill', value: 'pill' },
  { label: 'Square', value: 'square' },
  { label: 'Underline only', value: 'underline' },
]

/** The colour a "Colour" pick starts on. */
const FIRST_COLOUR: LinkPillColor = 'blue'

/** The ten palette swatches as a radio row (the Band colour row's look). */
function Swatches({ label, value, swatch, onPick }: { label: string; value: LinkPillColor | undefined; swatch: (c: LinkPillColor) => string; onPick: (c: LinkPillColor) => void }) {
  return (
    <span className="settings__band-colours" role="radiogroup" aria-label={label}>
      {LINK_PILL_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} title={capital(c)} className="settings__band-colour" onClick={() => onPick(c)}>
          <span className="settings__band-swatch" style={{ background: swatch(c) }} aria-hidden />
        </button>
      ))}
    </span>
  )
}

/** Background: the accent's tint (today), none, or a palette colour with its strength. */
export function PillBackgroundControl({ look }: RowProps) {
  const { pills, save } = look
  const mode = pills.background === undefined ? 'accent' : pills.background === 'none' ? 'none' : 'colour'
  const colour = mode === 'colour' ? (pills.background as LinkPillColor) : undefined
  return (
    <span className="settings__pill-row">
      <Segmented
        options={ACCENT_NONE_COLOUR}
        value={mode}
        onChange={(next) => save(withLinkPills(pills, { background: next === 'accent' ? undefined : next === 'none' ? 'none' : (colour ?? FIRST_COLOUR), ...(next !== 'colour' && { strength: undefined }) }))}
        ariaLabel="Link pill background"
      />
      {mode === 'colour' && (
        <>
          <Swatches label="Background colour" value={colour} swatch={fillSwatch} onPick={(c) => save(withLinkPills(pills, { background: c }))} />
          <Segmented options={STRENGTH_OPTIONS} value={pills.strength ?? 'medium'} onChange={(strength) => save(withLinkPills(pills, { strength: strength === 'medium' ? undefined : strength === 'light' ? 'light' : 'strong' }))} ariaLabel="Background strength" />
        </>
      )}
    </span>
  )
}

/** Text colour: the accent (today), the text around the pill, or a palette colour's text colour. */
export function PillTextControl({ look }: RowProps) {
  const { pills, save } = look
  const mode = pills.text === undefined ? 'accent' : pills.text === 'same' ? 'same' : 'colour'
  const colour = mode === 'colour' ? (pills.text as LinkPillColor) : undefined
  return (
    <span className="settings__pill-row">
      <Segmented options={TEXT_OPTIONS} value={mode} onChange={(next) => save(withLinkPills(pills, { text: next === 'accent' ? undefined : next === 'same' ? 'same' : (colour ?? FIRST_COLOUR) }))} ariaLabel="Link pill text colour" />
      {mode === 'colour' && <Swatches label="Text colour" value={colour} swatch={textSwatch} onPick={(c) => save(withLinkPills(pills, { text: c }))} />}
    </span>
  )
}

export function PillIconControl({ look }: RowProps) {
  const { pills, save } = look
  return <Segmented options={ICON_OPTIONS} value={pills.icon ?? 'show'} onChange={(icon) => save(withLinkPills(pills, { icon: icon === 'show' ? undefined : 'hide' }))} ariaLabel="Link pill icon" />
}

/** Bold · Italic · Underline: three toggles. */
export function PillStyleControl({ look }: RowProps) {
  const { pills, save } = look
  const toggle = (field: 'bold' | 'italic' | 'underline', label: string, mark: string) => (
    <button type="button" className={`settings__option${pills[field] ? ' settings__option--active' : ''}`} aria-pressed={pills[field] === true} aria-label={label} title={label} onClick={() => save(withLinkPills(pills, { [field]: pills[field] ? undefined : true }))}>
      {mark}
    </button>
  )
  return (
    <div className="settings__options settings__pill-style" role="group" aria-label="Link pill style">
      {toggle('bold', 'Bold', 'B')}
      {toggle('italic', 'Italic', 'I')}
      {toggle('underline', 'Underline', 'U')}
    </div>
  )
}

/** One of the Before / After fields: kept on blur or ⏎, up to 8 characters; empty is today's look. */
function PillTextField({ label, value, onKeep }: { label: string; value: string; onKeep: (next: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const keep = () => {
    if (draft !== value) onKeep(draft)
  }
  return (
    <label className="settings__pill-text">
      <span>{label}</span>
      <input className="settings__input settings__pill-input" aria-label={`Text ${label.toLowerCase()} a link pill`} placeholder="None" maxLength={LINK_PILL_TEXT_MAX} spellCheck={false} value={draft}
        onChange={(event) => setDraft(event.target.value)} onBlur={keep}
        onKeyDown={(event) => {
          if (event.key === 'Enter') keep()
        }} />
    </label>
  )
}

/** Before and After: two short fields and the quick picks. */
export function PillBeforeAfterControl({ look }: RowProps) {
  const { pills, save } = look
  const set = (before: string, after: string) => save(withLinkPills(pills, { before: before === '' ? undefined : before, after: after === '' ? undefined : after }))
  return (
    <span className="settings__pill-row">
      <PillTextField label="Before" value={pills.before ?? ''} onKeep={(before) => set(before, pills.after ?? '')} />
      <PillTextField label="After" value={pills.after ?? ''} onKeep={(after) => set(pills.before ?? '', after)} />
      <span className="settings__options" role="group" aria-label="Quick picks">
        {LINK_PILL_QUICK_PICKS.map(([label, before, after]) => (
          <button key={label} type="button" className={`settings__option${(pills.before ?? '') === before && (pills.after ?? '') === after ? ' settings__option--active' : ''}`} aria-label={`Quick pick ${label.trim()}`} onClick={() => set(before, after)}>
            {label}
          </button>
        ))}
      </span>
    </span>
  )
}

/** Vault name: on pills into other vaults only (today), on every pill, or never; after or before the name. */
export function PillVaultControl({ look }: RowProps) {
  const { pills, save } = look
  return (
    <span className="settings__pill-row">
      <Segmented options={VAULT_OPTIONS} value={pills.vault ?? 'other'} onChange={(vault) => save(withLinkPills(pills, { vault: vault === 'other' ? undefined : vault === 'always' ? 'always' : 'never' }))} ariaLabel="Vault name on a link pill" />
      {pills.vault !== 'never' && <Segmented options={VAULT_PLACE_OPTIONS} value={pills.vaultPlace ?? 'after'} onChange={(place) => save(withLinkPills(pills, { vaultPlace: place === 'after' ? undefined : 'before' }))} ariaLabel="Where the vault name goes" />}
    </span>
  )
}

export function PillIdControl({ look }: RowProps) {
  const { pills, save } = look
  return <Segmented options={ID_OPTIONS} value={pills.id ?? 'off'} onChange={(id) => save(withLinkPills(pills, { id: id === 'off' ? undefined : 'show' }))} ariaLabel="ID on a link pill" />
}

export function PillFolderControl({ look }: RowProps) {
  const { pills, save } = look
  return <Segmented options={FOLDER_OPTIONS} value={pills.folder ?? 'off'} onChange={(folder) => save(withLinkPills(pills, { folder: folder === 'off' ? undefined : folder === 'parent' ? 'parent' : 'full' }))} ariaLabel="Folder on a link pill" />
}

export function PillShapeControl({ look }: RowProps) {
  const { pills, save } = look
  return <Segmented options={SHAPE_OPTIONS} value={pills.shape ?? 'pill'} onChange={(shape) => save(withLinkPills(pills, { shape: shape === 'pill' ? undefined : shape === 'square' ? 'square' : 'underline' }))} ariaLabel="Link pill shape" />
}

/** One pill of the preview: the editor's classes and icon attributes, and the pieces the look adds. */
function PreviewPill({ pills, vault, text, path, otherVault = null, info, missing = false }: { pills: LinkPills; vault: string | null; text: string; path?: string; otherVault?: string | null; info?: { id?: string; folder: string }; missing?: boolean }) {
  const icons = useContext(IconsContext)
  const { head, tail } = pillParts(pills, { info, otherVault }, vault)
  const ends = (
    <>
      {head !== null && <PillHead head={head} />}
      {text}
      {tail !== null && <PillTail tail={tail} />}
    </>
  )
  if (missing || path === undefined)
    return (
      <span className="wikilink wikilink--unresolved" title="A link to a note that does not exist yet">
        {ends}
      </span>
    )
  const { style, ...attrs } = fileIconAttrs(icons, path, false)
  return (
    <span {...attrs} style={style} className="wikilink file-icon file-icon--file">
      {ends}
    </span>
  )
}

/**
 * The live preview, with Plain and Reset. `vault`: what the app calls this vault, for "Always"; `ids`: whether the
 * vault gives its notes IDs, so the note pill can show one.
 */
export function LinkPillsPreview({ look, vault, ids }: RowProps & { vault: string | null; ids: boolean }) {
  const { pills, save } = look
  const plain = isPlainLinkPills(pills)
  return (
    <div className="link-pills-preview-row">
      <p className="link-pills-preview" aria-label="Link pills preview" style={linkPillVars(pills)}>
        Read the <PreviewPill pills={pills} vault={vault} text="Roadmap" path="/preview/Roadmap.md" info={ids ? { id: 'YAS-12', folder: 'Projects/Plans' } : { folder: 'Projects/Plans' }} /> note, the{' '}
        <PreviewPill pills={pills} vault={vault} text="Q3 plan" path="/preview/Q3 plan.excalidraw" info={{ folder: 'Boards' }} /> board, and{' '}
        <PreviewPill pills={pills} vault={vault} text="Budget" path="/preview/Budget.md" otherVault="Wiki" /> in another vault. <PreviewPill pills={pills} vault={vault} text="Old plan" missing /> has no note yet.
      </p>
      <span className="settings__options" role="group" aria-label="Link pills quick buttons">
        <button type="button" className={`settings__option${plain ? ' settings__option--active' : ''}`} aria-pressed={plain} title="No background, the text's colour, no icon" onClick={() => save(plain ? withLinkPills(pills, { background: undefined, strength: undefined, text: undefined, icon: undefined }) : plainLinkPills(pills))}>
          Plain
        </button>
        {!isDefaultLinkPills(pills) && (
          <button type="button" className="settings__option" title="Back to today's look" onClick={() => save({})}>
            Reset
          </button>
        )}
      </span>
    </div>
  )
}
