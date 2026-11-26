/**
 * PORTABLE SYNCED VAULT & WORKSPACE LAUNCHER ICONS (YAZ-6560).
 *
 * Pure and intentionally lightweight (zero runtime imports from `shared/types` or `shared/vaultSettings`)
 * so Mobile's first-load bundle stays tiny (`mobile/src/bundleWalls.test.ts`).
 *
 * Synced storage:
 * - Vaults: `<vault>/.yaseendocs/settings.json` under `"launcher"` (+ optional `<vault>/.yaseendocs/vault-icon.png`
 *   when using a custom uploaded PNG).
 * - Workspaces: `SettingsState.workspaceLaunchers[workspaceLauncherKey(name)]` (badge presets only).
 */
import { isRecord } from './guards'
import type { VaultLauncherBadge, VaultLauncherTarget } from './types'

/** Relative filename inside `<vault>/.yaseendocs/` for a custom uploaded launcher PNG. */
export const VAULT_ICON_FILE = 'vault-icon.png'

/** Maximum number of synced workspace launcher presets stored in `SettingsState.workspaceLaunchers`. */
export const MAX_WORKSPACE_LAUNCHERS = 50

const MAX_BADGE_SVG_PATHS = 16
const MAX_BADGE_SVG_PATH_LEN = 2048
const MAX_PRESET_NAME_LEN = 80

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i
const SVG_PATH_D_RE = /^[0-9a-zA-Z.,\s+\-]+$/
const SVG_VIEWBOX_RE = /^-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?$/

const isTarget = (v: unknown): v is VaultLauncherTarget => v === 'normal' || v === 'inbox' || v === 'today'
const isBadgeKind = (v: unknown): v is VaultLauncherBadge['kind'] => v === 'emoji' || v === 'letters' || v === 'material'

/** Portable launcher preset synced in `<vault>/.yaseendocs/settings.json` (`launcher`) or `SettingsState.workspaceLaunchers`. */
export interface VaultLauncherPreset {
  name: string
  target?: VaultLauncherTarget
  badge?: VaultLauncherBadge
  /** Present (`'vault-icon.png'`) when a vault uses a custom uploaded PNG instead of a badge recipe. */
  iconFile?: typeof VAULT_ICON_FILE
}

/** Default 1–2 letter monogram initials from a vault name (e.g. "Business Wiki" -> "BW", "Notes" -> "NO"). */
export function vaultInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_/]+/)
    .filter((w) => w.length > 0)
  if (words.length === 0) return 'YD'
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase()
  return `${[...words[0]][0] ?? ''}${[...words[1]][0] ?? ''}`.toUpperCase()
}

/** Case-insensitive lookup key for synced workspace launcher presets (`SettingsState.workspaceLaunchers`). */
export function workspaceLauncherKey(name: string): string {
  return name.trim().toLowerCase()
}

function cleanPresetName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim()
  if (cleaned.length === 0 || cleaned.length > MAX_PRESET_NAME_LEN) return null
  return cleaned
}

/** Sanitize an array of compact SVG `<path d="...">` strings for a bundled Material icon badge. */
export function sanitizeBadgeSvgPaths(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BADGE_SVG_PATHS) return undefined
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return undefined
    const d = item.trim()
    if (d.length === 0 || d.length > MAX_BADGE_SVG_PATH_LEN || !SVG_PATH_D_RE.test(d)) return undefined
    out.push(d)
  }
  return out
}

/** Sanitize an optional SVG `viewBox` string (`"minX minY width height"`). */
export function sanitizeBadgeSvgViewBox(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const vb = raw.trim().replace(/\s+/g, ' ')
  return SVG_VIEWBOX_RE.test(vb) ? vb : undefined
}

