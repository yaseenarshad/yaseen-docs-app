/**
 * Settings › This vault › Link pills (YAZ-4924, the redo): ONE row, three parts, saved in the vault
 * (`.yaseendocs/link-pills.json`, `useLinkPills`, `shared/linkPills.ts`).
 *  1. **Format:** a text box with tokens in braces (`{icon}` `{name}` `{id}` `{vault}` `{folder}` `{path}`), draft +
 *     commit on Enter or blur (the pattern of `TimeFormatControl.tsx`): a format the app cannot read (an unknown token,
 *     no `{name}`, too long) keeps the STORED format, marks the box red and says why. The token chips insert at the
 *     caret and keep at once. A dropdown of ready formats beside it. The vault rule (other vaults only · always ·
 *     never) shows only while the format has `{vault}`.
 *  2. **Preview:** a muted "Preview" label and ONE sample pill, "Roadmap" (round 4: the sentence of four read as real
 *     text), drawn by the folder page's pill (`PillEnds`, the same pieces the note's widgets draw) under the look's
 *     variables. The sample note has every part (an ID, a folder, a path, a vault), so each token of the format shows.
 *  3. **Click to style:** a click on a part of a pill (the name, the ID, the vault, the folder, your own text) opens the
 *     style panel under the preview, titled "Styling: the name" (the title is a quiet dropdown: the second way to pick a
 *     part), with three labelled rows — Text (B I U), Colour (ONE row: Accent · Text · Muted, then the ten palette
 *     swatches), Size (Normal · Small) — and a click on the pill's icon the box's: Shape, Fill (Tint · None · the
 *     swatches), Strength (only with a palette fill). Each button writes one field through `withLinkPillPart` /
 *     `withLinkPillBox`, so the file holds only changes.
 * Reset brings today's look back. Every default is today's look.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  DEFAULT_LINK_PILL_FORMAT,
  LINK_PILL_COLORS,
  LINK_PILL_FORMAT_MAX,
  LINK_PILL_PART_DEFAULTS,
  LINK_PILL_READY,
  LINK_PILL_TOKENS,
  isDefaultLinkPills,
  linkPillFormatProblem,
  linkPillFormatTokens,
  parseLinkPillFormat,
  withLinkPillBox,
  withLinkPillPart,
  withLinkPillReady,
  withLinkPills,
  type LinkPillColor,
  type LinkPillPart,
  type LinkPillPartColor,
  type LinkPills,
} from '@shared/linkPills'
import { linkPillVars, pillsShowVault } from '../editor/wikilink/linkPillLook'
import { PillEnds, PillLook } from '../editor/wikilink/LinkPillParts'
import { capital, fillSwatch, textSwatch } from '../editor/table/colours'
import { FileIcon } from '../sidebar/FileIcon'
import { Segmented, Select } from './controls'
import type { Option } from './options'
import type { LinkPillsState } from './useLinkPills'

/** What the toolbar styles: one part, or the box. */
type Target = { kind: 'part'; part: LinkPillPart } | { kind: 'box' }

/** What the panel's title names: "Styling: the name". */
const PART_NAMES: Record<LinkPillPart, string> = { name: 'the name', id: 'the ID', vault: 'the vault', folder: 'the folder', path: 'the path', text: 'your text' }
const BOX_NAME = 'the box'
const VAULT_OPTIONS: readonly Option<'other' | 'always' | 'never'>[] = [
  { label: 'Vault name: other vaults only', value: 'other' },
  { label: 'Vault name: always', value: 'always' },
  { label: 'Vault name: never', value: 'never' },
]
const SIZE_OPTIONS: readonly Option<'normal' | 'small'>[] = [
  { label: 'Normal', value: 'normal' },
  { label: 'Small', value: 'small' },
]
const SHAPE_OPTIONS: readonly Option<'round' | 'square' | 'underline'>[] = [
  { label: 'Round', value: 'round' },
  { label: 'Square', value: 'square' },
  { label: 'Underline', value: 'underline' },
]
const STRENGTH_OPTIONS: readonly Option<'light' | 'medium' | 'strong'>[] = [
  { label: 'Light', value: 'light' },
  { label: 'Medium', value: 'medium' },
  { label: 'Strong', value: 'strong' },
]
/** The ready formats dropdown: a picker, so its own value never changes. */
const READY_PICK = -1
const READY_OPTIONS: readonly Option<number>[] = [{ label: 'Ready formats…', value: READY_PICK }, ...LINK_PILL_READY.map((r, i) => ({ label: r.label, value: i }))]

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

