/**
 * Where an editor's pop-up toolbar is (YAZ-4445). A note's toolbar sits beside its view. A drawing text box moves
 * its toolbar into a layer of its own on the page (`drawings/textBoxEditor.ts`, YAZ-4277 1C), so a ▾ panel looks
 * there for its ▾.
 */
import type { EditorView } from '@milkdown/kit/prose/view'

const layers = new WeakMap<EditorView, HTMLElement>()

/** The layer that holds this editor's pop-ups, when they are not beside its view. */
export const setPopupLayer = (view: EditorView, layer: HTMLElement): void => void layers.set(view, layer)

/** The layer of this editor's pop-ups, or null when they sit beside its view. */
export const popupLayerOf = (view: EditorView): HTMLElement | null => layers.get(view) ?? null

/** This editor's pop-up toolbar, or null while it is not drawn: in its layer, else (not moved yet) beside the view. */
export const toolbarOf = (view: EditorView): HTMLElement | null =>
  layers.get(view)?.querySelector<HTMLElement>('.milkdown-toolbar') ?? view.dom.parentElement?.querySelector<HTMLElement>('.milkdown-toolbar') ?? null

/** One button of this editor's pop-up toolbar, by its key. */
export const toolbarItemOf = (view: EditorView, key: string): HTMLElement | null =>
  toolbarOf(view)?.querySelector<HTMLElement>(`[data-toolbar-item="${key}"]`) ?? null

/**
 * The board's ▾ marks a color of its own menu with a bar of that color under the ▾ (`styles.scss`,
 * `.text-toolbar-more.is-other`). The bar's color is `--<key>-colour` on the toolbar, set here from the ▾'s `active`
 * check: the toolbar stays one element while Crepe redraws its buttons. A write only when the color changes.
 */
export function showMoreColour(view: EditorView, key: string, colour: string | null): void {
  const toolbar = toolbarOf(view)
  if (toolbar === null) return
  const name = `--${key}-colour`
  if (colour === null) toolbar.style.removeProperty(name)
  else if (toolbar.style.getPropertyValue(name) !== colour) toolbar.style.setProperty(name, colour)
}
