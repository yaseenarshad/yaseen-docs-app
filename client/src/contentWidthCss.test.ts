import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'
import commentsCss from './comments/comments.css?inline'
import backlinksCss from './links/backlinks.css?inline'
import folderViewCss from './views/folderView.css?inline'

const maxWidthFor = (css: string, selector: string): string | undefined => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*max-width:\\s*([^;]+);`, 's'))?.[1].trim()
}

describe('content-width CSS contract (YAZ-1176)', () => {
  it('the column is the text`s widest (App sets it from `CONTENT_TEXT_WIDTHS`, YAZ-5144) and its 48 px sides; no second table of steps here', () => {
    expect(appCss).toMatch(/\.app\s*\{[^}]*--content-max-width:\s*calc\(var\(--content-text-width\) \+ 96px\);/s)
    expect(appCss).not.toMatch(/data-content-width/)
  })

  it("a page's own width (YAZ-5640): the page's scroller works out the column again from the text width it sets, and a card file's column keeps `.app`'s", () => {
    const own = [...appCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|\})\s*([^{}]+)\{([^{}]*--content-max-width:[^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!.trim()])
    expect(own).toEqual([
      ['.app', expect.stringContaining('--content-max-width: calc(var(--content-text-width) + 96px);')],
      ['.editor-host', '--content-max-width: calc(var(--content-text-width) + 96px);'],
    ])
  })

  it('routes every aligned shell through the one shared token', () => {
    expect(maxWidthFor(appCss, '.page-header')).toBe('var(--content-max-width)')
    expect(maxWidthFor(appCss, '.editor-instance')).toBe('var(--content-max-width)')
    expect(maxWidthFor(folderViewCss, '.folder-view')).toBe('var(--content-max-width)')
    expect(maxWidthFor(commentsCss, '.comments')).toBe('var(--content-max-width)')
    expect(maxWidthFor(backlinksCss, '.backlinks')).toBe('var(--content-max-width)')
  })

  it('the scroller owns the page\'s ONE tail; the blocks under the page carry no tail and no hairline (YAZ-1680)', () => {
    expect(appCss).toMatch(/\.editor-host\s*\{[^}]*padding-bottom:\s*64px;/s)
    for (const [css, selector] of [
      [folderViewCss, '.folder-view'],
      [commentsCss, '.comments'],
      [backlinksCss, '.backlinks'],
    ] as const) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1]
      expect(rule, selector).toMatch(/padding:\s*0 48px;/)
      expect(rule, selector).not.toMatch(/border/)
    }
  })

  it("no rule hides a page's body", () => {
    expect(appCss).not.toMatch(/\.editor-mount\s*\{[^}]*display:\s*none/)
  })

  it('document zoom sits on the CONTENT, never on a shell (YAZ-1710 D14): the scroller carries the variable, the content selectors read it, the runner adds the measured slack (D15)', () => {
    // The ONE rule that reads `--document-zoom`, and exactly its selectors: the page's content (the blocks inside each shell,
    // and ProseMirror itself) and the Inbox card's frame (YAZ-5372 reuses this rule). A shell added here fails.
    const zoomRules = [...appCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*zoom:\s*var\(--document-zoom, 1\);[^{}]*)\}/g)]
    expect(zoomRules).toHaveLength(1)
    expect(zoomRules[0]![1]!.split(',').map((s) => s.trim())).toEqual([
      '.editor-host > :not(.editor-mount) > *',
      '.card-file > * > *',
      '.editor-instance .milkdown > .ProseMirror',
      '.card-inbox__panel',
    ])
    // The `display: contents` properties panel already passes the zoom to its pieces; a second rule
    // on them zoomed the chip twice (6B1).
    expect(appCss).not.toMatch(/\.frontmatter-panel > \*/)
    const scroller = appCss.match(/\.editor-host\s*\{([^}]*)\}/s)?.[1]
    expect(scroller).not.toMatch(/\bzoom:/)
    expect(scroller).toMatch(/overflow-x:\s*auto;/)
    expect(appCss).toMatch(/\.editor-host::after\s*\{[^}]*width:\s*calc\(100% \+ var\(--zoom-slack, 0px\)\);/s)
  })
})
