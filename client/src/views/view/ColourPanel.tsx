import { useContext } from 'react'
import { COLOR_STRENGTHS, HEADER_ROW_CHOICES, type ColorName, type ColorStrength, type ColorStrengthValue } from '@shared/types'
import { capital, headerSwatch } from '../../editor/table/colours'
import { FlyoutParent, MenuFlyout, useFlyout } from '../../components/Flyout'
import { ChoiceSeg } from './settingRow'

/**
 * The colour panel (YAZ-4878, YAZ-4906): the strength switch over the colours, the table menu's "Subheader row › Fill"
 * tab as a React panel. That tab is a DOM menu (`tableRows.ts`), so the View tab, Settings › Folder pages and a card's
 * right-click share THIS one, with the same choices (`HEADER_ROW_CHOICES.color`: Gray … Black), the same swatches
 * (`table-menu-swatch`) and the same strengths (Light, Medium, Strong). A pick keeps the panel open, so the strength and
 * the colour go in one visit, as the header row's flyout does. "No colour" shows when `onNone` is given.
 */
export function ColourPanel({ label, value, onPick, onNone }: { label: string; value: ColorStrengthValue | null; onPick: (next: ColorStrengthValue) => void; onNone?: () => void }) {
  const strength = value?.strength ?? 'medium'
  return (
    <div className="colour-panel" role="group" aria-label={label}>
      <ChoiceSeg<ColorStrength> label={`${label} strength`} value={strength} options={COLOR_STRENGTHS.map((s) => [s, capital(s)] as const)} onChange={(next) => onPick({ color: value?.color ?? 'gray', strength: next })} />
      <ColourSwatches label={`${label} swatches`} colors={HEADER_ROW_CHOICES.color} value={value?.color ?? null} onPick={(color) => onPick({ color: color as ColorName, strength })} />
      {onNone !== undefined && (
        <button type="button" className="colour-panel__none" aria-pressed={value === null} onClick={onNone}>
          No colour
        </button>
      )}
    </div>
  )
}

/** The colours as swatches, one pressed (the View tab's Header row rows, YAZ-4774); a press on the chosen one writes nothing. */
export function ColourSwatches({ label, colors, value, onPick }: { label: string; colors: readonly string[]; value: string | null; onPick: (color: string) => void }) {
  return (
    <div className="view-header-colors" role="group" aria-label={label}>
      {colors.map((c) => (
        <button key={c} type="button" title={capital(c)} aria-label={capital(c)} aria-pressed={value === c} onClick={() => value !== c && onPick(c)}>
          <span className="table-menu-swatch" style={{ background: headerSwatch(c) }} />
        </button>
      ))}
    </div>
  )
}

/** "Colour ›" in a card's right-click menu (YAZ-4906): the panel and "No colour" in the menu's one flyout. */
export function ColourFlyout({ value, onPick }: { value: ColorStrengthValue | null; onPick: (next: ColorStrengthValue | null) => void }) {
  const own = useFlyout<string>()
  const flyout = useContext(MenuFlyout) ?? own
  return (
    <FlyoutParent label="Colour" open={flyout.open === 'colour'} onHover={() => flyout.hover('colour')} onOpen={() => flyout.openNow('colour')} onCloseFlyout={() => flyout.openNow(null)}>
      <div className="ctx-menu__group colour-panel__group" role="group">
        <ColourPanel label="Card colour" value={value} onPick={onPick} onNone={() => onPick(null)} />
      </div>
    </FlyoutParent>
  )
}