/** Pure: validate and normalize a `VaultLauncherBadge` (including optional `svgPaths` / `svgViewBox` for material icons). */
export function sanitizeVaultLauncherBadge(raw: unknown): VaultLauncherBadge | undefined {
  if (!isRecord(raw)) return undefined
  const kind = raw.kind
  const value = typeof raw.value === 'string' ? raw.value.trim() : ''
  const color = raw.color
  if (!isBadgeKind(kind)) return undefined
  if (value.length === 0 || value.length > 64) return undefined
  if (typeof color !== 'string' || !HEX_COLOR_RE.test(color)) return undefined

  const badge: VaultLauncherBadge = {
    kind,
    value,
    color,
  }
  if (kind === 'material') {
    const svgPaths = sanitizeBadgeSvgPaths(raw.svgPaths)
    if (svgPaths !== undefined) {
      badge.svgPaths = svgPaths
      const svgViewBox = sanitizeBadgeSvgViewBox(raw.svgViewBox)
      if (svgViewBox !== undefined && svgViewBox !== '0 0 16 16') {
        badge.svgViewBox = svgViewBox
      }
    }
  }
  return badge
}

/**
 * Pure: validate and normalize a synced `VaultLauncherPreset`, or `null` when invalid or missing both `badge` and `iconFile`.
 */
export function sanitizeVaultLauncherPreset(raw: unknown): VaultLauncherPreset | null {
  if (!isRecord(raw)) return null
  const name = cleanPresetName(raw.name)
  if (name === null) return null

  const badge = sanitizeVaultLauncherBadge(raw.badge)
  const iconFile = badge === undefined && raw.iconFile === VAULT_ICON_FILE ? VAULT_ICON_FILE : undefined
  if (badge === undefined && iconFile === undefined) return null

  const out: VaultLauncherPreset = { name }
  if (isTarget(raw.target)) {
    out.target = raw.target
  }
  if (badge !== undefined) out.badge = badge
  else if (iconFile !== undefined) out.iconFile = iconFile
  return out
}

/** Lighten or darken a `#rrggbb` hex colour by `amount` (-1..1). */
export function shadeHex(hex: string, amount: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const num = Number.parseInt(clean, 16)
  if (!Number.isFinite(num)) return hex
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  const r = clamp(((num >> 16) & 255) + 255 * amount)
  const g = clamp(((num >> 8) & 255) + 255 * amount)
  const b = clamp((num & 255) + 255 * amount)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Pure: render a `VaultLauncherBadge` into a self-contained SVG data URL (`data:image/svg+xml;charset=utf-8,...`)
 * matching the macOS squircle badge aesthetic so Desktop switcher/Welcome/Settings previews work on Mac #2
 * without requiring a local `.app` or `<canvas>`.
 */
export function renderBadgeSvgDataUrl(badge: VaultLauncherBadge): string {
  const safeColor = HEX_COLOR_RE.test(badge.color) ? badge.color : '#007AFF'
  const top = shadeHex(safeColor, 0.1)
  const bottom = shadeHex(safeColor, -0.08)
  let inner: string
  if (badge.kind === 'material' && badge.svgPaths !== undefined && badge.svgPaths.length > 0) {
    const vb = badge.svgViewBox ?? '0 0 16 16'
    const paths = badge.svgPaths.map((d) => `<path d="${escapeXml(d)}" fill="#ffffff"/>`).join('')
    inner = `<svg x="124" y="124" width="264" height="264" viewBox="${escapeXml(vb)}">${paths}</svg>`
  } else if (badge.kind === 'emoji') {
    inner = `<text x="256" y="274" text-anchor="middle" dominant-baseline="central" font-size="250" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${escapeXml(badge.value)}</text>`
  } else {
    const label = (badge.kind === 'letters' ? badge.value : badge.value.slice(0, 2)).slice(0, 2).toUpperCase()
    const fontSize = label.length <= 1 ? 245 : 208
    inner = `<text x="256" y="266" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-weight="700" font-size="${fontSize}" font-family="-apple-system, BlinkMacSystemFont, SF Pro Rounded, sans-serif">${escapeXml(label)}</text>`
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${top}"/><stop offset="100%" stop-color="${bottom}"/></linearGradient>` +
    `<linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
    `</defs>` +
    `<rect x="20" y="20" width="472" height="472" rx="106" fill="url(#bg)"/>` +
    `<rect x="20" y="20" width="472" height="236" rx="106" fill="url(#sh)"/>` +
    `${inner}` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
