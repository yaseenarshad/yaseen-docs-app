import { useState, type ReactNode } from 'react'
import type { Appearance } from '../store/appearancePref'
import { APPEARANCE_OPTIONS, appearance, setAppearance } from './appearance'
import { Segmented } from './Segmented'

/** YAZ-5667: each choice's icon (the app's icon set has no sun or moon): a half-filled circle, a sun, a moon. */
const ICONS: Record<Appearance, ReactNode> = {
  system: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 0 0 14z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 1.75v2M10 16.25v2M1.75 10h2M16.25 10h2M4.17 4.17l1.41 1.41M14.42 14.42l1.41 1.41M4.17 15.83l1.41-1.41M14.42 5.58l1.41-1.41" />
    </>
  ),
  dark: <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z" />,
}

const SEGMENTS = APPEARANCE_OPTIONS.map((o) => ({ ...o, icon: ICONS[o.value] }))

/**
 * YAZ-5565: Settings › Appearance, the Mac's Theme row (System, Light, Dark). Saved on this phone; the page, the status
 * bar and the drawings change at once. YAZ-5667: one segmented row, an icon over each word (about 56 px, was 140).
 */
export function AppearancePart() {
  const [value, setValue] = useState(appearance)
  return (
    <>
      <h2 className="section">Appearance</h2>
      <Segmented
        label="Theme"
        name="appearance"
        options={SEGMENTS}
        value={value}
        onChoose={(next) => {
          setAppearance(next)
          setValue(next)
        }}
      />
    </>
  )
}
