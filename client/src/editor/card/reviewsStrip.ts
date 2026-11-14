/**
 * THE CARD'S STRIP outside React (YAZ-5105 round 4; YAZ-5380 its parts): a card in a page (`cardBlockView.ts`) and a
 * card embed (`cardEmbed.ts`) are drawn without React, and mount the ONE strip, `CardStrip` (`review/cardParts.tsx`), here.
 * No second copy of its look or its toggle. React's root and the strip's chunk (with its CSS, `cardScreens.css`) load
 * the first time a card draws its strip: a page with no card loads neither.
 *
 * The strip's host is a `display: contents` box (`.card__reviews`), so the strip itself is the card's child for the
 * CSS that tucks it under the card's text.
 */
import type { CardReview } from '@shared/cardLine'
import type { ReviewSettings } from '@shared/reviews'

/** The strip's parts (YAZ-5380): one open at a time. The same type as `CardStripPart` in `review/cardParts.tsx`, which this chunk-free file cannot import. */
export type StripPart = 'reviews' | 'properties' | 'links' | 'embeds'

/** The strip's page parts (YAZ-5382), as `CardStripPages` in `review/cardParts.tsx`: a card file's Linked mentions and Embedded in. */
export interface StripPages {
  id: string
  wikilinks: import('../wikilink/wikilinkPlugin').WikilinkResolveSource
  onOpen: (path: string) => void
  embeds?: boolean
}

export interface ReviewsStripProps {
  reviews: readonly CardReview[]
  settings: ReviewSettings
  onDelete?: (review: CardReview) => void
  /** The open part; null: none. */
  open: StripPart | null
  /** A click on a part's toggle: the host opens it, or closes it when it is the open one. */
  onToggle: (part: StripPart) => void
  /** The card's own properties (YAZ-5379) and their edit door (YAZ-5383), for the Properties part. */
  properties: import('../../review/cardParts').CardStripProperties
  /** Linked mentions and Embedded in (YAZ-5382); absent: neither part. */
  pages?: StripPages
}

export interface ReviewsStripHandle {
  /** The host to put in the card, after its text. */
  readonly dom: HTMLElement
  /** Draws the strip with `props`; the same props again draw nothing. */
  render: (props: ReviewsStripProps) => void
  destroy: () => void
}

interface Kit {
  createRoot: typeof import('react-dom/client').createRoot
  draw: (props: ReviewsStripProps) => import('react').ReactElement
}
let kit: Kit | null = null
let kitLoad: Promise<Kit> | null = null
const loadKit = (): Promise<Kit> =>
  (kitLoad ??= Promise.all([import('react'), import('react-dom/client'), import('../../review/cardParts')]).then(([react, dom, parts]) => {
    kit = { createRoot: dom.createRoot, draw: (props) => react.createElement(parts.CardStrip, props) }
    return kit
  }))

/** Whether two draws of the strip show the same: its reviews, settings, open part and properties (the doors are read at click time). */
const same = (a: ReviewsStripProps, b: ReviewsStripProps): boolean =>
  a.settings === b.settings && a.open === b.open && JSON.stringify(a.properties.values) === JSON.stringify(b.properties.values) && a.properties.edit?.readOnly === b.properties.edit?.readOnly && (a.properties.edit === undefined) === (b.properties.edit === undefined) && a.pages?.id === b.pages?.id && a.pages?.wikilinks === b.pages?.wikilinks && a.pages?.embeds === b.pages?.embeds && a.reviews.length === b.reviews.length && a.reviews.every((r, i) => r === b.reviews[i] || (r.at === b.reviews[i].at && r.rating === b.reviews[i].rating && r.seconds === b.reviews[i].seconds))

export function mountReviewsStrip(): ReviewsStripHandle {
  const dom = document.createElement('div')
  dom.className = 'card__reviews'
  let root: import('react-dom/client').Root | null = null
  let drawn: ReviewsStripProps | null = null
  let latest: ReviewsStripProps | null = null
  let gone = false
  // The doors are read at click time: a draw with new doors and the same look draws nothing.
  const props = (): ReviewsStripProps => {
    const p = latest!
    const edit = p.properties.edit
    return {
      ...p,
      properties: { ...p.properties, edit: edit === undefined ? undefined : { ...edit, change: (change) => latest?.properties.edit?.change(change) ?? Promise.resolve() } },
      pages: p.pages === undefined ? undefined : { ...p.pages, onOpen: (path) => latest?.pages?.onOpen(path) }, onToggle: (part) => latest?.onToggle(part), onDelete: p.onDelete === undefined ? undefined : (r) => latest?.onDelete?.(r) }
  }
  const paint = (k: Kit): void => {
    if (gone || latest === null) return
    root ??= k.createRoot(dom)
    drawn = latest
    root.render(k.draw(props()))
  }
  return {
    dom,
    render: (next) => {
      const hadDelete = latest?.onDelete !== undefined
      latest = next
      if (drawn !== null && same(drawn, next) && hadDelete === (next.onDelete !== undefined)) return
      if (kit !== null) paint(kit)
      else void loadKit().then(paint)
    },
    destroy: () => {
      gone = true
      dom.remove()
      const r = root
      root = null
      // Not in the middle of a React commit (an editor that closes in an effect's cleanup): after it.
      if (r !== null) queueMicrotask(() => r.unmount())
    },
  }
}
