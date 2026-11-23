/**
 * Bullet threading per page (YAZ-4432, D29 on YAZ-4278): the rule of guide lines (guideLinesCss.test.ts). The page's own
 * choice wins — `data-threading` on a page's host, or on a preview's own `.editor-instance` — and a page with none
 * follows the app default on `:root`. CSS is not computed here, so the proof is each rule's selectors, read from the
 * stylesheet, matched against a DOM of two page panes and three previews.
 */
import { afterEach, describe, expect, it } from 'vitest'
import threadCss from './bulletThreading.css?inline'
import sectionCss from './sectionIndent.css?inline'

/** Every rule of a sheet, comments gone: each selector of its list (split at the commas outside `:is(…)`), and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(/,(?![^(]*\))/).map((s) => s.trim()), body }))

/** The selector list of the first rule whose body has `body`, pseudo-elements off (`matches` takes none). */
const selectorOf = (css: string, body: string): string => {
  const rule = rulesOf(css).find((one) => one.body.includes(body))
  if (rule === undefined) throw new Error(`no rule with ${body}`)
  return rule.selectors.map((one) => one.replace('::before', '')).join(', ')
}

/** One editor's list item on the thread, and one section block on the path, as the CSS sees them. */
const body = '<div class="milkdown"><div class="ProseMirror"><div class="milkdown-list-item-block outline-thread-seg outline-thread-stop outline-thread-node"><li class="list-item"><div class="label-wrapper"></div></li></div><p data-sp="1"></p></div></div>'
const PANES = ['page', 'pageOn', 'pageOff', 'preview', 'previewOn', 'previewOff'] as const

function mountPanes(): void {
  document.body.innerHTML = [
    // A split view: three page panes side by side in one `.app`, each with its own host.
    `<div class="app"><div class="editor-host" id="page"><div class="editor-instance">${body}</div></div>`,
    `<div class="editor-host" id="pageOn" data-threading="on"><div class="editor-instance">${body}</div></div>`,
    `<div class="editor-host" id="pageOff" data-threading="off"><div class="editor-instance">${body}</div></div></div>`,
    // Previews portalled to <body>, outside `.app`.
    `<div class="board-preview" id="preview"><div class="editor-instance">${body}</div></div>`,
    `<div class="board-preview" id="previewOn"><div class="editor-instance" data-threading="on">${body}</div></div>`,
    `<div class="board-preview" id="previewOff"><div class="editor-instance" data-threading="off">${body}</div></div>`,
  ].join('')
}

/** The panes whose `target` the rule with `ruleBody` reaches. */
const drawn = (css: string, ruleBody: string, target: string): string[] => {
  const selector = selectorOf(css, ruleBody)
  return PANES.filter((id) => document.querySelector(`#${id} ${target}`)!.matches(selector))
}

const html = document.documentElement

afterEach(() => {
  delete html.dataset.threading
  document.body.innerHTML = ''
})

describe('bullet threading per page (YAZ-4432)', () => {
  it('the app default Off draws only on the pages that chose On; Off panes and default panes in the same split view draw nothing', () => {
    mountPanes()
    html.dataset.threading = 'off'
    expect(drawn(threadCss, 'border-left', 'li.list-item')).toEqual(['pageOn', 'previewOn'])
    expect(drawn(threadCss, 'border-bottom', 'li.list-item')).toEqual(['pageOn', 'previewOn'])
    expect(drawn(threadCss, '--list-marker-color', '.label-wrapper')).toEqual(['pageOn', 'previewOn'])
  })

  it('the app default On draws on every page except the ones that chose Off', () => {
    mountPanes()
    html.dataset.threading = 'on'
    expect(drawn(threadCss, 'border-left', 'li.list-item')).toEqual(['page', 'pageOn', 'preview', 'previewOn'])
    expect(drawn(threadCss, 'border-bottom', 'li.list-item')).toEqual(['page', 'pageOn', 'preview', 'previewOn'])
    expect(drawn(threadCss, '--list-marker-color', '.label-wrapper')).toEqual(['page', 'pageOn', 'preview', 'previewOn'])
  })

  it('the section-indent path takes the same per-page switch', () => {
    mountPanes()
    html.dataset.threading = 'off'
    expect(drawn(sectionCss, '--l1: var(--thread-color', 'p[data-sp]')).toEqual(['pageOn', 'previewOn'])
    html.dataset.threading = 'on'
    expect(drawn(sectionCss, '--l1: var(--thread-color', 'p[data-sp]')).toEqual(['page', 'pageOn', 'preview', 'previewOn'])
  })

  it('`.app` no longer gates threading: an app root that says on draws nothing on a page with no choice', () => {
    mountPanes()
    document.querySelector<HTMLElement>('.app')!.dataset.threading = 'on'
    expect(drawn(threadCss, 'border-left', 'li.list-item')).toEqual(['pageOn', 'previewOn'])
    expect(`${threadCss}${sectionCss}`).not.toContain(".app[data-threading")
  })
})
