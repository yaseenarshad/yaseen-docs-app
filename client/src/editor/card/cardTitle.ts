/**
 * THE CARD'S TITLE outside React (YAZ-5164 part 3, Yaseen: "Yes, build it"): a card in a page (`cardBlockView.ts`) and a
 * card embed (`cardEmbed.ts`) are drawn without React, and show their title in the head with the page title's own
 * component, `PageTitle`: the one a card file's tab shows (YAZ-5104). A click renames it, and in a page locked by Read
 * only the click is an edit attempt that carries the rename (YAZ-5145 round 2: "unlock, then continue"). No second
 * copy of its look or its keys. Where the title is stored is the caller's (`onRetitle`): a card in a page writes its
 * first line (`cardRetitled`).
 *
 * React is woken only for a title someone reaches (the pointer comes over it, the keyboard comes to it, a press): until
 * then the box is the component's own markup, drawn here (a page of 50 cards makes no 50 React roots on open).
 */
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type { PathTitles } from '../../lib/pageLabel'
import { PageTitle } from '../PageTitle'

export interface CardTitleProps {
  /** The card's title as plain text; '' for a card with none yet. */
  title: string
  /** The page cannot be edited now (Read only, a read layer): a click is an edit attempt, told to the page's chip. */
  readOnly: boolean
  /** The new title, left in the field (Enter, a click away). Not called for the same title or an empty one. */
  onRetitle: (title: string) => void
}

export interface CardTitleHandle {
  /** The box to put in the card's head. */
  readonly dom: HTMLElement
  /** Draws the title with `props`; `now`: at once (a press about to click it reads what it shows). */
  render: (props: CardTitleProps, now?: boolean) => void
  destroy: () => void
}

const NO_TITLES: PathTitles = new Map()
/** What a card with no title shows in its head. */
export const UNTITLED_CARD = 'Untitled card'

export function mountCardTitle(): CardTitleHandle {
  const dom = document.createElement('div')
  dom.className = 'card__title'
  // Until React wakes: `PageTitle`'s own markup, the heading with the title's text.
  const box = document.createElement('div')
  box.className = 'page-title'
  const heading = document.createElement('h1')
  box.append(heading)
  dom.append(box)
  let root: Root | null = null
  let latest: CardTitleProps | null = null
  let drawn: { title: string; readOnly: boolean } | null = null
  // The door is read when the field is left: a draw with a new door and the same look draws nothing.
  const onRetitle = (title: string): void => latest?.onRetitle(title)
  const paint = (): void => {
    if (latest === null) return
    root ??= createRoot(dom)
    root.render(createElement(PageTitle, { path: '', titles: NO_TITLES, text: latest.title, placeholder: UNTITLED_CARD, readOnly: latest.readOnly, locked: latest.readOnly ? 'card' : false, onRetitle }))
  }
  const still = (props: CardTitleProps): void => {
    heading.className = `page-title__text${props.title === '' ? ' page-title__text--empty' : ''}`
    heading.textContent = props.title === '' ? UNTITLED_CARD : props.title
  }
  /** React takes the box over, at once: the click that follows lands on its heading. */
  const wake = (): void => {
    if (root === null && latest !== null) flushSync(paint)
  }
  dom.addEventListener('pointerenter', wake)
  dom.addEventListener('mouseenter', wake)
  return {
    dom,
    render(props, now = false) {
      latest = props
      if (!now && drawn !== null && drawn.title === props.title && drawn.readOnly === props.readOnly) return
      drawn = { title: props.title, readOnly: props.readOnly }
      if (root === null && !now) return still(props)
      if (now) flushSync(paint)
      else paint()
    },
    destroy() {
      latest = null
      dom.removeEventListener('pointerenter', wake)
      dom.removeEventListener('mouseenter', wake)
      const r = root
      root = null
      // Not inside React's own commit: a card view can go while a page renders.
      if (r !== null) queueMicrotask(() => r.unmount())
    },
  }
}
