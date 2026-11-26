/**
 * Modal to create or edit a macOS Vault App launcher (YAZ-5967, YAZ-6375).
 * Lazy-loaded from `VaultLauncherControl` so it adds zero eager weight to `App.tsx` or Settings.
 *
 * Exports a 512x512 macOS squircle PNG via `<canvas>` from either:
 * - Badge tab: colour swatch + Emoji, Letters (1–2 chars), or bundled Material icon (`materialIcons.ts`)
 * - Image tab: PNG/JPEG/WebP file centre-cropped into a 512x512 squircle
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { VaultLauncherBadge, VaultLauncherInfo, VaultLauncherPreset, VaultLauncherStatus, VaultLauncherTarget } from '@shared/types'
import { sanitizeBadgeSvgPaths, sanitizeBadgeSvgViewBox, shadeHex, vaultInitials } from '@shared/vaultIcon'
import { api } from '../api'
import { iconUrl, pickableIcons, useMaterialIcons } from '../sidebar/materialIcons'
import { Segmented } from './controls'

export { vaultInitials }

export const LAUNCHER_ICON_SIZE = 512

export const LAUNCHER_COLORS: readonly { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#007AFF' },
  { name: 'Indigo', hex: '#5856D6' },
  { name: 'Purple', hex: '#AF52DE' },
  { name: 'Pink', hex: '#FF2D55' },
  { name: 'Red', hex: '#FF3B30' },
  { name: 'Orange', hex: '#FF9500' },
  { name: 'Amber', hex: '#EAB308' },
  { name: 'Green', hex: '#34C759' },
  { name: 'Teal', hex: '#0D9488' },
  { name: 'Slate', hex: '#475569' },
]

export const QUICK_EMOJIS: readonly string[] = [
  '📚', '📝', '🚀', '🧠', '💼', '🏠', '⚡', '🌿',
  '🔬', '🎨', '🎯', '📅', '💡', '🛠️', '📖', '✨',
]

const FEATURED_MATERIAL_ICONS: readonly string[] = [
  'folder-docs', 'folder-notes', 'folder-project', 'folder-src', 'folder-home', 'folder-work',
  'folder-tasks', 'folder-archive', 'folder-bookmark', 'folder-core', 'folder-database', 'folder-design',
  'folder-images', 'folder-lib', 'folder-scripts', 'folder-tools', 'markdown', 'document',
  'readme', 'todo', 'settings', 'database', 'console', 'git',
]

const MAX_VISIBLE_ICONS = 96

const TARGET_OPTIONS: readonly { label: string; value: VaultLauncherTarget }[] = [
  { label: 'Normal', value: 'normal' },
  { label: 'Cards Inbox', value: 'inbox' },
  { label: "Today's Daily Page", value: 'today' },
]

const BADGE_MODE_OPTIONS: readonly { label: string; value: VaultLauncherBadge['kind'] }[] = [
  { label: 'Emoji', value: 'emoji' },
  { label: 'Letters', value: 'letters' },
  { label: 'Icon', value: 'material' },
]

/** Trace a macOS-style rounded squircle path inset slightly for Dock breathing room. */
function traceSquircle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/**
 * Extract compact `<path d="...">` strings + optional non-default `viewBox` from a bundled Material SVG
 * so Mobile and other Macs can render crisp vector icons with zero bundle overhead (YAZ-6560).
 */
export async function enrichBadgeForSync(badge: VaultLauncherBadge): Promise<VaultLauncherBadge> {
  if (badge.kind !== 'material' || (badge.svgPaths !== undefined && badge.svgPaths.length > 0)) return badge
  try {
    const res = await fetch(iconUrl(badge.value))
    if (!res.ok) return badge
    const text = await res.text()
    const vbMatch = /\bviewBox=["']([^"']+)["']/i.exec(text)
    const rawPaths: string[] = []
    const pathRe = /<path\b[^>]*\bd=["']([^"']+)["']/gi
    let match: RegExpExecArray | null
    while ((match = pathRe.exec(text)) !== null) rawPaths.push(match[1])
    const svgPaths = sanitizeBadgeSvgPaths(rawPaths)
    if (svgPaths === undefined) return badge
    const svgViewBox = vbMatch ? sanitizeBadgeSvgViewBox(vbMatch[1]) : undefined
    return {
      ...badge,
      svgPaths,
      ...(svgViewBox !== undefined && svgViewBox !== '0 0 16 16' ? { svgViewBox } : {}),
    }
  } catch {
    return badge
  }
}

