import { describe, expect, it } from 'vitest'
import guideCss from './guideLines.css?inline'
import threadCss from './bulletThreading.css?inline'

/** Every rule of a sheet, comments gone: each selector of its list (split at the commas outside `:is(…)`), and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(/,(?![^(]*\))/).map((s) => s.trim()), body }))

const STRIP = '.milkdown .milkdown-list-item-block li.list-item > .children > .content-dom > :is(ul, ol)::before'

describe('guide lines CSS contract (YAZ-4094 D2–D4, G2, G3)', () => {
  const rules = rulesOf(guideCss)
  const bodyOf = (selector: string) => rules.find((rule) => rule.selectors.includes(selector))?.body ?? ''

  it('G3: the line and its hover take Settings › Outline › "Guide line darkness", 15% and 35% when absent', () => {
    expect(bodyOf(`.editor-instance ${STRIP}`)).toContain('color-mix(in srgb, currentColor var(--guide-line-darkness, 15%), transparent)')
    expect(bodyOf(`.editor-instance .milkdown .milkdown-list-item-block li.list-item > .children > .content-dom > :is(ul, ol).outline-guide-hover::before`)).toContain('var(--guide-line-darkness-hover, 35%)')
  })

  it('D2, D3: Off removes the strip itself — the page’s own choice (a page’s host, a preview’s instance), or the app default on :root where the page made none — so no line, no hover and no click', () => {
    const off = rules.find((rule) => rule.body.includes('content: none'))
    expect(off?.selectors).toEqual([
      `.editor-host[data-guide-lines='off'] .editor-instance ${STRIP}`,
      `.editor-instance[data-guide-lines='off'] ${STRIP}`,
      `:root[data-guide-lines='off'] .editor-instance:not(.editor-host[data-guide-lines='on'] .editor-instance, [data-guide-lines='on']) ${STRIP}`,
    ])
  })

  it('G2: "Only near the mouse" hides the line, not the strip, while the mouse is off the page', () => {
    const near = rules.find((rule) => rule.selectors.some((s) => s.includes("data-guide-lines-show='near'")))
    expect(near?.selectors).toEqual([":root[data-guide-lines-show='near'] .editor-instance .milkdown > .ProseMirror:not(:hover) .milkdown-list-item-block li.list-item > .children > .content-dom > :is(ul, ol)::before"])
    expect(near?.body.trim()).toBe('background-image: none;')
  })

  it('F1: with folding off the line still shows but is no button — `cursor: auto` — on the same three levels as Off', () => {
    const auto = rules.find((rule) => rule.body.includes('cursor: auto'))
    expect(auto?.selectors).toEqual([
      `.editor-host[data-folding='off'] .editor-instance ${STRIP}`,
      `.editor-instance[data-folding='off'] ${STRIP}`,
      `:root[data-folding='off'] .editor-instance:not(.editor-host[data-folding='on'] .editor-instance, [data-folding='on']) ${STRIP}`,
    ])
    expect(auto?.body.trim()).toBe('cursor: auto;')
  })

  it('fix 3: the Off and folding rules reach a preview portalled to <body> outside `.app`, and the page’s own key wins in both directions', () => {
    /** The nested list of one editor, as the CSS sees it: the rule's selectors, `::before` taken off, matched against it. */
    const list = '<div class="milkdown"><div class="milkdown-list-item-block"><li class="list-item"><div class="children"><div class="content-dom"><ul></ul></div></div></li></div></div>'
    document.body.innerHTML = [
      `<div class="app"><div class="editor-host" id="page"><div class="editor-instance">${list}</div></div></div>`,
      `<div class="app"><div class="editor-host" id="pageOn" data-guide-lines="on" data-folding="on"><div class="editor-instance">${list}</div></div></div>`,
      `<div class="board-preview"><div class="editor-instance" id="preview">${list}</div></div>`,
      `<div class="board-preview"><div class="editor-instance" id="previewOn" data-guide-lines="on" data-folding="on">${list}</div></div>`,
      `<div class="board-preview"><div class="editor-instance" id="previewOff" data-guide-lines="off" data-folding="off">${list}</div></div>`,
    ].join('')
    const hits = (body: string): string[] => {
      const selector = rules.find((rule) => rule.body.includes(body))!.selectors.map((one) => one.replace('::before', '')).join(', ')
      return ['page', 'pageOn', 'preview', 'previewOn', 'previewOff'].filter((id) => document.querySelector(`#${id} ul`)!.matches(selector))
    }
    const html = document.documentElement
    try {
      html.dataset.guideLines = 'off'
      html.dataset.folding = 'off'
      expect(hits('content: none')).toEqual(['page', 'preview', 'previewOff'])
      expect(hits('cursor: auto')).toEqual(['page', 'preview', 'previewOff'])
      html.dataset.guideLines = 'on'
      html.dataset.folding = 'on'
      expect(hits('content: none')).toEqual(['previewOff'])
      expect(hits('cursor: auto')).toEqual(['previewOff'])
    } finally {
      delete html.dataset.guideLines
      delete html.dataset.folding
      document.body.innerHTML = ''
    }
  })

  it('D4: the thread draws its own path and does not depend on the guide lines', () => {
    expect(threadCss).not.toContain('data-guide-lines')
  })
})
