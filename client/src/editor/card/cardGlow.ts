/**
 * THE OUTSIDE-CHANGE GLOW INSIDE A DRAWN CARD (YAZ-5923, YAZ-5925; decisions D1–D4 on YAZ-5924). A card is drawn
 * (`renderCard`), not edited, so the page's glow (inline decorations on its text) cannot reach its words. Here:
 *
 *  - D1, THE WORDS: the old text is drawn off screen with the same `render`, the VISIBLE words of both drawings are
 *    compared with the page's `wordDiff`, and the new drawing gets the page's looks: `outside-change` on the new words,
 *    the thin red `outside-removed` mark where words went. Text nodes are mapped one by one, so bold, a link pill, a
 *    table cell and a hidden word light where they stand; inside a hidden-word blank the blank itself lights (its word
 *    is not visible). A space stands between two blocks, so two lines never make one word. The mouse on a glow or a
 *    mark shows the page's box (`OUTSIDE_TIP_ATTR`), the card word by word (`outsideTipParts`). It runs only when a
 *    card has a change, and one compare is kept for each (before, now) pair (`plans`).
 *  - D4, A REWRITE (approved, `CARD_REWRITE_FRAME`): when the removed visible text is `REWRITE_SHARE` (80%) or more of
 *    the old visible text, the frame glows (`CARD_REWRITTEN_CLASS`) and the box says "Rewritten", not word by word.
 *    A change with no visible word changed (a word made bold, an image) glows the frame too.
 *  - D2, WHERE: a card in a page reads the page's change list (`PageCardGlow`: the bar counts it, Next change rings
 *    it, Checked in its head and Mark all checked clear it). A card page and an embed keep their last drawn text
 *    (`CardGlowTracker`): an outside write of new text glows; the app's own write (`isOwnWrite`) never does, and
 *    clears what glows, as typing in a changed line does in a page.
 *  - D3, HOW LONG: the page's Glow (Settings › Outside changes glow, the page's cog), Checked, Mark all checked.
 *    Memory only: nothing is saved to disk.
 *  - A FOLDED SIDE (YAZ-5904's fold, `cardFold.ts`): `CARD_GLOW_SIDE_ATTR` on each side that holds a glow (its folded
 *    rule lights, `card.css`) and `CARD_GLOW_REVEAL`, sent from the ringed glow: the folded side opens (`onFoldReveal`).
 */
import type { EditorView } from '@milkdown/kit/prose/view'
import type { OutsideChangeGlow } from '@shared/types'
import { REWRITE_SHARE } from '../external/applyExternalMarkdown'
import { checkOutsideChange, outsideChangeAt, outsideGlowEndsAt, outsideTipParts, OUTSIDE_ACTIVE_CLASS, OUTSIDE_CHANGE_CLASS, OUTSIDE_REMOVED_CLASS, OUTSIDE_TIP_ATTR, wordDiff, type OutsideDiffPart } from '../external/outsideChanges'
import '../external/outsideChanges.css'
import './cardGlow.css'
import { FOLD_GLOW_SIDE_ATTR, FOLD_REVEAL_EVENT } from './cardFold'

/** D4 (approved by Yaseen, "Yes, frame glow"): a card rewritten from outside glows its frame, not its words. */
export const CARD_REWRITE_FRAME = true
/** On the drawn card's root when its frame glows (D4); `card.css`'s frame reads it through `:has`. */
export const CARD_REWRITTEN_CLASS = 'card-glow--rewritten'
/** On a side (`.card__side`) that holds a glow or a removed mark: the fold's side line shows a dot (hook point). */
export const CARD_GLOW_SIDE_ATTR = FOLD_GLOW_SIDE_ATTR
/** Sent (bubbling) from the ringed glow of a card after Next change: a folded side opens (hook point). */
export const CARD_GLOW_REVEAL = FOLD_REVEAL_EVENT
/** The Checked button in a card's head (a card in a page, an embed). */
export const CARD_GLOW_CHECKED_CLASS = 'card-glow__checked'

/** What glows on a card: its text before the first outside change of it, and whether Next put the ring on it. */
export interface CardGlow {
  before: string
  active?: boolean
}

interface Piece {
  node: Text
  start: number
  end: number
}

const BLOCKS = 'p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote, tr, div'
const BLANK = '.card__blank'

