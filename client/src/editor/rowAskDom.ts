import '../sidebar/rowAsk.css'

/**
 * A DOM menu row's ask in place (YAZ-5696 with YAZ-5697): the page's own menus (`blockHandleMenu.ts`, the card block's
 * ⋯) are drawn without React, so the ContextMenu's `RowAsk` is drawn here the same way: its question, then Cancel
 * (first, with the focus: a stray Enter runs nothing) and the answer, in the confirm sheet's buttons. Cancel, or the
 * focus leaving it, puts the row back; only the answer runs `onYes`. A lazy chunk: the menu loads it at the first ask.
 */
export function askInPlace(row: HTMLButtonElement, ask: { question: string; yes: string; danger?: boolean }, onYes: () => void): void {
  const box = document.createElement('div')
  box.className = 'ctx-menu__ask'
  box.setAttribute('role', 'group')
  box.setAttribute('aria-label', ask.question)
  const text = document.createElement('p')
  text.className = 'confirm__text'
  text.textContent = ask.question
  const actions = document.createElement('div')
  actions.className = 'confirm__actions'
  const button = (label: string, className: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', 'menuitem')
    b.className = className
    b.textContent = label
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', run)
    return b
  }
  let done = false
  const back = (): void => {
    if (done) return
    done = true
    box.replaceWith(row)
    row.focus({ preventScroll: true })
  }
  const cancel = button('Cancel', 'confirm__btn', back)
  const yes = button(ask.yes, ask.danger === true ? 'confirm__btn confirm__btn--danger' : 'confirm__btn', () => {
    done = true
    onYes()
  })
  actions.append(cancel, yes)
  box.append(text, actions)
  box.addEventListener('focusout', (e) => {
    if (!(e.relatedTarget instanceof Node && box.contains(e.relatedTarget))) back()
  })
  row.replaceWith(box)
  cancel.focus({ preventScroll: true })
}
