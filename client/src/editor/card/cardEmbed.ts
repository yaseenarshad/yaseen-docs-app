/**
 * A CARD EMBED (YAZ-5037): `![[GEO-140]]` in a page shows the card that ID names, wherever it lives — a card file
 * (`kind: card`) or another page. It is not a copy: the same ID, the same history, the same text. The board host draws
 * it (`drawing/boardEmbed.ts`): the same decorations over plain text (no schema change), so the scan, the caret, ⌘F,
 * the fold and "Add line" treat it as they treat a board's window. This file is the box in the host's widget, in a
 * chunk of its own (`loadCardEmbed`, as a board's window is): a page with no card embed never loads it.
 *
 *  - THE HEAD (Q4, locked): ↗, `Embedded from "<name>" · GEO-140`, Edit card, ⋯. The name is the card's title for a
 *    card file (`record.kind === 'card'`), the page's title for a card in a page. A click on it opens the original as a
 *    tab gesture on the card's link does (`follow`, YAZ-5030): the card file's tab, or the page landed on the card. The
 *    ID copies on a click, as on the page's card (D20); "Archived" when the line says `off` (YAZ-5046). Under the head,
 *    the card's title band (YAZ-5308 A3, `cardBand.ts`): a click renames a card in a page; a card file's shows only.
 *  - THE CARD: `renderCard`, the page card's own function; its pills, images and boards as its own page has them.
 *    Read from its file only once the box is near the screen (as a board window waits for the screen), and one time
 *    per version of that file (`cardFileText`, by its path and the index's mtime), however many boxes show its cards.
 *    The head needs no read: the index knows the name, the ID and the state.
 *  - EDIT CARD: the card editor (YAZ-5026, `mountCardEditor`, through `doors.edit`) in the box, with the page card's key row. Done writes the
 *    ORIGINAL file, one `transformFile` (`changeCardTextIn`, the app's own write: an open tab of that file takes it
 *    quietly). The page that embeds it does not change. Read only: Edit card asks first, as the page's card does, and opens after "Allow edits" (YAZ-5145 round 2).
 *  - ⋯ (`cardEmbedMenuRows`): Open card (the card window), Show as link, Put back into this page (YAZ-5037 phase 5:
 *    a card file's card, from an embed alone on its line; the page's convert door writes it), Archive / Unarchive card
 *    (the original's card line, as the page card's row: shown in a read-only page too), Copy card ID.
 *  - MISSING: an ID of this vault that names nothing (`missingId`) says "Missing card · GEO-140", quietly. A pill keeps
 *    its own look ("Missing page · …").
 *
 *  - REVIEWS (YAZ-5105 round 4): a card with reviews has THE Reviews strip under its text, as a card in a page has it
 *    (`reviewsStrip.ts`: the Inbox's own `CardStrip`, YAZ-5380), its parts Reviews and Properties; closed until asked for.
 *    Its delete writes the ORIGINAL file through the vault's door (`doors.reviews`). No door (a hover preview): none.
 *
 * Not here: an embed inside a card (card-in-card is off in the card editor; a card's own render keeps `![[…]]` as text).
 */