/** Load an image URL (SVG or raster) into an HTMLImageElement for canvas drawing. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = window.setTimeout(() => reject(new Error(`Timed out loading image: ${src}`)), 3000)
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error(`Could not load image: ${src}`))
    }
    img.src = src
  })
}

/** Render a 512x512 macOS squircle badge PNG data URL from a badge recipe. */
export async function renderBadgeToPng(badge: VaultLauncherBadge): Promise<string> {
  const size = LAUNCHER_ICON_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('Canvas 2D context unavailable')

  const pad = Math.round(size * 0.04)
  const side = size - pad * 2
  const radius = Math.round(side * 0.225)

  ctx.clearRect(0, 0, size, size)
  ctx.save()
  traceSquircle(ctx, pad, pad, side, side, radius)
  ctx.clip()

  // Subtle vertical gradient for a clean native macOS icon look
  const grad = ctx.createLinearGradient(0, pad, 0, pad + side)
  grad.addColorStop(0, shadeHex(badge.color, 0.1))
  grad.addColorStop(1, shadeHex(badge.color, -0.08))
  ctx.fillStyle = grad
  ctx.fillRect(pad, pad, side, side)

  // Subtle top sheen
  const sheen = ctx.createLinearGradient(0, pad, 0, pad + side * 0.5)
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.16)')
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(pad, pad, side, side * 0.5)

  if (badge.kind === 'material') {
    try {
      const img = await loadImage(iconUrl(badge.value))
      const iconBox = Math.round(side * 0.56)
      const off = document.createElement('canvas')
      off.width = iconBox
      off.height = iconBox
      const offCtx = off.getContext('2d')
      if (offCtx !== null) {
        offCtx.drawImage(img, 0, 0, iconBox, iconBox)
        offCtx.globalCompositeOperation = 'source-in'
        offCtx.fillStyle = '#ffffff'
        offCtx.fillRect(0, 0, iconBox, iconBox)
        const offset = Math.round((size - iconBox) / 2)
        ctx.drawImage(off, offset, offset, iconBox, iconBox)
      }
    } catch {
      // Fallback: render first letter in white if the SVG fails to load (e.g. headless test)
      ctx.fillStyle = '#ffffff'
      ctx.font = `700 ${Math.round(side * 0.44)}px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(badge.value.slice(0, 2).toUpperCase(), size / 2, size / 2 + 8)
    }
  } else if (badge.kind === 'emoji') {
    ctx.font = `${Math.round(side * 0.54)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(badge.value || '📚', size / 2, size / 2 + 12)
  } else {
    const text = (badge.value.trim() || 'YD').slice(0, 2)
    ctx.fillStyle = '#ffffff'
    const fontSize = text.length === 1 ? Math.round(side * 0.52) : Math.round(side * 0.42)
    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Helvetica Neue", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, size / 2, size / 2 + 8)
  }

  ctx.restore()
  return canvas.toDataURL('image/png')
}

/** Centre-crop a PNG/JPEG/WebP image file into a 512x512 macOS squircle PNG data URL. */
export async function renderImageToPng(file: Blob): Promise<string> {
  const size = LAUNCHER_ICON_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('Canvas 2D context unavailable')

  const pad = Math.round(size * 0.04)
  const side = size - pad * 2
  const radius = Math.round(side * 0.225)

  const bitmap = await createImageBitmap(file)
  try {
    const cropSide = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - cropSide) / 2
    const sy = (bitmap.height - cropSide) / 2
    ctx.clearRect(0, 0, size, size)
    ctx.save()
    traceSquircle(ctx, pad, pad, side, side, radius)
    ctx.clip()
    ctx.drawImage(bitmap, sx, sy, cropSide, cropSide, pad, pad, side, side)
    ctx.restore()
  } finally {
    bitmap.close()
  }
  return canvas.toDataURL('image/png')
}

function stripPngDataUrlPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/png;base64,/, '')
}

export interface VaultLauncherModalProps {
  root?: string
  workspaceId?: string
  defaultName: string
  initial?: VaultLauncherInfo | null
  /** Optional synced cross-Mac preset to prefill when creating a launcher on a second Mac (YAZ-6560). */
  preset?: VaultLauncherPreset | null
  initialIconDataUrl?: string | null
  recreating?: boolean
  onSaved: (status: VaultLauncherStatus) => void
  onClose: () => void
}

