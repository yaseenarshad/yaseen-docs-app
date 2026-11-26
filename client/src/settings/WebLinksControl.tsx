/**
 * Settings › Links & IDs › Web links (YAZ-6580 / YAZ-6584):
 * Dedicated appearance control for external hyperlinks (`https://`, `http://`, `mailto:`, app URLs).
 * Stored on `SettingsState.webLinks` (Global default) and sparsely overridden per vault via `VAULT_OVERRIDE_KEYS`.
 */
import { useEffect, useRef, useState } from 'react'
import {
  LINK_MARK_SVG,
  type LinkHoverColor,
  type LinkHoverStyle,
  type LinkStrength,
} from '@shared/linkStyle'
import {
  DEFAULT_WEB_LINKS,
  DEFAULT_WEB_LINK_MARK,
  WEB_LINK_CUSTOM_MAX,
  WEB_LINK_MARKS,
  WEB_LINK_PRESETS,
  cleanWebLinkCustomMark,
  isDefaultWebLinks,
  sameWebLinks,
  sanitizeWebLinks,
  webLinkVars,
  type WebLinkBoxShape,
  type WebLinkMarkPlace,
  type WebLinkMarkSize,
  type WebLinksStyle,
} from '@shared/webLinks'
import { fillSwatch, textSwatch } from '../editor/table/colours'
import { Segmented } from './controls'
import {
  LINK_HOVER_STRENGTH_OPTIONS,
  LINK_HOVER_STYLE_OPTIONS,
  LINK_MARK_NAMES,
  LINK_STRENGTH_OPTIONS,
  LinkColorSwatches,
  LinkStyleRow,
  LinkStyleToggle,
} from './linkStyleParts'
import type { Option } from './options'

const BOX_SHAPE_OPTIONS: readonly Option<WebLinkBoxShape>[] = [
  { label: 'None', value: 'none' },
  { label: 'Round', value: 'round' },
  { label: 'Square', value: 'square' },
]

const MARK_PLACE_OPTIONS: readonly Option<WebLinkMarkPlace>[] = [
  { label: 'Off', value: 'off' },
  { label: 'After text', value: 'after' },
  { label: 'Before text', value: 'before' },
]

const MARK_SIZE_OPTIONS: readonly Option<WebLinkMarkSize>[] = [
  { label: 'Small', value: 'small' },
  { label: 'Normal', value: 'normal' },
]