/** The visible text of a drawing, with where each text node stands in it. */
function visibleText(root: HTMLElement): { text: string; pieces: Piece[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let text = ''
  const pieces: Piece[] = []
  let block: Element | null | undefined
  for (let next = walker.nextNode(); next !== null; next = walker.nextNode()) {
    const node = next as Text
    if (node.data === '') continue
    const here = node.parentElement?.closest(BLOCKS) ?? null
    // Two blocks: a space between them in the compare only (no node holds it), so "end" and "Start" stay two words.
    if (block !== undefined && here !== block && !/\s$/.test(text) && !/^\s/.test(node.data)) text += ' '
    block = here
    pieces.push({ node, start: text.length, end: text.length + node.data.length })
    text += node.data
  }
  return { text, pieces }
}

interface Plan {
  /** The new drawing's visible text this plan is for. */
  now: string
  kind: 'words' | 'frame'
  /** The new words, as ranges of `now`. */
  ins: [number, number][]
  /** Where words went, as places in `now`, with the words. */
  dels: { at: number; text: string }[]
  /** The box's text. */
  tip: OutsideDiffPart[]
}

/** One compare for each (before, now) pair of card texts; the newest few. */
const plans = new Map<string, Plan>()
const MAX_PLANS = 64
/** Test hook. */
export const cardGlowStats = { compares: 0 }

const TIP_CONTEXT = 60
const TIP_BEFORE_CHARS = 200
const flat = (text: string): string => text.replace(/\s+/g, ' ')

/** The box's parts: spaces as one, and a long same run cut to its ends around the change. Also a card page's list row. */
export function tipOf(parts: readonly OutsideDiffPart[]): OutsideDiffPart[] {
  const last = parts.length - 1
  return parts.map((part, index) => {
    const text = flat(part.text)
    if (part.kind !== 'same') return { kind: part.kind, text }
    if (index === 0 && text.length > TIP_CONTEXT) return { kind: 'same', text: `…${text.slice(-TIP_CONTEXT)}` }
    if (index === last && text.length > TIP_CONTEXT) return { kind: 'same', text: `${text.slice(0, TIP_CONTEXT)}…` }
    if (text.length > TIP_CONTEXT * 2) return { kind: 'same', text: `${text.slice(0, TIP_CONTEXT)} … ${text.slice(-TIP_CONTEXT)}` }
    return { kind: 'same', text }
  })
}

/** The frame's box: "Rewritten" (or "New card"), and the old words struck. */
const frameTip = (before: string, title: string): OutsideDiffPart[] => {
  const old = flat(before).trim()
  return old === '' ? [{ kind: 'same', text: title }] : [{ kind: 'same', text: `${title}. Before: ` }, { kind: 'del', text: old.length > TIP_BEFORE_CHARS ? `${old.slice(0, TIP_BEFORE_CHARS)}…` : old }]
}

/** The compare of two visible texts (D1), or the frame (D4). */
function planOf(old: string, now: string): Plan {
  cardGlowStats.compares += 1
  const parts = wordDiff(old, now)
  const ins: [number, number][] = []
  const dels: { at: number; text: string }[] = []
  let at = 0
  let removed = 0
  for (const part of parts) {
    if (part.kind === 'same') at += part.text.length
    else if (part.kind === 'ins') {
      ins.push([at, at + part.text.length])
      at += part.text.length
    } else {
      dels.push({ at, text: part.text })
      removed += part.text.replace(/\s/g, '').length
    }
  }
  const oldSize = old.replace(/\s/g, '').length
  const changed = ins.length > 0 || dels.length > 0
  // `same` and `ins` give `now` again; if they ever did not, the frame is the safe look.
  const rewrite = at !== now.length || !changed || (CARD_REWRITE_FRAME && (oldSize === 0 || removed >= oldSize * REWRITE_SHARE))
  if (rewrite) return { now, kind: 'frame', ins: [], dels: [], tip: frameTip(old, oldSize === 0 ? 'New card' : changed ? 'Rewritten' : 'Changed outside: the words are the same') }
  return { now, kind: 'words', ins, dels, tip: tipOf(parts) }
}

/** The glow's look on one element: the class, the ring, the box. */
function dress(el: HTMLElement, className: string, active: boolean, short: string, tip: readonly OutsideDiffPart[]): void {
  el.classList.add(className)
  if (active) el.classList.add(OUTSIDE_ACTIVE_CLASS)
  el.setAttribute(OUTSIDE_TIP_ATTR, short)
  outsideTipParts.set(el, tip)
}

type Op = { at: number; to: number; mark: string | null }

/** Lights `pieces` by `plan`: each text node's pieces from its end back, so the earlier offsets stay true. */
function light(root: HTMLElement, pieces: readonly Piece[], plan: Plan, active: boolean, short: string): void {
  const ops = new Map<Piece, Op[]>()
  const add = (piece: Piece, op: Op) => ops.set(piece, [...(ops.get(piece) ?? []), op])
  for (const [from, to] of plan.ins) {
    for (const piece of pieces) {
      if (piece.end <= from || piece.start >= to) continue
      add(piece, { at: Math.max(from, piece.start) - piece.start, to: Math.min(to, piece.end) - piece.start, mark: null })
    }
  }
  for (const del of plan.dels) {
    if (del.text.trim() === '') continue
    // The piece the place is in; at a piece's end or between blocks, the end of the piece before it.
    const piece = pieces.find((each) => del.at >= each.start && del.at < each.end) ?? [...pieces].reverse().find((each) => each.end <= del.at) ?? pieces[0]
    if (piece === undefined) {
      root.append(removedMark(del.text, active, plan.tip))
      continue
    }
    const at = Math.max(0, Math.min(del.at - piece.start, piece.node.data.length))
    add(piece, { at, to: at, mark: del.text })
  }
  for (const [piece, list] of ops) {
    // From the end back; at one place, the new words first, so the mark lands before them.
    list.sort((a, b) => b.at - a.at || (a.mark === null ? -1 : 1))
    const blank = piece.node.parentElement?.closest<HTMLElement>(BLANK) ?? null
    for (const op of list) {
      if (blank !== null) {
        if (op.mark === null) dress(blank, OUTSIDE_CHANGE_CLASS, active, short, plan.tip)
        else blank.before(removedMark(op.mark, active, plan.tip))
        continue
      }
      if (op.mark !== null) {
        const rest = piece.node.splitText(op.at)
        rest.before(removedMark(op.mark, active, plan.tip))
        continue
      }
      if (piece.node.data.slice(op.at, op.to).trim() === '') continue
      const middle = piece.node.splitText(op.at)
      middle.splitText(op.to - op.at)
      const span = document.createElement('span')
      dress(span, OUTSIDE_CHANGE_CLASS, active, short, plan.tip)
      middle.replaceWith(span)
      span.append(middle)
    }
  }
}

function removedMark(text: string, active: boolean, tip: readonly OutsideDiffPart[]): HTMLElement {
  const mark = document.createElement('span')
  dress(mark, OUTSIDE_REMOVED_CLASS, active, `Removed: ${flat(text).trim().slice(0, TIP_BEFORE_CHARS)}`, tip)
  return mark
}

/**
 * Lights `drawn` (the new drawing of `now`) against `before` (D1, D4): `render` draws the old text off screen. The new
 * words and the removed marks, or the frame. Returns what it did.
 */
export function glowCard(drawn: HTMLElement, before: string, now: string, render: (text: string) => HTMLElement, active = false): 'words' | 'frame' | 'none' {
  if (before === now) return 'none'
  const shown = visibleText(drawn)
  const key = `${before}\u0000${now}`
  let plan = plans.get(key)
  // The same texts drawn with another look (a pill's label changed): compare again.
  if (plan === undefined || plan.now !== shown.text) {
    plan = planOf(before.trim() === '' ? '' : visibleText(render(before)).text, shown.text)
    plans.delete(key)
    plans.set(key, plan)
    if (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value!)
  }
  if (plan.kind === 'frame') {
    dress(drawn, CARD_REWRITTEN_CLASS, active, flat(plan.tip.map((part) => part.text).join('')), plan.tip)
    return 'frame'
  }
  light(drawn, shown.pieces, plan, active, before.trim() === '' ? 'New card' : `Before: ${flat(before).slice(0, TIP_BEFORE_CHARS)}`)
  for (const side of drawn.querySelectorAll<HTMLElement>('.card__side')) {
    if (side.querySelector(`.${OUTSIDE_CHANGE_CLASS}, .${OUTSIDE_REMOVED_CLASS}`) !== null) side.setAttribute(CARD_GLOW_SIDE_ATTR, '')
  }
  return 'words'
}

/** `drawn` lit by `glow` (none: as it is), then returned; the ringed glow asks a fold to open its side. */
export function paintCardGlow(drawn: HTMLElement, now: string, glow: CardGlow | null, render: (text: string) => HTMLElement): HTMLElement {
  if (glow === null || now.trim() === '') return drawn
  glowCard(drawn, glow.before, now, render, glow.active === true)
  if (glow.active === true) {
    const ring = drawn.classList.contains(OUTSIDE_ACTIVE_CLASS) ? drawn : drawn.querySelector(`.${OUTSIDE_ACTIVE_CLASS}`)
    queueMicrotask(() => ring?.isConnected === true && ring.dispatchEvent(new CustomEvent(CARD_GLOW_REVEAL, { bubbles: true })))
  }
  return drawn
}

/** The head's Checked (D8): its press never moves the caret or selects the card; the click checks the card off. */
export function cardGlowChecked(onCheck: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = CARD_GLOW_CHECKED_CLASS
  button.textContent = 'Checked'
  button.title = 'Checked: the outside change of this card stops glowing'
  button.hidden = true
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onCheck()
  })
  return button
}

