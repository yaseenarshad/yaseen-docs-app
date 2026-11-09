import { useContext, useEffect, useRef, useState } from 'react'
import { capital, fillSwatch } from '../../editor/table/colours'
import { TABLE_COLORS } from '../../editor/table/tableComment'
import { ColourBox } from '../../editor/highlightColourBox'
import type { Hex } from '../../lib/colour'
import { type FlyoutControl, FlyoutParent, MenuFlyout, useFlyout } from '../../components/Flyout'

export type FillTarget = 'cell' | 'row' | 'column'

interface FillMenuProps {
  /** The clicked cell's fill now: the custom box opens at it when it is a custom one. */
  start?: string
  /** One fill write: a colour name, `#rrggbb`, or null for No fill. */
  onFill: (target: FillTarget, fill: string | null) => void
  onClose: () => void
  /** The flyouts it offers, in this order (YAZ-3746 13AQ: "Fill column" for a column). Default: Fill cell, Fill row. */
  targets?: readonly FillTarget[]
  /**
   * The host menu's own flyout (YAZ-3746 13AU): one menu, ONE open flyout, so Text › and Fill column › never show at
   * once. Its ids here are `fill:<target>`. Absent: the menu's `MenuFlyout`, else a flyout of its own.
   */
  flyout?: FlyoutControl
  /**
   * ONE "Fill ›" (YAZ-3746 13AW) in place of a row per target: its flyout opens on a Cell · Row · Column switch, set to
   * `initial`, over the colours. `startOf` is each target's fill now, for the custom colour box.
   */
  combined?: { initial: FillTarget; startOf?: (target: FillTarget) => string | undefined }
}

const TARGET_WORD: Record<FillTarget, string> = { cell: 'Cell', row: 'Row', column: 'Column' }


const LABEL: Record<FillTarget, string> = { cell: 'Fill cell', row: 'Fill row', column: 'Fill column' }
const CELL_AND_ROW: readonly FillTarget[] = ['cell', 'row']

/**
 * "Fill cell ›" and "Fill row ›" (YAZ-4536 D12), for the folder table's row right-click
 * (`PageContextMenu`'s `extra`). Each flyout is the table block's Fill menu (`tableMenu.ts`): No fill,
 * the ten colours with swatches, and "Custom colour…". The rows are the app's one flyout
 * (`components/Flyout.tsx`, YAZ-4544 4F: the right-or-left place, the hover wait between two parents). A colour closes the menu. "Custom colour…" opens the note's colour box under it, as the
 * cell toolbar does: each finished pick is one write, and the box stays for the next.
 */
export function FillMenu({ start, onFill, onClose, targets = CELL_AND_ROW, flyout: shared, combined }: FillMenuProps) {
  const own = useFlyout<string>()
  const menu = useContext(MenuFlyout)
  const flyout = shared ?? menu ?? own
  // "Custom colour…" is open in the flyout that is open; a flyout opens without it.
  const [custom, setCustom] = useState(false)
  useEffect(() => setCustom(false), [flyout.open])
  const [target, setTarget] = useState<FillTarget>(combined?.initial ?? targets[0])
  if (combined !== undefined)
    return (
      <FlyoutParent
        label="Fill"
        open={flyout.open === 'fill'}
        menuClassName="ctx-menu--glyphs"
        measureKey={`${custom}`}
        onHover={() => flyout.hover('fill')}
        onOpen={() => flyout.openNow('fill')}
        onCloseFlyout={() => flyout.openNow(null)}
      >
        {targets.length > 1 && (
          <div className="fill-target" role="group" aria-label="Fill what">
            {targets.map((t) => (
              <button key={t} type="button" className="fill-target__opt" aria-pressed={t === target} onClick={() => setTarget(t)}>
                {TARGET_WORD[t]}
              </button>
            ))}
          </div>
        )}
        <FillRows key={target} start={combined.startOf?.(target) ?? start} custom={custom} onCustom={setCustom} onFill={(fill) => onFill(target, fill)} onClose={onClose} />
      </FlyoutParent>
    )
  return (
    <>
      {targets.map((target) => (
        <FlyoutParent
          key={target}
          label={LABEL[target]}
          open={flyout.open === `fill:${target}`}
          menuClassName="ctx-menu--glyphs"
          measureKey={custom}
          onHover={() => flyout.hover(`fill:${target}`)}
          onOpen={() => flyout.openNow(`fill:${target}`)}
          onCloseFlyout={() => flyout.openNow(null)}
        >
          <FillRows start={start} custom={custom} onCustom={setCustom} onFill={(fill) => onFill(target, fill)} onClose={onClose} />
        </FlyoutParent>
      ))}
    </>
  )
}

/** One Fill flyout's rows: No fill, the colours, and "Custom colour…" with the note's colour box under it. */
function FillRows({ start, custom, onCustom, onFill, onClose }: { start: string | undefined; custom: boolean; onCustom: (open: boolean) => void; onFill: (fill: string | null) => void; onClose: () => void }) {
  const boxHolder = useRef<HTMLDivElement>(null)
  const box = useRef<ColourBox | null>(null)
  const pick = useRef(onFill)
  pick.current = onFill
  const setCustom = useRef(onCustom)
  setCustom.current = onCustom
  // The box opens at the fill there is when it opens; a pick moves the box itself.
  const startAt = useRef(start)
  startAt.current = start

  useEffect(() => {
    if (!custom) return
    if (box.current === null) {
      box.current = new ColourBox(document, { preview: () => {}, pick: (hex) => pick.current(hex), close: () => setCustom.current(false) })
      boxHolder.current?.append(box.current.el)
    }
    const at = startAt.current
    box.current.show(at?.startsWith('#') === true ? (at as Hex) : '#000000')
    return () => box.current?.hide()
  }, [custom])

  const row = (label: string, fill: string | null, swatch?: string) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      className="ctx-menu__item"
      onClick={() => {
        onFill(fill)
        onClose()
      }}
    >
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

  return (
    <>
      <div className="ctx-menu__group" role="group">
        {row('No fill', null)}
      </div>
      <div className="ctx-menu__group" role="group">
        {TABLE_COLORS.map((c) => row(capital(c), c, fillSwatch(c)))}
      </div>
      <div className="ctx-menu__group" role="group">
        <button type="button" role="menuitem" className="ctx-menu__item" aria-expanded={custom} onClick={() => onCustom(!custom)}>
          Custom colour…
        </button>
        <div ref={boxHolder} className="view-fill-menu__box" />
      </div>
    </>
  )
}