/** A small toggle or pick button of the toolbar. */
function Tool({ label, on, mark, onClick, className = '' }: { label: string; on: boolean; mark: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`settings__option pill-toolbar__item${on ? ' settings__option--active' : ''}${className}`} aria-pressed={on} aria-label={label} title={label} onClick={onClick}>
      {mark}
    </button>
  )
}

/** One row of the panel: its short label on the left, its controls after. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pill-toolbar__row">
      <span className="pill-toolbar__label">{label}</span>
      {children}
    </div>
  )
}

/** The rows of one part: Text (B I U), Colour (one row: the named colours, then the swatches), Size. */
function PartRows({ look, part }: { look: LinkPillsState; part: LinkPillPart }) {
  const { pills, save } = look
  const style = pills.parts?.[part] ?? {}
  const defaults = LINK_PILL_PART_DEFAULTS[part]
  const color: LinkPillPartColor = style.color ?? defaults.color
  const named = (c: LinkPillPartColor) => (c === defaults.color ? undefined : c)
  const toggle = (field: 'bold' | 'italic' | 'underline') => save(withLinkPillPart(pills, part, { [field]: style[field] ? undefined : true }))
  const who = PART_NAMES[part]
  return (
    <>
      <Row label="Text">
        <span className="pill-toolbar__group" role="group" aria-label={`Text (${who})`}>
          <Tool label="Bold" on={style.bold === true} mark="B" className=" pill-toolbar__b" onClick={() => toggle('bold')} />
          <Tool label="Italic" on={style.italic === true} mark="I" className=" pill-toolbar__i" onClick={() => toggle('italic')} />
          <Tool label="Underline" on={style.underline === true} mark="U" className=" pill-toolbar__u" onClick={() => toggle('underline')} />
        </span>
      </Row>
      <Row label="Colour">
        <span className="pill-toolbar__group" role="group" aria-label={`Colour (${who})`}>
          <Tool label="Accent colour" on={color === 'accent'} mark="Accent" onClick={() => save(withLinkPillPart(pills, part, { color: named('accent') }))} />
          <Tool label="Same as text" on={color === 'same'} mark="Text" onClick={() => save(withLinkPillPart(pills, part, { color: named('same') }))} />
          <Tool label="Muted" on={color === 'muted'} mark="Muted" onClick={() => save(withLinkPillPart(pills, part, { color: named('muted') }))} />
          <Swatches label={`Palette (${who})`} value={color === 'accent' || color === 'same' || color === 'muted' ? undefined : color} swatch={textSwatch} onPick={(c) => save(withLinkPillPart(pills, part, { color: named(c) }))} />
        </span>
      </Row>
      <Row label="Size">
        <Segmented options={SIZE_OPTIONS} value={style.size ?? defaults.size} onChange={(size) => save(withLinkPillPart(pills, part, { size: size === defaults.size ? undefined : size }))} ariaLabel={`Size (${who})`} />
      </Row>
    </>
  )
}

