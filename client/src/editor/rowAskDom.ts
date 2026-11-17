import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { AskInPlace } from '../components/AskInPlace'
import '../sidebar/rowAsk.css'

/**
 * A DOM menu row's ask in place (YAZ-5696 with YAZ-5697): the page's own menus (`blockHandleMenu.ts`: a card in a page's
 * ⋯, a card embed's) are drawn without React, so the row's place takes the app's ONE in-place ask (`AskInPlace`, the
 * one `ContextMenu`'s rows show): its question, then Cancel (first, with the focus) and the answer. Cancel, Esc or the
 * focus leaving it puts the row back; only the answer runs `onYes`. A lazy chunk: the menu loads it at the first ask.
 */
export function askInPlace(row: HTMLButtonElement, ask: { question: string; yes: string; danger?: boolean }, onYes: () => void): void {
  const box = document.createElement('div')
  box.style.display = 'contents'
  const root = createRoot(box)
  let done = false
  const end = (): void => {
    if (done) return
    done = true
    queueMicrotask(() => root.unmount())
  }
  const back = (): void => {
    if (done) return
    end()
    box.replaceWith(row)
    row.focus({ preventScroll: true })
  }
  row.replaceWith(box)
  root.render(
    createElement(AskInPlace, {
      question: ask.question,
      yes: ask.yes,
      danger: ask.danger === true,
      className: 'ctx-menu__ask',
      buttonRole: 'menuitem',
      onNo: back,
      onYes: () => {
        end()
        onYes()
      },
    }),
  )
}
