/**
 * Settings › Appearance › Text formatting (YAZ-3068; D14, D15, D16 on YAZ-3048; the heading lines
 * are YAZ-3050 D6). It changes ONE vault's `.yaseendocs/text-formatting.json` through that vault's
 * `useTextFormatting`, never the app-wide settings.
 *
 * - A "Vault" dropdown above the lines when the window has two or more vaults (D15). It starts on
 *   the active tab's vault each time Settings opens (the dialog mounts this anew on each open), and
 *   falls back to the first vault when the chosen one leaves the window.
 * - A "Text" line (D14): the size of normal text, 12 to 24 px, "Reset" when it is not 16.
 * - One line for each heading level, H1 to H6, all six in view. A level with no size of its own
 *   shows its size at the vault's Text size (D17). `withHeadingStyle` / `withoutHeadingStyle` keep
 *   the file to what the reader changed (D1).
 * - A "Line" line below Heading 6 (YAZ-3208, 🔒 D10): the vault's default line — a preview, the
 *   darkness (steps of 5%, 5–100), the thickness (steps of 1px, 1–24) and the style (Solid, Dotted,
 *   Dashed). `withLineDefaults` keeps only the fields that differ from the app's 50%, 3px, solid;
 *   "Reset" removes the `line` key. Plain lines in every note of the vault follow it (D8).
 */
import { useState, type CSSProperties } from 'react'
import { TEXT_DEFAULT_SIZE, TEXT_SIZE_MAX, TEXT_SIZE_MIN, type TextFormatting } from '@shared/textFormatting'
import { DARKNESS_MAX, DARKNESS_MIN, THICKNESS_MAX, THICKNESS_MIN } from '@shared/line'
import { HEADING_HIGHLIGHTS, HEADING_KEYS, HEADING_SIZE_MAX, HEADING_SIZE_MIN, type HeadingHighlight, type HeadingKey } from '@shared/types'
import { Select } from './controls'
import { defaultHeadingSize, HEADING_DEFAULT_WEIGHTS, HEADING_HIGHLIGHT_VARS, isChanged, lineDefaultsOf, withHeadingStyle, withLineDefaults, withoutHeadingStyle } from './headingStyles'
import type { TextFormattingState } from './useTextFormatting'

/** The name's largest size in the dialog: larger sizes would push the controls onto a second line. */
const NAME_MAX_PX = 24

const HIGHLIGHT_NAMES: Readonly<Record<HeadingHighlight, string>> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' }

/** One vault of the window, as App hands it over: its root, the name the app calls it (its folder name when it has none), and its formatting. */
export interface TextFormattingVault {
  root: string
  name: string
  state: TextFormattingState
}

