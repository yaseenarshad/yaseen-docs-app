import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Answers } from '../answers/answers'
import { Toast, useToast } from '../screens/Toast'
import { CardMenuFor } from './lazy'
import { CARD_MORE_ATTR } from './moreButton'
import './cardMenu.css'

/**
 * A PAGE CARD'S ⋯ MENU (YAZ-5504): a tap on the ⋯ at the right of a card's head in the page (`moreButton.ts`) opens
 * the card actions for THAT card, under the ⋯, in the card's own box. A tap outside, Escape, the ⋯ again, or an action
 * closes it. What was done shows in the app's quiet toast; the card shows it at once (the page reads `shownText`). The
 * page view mounts it with one line; the rows are a lazy chunk (`CardMenuFor`).
 */
export function usePageCardMenu(host: RefObject<HTMLElement | null>, options: { path: string; answers: Answers | null; upNext: boolean }): ReactNode {
  const [said, say] = useToast(2500)
  const [open, setOpen] = useState<{ id: string; button: HTMLElement } | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  // The ⋯ of a card: the page's DOM is drawn by `renderPage`, so one listener on the page's box.
  useEffect(() => {
    const el = host.current
    if (el === null) return
    const click = (e: Event) => {
      const button = e.target instanceof Element ? e.target.closest<HTMLElement>(`[${CARD_MORE_ATTR}]`) : null
      if (button === null || !el.contains(button)) return
      // Only the app's own ⋯ of the page's own card (the text cannot forge one: YAZ-5280): its card box names the ID.
      const id = button.getAttribute(CARD_MORE_ATTR)!
      if (!button.classList.contains('card__more') || button.closest<HTMLElement>('.page-card')?.dataset.cardId !== id) return
      setOpen((now) => (now?.button === button ? null : { id, button }))
    }
    el.addEventListener('click', click)
    return () => el.removeEventListener('click', click)
  }, [host])
  // aria-expanded on the ⋯; a tap outside the menu (and not on its ⋯) or Escape closes it.
  useEffect(() => {
    if (open === null) return
    open.button.setAttribute('aria-expanded', 'true')
    const away = (e: Event) => {
      if (!(e.target instanceof Node) || menu.current?.contains(e.target) === true || open.button.contains(e.target)) return
      setOpen(null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(null)
      open.button.focus()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      open.button.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const box = open?.button.parentElement ?? null
  const toast = said !== null && <Toast text={said} />
  if (open === null || box === null || !box.isConnected) return toast
  return (
    <>
      {toast}
      {createPortal(
        <div className="card-menu" role="menu" aria-label={`Card actions: ${open.id}`} ref={menu}>
          <CardMenuFor answers={options.answers} path={options.path} id={open.id} upNext={options.upNext} onClose={() => setOpen(null)} onNotice={say} />
        </div>,
        box,
      )}
    </>
  )
}
