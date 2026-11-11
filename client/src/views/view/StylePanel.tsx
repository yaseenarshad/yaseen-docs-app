import { type CSSProperties, type ReactNode, useContext, useState } from 'react'
import { HEADER_ROW_CHOICES, headerRowLabel } from '@shared/types'
import { capital, headerSwatch } from '../../editor/table/colours'
import { FlyoutParent, MenuFlyout, useFlyout } from '../../components/Flyout'
import { Dropdown } from './Dropdown'

/**
 * The style panel (YAZ-4864 round 3; Yaseen: "should it be something like the right click one?"): the table's
 * "Header row ›" panel (`tableRows.ts` `headerRowParent`, drawn by `blockHandleMenu.ts` `fillFlyout`) as ONE React
 * panel with its classes: "Plain …" on top, the Fill · Text · Style tabs (`fill-target`), the Off · Light · Medium ·
 * Strong switch (`fill-target--sub`), rows with swatches and a ✓ at what shows. Style holds Weight, and Align when
 * `shown.align` is given. It serves the View tab's "Style [Aa ▾]" (Table and Calendar), the calendar day names'
 * right-click, a card's "Card style ›" and Settings › Tables. A pick keeps it open.
 */
export interface StyleShown {
  strength: string
  color: string | null
  text: string | null
  weight: string | null
  /** Absent: no Align (a card). */
  align?: string | null
}
export type StylePart = 'strength' | 'color' | 'text' | 'weight' | 'align'
export interface StylePanelProps {
  shown: StyleShown
  plainLabel: string
  plainOn: boolean
  onPlain: () => void
  onPick: (part: StylePart, value: string) => void
}

type Tab = 'fill' | 'text' | 'style'
const TABS: readonly (readonly [Tab, string])[] = [['fill', 'Fill'], ['text', 'Text'], ['style', 'Style']]

export function StylePanel({ shown, plainLabel, plainOn, onPlain, onPick }: StylePanelProps) {
  const [tab, setTab] = useState<Tab>('fill')
  const item = (label: string, on: boolean, run: () => void, swatch?: string) => (
    <button key={label} type="button" role="menuitem" className="ctx-menu__item" data-hint={on ? '✓' : undefined} onClick={() => !on && run()}>
      {swatch === undefined ? (
        label
      ) : (
        <span className="ctx-menu__label">
          <span className="table-menu-swatch" style={{ background: swatch }} />
          {label}
        </span>
      )}
    </button>
  )
  const seg = (label: string, options: readonly string[], value: string | null, part: StylePart) => (
    <div className="fill-target fill-target--sub" role="group" aria-label={label}>
      {options.map((v) => (
        <button key={v} type="button" className="fill-target__opt" aria-pressed={v === value} onClick={() => v !== value && onPick(part, v)}>
          {capital(v)}
        </button>
      ))}
    </div>
  )
  let body: ReactNode
  if (tab === 'fill')
    body = (
      <>
        {seg('Fill strength', HEADER_ROW_CHOICES.strength, shown.strength, 'strength')}
        {HEADER_ROW_CHOICES.color.map((c) => item(capital(c), shown.color === c, () => onPick('color', c), headerSwatch(c)))}
      </>
    )
  else if (tab === 'text') body = HEADER_ROW_CHOICES.text.map((c) => item(capital(c), shown.text === c, () => onPick('text', c), c === 'muted' || c === 'full' ? undefined : headerSwatch(c)))
  else
    body = (
      <>
        <div className="ctx-menu__heading" role="presentation">
          Weight
        </div>
        {HEADER_ROW_CHOICES.weight.map((w) => item(capital(w), shown.weight === w, () => onPick('weight', w)))}
        {shown.align !== undefined && (
          <>
            <div className="ctx-menu__heading" role="presentation">
              Align
            </div>
            {HEADER_ROW_CHOICES.align.map((a) => item(headerRowLabel(a), shown.align === a, () => onPick('align', a)))}
          </>
        )}
      </>
    )
  return (
    <>
      <div className="ctx-menu__group" role="group">
        {item(plainLabel, plainOn, onPlain)}
      </div>
      <div className="ctx-menu__group" role="group">
        <div className="fill-target" role="group" aria-label="Style part">
          {TABS.map(([t, name]) => (
            <button key={t} type="button" className="fill-target__opt" aria-pressed={t === tab} onClick={() => setTab(t)}>
              {name}
            </button>
          ))}
        </div>
        {body}
      </div>
    </>
  )
}

/** The panel as a "<label> ›" row of a context menu, in the menu's one flyout (`MenuFlyout`). */
export function StyleFlyout({ label, ...panel }: { label: string } & StylePanelProps) {
  const own = useFlyout<string>()
  const flyout = useContext(MenuFlyout) ?? own
  const id = `style:${label}`
  return (
    <FlyoutParent label={label} open={flyout.open === id} menuClassName="ctx-menu--glyphs" onHover={() => flyout.hover(id)} onOpen={() => flyout.openNow(id)} onCloseFlyout={() => flyout.openNow(null)}>
      <StylePanel {...panel} />
    </FlyoutParent>
  )
}

/**
 * A header row's look as CSS custom properties, the ones `table.css` sets from `data-table-header-*` and the folder
 * table reads (`views.css`): the hue and its scale (a colour at 2.5 times the strength, Black at 5), the strength
 * (Off 0, Light 6, Medium 12, Strong 20), the weight, the text (Muted, Full, White or a cell text colour) and the
 * align. Gray and Bold set nothing: the reader's own text colour and bold are the look. For the calendar's day names
 * and the "Aa" chip, which are no table.
 */
export function headerRowVars(shown: { color: string; strength: string; weight: string; text: string | null; align: string }): CSSProperties {
  const out: Record<string, string | number> = {}
  if (shown.color !== 'gray') {
    out['--table-header-hue'] = `var(--table-fill-solid-${shown.color})`
    out['--table-header-scale'] = shown.color === 'black' ? 5 : 2.5
  }
  out['--table-header-strength'] = ({ off: 0, light: 6, medium: 12, strong: 20 } as Record<string, number>)[shown.strength] ?? 6
  if (shown.weight === 'regular') out['--table-header-weight'] = 400
  if (shown.text === 'muted') out['--table-header-mute'] = 1
  else if (shown.text === 'full') out['--table-header-mute'] = 0
  else if (shown.text === 'white') out['--table-header-ink'] = '#fff'
  else if (shown.text !== null) out['--table-header-ink'] = `var(--table-text-${shown.text})`
  if (shown.align !== 'follow') out['--table-header-align'] = shown.align
  return out as CSSProperties
}

/**
 * The compact "Aa ▾" control (YAZ-4864 round 3): a chip in the current fill, text colour and weight, and the panel under
 * it on the body (`Dropdown`). The View tab's Table and Calendar rows and Settings › Tables' header rows use it.
 */
export function HeaderStyleControl({ label, shown, ...panel }: { label: string; shown: StyleShown & { align: string } } & Omit<StylePanelProps, 'shown'>) {
  return (
    <Dropdown label={label} className="view-style" panelClassName="view-style__panel ctx-menu--glyphs" trigger={<span className="view-style__chip" style={headerRowVars({ color: shown.color ?? 'gray', strength: shown.strength, weight: shown.weight ?? 'bold', text: shown.text, align: shown.align })}>Aa</span>}>
      {() => <StylePanel shown={shown} {...panel} />}
    </Dropdown>
  )
}