/** The box's rows: Shape, Fill (Tint · None · the swatches), Strength (only with a palette fill). */
function BoxRows({ look }: { look: LinkPillsState }) {
  const { pills, save } = look
  const box = pills.box ?? {}
  const fill = box.fill
  return (
    <>
      <Row label="Shape">
        <Segmented options={SHAPE_OPTIONS} value={box.shape ?? 'round'} onChange={(shape: 'round' | 'square' | 'underline') => save(withLinkPillBox(pills, { shape: shape === 'round' ? undefined : shape }))} ariaLabel="Shape" />
      </Row>
      <Row label="Fill">
        <span className="pill-toolbar__group" role="group" aria-label="Fill">
          <Tool label="Accent tint" on={fill === undefined} mark="Tint" onClick={() => save(withLinkPillBox(pills, { fill: undefined, strength: undefined }))} />
          <Tool label="No fill" on={fill === 'none'} mark="None" onClick={() => save(withLinkPillBox(pills, { fill: 'none', strength: undefined }))} />
          <Swatches label="Palette (the box)" value={fill === undefined || fill === 'none' ? undefined : fill} swatch={fillSwatch} onPick={(c) => save(withLinkPillBox(pills, { fill: c }))} />
        </span>
      </Row>
      {fill !== undefined && fill !== 'none' && (
        <Row label="Strength">
          <Segmented options={STRENGTH_OPTIONS} value={box.strength ?? 'medium'} onChange={(strength: 'light' | 'medium' | 'strong') => save(withLinkPillBox(pills, { strength: strength === 'medium' ? undefined : strength }))} ariaLabel="Strength" />
        </Row>
      )}
    </>
  )
}

/** The sample note: every part a format can show, so each token has text on it. */
const SAMPLE = { text: 'Roadmap', path: '/preview/Roadmap.md', info: { id: 'YAS-12', folder: 'Projects/Plans' } }
/** The sample's vault name where the app has none for this vault. */
const SAMPLE_VAULT = 'Wiki'

/** The part a click in the preview lands on, or null: a piece's class names its part; the pill's own span is the name; the icon is the box. */
function targetAt(el: Element): Target | null {
  const hit = el.closest('.link-pill__text, .link-pill__id, .link-pill__vault, .link-pill__folder, .link-pill__path, .file-icon, .link-pill__icon, .wikilink')
  if (hit === null) return null
  if (hit.classList.contains('file-icon') || hit.classList.contains('link-pill__icon')) return { kind: 'box' }
  if (hit.classList.contains('wikilink')) return { kind: 'part', part: 'name' }
  const part = hit.className.replace('link-pill__', '') as LinkPillPart
  return { kind: 'part', part }
}

