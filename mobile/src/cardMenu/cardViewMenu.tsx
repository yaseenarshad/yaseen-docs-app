import type { ReactNode, RefObject } from 'react'
import type { Answers } from '../answers/answers'
import { usePageTools } from '../page/PageTools'
import { Toast, useToast } from '../screens/Toast'
import { CardMenuFor } from './lazy'
import './cardMenu.css'

/**
 * THE CARD VIEW'S ⋯ (YAZ-5504; a card opened from Search, Favorites, Recent or a sheet): the reader's own tools menu
 * (`usePageTools`) with the card's actions as its first section (Up next while the vault reviews, Archive card, Fix
 * later, Title on the front; two taps each), then "Find in card". What was done shows in the app's quiet toast; the card
 * itself shows it at once (the view reads the card as the phone shows it, `shownText`).
 */
export function useCardViewMenu(host: RefObject<HTMLElement | null>, options: { title: string; path: string; id: string | null; answers: Answers | null; upNext: boolean }): { button: ReactNode; bar: ReactNode; toast: ReactNode } {
  const [said, say] = useToast(2500)
  const { title, path, id, answers, upNext } = options
  // YAZ-5498: the full title (and folder) on top when the top bar cuts it.
  const tools = usePageTools(host, {
    title,
    path,
    label: 'Card tools',
    find: 'Find in card',
    headings: false,
    section: id === null ? undefined : (close) => <CardMenuFor answers={answers} path={path} id={id} upNext={upNext} onClose={close} onNotice={say} />,
  })
  return { button: tools.button, bar: tools.bar, toast: said !== null && <Toast text={said} /> }
}
