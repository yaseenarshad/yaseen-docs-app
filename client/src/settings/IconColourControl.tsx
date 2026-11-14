/**
 * One kind's icon colour row (YAZ-3440 D4, YAZ-5100 round 2): a colour picker and Reset, which drops the kind's colour.
 * Its own chunk, loaded when Settings shows a colour row: the registry keeps only the row's name, words and when it shows.
 */
import type { SettingsState, SidebarIconKind } from '@shared/types'
import { SIDEBAR_ICON_SWATCHES } from './options'

/** Material's own colour of the kinds whose icon it draws as an image: the swatch while none is picked. */
export const MATERIAL_ICON_SWATCHES: Partial<Record<SidebarIconKind, string>> = { drawing: '#5c6bc0', diagram: '#fb8c00', folder: '#90a4ae' }

/** A colour token of the root in this theme (app.css), or null when it cannot be read as `#rrggbb`. */
function rootColour(name: string): string | null {
  const css = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[0-9a-f]{6}$/i.test(css) ? css : null
}

/**
 * A kind's colour while none is picked, as the icons show it now: Material's own for the kinds it draws as an image, a
 * page's grey with "Colour", else app.css's `--kind-<kind>` in this theme (`.app` carries the picked ones; the root the card's
 * too, but a picked one is the picker's value), else the light theme's.
 */
export function builtInIconColour(kind: SidebarIconKind, settings: SettingsState): string {
  const material = settings.sidebarIconSet === 'material' ? MATERIAL_ICON_SWATCHES[kind] : undefined
  if (material !== undefined) return material
  if (kind === 'page' && settings.sidebarFileIcons !== 'color') return rootColour('--fg-muted') ?? SIDEBAR_ICON_SWATCHES.folder
  return rootColour(`--kind-${kind}`) ?? SIDEBAR_ICON_SWATCHES[kind]
}

export default function IconColourControl({ kind, name, settings, onChange }: { kind: SidebarIconKind; name: string; settings: SettingsState; onChange: (next: SettingsState) => void }) {
  const own = settings.sidebarIconColors[kind]
  const drop = (): SettingsState['sidebarIconColors'] => Object.fromEntries(Object.entries(settings.sidebarIconColors).filter(([k]) => k !== kind))
  return (
    <>
      <input
        type="color"
        className="settings__color"
        aria-label={`${name} icon colour`}
        value={own ?? builtInIconColour(kind, settings)}
        onChange={(e) => onChange({ ...settings, sidebarIconColors: { ...settings.sidebarIconColors, [kind]: e.target.value } })}
      />
      <button type="button" className={`settings__option${own === undefined ? ' settings__option--active' : ''}`} disabled={own === undefined} onClick={() => onChange({ ...settings, sidebarIconColors: drop() })}>
        Reset
      </button>
    </>
  )
}
