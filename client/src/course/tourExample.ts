/**
 * THE COACH CARD'S "USE AN EXAMPLE" (YAZ-5125): nobody has to type to get through a tour. A step that asks the person
 * to type has an `example` (`script.ts`); this puts it into the step's real field through the app's own path, so the
 * app's own events fire and the step ends as if the person had typed it.
 *
 * - A text box (`input`, `textarea`; the sidebar's name box): its value is set with the element's own setter and an
 *   `input` event, then, for `enter`, an Enter keydown: the box's own Enter makes the card file.
 * - The card editor: the editor's own typer (`setTourTyper` in `cardEditor.ts`), which types letter by letter through
 *   ProseMirror's `handleTextInput`, after the editor's own New side when the step asks for one.
 *
 * Returns false when the field has no clean way in: the coach then offers nothing.
 */
import type { TourExample } from './tour'
import { tourTyperIn } from './tourBus'

/** The same label as the course's own steps (`USE_AN_EXAMPLE` in `scenes/firstCard.tsx`). */
export const USE_AN_EXAMPLE = 'Use an example'

/** True when "Use an example" can fill `el`. */
export function canFillExample(el: Element | null): boolean {
  if (el === null) return false
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || tourTyperIn(el) !== null
}

export function fillExample(el: Element, example: TourExample): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus({ preventScroll: true })
    // The prototype's setter: a React box hears the change as typing.
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, example.text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    if (example.enter === true) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
    return true
  }
  const typer = tourTyperIn(el)
  if (typer === null) return false
  typer.type(example.text, { newSide: example.newSide === true, lineEnd: example.lineEnd === true })
  return true
}
