import { useState } from 'react'
import { APPEARANCE_OPTIONS, appearance, setAppearance } from './appearance'

/**
 * YAZ-5565: Settings › Appearance, the Mac's Theme row (System, Light, Dark). Saved on this phone; the page, the status
 * bar and the drawings change at once.
 */
export function AppearancePart() {
  const [value, setValue] = useState(appearance)
  return (
    <>
      <h2 className="section">Appearance</h2>
      <div className="sheet" role="radiogroup" aria-label="Theme">
        {APPEARANCE_OPTIONS.map((o) => (
          <label key={o.value} className="row">
            <input
              type="radio"
              className="check"
              name="appearance"
              checked={value === o.value}
              onChange={() => {
                setAppearance(o.value)
                setValue(o.value)
              }}
            />
            <span className="row__main">{o.label}</span>
          </label>
        ))}
      </div>
    </>
  )
}
