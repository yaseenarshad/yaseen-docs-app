import { type ReactNode, useContext, useState } from 'react'
import { HEADER_ROW_CHOICES, headerRowAttrs, headerRowLabel } from '@shared/types'
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

/** One row of the panel: a ✓ at what shows, a swatch before a colour's name. A press on the shown one does nothing. */
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
/** A short switch of the panel (the strength): one button pressed. */
const seg = (label: string, options: readonly string[], value: string | null, onPick: (value: string) => void) => (
  <div className="fill-target fill-target--sub" role="group" aria-label={label}>
    {options.map((v) => (
      <button key={v} type="button" className="fill-target__opt" aria-pressed={v === value} onClick={() => v !== value && onPick(v)}>
        {capital(v)}
      </button>
    ))}
  </div>
)

/**
 * The Fill tab (YAZ-4834 P9): the strength switch over the colour rows (`HEADER_ROW_CHOICES.color`: Gray … Black), a ✓
 * at what shows. The style panel gives it Off · Light · Medium · Strong; a calendar line's colour dot
 * (`CalendarLineControls.tsx`) Light · Medium · Strong: the one fill picker of both.
 */
export function FillPicker({ label, strengths, strength, color, onStrength, onColor }: { label: string; strengths: readonly string[]; strength: string; color: string | null; onStrength: (strength: string) => void; onColor: (color: string) => void }) {
  return (
    <>
      {seg(`${label} strength`, strengths, strength, onStrength)}
      {HEADER_ROW_CHOICES.color.map((c) => item(capital(c), color === c, () => onColor(c), headerSwatch(c)))}
    </>
  )
}

export function StylePanel({ shown, plainLabel, plainOn, onPlain, onPick }: StylePanelProps) {
  const [tab, setTab] = useState<Tab>('fill')
  let body: ReactNode
  if (tab === 'fill') body = <FillPicker label="Fill" strengths={HEADER_ROW_CHOICES.strength} strength={shown.strength} color={shown.color} onStrength={(v) => onPick('strength', v)} onColor={(v) => onPick('color', v)} />
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
 * The compact "Aa ▾" control (YAZ-4864 round 3): a chip in the current fill, text colour and weight, and the panel under
 * it on the body (`Dropdown`). The View tab's Table and Calendar rows and Settings › Tables' header rows use it. The chip
 * wears the look as `data-table-header-*` (`headerRowAttrs`, `table.css`), as a table does (YAZ-4834 P1): Gray and Bold
 * then unset the variables of a further-out look (Settings' on `.app`), which inline variables could not.
 */
export function HeaderStyleControl({ label, shown, ...panel }: { label: string; shown: StyleShown & { align: string } } & Omit<StylePanelProps, 'shown'>) {
  return (
    <Dropdown label={label} className="view-style" panelClassName="view-style__panel ctx-menu--glyphs" trigger={<span className="view-style__chip" {...headerRowAttrs({ color: shown.color ?? 'gray', strength: shown.strength, weight: shown.weight ?? 'bold', text: shown.text, align: shown.align } as Parameters<typeof headerRowAttrs>[0])}>Aa</span>}>
      {() => <StylePanel shown={shown} {...panel} />}
    </Dropdown>
  )
}