export function VaultLauncherModal({ root, workspaceId, defaultName, initial, preset, initialIconDataUrl, recreating = false, onSaved, onClose }: VaultLauncherModalProps) {
  const isWorkspace = workspaceId !== undefined
  const editing = initial !== null && initial !== undefined
  const seed = initial ?? preset ?? null
  const initialBadge = seed?.badge
  const startOnImage = seed !== null && initialBadge === undefined && Boolean(initialIconDataUrl)

  const [name, setName] = useState(seed?.name ?? defaultName)
  const [target, setTarget] = useState<VaultLauncherTarget>(seed?.target ?? 'normal')
  const [tab, setTab] = useState<'badge' | 'image'>(startOnImage ? 'image' : 'badge')

  // Badge state
  const [color, setColor] = useState(initialBadge?.color ?? LAUNCHER_COLORS[0].hex)
  const [badgeKind, setBadgeKind] = useState<VaultLauncherBadge['kind']>(initialBadge?.kind ?? 'letters')
  const [emoji, setEmoji] = useState(initialBadge?.kind === 'emoji' ? initialBadge.value : QUICK_EMOJIS[0])
  const [letters, setLetters] = useState(initialBadge?.kind === 'letters' ? initialBadge.value : vaultInitials(seed?.name ?? defaultName))
  const [materialId, setMaterialId] = useState(initialBadge?.kind === 'material' ? initialBadge.value : 'folder-docs')
  const [iconQuery, setIconQuery] = useState('')

  // Image state
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(startOnImage ? (initialIconDataUrl ?? null) : null)
  const [imageError, setImageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const iconsReady = useMaterialIcons()
  const allMaterialIds = useMemo(() => (iconsReady ? pickableIcons() : []), [iconsReady])

  const visibleMaterialIds = useMemo(() => {
    const q = iconQuery.trim().toLowerCase()
    if (q === '') {
      const featured = FEATURED_MATERIAL_ICONS.filter((id) => allMaterialIds.includes(id))
      const rest = allMaterialIds.filter((id) => !featured.includes(id))
      return [...featured, ...rest].slice(0, MAX_VISIBLE_ICONS)
    }
    return allMaterialIds.filter((id) => id.toLowerCase().includes(q)).slice(0, MAX_VISIBLE_ICONS)
  }, [allMaterialIds, iconQuery])

  const currentBadge: VaultLauncherBadge = useMemo(() => {
    const value = badgeKind === 'emoji' ? (emoji.trim() || QUICK_EMOJIS[0]) : badgeKind === 'letters' ? (letters.trim() || vaultInitials(name || defaultName)) : materialId
    return { kind: badgeKind, value, color }
  }, [badgeKind, emoji, letters, name, defaultName, materialId, color])

  const trimmedName = name.trim()
  const canSubmit = !saving && trimmedName.length > 0 && (tab === 'badge' || imageDataUrl !== null)

  // Focus app name input on mount
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (!saving) onClose()
    }
  }

  const handleImagePick = (file: File | undefined): void => {
    if (file === undefined) return
    setImageError(null)
    void renderImageToPng(file).then(
      (dataUrl) => setImageDataUrl(dataUrl),
      () => setImageError('Could not read that image. Try a PNG, JPEG, or WebP file.'),
    )
  }

  const handleSave = async (): Promise<void> => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const badgeToSave = tab === 'badge' ? await enrichBadgeForSync(currentBadge) : undefined
      const dataUrl = tab === 'badge' ? await renderBadgeToPng(badgeToSave!) : imageDataUrl!
      const pngBase64 = stripPngDataUrlPrefix(dataUrl)
      const next = isWorkspace
        ? await api.vaultLauncher.createWorkspace({
            workspaceId,
            name: trimmedName,
            pngBase64,
            ...(badgeToSave !== undefined ? { badge: badgeToSave } : {}),
          })
        : await api.vaultLauncher.create({
            root: root!,
            name: trimmedName,
            pngBase64,
            target,
            ...(badgeToSave !== undefined ? { badge: badgeToSave } : {}),
          })
      onSaved(next)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const displayAppName = trimmedName || defaultName || 'Vault'

  return (
    <div
      className="vault-launcher-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-launcher-modal-title"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="vault-launcher-modal">
        <div className="vault-launcher-modal__head">
          <h3 id="vault-launcher-modal-title" className="vault-launcher-modal__title">
            {isWorkspace
              ? recreating
                ? 'Recreate workspace launcher'
                : editing
                  ? 'Edit workspace launcher'
                  : 'Create workspace launcher'
              : recreating
                ? 'Recreate vault launcher'
                : editing
                  ? 'Edit vault launcher'
                  : 'Make a vault launcher'}
          </h3>
          <button type="button" className="vault-launcher-modal__close" aria-label="Close" disabled={saving} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="vault-launcher-modal__body">
          <div className="vault-launcher-modal__fields">
            <label className="vault-launcher-modal__field">
              <span className="vault-launcher-modal__label">App name</span>
              <div className="vault-launcher-modal__name-row">
                <input
                  ref={nameRef}
                  type="text"
                  className="settings__input"
                  aria-label="App name"
                  value={name}
                  placeholder={defaultName}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit) void handleSave()
                  }}
                />
                <span className="vault-launcher-modal__suffix">.app</span>
              </div>
            </label>

            {!isWorkspace && (
              <div className="vault-launcher-modal__field">
                <span className="vault-launcher-modal__label">Open on</span>
                <Segmented options={TARGET_OPTIONS} value={target} onChange={setTarget} ariaLabel="Open on" />
              </div>
            )}

            <div className="vault-launcher-modal__tabs" role="tablist" aria-label="Icon source">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'badge'}
                className={`vault-launcher-modal__tab${tab === 'badge' ? ' vault-launcher-modal__tab--active' : ''}`}
                onClick={() => setTab('badge')}
              >
                Badge
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'image'}
                className={`vault-launcher-modal__tab${tab === 'image' ? ' vault-launcher-modal__tab--active' : ''}`}
                onClick={() => setTab('image')}
              >
                Image
              </button>
            </div>

            {tab === 'badge' ? (
              <div className="vault-launcher-modal__panel" role="tabpanel" aria-label="Badge">
                <div className="vault-launcher-modal__swatches" role="radiogroup" aria-label="Badge colour">
                  {LAUNCHER_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      role="radio"
                      aria-checked={color.toLowerCase() === c.hex.toLowerCase()}
                      aria-label={c.name}
                      title={c.name}
                      className={`vault-launcher-modal__swatch${color.toLowerCase() === c.hex.toLowerCase() ? ' vault-launcher-modal__swatch--on' : ''}`}
                      style={{ background: c.hex }}
                      onClick={() => setColor(c.hex)}
                    />
                  ))}
                </div>

                <Segmented options={BADGE_MODE_OPTIONS} value={badgeKind} onChange={setBadgeKind} ariaLabel="Badge symbol" />

                {badgeKind === 'emoji' && (
                  <div className="vault-launcher-modal__symbol-box">
                    <div className="vault-launcher-modal__emoji-grid">
                      {QUICK_EMOJIS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          className={`vault-launcher-modal__emoji-btn${emoji === em ? ' vault-launcher-modal__emoji-btn--on' : ''}`}
                          onClick={() => setEmoji(em)}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className="settings__input"
                      aria-label="Custom emoji"
                      placeholder="Or type any emoji…"
                      value={emoji}
                      maxLength={8}
                      onChange={(e) => setEmoji(e.target.value)}
                    />
                  </div>
                )}

                {badgeKind === 'letters' && (
                  <div className="vault-launcher-modal__symbol-box">
                    <input
                      type="text"
                      className="settings__input vault-launcher-modal__letters-input"
                      aria-label="Badge letters"
                      placeholder={vaultInitials(name || defaultName)}
                      value={letters}
                      maxLength={2}
                      onChange={(e) => setLetters(e.target.value.toUpperCase())}
                    />
                    <span className="vault-launcher-modal__hint">1–2 characters shown on the icon.</span>
                  </div>
                )}

                {badgeKind === 'material' && (
                  <div className="vault-launcher-modal__symbol-box">
                    <input
                      type="text"
                      className="settings__input"
                      aria-label="Search Material icons"
                      placeholder="Search icons…"
                      value={iconQuery}
                      onChange={(e) => setIconQuery(e.target.value)}
                    />
                    <div className="vault-launcher-modal__icon-grid" role="listbox" aria-label="Material icons">
                      {visibleMaterialIds.length === 0 ? (
                        <span className="vault-launcher-modal__hint">{iconsReady ? 'No matching icons.' : 'Loading icons…'}</span>
                      ) : (
                        visibleMaterialIds.map((id) => (
                          <button
                            key={id}
                            type="button"
                            role="option"
                            aria-selected={materialId === id}
                            title={id}
                            aria-label={id}
                            className={`vault-launcher-modal__icon-btn${materialId === id ? ' vault-launcher-modal__icon-btn--on' : ''}`}
                            onClick={() => setMaterialId(id)}
                          >
                            <img src={iconUrl(id)} alt="" width={20} height={20} loading="lazy" />
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="vault-launcher-modal__panel" role="tabpanel" aria-label="Image">
                <div className="vault-launcher-modal__upload">
                  <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                    {imageDataUrl === null ? 'Choose image…' : 'Change image…'}
                  </button>
                  <span className="vault-launcher-modal__hint">PNG, JPEG, or WebP. Centre-cropped to a 512×512 squircle.</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    aria-label="Choose launcher image"
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0]
                      e.currentTarget.value = ''
                      handleImagePick(file)
                    }}
                  />
                </div>
                {imageError !== null && <p className="vault-launcher-modal__error" role="alert">{imageError}</p>}
              </div>
            )}
          </div>

          <div className="vault-launcher-modal__preview" aria-label="Launcher preview">
            <span className="vault-launcher-modal__preview-label">Preview</span>
            <div className="vault-launcher-modal__dock-preview">
              <LauncherIconPreview tab={tab} badge={currentBadge} imageDataUrl={imageDataUrl} size={76} />
              <span className="vault-launcher-modal__dock-name">{displayAppName}</span>
            </div>
            <div className="vault-launcher-modal__alfred-preview">
              <LauncherIconPreview tab={tab} badge={currentBadge} imageDataUrl={imageDataUrl} size={28} />
              <div className="vault-launcher-modal__alfred-text">
                <span className="vault-launcher-modal__alfred-name">{displayAppName}.app</span>
                <span className="vault-launcher-modal__alfred-sub">
                  {isWorkspace
                    ? 'Opens all vaults in workspace'
                    : target === 'inbox'
                      ? 'Opens Cards Inbox'
                      : target === 'today'
                        ? "Opens Today's Daily Page"
                        : 'Opens in Yaseen Docs'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {error !== null && (
          <div className="vault-launcher-modal__error-banner" role="alert">
            {error}
          </div>
        )}

        <div className="vault-launcher-modal__foot">
          <button type="button" className="btn" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : recreating ? 'Recreate launcher' : editing ? 'Save launcher' : 'Create launcher'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Crisp live icon preview matching the exported 512x512 squircle. */
function LauncherIconPreview({ tab, badge, imageDataUrl, size }: { tab: 'badge' | 'image'; badge: VaultLauncherBadge; imageDataUrl: string | null; size: number }) {
  const radius = Math.round(size * 0.225)
  if (tab === 'image') {
    return imageDataUrl !== null ? (
      <img
        className="vault-launcher-preview-img"
        src={imageDataUrl}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: radius }}
      />
    ) : (
      <div
        className="vault-launcher-preview-empty"
        style={{ width: size, height: size, borderRadius: radius }}
        aria-hidden="true"
      >
        ?
      </div>
    )
  }

  return (
    <div
      className="vault-launcher-preview-badge"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(180deg, ${shadeHex(badge.color, 0.1)}, ${shadeHex(badge.color, -0.08)})`,
        fontSize: badge.kind === 'emoji' ? Math.round(size * 0.52) : Math.round(size * (badge.value.length <= 1 ? 0.5 : 0.4)),
      }}
      aria-hidden="true"
    >
      {badge.kind === 'material' ? (
        <span
          className="vault-launcher-preview-material"
          style={{
            width: Math.round(size * 0.56),
            height: Math.round(size * 0.56),
            WebkitMaskImage: `url(${iconUrl(badge.value)})`,
            maskImage: `url(${iconUrl(badge.value)})`,
          }}
        />
      ) : (
        <span>{badge.value}</span>
      )}
    </div>
  )
}
