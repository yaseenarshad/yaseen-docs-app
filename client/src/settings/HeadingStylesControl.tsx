/**
 * Settings › Appearance › Headings (YAZ-3050 D6): one line for each heading level, H1 to H6, all six
 * in view, so the reader sees the whole ladder of sizes at one time. Every change writes the whole
 * settings object with only `headingStyles` changed, through `withHeadingStyle` /
 * `withoutHeadingStyle`, which keep the map to what the reader changed (D1).
 */
import { HEADING_HIGHLIGHTS, HEADING_KEYS, HEADING_SIZE_MAX, HEADING_SIZE_MIN, type HeadingHighlight, type HeadingKey, type HeadingStyles, type SettingsState } from '@shared/types'
import type { CSSProperties } from 'react'
import { HEADING_DEFAULT_SIZES, HEADING_DEFAULT_WEIGHTS, HEADING_HIGHLIGHT_VARS, isChanged, withHeadingStyle, withoutHeadingStyle } from './headingStyles'

/** The name's largest size in the dialog: larger sizes would push the controls onto a second line. */
const NAME_MAX_PX = 24

const HIGHLIGHT_NAMES: Readonly<Record<HeadingHighlight, string>> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' }

interface Props {
  settings: SettingsState
  onChange: (next: SettingsState) => void
}

export function HeadingStylesControl({ settings, onChange }: Props) {
  const styles = settings.headingStyles
  const write = (headingStyles: HeadingStyles) => onChange({ ...settings, headingStyles })
  return (
    <div className="heading-styles">
      {HEADING_KEYS.map((key) => (
        <HeadingLine key={key} level={key} styles={styles} write={write} />
      ))}
    </div>
  )
}

function HeadingLine({ level, styles, write }: { level: HeadingKey; styles: HeadingStyles; write: (next: HeadingStyles) => void }) {
  const style = styles[level]
  const n = level.slice(1)
  const size = style?.size ?? HEADING_DEFAULT_SIZES[level]
  const bold = style?.bold !== false
  const underline = style?.underline === true
  const highlight = style?.highlight
  const step = (delta: number) => write(withHeadingStyle(styles, level, { size: Math.min(HEADING_SIZE_MAX, Math.max(HEADING_SIZE_MIN, size + delta)) }))
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
      <div className="heading-styles__stepper" role="group" aria-label={`Heading ${n} size`}>
        <button type="button" className="settings__option heading-styles__step" aria-label={`Heading ${n} smaller`} disabled={size <= HEADING_SIZE_MIN} onClick={() => step(-1)}>
          −
        </button>
        <span className="heading-styles__size">{size} px</span>
        <button type="button" className="settings__option heading-styles__step" aria-label={`Heading ${n} larger`} disabled={size >= HEADING_SIZE_MAX} onClick={() => step(1)}>
          +
        </button>
      </div>
      <div className="settings__options">
        <button
          type="button"
          className={`settings__option heading-styles__switch heading-styles__switch--bold${bold ? ' settings__option--active' : ''}`}
          aria-label={`Heading ${n} bold`}
          aria-pressed={bold}
          onClick={() => write(withHeadingStyle(styles, level, { bold: !bold }))}
        >
          B
        </button>
        <button
          type="button"
          className={`settings__option heading-styles__switch heading-styles__switch--underline${underline ? ' settings__option--active' : ''}`}
          aria-label={`Heading ${n} underline`}
          aria-pressed={underline}
          onClick={() => write(withHeadingStyle(styles, level, { underline: !underline }))}
        >
          U
        </button>
      </div>
      <div className="heading-styles__dots" role="group" aria-label={`Heading ${n} highlight`}>
        <button type="button" className="heading-styles__dot heading-styles__dot--none" aria-label="No highlight" aria-pressed={highlight === undefined} onClick={() => write(withHeadingStyle(styles, level, { highlight: undefined }))} />
        {HEADING_HIGHLIGHTS.map((colour) => (
          <button
            key={colour}
            type="button"
            className="heading-styles__dot"
            style={{ backgroundColor: HEADING_HIGHLIGHT_VARS[colour] }}
            aria-label={HIGHLIGHT_NAMES[colour]}
            aria-pressed={highlight === colour}
            onClick={() => write(withHeadingStyle(styles, level, { highlight: colour }))}
          />
        ))}
      </div>
      {/* The slot keeps its width when Reset is not there, so the controls of the six lines stay in columns. */}
      <span className="heading-styles__reset">
        {isChanged(style) && (
          <button type="button" className="settings__option" aria-label={`Reset heading ${n}`} onClick={() => write(withoutHeadingStyle(styles, level))}>
            Reset
          </button>
        )}
      </span>
    </div>
  )
}