/**
 * D2a: a card in a page. Its glow is the page's change of its textblock (`outsideChangeAt`): the Before the page kept,
 * and Next's ring. The card's head shows `checked` while it has one.
 */
export class PageCardGlow {
  readonly checked: HTMLButtonElement
  private id: number | null = null
  private painted = ''

  constructor(private readonly view: EditorView) {
    this.checked = cardGlowChecked(() => {
      if (this.id !== null) checkOutsideChange(this.view, this.id)
    })
  }

  private glowOf(pos: number | null, text: string): CardGlow | null {
    const change = pos === null ? null : outsideChangeAt(this.view.state, pos)
    this.id = change?.id ?? null
    this.checked.hidden = change === null
    // A new card from outside has no Before: all of it is new.
    const before = change === null ? null : (change.before ?? '')
    return before === null || before === text ? null : { before, active: change!.active }
  }

  /** Did the page's change of the card move since the last paint (a new one, Checked, the ring)? */
  moved(pos: number | null, text: string): boolean {
    const glow = this.glowOf(pos, text)
    return keyOf(glow) !== this.painted
  }

  /** `drawn` lit by the page's change of the card at `pos`. */
  paint(drawn: HTMLElement, pos: number | null, text: string, render: (text: string) => HTMLElement): HTMLElement {
    const glow = this.glowOf(pos, text)
    this.painted = keyOf(glow)
    return paintCardGlow(drawn, text, glow, render)
  }
}

