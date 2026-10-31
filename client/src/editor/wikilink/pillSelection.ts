/**
 * A selected link lights up as one box (YAZ-3747 demo): the browser's selection colours only a link's letters, so a
 * pill showed a patchy box, its icon and padding left out. Every link piece inside the selection gets
 * `wikilink--selected`, and `wikilink.css` draws the whole box and keeps the browser's colour off its letters. A link is
 * one unit (`idLinkCaret.ts`), so it is wholly in a selection or wholly out.
 *
 * Typing is never slower: with no selection both parts return at once. A link's text pieces get the class by a
 * decoration over each piece the two link plugins drew (`wikilinkKey`, `markdownLinkKey`); a class set on a text span
 * from outside would make ProseMirror redraw the line. A widget (an ID link's title, a vault name) takes no decoration,
 * so its class is set on its DOM after each update, only in the textblocks the selection touches: ProseMirror ignores a
 * class change on a widget, and keeps a widget's DOM while its key is the same.
 *
 * The lit box is as tall as the browser's selection, which fills the line: `wikilink.css` pads it by half the line's
 * leading, and the leading needs the height of the font's letters. The first selection that lights a pill measures
 * that height once, as a part of the font size (`--pill-letters` on the editor's root); before that, and in a test's
 * DOM, the CSS uses the system font's 1.19.
 */
import { AllSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { markdownLinkKey } from '../markdownLink'
import { WIKILINK_CLASS, wikilinkKey } from './wikilinkPlugin'

export const PILL_SELECTED_CLASS = 'wikilink--selected'

/** The selection to light, or null. A table's cell selection and a node selection have their own look. */
function lightRange(state: EditorState): { from: number; to: number } | null {
  const sel = state.selection
  return sel.empty || !(sel instanceof TextSelection || sel instanceof AllSelection) ? null : sel
}

/** A decoration over every link text piece inside the selection. A hidden piece gets it too: it stays hidden. */
function pieceDecorations(state: EditorState): DecorationSet {
  const range = lightRange(state)
  if (range === null) return DecorationSet.empty
  const out: Decoration[] = []
  for (const set of [wikilinkKey.getState(state), markdownLinkKey.getState(state)]) {
    for (const d of set?.find(range.from, range.to) ?? []) {
      if (d.from < d.to && d.from >= range.from && d.to <= range.to) out.push(Decoration.inline(d.from, d.to, { class: PILL_SELECTED_CLASS }))
    }
  }
  return out.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, out)
}

/** The link widgets inside the selection: a widget sits at its link's end (`side: -1`). */
function selectedWidgets(view: EditorView): Set<Element> {
  const out = new Set<Element>()
  const range = lightRange(view.state)
  if (range === null) return out
  view.state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isTextblock) return true
    const dom = view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return false
    for (const el of dom.querySelectorAll(`.ProseMirror-widget.${WIKILINK_CLASS}`)) {
      const at = view.posAtDOM(el, 0)
      if (at > range.from && at <= range.to) out.add(el)
    }
    return false
  })
  return out
}

/** Measures a lit pill's letters (its box without the padding) as a part of its font size; true once it has. */
function measureLetters(view: EditorView): boolean {
  const sample = view.dom.querySelector(`.${WIKILINK_CLASS}.${PILL_SELECTED_CLASS}`)
  if (!(sample instanceof HTMLElement)) return false
  const style = getComputedStyle(sample)
  const font = parseFloat(style.fontSize)
  const letters = sample.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  if (!(font > 0 && letters > 0)) return false
  ;(view.dom.parentElement ?? view.dom).style.setProperty('--pill-letters', (letters / font).toFixed(4))
  return true
}

export const createPillSelection = () =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-pill-selection'),
        props: { decorations: pieceDecorations },
        view: (view) => {
          let lit = new Set<Element>()
          let measured = false
          return {
            update: () => {
              if (lit.size === 0 && view.state.selection.empty) return
              const next = selectedWidgets(view)
              for (const el of lit) if (!next.has(el)) el.classList.remove(PILL_SELECTED_CLASS)
              for (const el of next) if (!el.classList.contains(PILL_SELECTED_CLASS)) el.classList.add(PILL_SELECTED_CLASS)
              lit = next
              // After the widgets are lit: a line of ID links has no other lit piece to measure.
              if (!measured) measured = measureLetters(view)
            },
          }
        },
      }),
  )
