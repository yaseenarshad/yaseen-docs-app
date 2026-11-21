/**
 * THE CARD'S TITLE outside React (YAZ-5164 part 3, Yaseen: "Yes, build it"): a card in a page (`cardBlockView.ts`) and a
 * card embed (`cardEmbed.ts`) are drawn without React, and show their title in its band with the page title's own
 * component, `PageTitle`: the one a card file's tab shows (YAZ-5104). A click renames it, and in a page locked by Read
 * only the click is an edit attempt that carries the rename (YAZ-5145 round 2: "unlock, then continue"). No second
 * copy of its look or its keys. Where the title is stored is the caller's (`onRetitle`): the card line's `title`
 * (YAZ-5308, `withCardTitle`).
 *
 * React is woken only for a title someone reaches (the pointer comes over it, the keyboard comes to it, a press): until
 * then the box is the component's own markup, drawn here (a page of 50 cards makes no 50 React roots on open).
 *
 * THE TITLE BAND (YAZ-5308 A3, Yaseen: "Yes, this is approved"): the title sits in a shaded band under the card's top
 * bar (`cardBand.ts`). Read, a card with no title has no band: the ID in the top bar names it.
 */
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type { PathTitles } from '../../lib/pageLabel'
import { PageTitle } from '../PageTitle'
import { cardBand, UNTITLED_CARD } from './cardBand'

export interface CardTitleProps {
  /** The card's title as plain text; '' for a card with none yet. */
  title: string
  /** The page cannot be edited now (Read only, a read layer): a click is an edit attempt, told to the page's chip. */
  readOnly: boolean
  /** The new title, left in the field (Enter, a click away). Not called for the same title or an empty one. */
  onRetitle: (title: string) => void
  /** false: the title shows only, and a click does nothing (an embed of a card file: only its tab renames the file). */
  canRename?: boolean
}

export interface CardTitleHandle {
  /** The card's title band, to put under the card's head; hidden while the card has no title. */
  readonly dom: HTMLElement
  /** Draws the title with `props`; `now`: at once (a press about to click it reads what it shows). */
  render: (props: CardTitleProps, now?: boolean) => void
  destroy: () => void
}

const NO_TITLES: PathTitles = new Map()
export function mountCardTitle(): CardTitleHandle {
  const inner = document.createElement('div')
  inner.className = 'card__title'
  // Until React wakes: `PageTitle`'s own markup, the heading with the title's text.
  const box = document.createElement('div')
  box.className = 'page-title'
  const heading = document.createElement('h1')
  box.append(heading)
  inner.append(box)
  const dom = cardBand(inner)
  dom.hidden = true
  let root: Root | null = null
  let latest: CardTitleProps | null = null
  let drawn: { title: string; readOnly: boolean; canRename: boolean } | null = null
  // The door is read when the field is left: a draw with a new door and the same look draws nothing.
  const onRetitle = (title: string): void => latest?.onRetitle(title)
  const paint = (): void => {
    if (latest === null) return
    root ??= createRoot(inner)
    const fixed = latest.canRename === false
    root.render(createElement(PageTitle, { path: '', titles: NO_TITLES, text: latest.title, placeholder: UNTITLED_CARD, readOnly: fixed || latest.readOnly, locked: !fixed && latest.readOnly ? 'card' : false, onRetitle }))
  }
  const still = (props: CardTitleProps): void => {
    heading.className = 'page-title__text'
    heading.textContent = props.title
  }
  /** React takes the box over, at once: the click that follows lands on its heading. */
  const wake = (): void => {
    if (root === null && latest !== null) flushSync(paint)
  }
  inner.addEventListener('pointerenter', wake)
  inner.addEventListener('mouseenter', wake)
  return {
    dom,
    render(props, now = false) {
      latest = props
      // Read, a card with no title has no band (YAZ-5308 A3): the ID in the top bar names it.
      dom.hidden = props.title === ''
      const canRename = props.canRename !== false
      if (!now && drawn !== null && drawn.title === props.title && drawn.readOnly === props.readOnly && drawn.canRename === canRename) return
      drawn = { title: props.title, readOnly: props.readOnly, canRename }
      if (root === null && !now) return still(props)
      if (now) flushSync(paint)
      else paint()
    },
    destroy() {
      latest = null
      inner.removeEventListener('pointerenter', wake)
      inner.removeEventListener('mouseenter', wake)
      const r = root
      root = null
      // Not inside React's own commit: a card view can go while a page renders.
      if (r !== null) queueMicrotask(() => r.unmount())
    },
  }
}