interface Props {
  /** The window's vaults, in the window's order; never empty (the row is there only with a vault). */
  vaults: readonly TextFormattingVault[]
  /** The active tab's vault: where the dropdown starts. */
  initialRoot: string
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

export function TextFormattingControl({ vaults, initialRoot }: Props) {
  const [chosen, setChosen] = useState(initialRoot)
  const vault = vaults.find((v) => v.root === chosen) ?? vaults[0]
  const { formatting, save } = vault.state
  const textSize = formatting.text?.size ?? TEXT_DEFAULT_SIZE
  return (
    <div className="text-formatting">
      {vaults.length > 1 && (
        <div className="text-formatting__vault">
          <span className="text-formatting__vault-label">Vault</span>
          <Select options={vaults.map((v) => ({ label: v.name, value: v.root }))} value={vault.root} onChange={setChosen} ariaLabel="Vault" />
        </div>
      )}
      <div className="heading-styles">
        <TextLine formatting={formatting} write={save} />
        {HEADING_KEYS.map((key) => (
          <HeadingLine key={key} level={key} formatting={formatting} textSize={textSize} write={save} />
        ))}
      </div>
      {/* Its own row, not a line of the grid above: its controls are wider than one column, and a
          spanning item would widen the grid's columns and squeeze the seven names (YAZ-3213). */}
      <LineDefaultsLine formatting={formatting} write={save} />
    </div>
  )
}

/** The size buttons of a line: "−", the size with its unit ("16 px", or "50%" for the line's darkness), "+". */
function Stepper({ name, size, min, max, unit = 'px', onStep }: { name: string; size: number; min: number; max: number; unit?: 'px' | '%'; onStep: (delta: number) => void }) {
  return (
    <div className="heading-styles__stepper" role="group" aria-label={`${name} size`}>
      <button type="button" className="settings__option heading-styles__step" aria-label={`${name} smaller`} disabled={size <= min} onClick={() => onStep(-1)}>
        −
      </button>
      <span className="heading-styles__size">{unit === '%' ? `${size}%` : `${size} px`}</span>
      <button type="button" className="settings__option heading-styles__step" aria-label={`${name} larger`} disabled={size >= max} onClick={() => onStep(1)}>
        +
      </button>
    </div>
  )
}

/** The slot keeps its width when Reset is not there, so the controls of the seven lines stay in columns. */
function ResetSlot({ shown, label, onReset }: { shown: boolean; label: string; onReset: () => void }) {
  return (
    <span className="heading-styles__reset">
      {shown && (
        <button type="button" className="settings__option" aria-label={label} onClick={onReset}>
          Reset
        </button>
      )}
    </span>
  )
}

/** The Text line (D14): size only. 16 is the app's look, so a step back to 16 removes `text`, as "Reset" does. */
function TextLine({ formatting, write }: { formatting: TextFormatting; write: (next: TextFormatting) => void }) {
  const size = formatting.text?.size ?? TEXT_DEFAULT_SIZE
  const { text: _text, ...withoutText } = formatting
  const set = (next: number) => write(next === TEXT_DEFAULT_SIZE ? withoutText : { ...formatting, text: { size: next } })
  return (
    <div className="heading-styles__line" data-level="text">
      <span className="heading-styles__label">
        {/* 24 px at most (TEXT_SIZE_MAX), so the name needs no cap. */}
        <span className="heading-styles__name" style={{ fontSize: `${size}px` }}>
          Text
        </span>
      </span>
      <Stepper name="Text" size={size} min={TEXT_SIZE_MIN} max={TEXT_SIZE_MAX} onStep={(delta) => set(clamp(size + delta, TEXT_SIZE_MIN, TEXT_SIZE_MAX))} />
      {/* No bold, underline or highlight for all text (D14). Reset still takes the last column (settings.css). */}
      <ResetSlot shown={size !== TEXT_DEFAULT_SIZE} label="Reset text" onReset={() => write(withoutText)} />
    </div>
  )
}

function HeadingLine({ level, formatting, textSize, write }: { level: HeadingKey; formatting: TextFormatting; textSize: number; write: (next: TextFormatting) => void }) {
  const style = formatting[level]
  const n = level.slice(1)
  const size = style?.size ?? defaultHeadingSize(level, textSize)
  const bold = style?.bold !== false
  const underline = style?.underline === true
  const highlight = style?.highlight
  const look: CSSProperties = {
    fontSize: `${Math.min(size, NAME_MAX_PX)}px`,
    fontWeight: bold ? HEADING_DEFAULT_WEIGHTS[level] : 400,
    textDecoration: underline ? 'underline' : 'none',
    ...(highlight !== undefined && { backgroundColor: HEADING_HIGHLIGHT_VARS[highlight], boxShadow: `0 0 0 3px ${HEADING_HIGHLIGHT_VARS[highlight]}` }),
  }
  return (
    <div className="heading-styles__line" data-level={level}>
      <span className="heading-styles__label">
        <span className="heading-styles__name" style={look}>
          Heading {n}
        </span>
      </span>
      <Stepper name={`Heading ${n}`} size={size} min={HEADING_SIZE_MIN} max={HEADING_SIZE_MAX} onStep={(delta) => write(withHeadingStyle(formatting, level, { size: clamp(size + delta, HEADING_SIZE_MIN, HEADING_SIZE_MAX) }))} />
      <div className="settings__options">
        <button
          type="button"
          className={`settings__option heading-styles__switch heading-styles__switch--bold${bold ? ' settings__option--active' : ''}`}
          aria-label={`Heading ${n} bold`}
          aria-pressed={bold}
          onClick={() => write(withHeadingStyle(formatting, level, { bold: !bold }))}
        >
          B
        </button>
        <button
          type="button"
          className={`settings__option heading-styles__switch heading-styles__switch--underline${underline ? ' settings__option--active' : ''}`}
          aria-label={`Heading ${n} underline`}
          aria-pressed={underline}
          onClick={() => write(withHeadingStyle(formatting, level, { underline: !underline }))}
        >
          U
        </button>
      </div>
      <div className="heading-styles__dots" role="group" aria-label={`Heading ${n} highlight`}>
        <button type="button" className="heading-styles__dot heading-styles__dot--none" aria-label="No highlight" aria-pressed={highlight === undefined} onClick={() => write(withHeadingStyle(formatting, level, { highlight: undefined }))} />
        {HEADING_HIGHLIGHTS.map((colour) => (
          <button
            key={colour}
            type="button"
            className="heading-styles__dot"
            style={{ backgroundColor: HEADING_HIGHLIGHT_VARS[colour] }}
            aria-label={HIGHLIGHT_NAMES[colour]}
            aria-pressed={highlight === colour}
            onClick={() => write(withHeadingStyle(formatting, level, { highlight: colour }))}
          />
        ))}
      </div>
      <ResetSlot shown={isChanged(style)} label={`Reset heading ${n}`} onReset={() => write(withoutHeadingStyle(formatting, level))} />
    </div>
  )
}

const LINE_STYLES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'dashed', label: 'Dashed' },
] as const