const keyOf = (glow: CardGlow | null): string => (glow === null ? '' : `${glow.active === true ? 1 : 0}${glow.before}`)

/**
 * D2b, D2c: the glow of a card that is no text of an editor (a card page, an embed): it keeps the card's last drawn
 * text. New text from outside glows from the text before its FIRST outside change, until Checked, Mark all checked or
 * the timed Glow ends; text the app wrote itself clears it. Memory only.
 */
export class CardGlowTracker {
  private last: string | null = null
  private glow: { before: string; ends: number | null } | null = null
  private ring = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly setting: () => OutsideChangeGlow,
    private readonly onChange: () => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The card as read now: `outside` false for the app's own write. */
  seen(text: string, outside: boolean): void {
    const last = this.last
    this.last = text
    if (last === null || last === text) return
    const glow = this.setting()
    if (!outside || glow === 'off') return this.set(null)
    const before = this.glow?.before ?? last
    // An outside save puts a timed glow's time back to its start, as on a page.
    this.set(before === text ? null : { before, ends: outsideGlowEndsAt(glow, this.now()) })
  }

  /** Another card in the box: nothing glows, and its first read only sets the last text. */
  reset(): void {
    this.last = null
    this.set(null)
  }

  get current(): CardGlow | null {
    return this.glow === null ? null : { before: this.glow.before, active: this.ring }
  }

  /** When the glow goes (a timed Glow), else null. */
  get ends(): number | null {
    return this.glow?.ends ?? null
  }

  /** Next change: the ring on the card. */
  setActive(on: boolean): void {
    if (this.glow === null || this.ring === on) return
    this.ring = on
    this.onChange()
  }

  /** Checked, Mark all checked. */
  check(): void {
    this.set(null)
  }

  /** The Glow setting changed: Off clears; a timed one starts its time now (the page's rule). */
  setGlow(glow: OutsideChangeGlow): void {
    if (this.glow === null) return
    if (glow === 'off') return this.set(null)
    this.set({ ...this.glow, ends: outsideGlowEndsAt(glow, this.now()) })
  }

  destroy(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private set(next: { before: string; ends: number | null } | null): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (next === null && this.glow === null) return
    this.glow = next
    if (next === null) this.ring = false
    const ends = next?.ends ?? null
    if (ends !== null) this.timer = setTimeout(() => this.set(null), Math.max(0, ends - this.now()))
    this.onChange()
  }
}