export function WebLinksControl({ value, onChange }: { value: WebLinksStyle; onChange: (next: WebLinksStyle) => void }) {
  const [showHover, setShowHover] = useState(false)
  const storedCustom = value.mark?.custom
  const [customDraft, setCustomDraft] = useState(storedCustom ?? '')
  const lastCommitted = useRef<string | undefined>(storedCustom)

  useEffect(() => {
    if (storedCustom !== lastCommitted.current) {
      lastCommitted.current = storedCustom
      setCustomDraft(storedCustom ?? '')
    }
  }, [storedCustom])

  const update = (next: WebLinksStyle) => onChange(sanitizeWebLinks(next))

  const textColor = value.color ?? 'accent'
  const box = value.box
  const boxShape: WebLinkBoxShape = box?.shape ?? 'none'
  const boxFill = box?.fill
  const mark = value.mark
  const markPlace: WebLinkMarkPlace = mark?.place ?? 'off'
  const activeIcon = mark !== undefined && mark.custom === undefined ? (mark.icon ?? DEFAULT_WEB_LINK_MARK) : undefined
  const markColor = mark?.color ?? 'same'
  const hover = value.hover ?? {}
  const hoverStyle: LinkHoverStyle = hover.style ?? 'wash'
  const hoverColor = hover.color
  const hoverStrength: LinkStrength = hover.strength ?? 'light'

  const setHover = (patch: { style?: LinkHoverStyle; color?: LinkHoverColor; strength?: LinkStrength }) => {
    const nextStyle = 'style' in patch ? patch.style : hover.style
    const nextColor = 'color' in patch ? patch.color : hover.color
    const nextStrength = 'strength' in patch ? patch.strength : hover.strength
    update({
      ...value,
      hover: {
        ...(nextStyle !== undefined && nextStyle !== 'wash' ? { style: nextStyle } : {}),
        ...(nextColor !== undefined ? { color: nextColor } : {}),
        ...(nextStrength !== undefined && nextStrength !== 'light' ? { strength: nextStrength } : {}),
      },
    })
  }

  return (
    <div className="web-links-control">
      <div className="web-links-presets__row">
        <div className="settings__options web-links-presets" role="group" aria-label="Web link presets">
          {WEB_LINK_PRESETS.map((preset) => {
            const active = sameWebLinks(value, preset.style)
            return (
              <button
                key={preset.id}
                type="button"
                className={`settings__option${active ? ' settings__option--active' : ''}`}
                aria-pressed={active}
                onClick={() => update(preset.style)}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
        {!isDefaultWebLinks(value) && (
          <button
            type="button"
            className="settings__option"
            title="Reset to Classic underline"
            onClick={() => update(DEFAULT_WEB_LINKS)}
          >
            Reset
          </button>
        )}
      </div>

      <div
        className={`link-pills-preview web-links-preview${showHover ? ' web-links-preview--hover' : ''}`}
        aria-label="Web links preview"
        style={webLinkVars(value)}
      >
        <span className="link-pills-preview__samples">
          <span className="link-pills-preview__label">Preview</span>
          <span className="web-links-preview__line">
            <u>Docs:</u>{' '}
            <a className="web-links-preview__link" href="#preview-k8s" onClick={(e) => e.preventDefault()}>
              Kubernetes
            </a>
            {' and '}
            <a className="web-links-preview__link" href="#preview-cncf" onClick={(e) => e.preventDefault()}>
              CNCF
            </a>
            {' reference.'}
          </span>
        </span>
        <button
          type="button"
          className={`link-pills-preview__hover-toggle${showHover ? ' link-pills-preview__hover-toggle--on' : ''}`}
          aria-pressed={showHover}
          title="Show hover state on preview links"
          onClick={() => setShowHover((v) => !v)}
        >
          <span className="link-pills-preview__hover-dot" aria-hidden />
          Show hover
        </button>
      </div>

      <div className="web-links-panel">
        <div className="web-links-section">
          <LinkStyleRow label="Text">
            <span className="pill-toolbar__group" role="group" aria-label="Text style">
              <LinkStyleToggle
                label="Bold"
                on={value.bold === true}
                mark="B"
                className=" pill-toolbar__b"
                onClick={() => update({ ...value, bold: value.bold ? undefined : true })}
              />
              <LinkStyleToggle
                label="Italic"
                on={value.italic === true}
                mark="I"
                className=" pill-toolbar__i"
                onClick={() => update({ ...value, italic: value.italic ? undefined : true })}
              />
              <LinkStyleToggle
                label="Underline"
                on={value.underline !== false}
                mark="U"
                className=" pill-toolbar__u"
                onClick={() => update({ ...value, underline: value.underline === false ? undefined : false })}
              />
            </span>
          </LinkStyleRow>
          <LinkStyleRow label="Colour">
            <span className="pill-toolbar__group" role="group" aria-label="Text colour">
              <LinkStyleToggle
                label="Accent colour"
                on={textColor === 'accent'}
                mark="Accent"
                onClick={() => update({ ...value, color: undefined })}
              />
              <LinkStyleToggle
                label="Same as text"
                on={textColor === 'same'}
                mark="Text"
                onClick={() => update({ ...value, color: 'same' })}
              />
              <LinkStyleToggle
                label="Muted"
                on={textColor === 'muted'}
                mark="Muted"
                onClick={() => update({ ...value, color: 'muted' })}
              />
              <LinkColorSwatches
                label="Palette (text)"
                value={textColor}
                swatch={textSwatch}
                onPick={(c) => update({ ...value, color: c })}
              />
            </span>
          </LinkStyleRow>
        </div>

        <div className="web-links-section">
          <LinkStyleRow label="Box">
            <Segmented
              options={BOX_SHAPE_OPTIONS}
              value={boxShape}
              onChange={(shape: WebLinkBoxShape) =>
                update({ ...value, box: shape === 'none' ? undefined : { ...value.box, shape } })
              }
              ariaLabel="Box shape"
            />
          </LinkStyleRow>
          {boxShape !== 'none' && (
            <>
              <LinkStyleRow label="Fill">
                <span className="pill-toolbar__group" role="group" aria-label="Box fill">
                  <LinkStyleToggle
                    label="Accent tint"
                    on={boxFill === undefined}
                    mark="Tint"
                    onClick={() => update({ ...value, box: { shape: boxShape } })}
                  />
                  <LinkStyleToggle
                    label="No fill"
                    on={boxFill === 'none'}
                    mark="None"
                    onClick={() => update({ ...value, box: { shape: boxShape, fill: 'none' } })}
                  />
                  <LinkColorSwatches
                    label="Palette (box)"
                    value={boxFill}
                    swatch={fillSwatch}
                    onPick={(c) => update({ ...value, box: { ...value.box, shape: boxShape, fill: c } })}
                  />
                </span>
              </LinkStyleRow>
              {boxFill !== undefined && boxFill !== 'none' && (
                <LinkStyleRow label="Strength">
                  <Segmented
                    options={LINK_STRENGTH_OPTIONS}
                    value={box?.strength ?? 'medium'}
                    onChange={(strength: LinkStrength) =>
                      update({
                        ...value,
                        box: { ...value.box, shape: boxShape, strength: strength === 'medium' ? undefined : strength },
                      })
                    }
                    ariaLabel="Box fill strength"
                  />
                </LinkStyleRow>
              )}
            </>
          )}
        </div>

        <div className="web-links-section">
          <LinkStyleRow label="Mark">
            <Segmented
              options={MARK_PLACE_OPTIONS}
              value={markPlace}
              onChange={(place: WebLinkMarkPlace) =>
                update({ ...value, mark: place === 'off' ? undefined : { ...value.mark, place } })
              }
              ariaLabel="Mark position"
            />
          </LinkStyleRow>
          {mark !== undefined && (
            <>
              <LinkStyleRow label="Icon">
                <span className="pill-toolbar__group web-links-mark-row">
                  <span className="pill-toolbar__group pill-toolbar__marks" role="radiogroup" aria-label="Mark icon">
                    {WEB_LINK_MARKS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={activeIcon === m}
                        aria-label={LINK_MARK_NAMES[m]}
                        title={LINK_MARK_NAMES[m]}
                        className={`settings__option pill-toolbar__item pill-toolbar__mark${activeIcon === m ? ' settings__option--active' : ''}`}
                        onClick={() =>
                          update({
                            ...value,
                            mark: { ...mark, custom: undefined, icon: m === DEFAULT_WEB_LINK_MARK ? undefined : m },
                          })
                        }
                        dangerouslySetInnerHTML={{ __html: LINK_MARK_SVG[m] }}
                      />
                    ))}
                  </span>
                  <label className="web-links-custom">
                    <span className="web-links-custom__label">Custom:</span>
                    <input
                      type="text"
                      className="settings__input web-links-custom-input"
                      aria-label="Custom mark"
                      placeholder="🔗"
                      maxLength={WEB_LINK_CUSTOM_MAX}
                      spellCheck={false}
                      value={customDraft}
                      onChange={(e) => {
                        const raw = e.target.value
                        setCustomDraft(raw)
                        const cleaned = cleanWebLinkCustomMark(raw)
                        if (cleaned !== undefined) {
                          lastCommitted.current = cleaned
                          update({ ...value, mark: { ...mark, icon: undefined, custom: cleaned } })
                        } else if (raw.trim() === '' && mark.custom !== undefined) {
                          lastCommitted.current = undefined
                          update({ ...value, mark: { ...mark, custom: undefined } })
                        }
                      }}
                    />
                  </label>
                </span>
              </LinkStyleRow>
              <LinkStyleRow label="Colour">
                <span className="pill-toolbar__group" role="group" aria-label="Mark colour">
                  <LinkStyleToggle
                    label="Same as link"
                    on={markColor === 'same'}
                    mark="Same as link"
                    onClick={() => update({ ...value, mark: { ...mark, color: undefined } })}
                  />
                  <LinkStyleToggle
                    label="Muted"
                    on={markColor === 'muted'}
                    mark="Muted"
                    onClick={() => update({ ...value, mark: { ...mark, color: 'muted' } })}
                  />
                  <LinkStyleToggle
                    label="Accent colour"
                    on={markColor === 'accent'}
                    mark="Accent"
                    onClick={() => update({ ...value, mark: { ...mark, color: 'accent' } })}
                  />
                  <LinkColorSwatches
                    label="Palette (mark)"
                    value={markColor}
                    swatch={textSwatch}
                    onPick={(c) => update({ ...value, mark: { ...mark, color: c } })}
                  />
                </span>
              </LinkStyleRow>
              <LinkStyleRow label="Size">
                <Segmented
                  options={MARK_SIZE_OPTIONS}
                  value={mark.size ?? 'small'}
                  onChange={(size: WebLinkMarkSize) =>
                    update({ ...value, mark: { ...mark, size: size === 'small' ? undefined : size } })
                  }
                  ariaLabel="Mark size"
                />
              </LinkStyleRow>
            </>
          )}
        </div>

        <div className="web-links-section">
          <LinkStyleRow label="Hover">
            <Segmented
              options={LINK_HOVER_STYLE_OPTIONS}
              value={hoverStyle}
              onChange={(next: LinkHoverStyle) =>
                setHover({
                  style: next === 'wash' ? undefined : next,
                  ...(next === 'off' || next === 'underline'
                    ? { color: undefined, strength: undefined }
                    : next === 'text'
                      ? { strength: undefined }
                      : {}),
                })
              }
              ariaLabel="Hover style"
            />
          </LinkStyleRow>
          {(hoverStyle === 'wash' || hoverStyle === 'text') && (
            <LinkStyleRow label="Colour">
              <span className="pill-toolbar__group" role="group" aria-label="Hover colour">
                <LinkStyleToggle
                  label="Auto hover colour"
                  on={hoverColor === undefined}
                  mark="Auto"
                  onClick={() => setHover({ color: undefined })}
                />
                <LinkStyleToggle
                  label="Accent hover colour"
                  on={hoverColor === 'accent'}
                  mark="Accent"
                  onClick={() => setHover({ color: 'accent' })}
                />
                <LinkColorSwatches
                  label="Palette (hover)"
                  value={hoverColor}
                  swatch={hoverStyle === 'wash' ? fillSwatch : textSwatch}
                  onPick={(c) => setHover({ color: c })}
                />
              </span>
            </LinkStyleRow>
          )}
          {hoverStyle === 'wash' && (
            <LinkStyleRow label="Strength">
              <Segmented
                options={LINK_HOVER_STRENGTH_OPTIONS}
                value={hoverStrength}
                onChange={(next: LinkStrength) => setHover({ strength: next === 'light' ? undefined : next })}
                ariaLabel="Hover strength"
              />
            </LinkStyleRow>
          )}
        </div>
      </div>
    </div>
  )
}

export default WebLinksControl
