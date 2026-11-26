/**
 * Settings › Appearance › Menus › Menu icons (YAZ-6571):
 * Master `On | Off` toggle (remembering custom picks across Off → On), collapsible
 * `Customize icons` 5-row glyph picker reading single-source shapes from `menuIconShapes.ts`,
 * `Reset to defaults`, and a live mini context menu preview. Lazy-loaded from `registry.tsx`.
 */
import { useEffect, useState } from 'react'
import {
  MENU_ICON_ACTIONS,
  isDefaultMenuIcons,
  patchMenuIconPick,
  resolveMenuIcons,
  sanitizeMenuIcons,
  type MenuIconAction,
  type MenuIconsSetting,
  type ResolvedMenuIconPicks,
} from '@shared/menuIcons'
import { MENU_ICON_CHOICES, menuIconShapesOf, type SvgShapeSpec } from '../views/view/menuIconShapes'

const ACTION_LABELS: Readonly<Record<MenuIconAction, string>> = {
  newWindow: 'New window',
  duplicateTab: 'Duplicate tab',
  openNewTab: 'Open in new tab',
  hideOthers: 'Hide all others',
  showInSidebar: 'Show in sidebar',
}

type PreviewRow = { readonly label: string; readonly action: MenuIconAction | null } | 'divider'

const PREVIEW_ROWS: readonly PreviewRow[] = [
  { label: 'Open in new tab', action: 'openNewTab' },
  { label: 'Move to new window', action: 'newWindow' },
  { label: 'Duplicate tab', action: 'duplicateTab' },
  'divider',
  { label: 'Show in sidebar', action: 'showInSidebar' },
  { label: 'Copy path', action: null },
  'divider',
  { label: 'Add to focus', action: null },
  { label: 'Hide all others', action: 'hideOthers' },
]

function renderShape([tag, attrs]: SvgShapeSpec, key: number) {
  switch (tag) {
    case 'path':
      return <path key={key} {...attrs} />
    case 'rect':
      return <rect key={key} {...attrs} />
    case 'line':
      return <line key={key} {...attrs} />
    case 'circle':
      return <circle key={key} {...attrs} />
  }
}

function shapesForPick<K extends MenuIconAction>(action: K, variant: ResolvedMenuIconPicks[K]): readonly SvgShapeSpec[] | null {
  return variant === 'none' ? null : menuIconShapesOf(action, variant)
}

function MenuIconGlyph({ shapes, size = 14 }: { shapes: readonly SvgShapeSpec[]; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes.map(renderShape)}
    </svg>
  )
}

export interface MenuIconsControlProps {
  value: MenuIconsSetting
  onChange: (next: MenuIconsSetting) => void
}

export function MenuIconsControl({ value, onChange }: MenuIconsControlProps) {
  const resolved = resolveMenuIcons(value)
  const { enabled, picks } = resolved

  const [lastOnValue, setLastOnValue] = useState<MenuIconsSetting>(() => (value === 'off' ? 'on' : sanitizeMenuIcons(value)))
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (value !== 'off') {
      setLastOnValue(sanitizeMenuIcons(value))
    }
  }, [value])

  const setEnabled = (nextEnabled: boolean) => {
    if (nextEnabled === enabled) return
    if (!nextEnabled) {
      onChange('off')
      return
    }
    onChange(lastOnValue === 'off' ? 'on' : sanitizeMenuIcons(lastOnValue))
  }

  const selectVariant = <K extends MenuIconAction>(action: K, variant: ResolvedMenuIconPicks[K]) => {
    const next = patchMenuIconPick(value, action, variant)
    setLastOnValue(next)
    onChange(next)
  }

  const resetDefaults = () => {
    setLastOnValue('on')
    onChange('on')
  }

  const hasAnyPreviewIcon =
    enabled &&
    PREVIEW_ROWS.some(
      (row) => row !== 'divider' && row.action !== null && shapesForPick(row.action, picks[row.action]) !== null,
    )

  return (
    <div className="menu-icons-control">
      <div className="menu-icons-control__top">
        <div className="settings__options" role="group" aria-label="Menu icons">
          <button
            type="button"
            className={`settings__option${enabled ? ' settings__option--active' : ''}`}
            aria-pressed={enabled}
            onClick={() => setEnabled(true)}
          >
            On
          </button>
          <button
            type="button"
            className={`settings__option${!enabled ? ' settings__option--active' : ''}`}
            aria-pressed={!enabled}
            onClick={() => setEnabled(false)}
          >
            Off
          </button>
        </div>

        {enabled && (
          <button
            type="button"
            className="menu-icons-control__disclosure"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            <span>{open ? 'Hide icon choices' : 'Customize icons'}</span>
            <svg
              className="menu-icons-control__chevron"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 4.5 6 7.5 9 4.5" />
            </svg>
          </button>
        )}
      </div>

      {enabled && open && (
        <div className="menu-icons-control__panel">
          <div className="menu-icons-control__picker">
            {MENU_ICON_ACTIONS.map((action) => {
              const actionLabel = ACTION_LABELS[action]
              const current = picks[action]
              const choices = MENU_ICON_CHOICES[action]
              return (
                <div key={action} className="menu-icons-control__row" data-menu-icon-action={action}>
                  <span className="menu-icons-control__row-label">{actionLabel}</span>
                  <div className="menu-icons-control__tiles" role="group" aria-label={`${actionLabel} icon`}>
                    {choices.map((choice) => {
                      const active = current === choice.id
                      const isOff = choice.shapes === null
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          className={`menu-icons-control__tile${isOff ? ' menu-icons-control__tile--off' : ''}${active ? ' menu-icons-control__tile--active' : ''}`}
                          title={choice.label}
                          aria-label={`${actionLabel}: ${choice.label}`}
                          aria-pressed={active}
                          data-variant={choice.id}
                          onClick={() => selectVariant(action, choice.id as never)}
                        >
                          {choice.shapes !== null ? <MenuIconGlyph shapes={choice.shapes} size={15} /> : 'Off'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {!isDefaultMenuIcons(value) && (
              <div className="menu-icons-control__footer">
                <button
                  type="button"
                  className="settings__option menu-icons-control__reset"
                  onClick={resetDefaults}
                >
                  Reset to defaults
                </button>
              </div>
            )}
          </div>

          <div className="menu-icons-preview">
            <span className="menu-icons-preview__label">Live preview</span>
            <div
              className={`menu-icons-preview__menu${hasAnyPreviewIcon ? ' menu-icons-preview__menu--glyphs' : ''}`}
              data-preview="menu-icons"
              data-has-icons={hasAnyPreviewIcon ? 'true' : 'false'}
              aria-label="Live menu preview"
            >
              {PREVIEW_ROWS.map((row, index) => {
                if (row === 'divider') {
                  return <div key={`div-${index}`} className="menu-icons-preview__divider" role="separator" />
                }
                const shapes = row.action !== null ? shapesForPick(row.action, picks[row.action]) : null
                return (
                  <div
                    key={row.label}
                    className="menu-icons-preview__item"
                    data-preview-action={row.action ?? undefined}
                    data-preview-variant={row.action !== null ? picks[row.action] : undefined}
                  >
                    {hasAnyPreviewIcon && (
                      <span className="menu-icons-preview__slot" aria-hidden="true">
                        {shapes !== null && <MenuIconGlyph shapes={shapes} size={14} />}
                      </span>
                    )}
                    <span className="menu-icons-preview__text">{row.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