/** The format's text box: draft + commit, the chips, the ready formats. */
function FormatBox({ look }: { look: LinkPillsState }) {
  const { pills, save } = look
  const format = pills.format ?? DEFAULT_LINK_PILL_FORMAT
  const [draft, setDraft] = useState(format)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  useEffect(() => {
    setDraft(format)
    setProblem(null)
  }, [format])
  // After a chip: the caret after the token it put in.
  useLayoutEffect(() => {
    if (caret.current === null || input.current === null) return
    input.current.focus()
    input.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })
  const commit = (raw: string) => {
    const why = linkPillFormatProblem(raw)
    setProblem(why)
    if (why === null && raw !== format) save(withLinkPills(pills, { format: raw }))
  }
  const insert = (token: string) => {
    const el = input.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? start
    const next = `${draft.slice(0, start)}{${token}}${draft.slice(end)}`
    caret.current = start + token.length + 2
    setDraft(next)
    commit(next)
  }
  return (
    <>
      <span className="settings__style-pick link-pills-format">
        <input
          ref={input}
          type="text"
          className={`settings__input settings__input--fill${problem !== null ? ' settings__input--error' : ''}`}
          aria-label="Link pill format"
          aria-invalid={problem !== null}
          maxLength={LINK_PILL_FORMAT_MAX}
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setProblem(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
          }}
          onBlur={(e) => commit(e.target.value)}
        />
        <Select options={READY_OPTIONS} value={READY_PICK} onChange={(i) => i !== READY_PICK && save(withLinkPillReady(pills, LINK_PILL_READY[i]!))} ariaLabel="Ready formats" />
      </span>
      <span className="settings__options link-pills-chips" role="group" aria-label="Tokens">
        {LINK_PILL_TOKENS.map((token) => (
          <button key={token} type="button" className="settings__option link-pills-chip" aria-label={`Add {${token}}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(token)}>
            {`{${token}}`}
          </button>
        ))}
      </span>
      {problem !== null ? <span className="settings__error settings__error--inline">{problem}</span> : <span className="settings__tokens">Other text shows as you type it. An empty part, like the ID of a note without one, takes its text with it.</span>}
    </>
  )
}

/** The row. `vault`: what the app calls this vault, the sample's vault name. */
export function LinkPillsControl({ look, vault }: { look: LinkPillsState; vault: string | null }) {
  const { pills, save } = look
  const [target, setTarget] = useState<Target | null>(null)
  const format = pills.format ?? DEFAULT_LINK_PILL_FORMAT
  const tokens = linkPillFormatTokens(format)
  // The parts the toolbar can switch to: the name, each token of the format, and your text when the format has some.
  const parts: LinkPillPart[] = ['name', ...(['id', 'vault', 'folder', 'path'] as const).filter((t) => tokens.has(t)), ...(parseLinkPillFormat(format).segments.some((s) => 'text' in s) ? (['text'] as const) : [])]
  const pickOptions: readonly Option<string>[] = [...parts.map((p) => ({ label: PART_NAMES[p], value: p })), { label: BOX_NAME, value: 'box' }]
  const picked = target === null ? 'name' : target.kind === 'box' ? 'box' : target.part
  const pick = (e: MouseEvent<HTMLElement>) => {
    const next = targetAt(e.target as Element)
    if (next !== null) setTarget(next)
  }
  // A part that left the format (its token removed) closes its toolbar.
  const live = target === null || target.kind === 'box' || parts.includes(target.part) ? target : null
  return (
    <div className="link-pills-row">
      <FormatBox look={look} />
      {pillsShowVault(pills) && <Select options={VAULT_OPTIONS} value={pills.vault ?? 'other'} onChange={(rule: 'other' | 'always' | 'never') => save(withLinkPills(pills, { vault: rule === 'other' ? undefined : rule }))} ariaLabel="Vault name on a link pill" />}
      <PillLook.Provider value={{ pills, vault }}>
        {/* The toolbar's own picker is the keyboard's way to a part; the click is the mouse's. */}
        <p className="link-pills-preview" aria-label="Link pills preview" title="Click a part of a pill to style it" style={linkPillVars(pills)} onClick={pick}>
          <span className="link-pills-preview__label">Preview</span>
          {/* The vault's name goes in as the pill's "other vault": `{vault}` then shows it under "other vaults only"
              and "always" alike; "never" still hides it. */}
          <span className="wikilink view-link-pill">
            <PillEnds text={SAMPLE.text} info={SAMPLE.info} otherVault={vault ?? SAMPLE_VAULT} icon={<FileIcon path={SAMPLE.path} />} />
          </span>
        </p>
      </PillLook.Provider>
      {live !== null && (
        <div className="pill-toolbar" role="toolbar" aria-label={`Styling: ${live.kind === 'box' ? BOX_NAME : PART_NAMES[live.part]}`}>
          {/* The title says what the rows style. Its part is a quiet dropdown: the second way to pick (the click in the preview is the first). */}
          <div className="pill-toolbar__head">
            <label className="pill-toolbar__title">
              Styling:
              <Select options={pickOptions} value={picked} onChange={(v) => setTarget(v === 'box' ? { kind: 'box' } : { kind: 'part', part: v as LinkPillPart })} ariaLabel="What to style" />
            </label>
            <button type="button" className="settings__option pill-toolbar__item pill-toolbar__close" aria-label="Close the toolbar" title="Close" onClick={() => setTarget(null)}>
              ×
            </button>
          </div>
          {live.kind === 'box' ? <BoxRows look={look} /> : <PartRows look={look} part={live.part} />}
        </div>
      )}
      {!isDefaultLinkPills(pills) && (
        <span className="settings__options">
          <button type="button" className="settings__option" title="Back to today's look" onClick={() => save({})}>
            Reset
          </button>
        </span>
      )}
    </div>
  )
}
