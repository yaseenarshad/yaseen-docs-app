/**
 * Pure CSS helpers for Settings › Editor › Code blocks › Inline code (YAZ-6452).
 *
 * Keeps `App.tsx` thin: `.app` (and the Settings live preview) stamp `data-inline-code-style`
 * and spread `inlineCodeVars(style)` so changes restyle inline code purely via CSS without
 * remounting any editor.
 */
import type { CSSProperties } from 'react'
import type { InlineCodeCustom, InlineCodePreset, InlineCodeStyle } from '@shared/types'

export type InlineCodeAttr = InlineCodePreset | 'custom'

export const DEFAULT_CUSTOM_INLINE_CODE: InlineCodeCustom = { fg: 'text', bg: 'auto' }

export function isCustomInlineCode(style: InlineCodeStyle | undefined): style is InlineCodeCustom {
  return typeof style === 'object' && style !== null
}

export function inlineCodeAttr(style: InlineCodeStyle | undefined): InlineCodeAttr {
  if (style === undefined) return 'default'
  return isCustomInlineCode(style) ? 'custom' : style
}

export function inlineCodeVars(style: InlineCodeStyle | undefined): CSSProperties {
  if (!isCustomInlineCode(style)) return {}
  const fg = style.fg === 'text' ? 'var(--fg)' : style.fg
  const bg =
    style.bg === 'none'
      ? 'transparent'
      : style.bg === 'auto'
        ? 'color-mix(in srgb, var(--inline-code-fg) 14%, transparent)'
        : style.bg
  return {
    '--inline-code-fg': fg,
    '--inline-code-bg': bg,
  } as CSSProperties
}