/** A step of `step` on the grid of `step`, so a hand-written 52 steps to 55 or 50. */
const onGrid = (value: number, direction: number, step: number): number =>
  direction > 0 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step

/** The Line line (YAZ-3208 D10): the vault's default line. */
function LineDefaultsLine({ formatting, write }: { formatting: TextFormatting; write: (next: TextFormatting) => void }) {
  const line = lineDefaultsOf(formatting.line)
  const { line: _line, ...withoutLine } = formatting
  const preview = {
    '--preview-darkness': `${line.darkness}%`,
    '--preview-thickness': `${line.thickness}px`,
  } as CSSProperties
  return (
    <div className="line-defaults" data-level="line">
      <span className="line-defaults__label">
        <span className="heading-styles__name">Line</span>
        <span className={`heading-styles__line-preview heading-styles__line-preview--${line.pattern}`} style={preview} aria-hidden="true" />
      </span>
      <div className="line-defaults__controls">
        <Stepper name="Line darkness" size={line.darkness} min={DARKNESS_MIN} max={DARKNESS_MAX} unit="%"
          onStep={(delta) => write(withLineDefaults(formatting, { darkness: clamp(onGrid(line.darkness, delta, 5), DARKNESS_MIN, DARKNESS_MAX) }))} />
        <Stepper name="Line thickness" size={line.thickness} min={THICKNESS_MIN} max={THICKNESS_MAX}
          onStep={(delta) => write(withLineDefaults(formatting, { thickness: clamp(line.thickness + delta, THICKNESS_MIN, THICKNESS_MAX) }))} />
        <div className="settings__options" role="group" aria-label="Line style">
          {LINE_STYLES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`settings__option${line.pattern === value ? ' settings__option--active' : ''}`}
              aria-pressed={line.pattern === value}
              onClick={() => write(withLineDefaults(formatting, { pattern: value }))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ResetSlot shown={formatting.line !== undefined} label="Reset line" onReset={() => write(withoutLine)} />
    </div>
  )
}
