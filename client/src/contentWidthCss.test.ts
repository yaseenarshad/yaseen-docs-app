import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'
import commentsCss from './comments/comments.css?inline'
import backlinksCss from './links/backlinks.css?inline'
import folderPageCss from './views/folderPageContents.css?inline'

const maxWidthFor = (css: string, selector: string): string | undefined => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*max-width:\\s*([^;]+);`, 's'))?.[1].trim()
}

describe('content-width CSS contract (YAZ-1176)', () => {
  it('maps the three presets once on the app container', () => {
    expect(appCss).toMatch(/\.app\s*\{[^}]*--content-max-width:\s*1040px;/s)
    expect(appCss).toMatch(/\.app\[data-content-width=['"]medium['"]\]\s*\{[^}]*--content-max-width:\s*1440px;/s)
    expect(appCss).toMatch(/\.app\[data-content-width=['"]full['"]\]\s*\{[^}]*--content-max-width:\s*none;/s)
  })

  it('routes every aligned shell through the one shared token', () => {
    expect(maxWidthFor(appCss, '.page-header')).toBe('var(--content-max-width)')
    expect(maxWidthFor(appCss, '.editor-instance')).toBe('var(--content-max-width)')
    expect(maxWidthFor(folderPageCss, '.folder-page-contents')).toBe('var(--content-max-width)')
    expect(maxWidthFor(commentsCss, '.comments')).toBe('var(--content-max-width)')
    expect(maxWidthFor(backlinksCss, '.backlinks')).toBe('var(--content-max-width)')
  })

  it('the scroller owns the page\'s ONE tail; the blocks under the note carry no tail and no hairline (YAZ-1680)', () => {
    expect(appCss).toMatch(/\.editor-host\s*\{[^}]*padding-bottom:\s*64px;/s)
    for (const [css, selector] of [
      [folderPageCss, '.folder-page-contents'],
      [commentsCss, '.comments'],
      [backlinksCss, '.backlinks'],
    ] as const) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1]
      expect(rule, selector).toMatch(/padding:\s*0 48px;/)
      expect(rule, selector).not.toMatch(/border/)
    }
  })
})