import { cleanCardTitle, withCardTitle } from '@shared/cardLine'
import type { CardLink } from '@shared/cardLinks'
import { BridgeRequestError, api } from '../../api'
import { pageLabel, pathTitles } from '../../lib/pageLabel'
import { changeCardLine, changeCardTextIn, cardInContent, type CardAtPage } from '../../review/cardFile'
import { loadCardMenu, withCardMenu } from '../../review/cardMenuLoad'
import type { CardMenuDoors } from '../../review/cardMenuView'
import type { CardMenuMarks } from '@shared/cardMenu'
import type { MenuRow } from '../blockHandleMenu'
import { scrollRootOf } from '../embed/hostWindow'
import { copyText, openMenuAt } from '../linkMenu'
import { missingId, type WikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import type { CardEditor } from './cardEditor'
import { embedCard, recordAt, type CardEmbedHandle, type CardEmbedHost } from './embedCard'
import { CARD_BOARD_ATTR, CARD_MEDIA, CARD_OPENS } from './cardMedia'
import { drawEditButton } from './cardEditKeys'
import { openCardWindow, previewCard } from './cardOpen'
import { mountCardTitle } from './cardTitle'
import { CARD_LINK_ATTR, cardLinkWhere, refreshCardLook, renderCard } from './cardRender'
import type { CardReviewDoorApi } from './cardBlockView'
import { mountReviewsStrip, type ReviewsStripHandle, type StripPart } from './reviewsStrip'
import { tellReadOnlyEdit } from '../readOnlyEdit'
import { CARD_FIND_READ } from '../find/cardFind'
import { pathUnit } from '../../vault/unitWord'
import './cardEmbed.css'

/** How far outside the screen a box starts to read its card (the page's own scroller). */
const NEAR = '600px 0px'

/** The name in the head: a card file's card title, else the title of the page the card is on. */
export function embedName(card: CardLink, source: WikilinkResolveSource): string {
  if (recordAt(source.records, card.path)?.kind === 'card') return card.title === '' ? card.id : card.title
  return pageLabel(card.path, false, pathTitles(source.records, source.folders))
}

/** Counts, for the speed tests: the files read for embeds since the start. */
export const cardEmbedStats = { reads: 0 }

/** Each file's text by its version: the last version read of each path, shared by every box. */
const reads = new Map<string, { version: number | undefined; text: Promise<string | null> }>()

/** The text of the card's file at `version` (the index's mtime): read one time per version; null when it is gone. */
export function cardFileText(path: string, version: number | undefined): Promise<string | null> {
  const held = reads.get(path)
  if (held !== undefined && held.version === version) return held.text
  cardEmbedStats.reads++
  const text = api.readFile(path).then(
    (file) => file.content,
    (err: unknown) => {
      if (reads.get(path)?.text === text) reads.delete(path)
      if (err instanceof BridgeRequestError && err.code === 'NOT_FOUND') return null
      throw err
    },
  )
  reads.set(path, { version, text })
  return text
}

/** One IntersectionObserver per scroll root (null = the viewport), as the board windows share theirs: made with its first box, ended with its last. */
const nearByRoot = new Map<Element | null, { io: IntersectionObserver; count: number }>()
const onNear = new WeakMap<Element, () => void>()

/** `near` runs once `el` comes within `NEAR` of its scroller's view; the returned function stops the watch. */
function whenNear(el: Element, root: Element | null, near: () => void): () => void {
  let held = nearByRoot.get(root)
  if (held === undefined) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) onNear.get(entry.target)?.()
      },
      { root, rootMargin: NEAR },
    )
    held = { io, count: 0 }
    nearByRoot.set(root, held)
  }
  const watch = held
  let done = false
  const stop = (): void => {
    if (done) return
    done = true
    onNear.delete(el)
    watch.io.unobserve(el)
    if (--watch.count > 0) return
    watch.io.disconnect()
    if (nearByRoot.get(root) === watch) nearByRoot.delete(root)
  }
  onNear.set(el, () => {
    stop()
    near()
  })
  watch.count++
  watch.io.observe(el)
  return stop
}

const boxes = new WeakMap<HTMLElement, CardEmbedHandle>()
/** The box drawn in `dom` (a `.card-embed`), or null: for tests, as `cardBlockViewOfDom`. */
export const cardEmbedOfDom = (dom: Element | null): CardEmbedHandle | null => (dom instanceof HTMLElement ? (boxes.get(dom) ?? null) : null)

const button = (className: string, label: string): HTMLButtonElement => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = className
  b.setAttribute('aria-label', label)
  return b
}

/**
 * The ⋯ rows of a card embed (YAZ-5037): the ONE card menu (`review/cardMenuView.ts`, YAZ-5697 round 2), an embed's
 * rows of it — Open card, Preview, Show as link (`editable`: the page), Put back into this page, the review rows and
 * Reset history (they write the ORIGINAL, as a card in a page's do), Copy card ID. `marks`: the card as read, else its
 * index record's.
 */
