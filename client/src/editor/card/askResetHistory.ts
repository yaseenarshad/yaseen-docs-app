/**
 * The ONE door to a card's Reset history (YAZ-5376): every ⋯ menu that has the row (a card in a page, its embed's,
 * the card window, the card file tab, Explore's card) asks through here. It opens `ResetHistorySheet` over the window
 * and runs `reset` only once `reset` is typed and confirmed. React and the sheet load on the first ask: a page that
 * never asks loads neither (the card in a page is drawn without React).
 */
let open: (() => void) | null = null

export function askResetHistory(id: string | null, reset: () => void): void {
  // One box at a time: a second ask closes the first.
  open?.()
  let gone = false
  const host = document.createElement('div')
  document.body.appendChild(host)
  let unmount = (): void => {}
  const close = (): void => {
    if (gone) return
    gone = true
    if (open === close) open = null
    unmount()
    host.remove()
  }
  open = close
  void Promise.all([import('react'), import('react-dom/client'), import('../../review/ResetHistorySheet')]).then(([react, dom, sheet]) => {
    if (gone) return
    const root = dom.createRoot(host)
    // After the click that closes it: a root does not unmount inside its own event.
    unmount = () => queueMicrotask(() => root.unmount())
    root.render(
      react.createElement(sheet.ResetHistorySheet, {
        id,
        onConfirm: () => {
          close()
          reset()
        },
        onCancel: close,
      }),
    )
  })
}
