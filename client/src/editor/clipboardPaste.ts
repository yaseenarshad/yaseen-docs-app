import { editorViewOptionsCtx, parserCtx } from '@milkdown/kit/core'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { CLIPBOARD_EMPTY_PARAGRAPH } from './clipboardCopyOut'
import { externalNumberedHTML, literalNumberedHTML, parseLiteralNumberedPaste } from './clipboardNumbers'

/** A root-level BR between paragraphs is one blank paragraph, not a paragraph with two visual lines. */
function normalizeParagraphSeparators(html: string): string {
  if (!/<br\b/i.test(html)) return html
  const template = document.createElement('template')
  template.innerHTML = html
  let changed = false
  // Our standalone copy-out separators must recover block identity, including inside a PM slice.
  for (const separator of template.content.querySelectorAll(`br[${CLIPBOARD_EMPTY_PARAGRAPH}]`)) {
    const paragraph = document.createElement('p')
    for (const { name, value } of separator.attributes) {
      if (name !== CLIPBOARD_EMPTY_PARAGRAPH) paragraph.setAttribute(name, value)
    }
    separator.replaceWith(paragraph)
    changed = true
  }
  if (/data-pm-slice\s*=/i.test(html)) return changed ? template.innerHTML : html
  const nodes = [...template.content.childNodes].filter(node => node.nodeType !== 8 && !(node.nodeType === 3 && !node.textContent?.trim()))
  for (let i = 1; i < nodes.length - 1; i++) {
    if (nodes[i - 1].nodeName !== 'P' || nodes[i].nodeName !== 'BR') continue
    let end = i
    while (nodes[end]?.nodeName === 'BR') end++
    if (nodes[end]?.nodeName !== 'P') continue
    for (let j = i; j < end; j++) nodes[j].replaceWith(document.createElement('p'))
    changed = true
    i = end
  }
  return changed ? template.innerHTML : html
}

/** Explicit modes share the same schema, paste rules, selection and undo as ordinary paste. */
export const clipboardPaste = $prose((ctx) => {
  ctx.update(editorViewOptionsCtx, prev => ({
    ...prev,
    transformPastedHTML: (html, view) => literalNumberedHTML(normalizeParagraphSeparators(prev.transformPastedHTML?.(html, view) ?? html)),
    handlePaste: (view, event, slice) => {
      if (!view.editable) return true
      // Guard before the fake-outline handler: code must never become a list.
      if (view.state.selection.$from.parent.type.spec.code) {
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (text) view.dispatch(closeHistory(view.state.tr).insertText(text.replace(/\r\n?/g, '\n')).setMeta('paste', true).setMeta('uiEvent', 'paste'))
        return true
      }
      if (prev.handlePaste?.(view, event, slice)) return true
      const data = event.clipboardData
      if (data?.getData('vscode-editor-data')) return false
      const html = data?.getData('text/html') ?? ''
      if (externalNumberedHTML(html)) {
        // ProseMirror already parsed the normalized HTML and applied transformPasted.
        view.dispatch(closeHistory(view.state.tr).replaceSelection(slice).setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
        return true
      }
      if (!html) {
        const doc = parseLiteralNumberedPaste(ctx, data?.getData('text/plain') ?? '')
        if (doc) {
          let literal = Slice.maxOpen(doc.content)
          view.someProp('transformPasted', transform => { literal = transform(literal, view, false) })
          view.dispatch(closeHistory(view.state.tr).replaceSelection(literal).setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
          return true
        }
      }
      return false
    },
  }))
  return new Plugin({
    key: new PluginKey('mdapp-clipboard-paste'),
    view: (view) => {
      const unsubscribe = window.yaseenDocs?.menu?.onPasteAs?.(({ mode, text }) => {
        // CodeMirror and ordinary inputs keep native text insertion at their own caret.
        if (!view.hasFocus()) return false
        if (!view.editable || !text) return true
        text = text.replace(/\r\n?/g, '\n')
        const { schema, selection } = view.state
        const tr = closeHistory(view.state.tr)
        if (selection.$from.parent.type.spec.code) {
          tr.insertText(text)
        } else {
          let slice: Slice
          if (mode === 'markdown') {
            slice = Slice.maxOpen(ctx.get(parserCtx)(text).content)
          } else {
            const inline: ProseNode[] = []
            text.split('\n').forEach((line, i) => {
              if (i) inline.push(schema.nodes.hardbreak.create())
              if (line) inline.push(schema.text(line))
            })
            slice = Slice.maxOpen(Fragment.from(schema.nodes.paragraph.create(null, inline)))
          }
          // Includes table repair and the folder-page outline's bullets-only conversion.
          view.someProp('transformPasted', transform => { slice = transform(slice, view, mode === 'plain') })
          tr.replaceSelection(slice)
        }
        view.dispatch(tr.setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
        return true
      })
      return { destroy: () => unsubscribe?.() }
    },
  })
})