export function cardEmbedMenuDoors(o: {
  card: CardLink
  marks: CardMenuMarks
  editable: boolean
  target: string
  from: EventTarget
  replace: (text: string) => void
  /** Preview (YAZ-5152), once the card is read. */
  preview?: (() => void) | null
  onNotice: (message: string) => void
  /** "Put back into this page" (YAZ-5037 phase 5): the card is in a card file, the embed stands alone on its line, and the page's door is there. Else null. */
  putBack?: (() => void) | null
}): CardMenuDoors {
  const { card } = o
  const failed = (err: unknown) => o.onNotice(`Can't change the card: ${err instanceof Error ? err.message : String(err)}`)
  return {
    marks: o.marks,
    path: card.path,
    upNext: true,
    copyId: card.id,
    reset: true,
    unit: pathUnit(card.path),
    change: (change) => void changeCardLine(card.path, card.id, change, card.index).catch(failed),
    onNotice: o.onNotice,
    openCard: () => openCardWindow(card.path, card.id, card.index, o.from),
    preview: o.preview ?? undefined,
    showAsLink: o.editable ? () => o.replace(`[[${o.target}]]`) : undefined,
    putBack: o.putBack ?? undefined,
  }
}

/** Draws the card box of `host` into a new element (see the module doc). */
export function mountCardEmbed(host: CardEmbedHost): CardEmbedHandle {
  const { source, viewOnly, doors } = host
  const onNotice = doors.onNotice ?? (() => {})
  const dom = document.createElement('div')
  dom.contentEditable = 'false'
  // The ⋯'s code (the one card menu, a lazy chunk): ready before the first click.
  void loadCardMenu()
  const head = document.createElement('div')
  head.className = 'card__head card-embed__head'
  const from = button('card-embed__from', 'Open the original')
  const arrow = document.createElement('span')
  arrow.className = 'card-embed__arrow'
  arrow.setAttribute('aria-hidden', 'true')
  arrow.textContent = '↗'
  const fromText = document.createElement('span')
  from.append(arrow, fromText)
  const dot = document.createElement('span')
  dot.className = 'card-embed__dot'
  dot.textContent = '·'
  const idButton = button('card__id', 'Copy card ID')
  const state = document.createElement('span')
  state.className = 'card__state'
  const fixMark = document.createElement('span')
  fixMark.className = 'card__state card__fix'
  fixMark.textContent = 'To fix'
  fixMark.hidden = true
  const editButton = button('card__edit', 'Edit card')
  const more = button('card__more', 'Card menu')
  more.textContent = '⋯'
  // The title band under the head (YAZ-5164 part 3, YAZ-5308 A3), the page title's own component: a click renames a card
  // in a page in its page. A card file's shows only: its tab renames the file.
  const title = mountCardTitle()
  head.append(from, dot, idButton, state, fixMark, editButton, more)
  const body = document.createElement('div')
  body.className = 'card__body'

  let card: CardLink | null = null
  /** The card as its file holds it, once read (or as Done wrote it). */
  let read: CardAtPage | null = null
  /** The read the body is for: path, version and ID. */
  let readKey: string | null = null
  let near = false
  let destroyed = false
  let selected = false
  let folded = false
  let stopWatch: (() => void) | null = null
  let closeMenu: (() => void) | null = null
  let edit: { editor: CardEditor; mount: HTMLElement; keys: HTMLElement; base: CardAtPage } | null = null
  /** The Reviews strip (YAZ-5105 round 4), while the card read has reviews; open or closed is this box's. */
  let strip: ReviewsStripHandle | null = null
  let stripOpen: StripPart | null = null

  const off = (c: CardLink): boolean => read?.id === c.id ? read.off : recordAt(source.records, c.path)?.cards?.[c.index]?.off === true
  const fix = (c: CardLink): boolean => (read?.id === c.id ? read.fix === true : recordAt(source.records, c.path)?.cards?.[c.index]?.fix === true)
  /** The ⋯'s marks (YAZ-5697 round 2): the card as read, else its index record's. */
  const marksOf = (c: CardLink): CardMenuMarks => {
    const rec = read?.id === c.id ? read : recordAt(source.records, c.path)?.cards?.[c.index]
    return { off: rec?.off === true, next: rec?.next === true, fix: rec?.fix === true, notitle: rec?.notitle === true, titleAt: rec?.notitle === true ? 'never' : (rec?.titleAt ?? 'default'), reviews: rec?.reviews.length ?? 0 }
  }

  /** The head, or the missing line: from the index alone. */
  const draw = (): void => {
    if (card === null) {
      closeMenu?.()
      strip?.destroy()
      strip = null
      dom.className = 'card-embed card-embed--missing'
      dom.replaceChildren(`Missing card · ${missingId(host.target, source) ?? host.target}`)
      return
    }
    if (head.parentNode !== dom) dom.replaceChildren(head, title.dom, body)
    const isOff = off(card)
    // Each index change draws the head again: only what changed is written.
    const set = (el: HTMLElement, text: string) => el.textContent !== text && (el.textContent = text)
    const className = `card card-embed${isOff ? ' card--off' : ''}${edit !== null ? ' card--editing' : ''}${folded ? ' card-embed--folded' : ''}${selected ? ' ProseMirror-selectednode' : ''}`
    if (dom.className !== className) dom.className = className
    set(fromText, `Embedded from "${embedName(card, source)}"`)
    drawTitle(card)
    set(idButton, card.id)
    set(state, isOff ? 'Archived' : '')
    const isFix = fix(card)
    if (fixMark.hidden === isFix) fixMark.hidden = !isFix
    drawEditButton(editButton, edit !== null)
  }

  /** Is the card a card file's (its title is its file's: only its tab renames it)? */
  const isFileCard = (c: CardLink): boolean => recordAt(source.records, c.path)?.kind === 'card'

  /** The title band (YAZ-5164 part 3, YAZ-5308 A3): from the index until read, then off its card line. */
  const drawTitle = (c: CardLink, now = false): void => {
    title.render({ title: read === null ? c.title : read.title, readOnly: !host.editable(), canRename: !isFileCard(c), onRetitle: retitle }, now)
  }

  /** The rename: the title on the card's line (YAZ-5308), in its ORIGINAL file (one write, as Done), shown at once. */
  const retitle = (next: string): void => {
    const r = read
    if (r === null || r.id === null || r.cardFile === true || !host.editable()) return
    const clean = cleanCardTitle(next)
    if (clean === r.title) return
    read = { ...r, title: clean }
    changeCardLine(r.path, r.id, (l) => withCardTitle(l, clean), r.index).catch((err: unknown) => {
      onNotice(`Can't rename the card: ${err instanceof Error ? err.message : String(err)}`)
      read = r
      draw()
      paint()
    })
    draw()
    paint()
  }

  const paint = (): void => {
    if (card === null || edit !== null) return
    // The head shows the title (off the card line); the card's text is its sides only (YAZ-5308).
    body.replaceChildren(read === null ? '' : renderCard(read.text, {}, doors.look(card.path)))
    drawReviews()
  }

  /** The card's strip under its text (YAZ-5380: Reviews and Properties), for the card as read: none with no door. */
  const drawReviews = (): void => {
    const door: CardReviewDoorApi | undefined = doors.reviews
    const c = read
    if (door === undefined || c === null || card === null) {
      strip?.destroy()
      strip = null
      return
    }
    strip ??= mountReviewsStrip()
    if (strip.dom.parentNode !== dom) body.after(strip.dom)
    const id = c.id
    strip.render({
      reviews: c.reviews,
      settings: door.settings(),
      onDelete: id === null ? undefined : (review) => void door.deleteReview(c.path, id, review),
      open: stripOpen,
      onToggle: (part) => {
        stripOpen = stripOpen === part ? null : part
        drawReviews()
      },
      properties: {
        values: c.properties ?? {},
        // YAZ-5383: an edit writes the card's line in its ORIGINAL file, as a rename does; locked with the page.
        edit:
          door.vault === undefined || id === null
            ? undefined
            : { change: (change) => changeCardLine(c.path, id, change, c.index).then(() => undefined), path: c.path, ...door.vault(), readOnly: !host.editable(), onNotice },
      },
    })
  }

  /** The card read from its file, once near the screen, again only for a new version of that file. */
  const load = (): void => {
    const c = card
    if (!near || c === null || edit !== null) return
    const version = recordAt(source.records, c.path)?.mtime
    const key = `${c.path}\n${version}\n${c.id}`
    if (key === readKey) return
    readKey = key
    cardFileText(c.path, version).then(
      (content) => {
        if (destroyed || readKey !== key || edit !== null) return
        read = content === null ? null : cardInContent(c.path, content, c.id, c.index)
        draw()
        paint()
      },
      (err: unknown) => {
        if (destroyed || readKey !== key) return
        readKey = null
        onNotice(`Can't show card ${c.id}: ${err instanceof Error ? err.message : String(err)}`)
      },
    )
  }

  const refresh = (): void => {
    if (destroyed) return
    const next = embedCard(host.target, source, viewOnly)
    // A card edited here stays until Done, even when its file goes meanwhile: Done's write then says why it failed.
    if (next === null && edit !== null) return
    if (next?.id !== card?.id || next?.path !== card?.path) read = null
    card = next
    draw()
    if (card === null) return
    load()
    // The pills follow the index, as the page card's do: only they draw again.
    if (edit === null && read !== null && read.text.includes('[[')) refreshCardLook(body, doors.look(card.path))
  }

  const startEdit = (): void => {
    const base = read
    if (edit !== null || card === null || base === null || doors.edit === undefined) return
    // A page locked by Read only (YAZ-5145 round 2): an edit attempt that carries itself; "Allow edits" opens Edit card.
    if (!host.editable()) return tellReadOnlyEdit(dom, 'card', startEdit)
    const mount = document.createElement('div')
    mount.className = 'card__editor'
    dom.append(mount)
    const { editor, keys } = doors.edit(mount, base.text, base.title, () => finishEdit(), base.cardFile === true)
    dom.append(keys)
    edit = { editor, mount, keys, base }
    draw()
  }

  /** Done: the text into the ORIGINAL file (one write), shown at once; nothing written when nothing changed. */
  const finishEdit = (): void => {
    const e = edit
    if (e === null) return
    const text = e.editor.text()
    // A card file's title is read only here (its tab renames the file); a card in a page's goes on its card line.
    const title = e.base.cardFile === true ? e.base.title : e.editor.title()
    e.editor.destroy()
    e.mount.remove()
    e.keys.remove()
    edit = null
    draw()
    if (text.replace(/\n+$/, '') !== e.base.text || title !== e.base.title) {
      // Fix later stays: only a hand clears it (YAZ-5647 item 5).
      read = { ...e.base, text, title }
      draw()
      changeCardTextIn(e.base.path, e.base.id, text, e.base.index, title === e.base.title ? undefined : title).catch((err: unknown) => {
        onNotice(`Can't save the card: ${err instanceof Error ? err.message : String(err)}`)
        read = e.base
        paint()
      })
    }
    paint()
    host.select()
  }

  /** Preview (YAZ-5152): the card as read, as the Inbox reads it. */
  const previewRead = (): void => {
    const r = read
    if (r === null) return
    previewCard(dom, { path: r.path, id: r.id, text: r.text, title: r.title, notitle: r.notitle === true, ...(r.titleAt !== undefined && { titleAt: r.titleAt }), reviews: r.reviews, properties: r.properties })
  }

  const openMenu = (x: number, y: number): void => {
    const c = card
    if (c === null) return
    closeMenu?.()
    // Put back: only a card file's card (a card in a page stays where it is), and only from an embed alone on its line.
    const place = doors.putBack !== undefined && recordAt(source.records, c.path)?.kind === 'card' ? host.place() : null
    const putBack = place === null ? null : () => doors.putBack!({ id: c.id, path: c.path }, place.inner, place.nth)
    withCardMenu(({ cardMenuRows }) => {
      closeMenu?.()
      const close = openMenuAt(host.menuParent(), x, y, cardMenuRows(cardEmbedMenuDoors({ card: c, marks: marksOf(c), editable: host.editable(), target: host.target, from: dom, replace: host.replace, onNotice, putBack, preview: read === null ? null : previewRead })))
      closeMenu = () => {
        close()
        closeMenu = null
      }
    })
  }

  const onMouseDown = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    // The card editor's own presses.
    if (target === null || event.button !== 0 || edit?.mount.contains(target) === true) return
    // The Reviews strip is React's (its toggle, its table): a press in it never selects the embed.
    if (strip?.dom.contains(target) === true) return
    const c = card
    if (c === null) return
    // The title is the page title's (YAZ-5164 part 3): its click renames, or asks to unlock a locked page.
    if (title.dom.contains(target)) return drawTitle(c, true)
    if (target.closest('.card__more') !== null) {
      event.preventDefault()
      const rect = more.getBoundingClientRect()
      return openMenu(rect.left, rect.bottom + 4)
    }
    if (target.closest('.card__edit') !== null) {
      event.preventDefault()
      return edit === null ? startEdit() : finishEdit()
    }
    if (target.closest('.card__id') !== null) {
      event.preventDefault()
      return copyText(c.id, 'card ID', onNotice, undefined, true)
    }
    if (target.closest('.card-embed__from') !== null) {
      event.preventDefault()
      return doors.follow?.(c.id, 'newTab')
    }
    // A sound's player is its own (YAZ-5014).
    if (target.closest(CARD_MEDIA) !== null) return
    // A pill, or a board's picture (YAZ-5015): it opens as its link does, as in the page's card.
    const pill = target.closest<HTMLElement>(CARD_OPENS)
    if (pill !== null && doors.follow !== undefined) {
      event.preventDefault()
      const where = cardLinkWhere(event, doors.hotkeys?.())
      if (where !== null) doors.follow(pill.getAttribute(CARD_LINK_ATTR) ?? pill.getAttribute(CARD_BOARD_ATTR) ?? '', where)
      return
    }
    if (target.closest('a[href]') !== null) return
    // A press on the card selects the embed whole, as on a board's window.
    event.preventDefault()
    host.select()
  }
  /** A Markdown link never navigates the window: it opens as the page's links do. */
  const onClick = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.card__body a[href]') : null
    if (link === null) return
    event.preventDefault()
    doors.openHref?.(link.getAttribute('href') ?? '')
  }
  const onDoubleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.card__body') == null || target.closest(`${CARD_OPENS}, ${CARD_MEDIA}, a[href]`) !== null) return
    event.preventDefault()
    startEdit()
  }
  const onContextMenu = (event: MouseEvent): void => {
    if (card === null || (event.target instanceof Element && edit?.mount.contains(event.target) === true)) return
    event.preventDefault()
    openMenu(event.clientX, event.clientY)
  }
  dom.addEventListener('mousedown', onMouseDown)
  dom.addEventListener('click', onClick)
  dom.addEventListener('dblclick', onDoubleClick)
  dom.addEventListener('contextmenu', onContextMenu)

  /** Near the screen: the page's scroller (`scrollRootOf`), found once the box is in it. Without an observer, at once. */
  const watch = (): void => {
    const come = (): void => {
      stopWatch = null
      near = true
      load()
    }
    if (typeof IntersectionObserver === 'undefined') return come()
    stopWatch = whenNear(dom, dom.isConnected ? scrollRootOf(dom) : null, come)
  }

  // ⌘F asks for the card's text (YAZ-5378): a box far from the screen reads its card now, so find counts it.
  dom.addEventListener(CARD_FIND_READ, () => {
    if (near) return
    stopWatch?.()
    stopWatch = null
    near = true
    load()
  })

  const handle: CardEmbedHandle = {
    dom,
    refresh,
    setSelected: (on) => {
      selected = on
      dom.classList.toggle('ProseMirror-selectednode', on && card !== null)
    },
    setFolded: (on) => {
      folded = on
      dom.classList.toggle('card-embed--folded', on && card !== null)
    },
    get cardEditor() {
      return edit?.editor ?? null
    },
    destroy: () => {
      destroyed = true
      stopWatch?.()
      closeMenu?.()
      edit?.editor.destroy()
      edit = null
      strip?.destroy()
      strip = null
      title.destroy()
      boxes.delete(dom)
    },
  }
  boxes.set(dom, handle)
  refresh()
  // The widget's DOM goes into the page right after it is made: then its scroller is known.
  queueMicrotask(() => !destroyed && watch())
  return handle
}
