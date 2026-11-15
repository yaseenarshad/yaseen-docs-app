import { useEffect, useRef, useState } from 'react'
import { cardInContent, type CardAtPage } from '@client/review/cardRead'
import { cardDueWords, cardFacts, cardFullDate, cardNextReview, reviewsTitle } from '@client/review/cardWords'
import { cardFileShape } from '@shared/cardFileFormat'
import { answerLabel, cardHistory } from '@shared/cardSchedule'
import { splitFrontmatter } from '@shared/frontmatter'
import { useApp } from '../app/AppState'
import { Frame } from '../screens/Frame'
import { useVaultData } from '../search/vaultData'
import { useMediaWatch, useVaultMedia } from '../media/ui/useVaultMedia'
import { guardLink } from '../media/ui/safeLinks'
import { openFile } from '../media/ui/vaultMedia'
import { cardHead, titleBand } from '../media/ui/cardHead'
import { tapOf } from './pageDom'
import { PageArrows } from './pageNav'
import { ScrollJump } from './ScrollJump'
import { openLink } from './openLink'
import { useVaultLook } from './vaultLook'
import { UNTITLED_CARD, drawCard } from './pageLook'
import { useTables } from './useTables'

/** The words of a card file that is not valid (round 15, item 3). */
export const NEEDS_A_FIX = 'This card file needs a fix on the Mac.'

/**
 * A CARD ALONE, READ ONLY (YAZ-5079, 4C; round 12 item 10): a tap on a card in Search opens it here. The card as Review
 * draws it (`renderCard`), in the Mac's card box (YAZ-5437, the card window): its head (ID, "Archived", and "Title
 * hidden in review" while Review is on) and its title band (none for a card with no title: the ID names it). The top
 * bar says the title ("Untitled card" with none); the heading "Title · ID" is for VoiceOver only, which names a card
 * with no title by its ID, when it is due and how sure you are, its review history, and "Open
 * page" for a card in a page (a card file's card has no other page: 4B, round 15). No Edit card and no ⋯ in stage one.
 *
 * A card file that is not valid (2 or more cards, text outside the card, or no card; from git or an agent): the first
 * card and one line, "This card file needs a fix on the Mac." (round 15, item 3). The fix actions stay on the Mac.
 *
 * 4B (Review) opens this view for "Open card" (`{ kind: 'card', path, id }`), and the page view for "Open page"
 * (`{ kind: 'page', path, at: id }`).
 */
export default function CardView({ path, id }: { path: string; id: string }) {
  const app = useApp()
  const { store, sync } = app.services
  const vault = app.vaultKey!
  const data = useVaultData()
  // YAZ-5455: the vault's link pills (their CSS variables) and its "Clicking a link".
  const look = useVaultLook(app.services.store, data)
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [reads, setReads] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const media = useVaultMedia()
  useMediaWatch(host, media)
  // YAZ-5471: its tables get their widths and frame; a wide one opens full screen (⤢).
  useTables(host)
  const now = app.services.now?.() ?? Date.now()

  // Read again when a pass brings a new version of the file.
  useEffect(
    () =>
      sync.subscribe((event) => {
        if (event.type === 'changed' && event.vault === vault && (event.diff == null || event.diff.changed.includes(path))) setReads((n) => n + 1)
      }),
    [sync, vault, path],
  )
  useEffect(() => {
    let live = true
    void store.read(vault, path).then((file) => {
      if (live) setText(file === null ? null : typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content))
    })
    return () => {
      live = false
    }
  }, [store, vault, path, reads])

  const record = data?.byPath[path]
  const isFile = record?.kind === 'card'
  const shape = typeof text === 'string' && isFile ? cardFileShape(splitFrontmatter(text).body) : null
  // The card by its ID; a card file shows its first card (also when that card's ID is not the one asked for).
  const card: CardAtPage | null = typeof text !== 'string' ? null : (cardInContent(path, text, id, -1) ?? (isFile ? cardInContent(path, text, null, 0) : null))
  // The title off the card line (YAZ-5308): the card's own, else the index's for it until the file is read.
  const listed = record?.cards?.find((c) => c.id !== null && c.id.toLowerCase() === id.toLowerCase())
  const name = card !== null ? card.title : (listed?.title ?? '')
  const title = name === '' ? UNTITLED_CARD : name
  const label = name === '' ? (card?.id ?? id) : name

  const reviewOn = data?.review.enabled === true
  const head = card === null ? null : `${card.id ?? id}\n${card.title}\n${card.off}\n${reviewOn && card.notitle === true}`
  useEffect(() => {
    const el = host.current
    if (el === null || data === null || card === null) return
    const body = document.createElement('div')
    body.className = 'card__body'
    body.append(drawCard(data, path, card.text))
    const parts = [cardHead({ id: card.id ?? id, title: card.title, off: card.off, notitle: reviewOn && card.notitle === true }), titleBand(card.title), body]
    el.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null))
    el.classList.toggle('card--off', card.off)
    // `card.text` and the head's words are what is drawn: a new read with the same ones draws nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, path, card?.text, head])

  const onTap = async (event: React.MouseEvent) => {
    if (data === null) return
    const tap = tapOf(event.target, data)
    // Any other link: the web opens Safari, the app's window stays (YAZ-5243).
    if (tap === null) return void guardLink(event)
    event.preventDefault()
    if (tap.kind === 'go') openLink({ go: app.go, click: look?.click ?? 'open' }, tap.target)
    // A missing page's link, or a heading of a page (a card has none), does nothing (YAZ-5455).
    else if (tap.kind === 'none' || tap.kind === 'heading') return
    else setNotice(await openFile(media, tap.path))
  }

  const facts = card === null || data === null ? null : cardFacts(card.reviews, data.review, now)
  return (
    <Frame title={title} back={() => app.go({ type: 'back' })} gear tabs reader kind={isFile ? 'card-file' : 'card'} foot={<PageArrows data={data} at={{ kind: 'card', path, id }} go={app.go} noun="card" />}>
      <article className="reader card-view" aria-label={label} style={look?.style}>
        <h2 className="reader__title reader__title--same">
          {title}
          <span className="card-view__id"> · {card?.id ?? id}</span>
        </h2>
        {!isFile && record !== undefined && <p className="muted card-view__in">{app.unit(`in ${record.title}`)}</p>}
        {shape !== null && shape.problem !== 'ok' && (
          <p className="problem problem--quiet" role="status">
            {NEEDS_A_FIX}
          </p>
        )}
        {notice !== null && (
          <p className="reader__notice" role="status">
            {notice}
          </p>
        )}
        {text === null && <p className="muted">This card is not on the phone.</p>}
        {text !== undefined && text !== null && card === null && shape === null && <p className="muted">{`Missing card · ${id}`}</p>}
        <div className="card card-view__card" ref={host} hidden={card === null} onClick={(e) => void onTap(e)} />
        <ScrollJump scroller={host} closest=".screen" />
        {card !== null && data !== null && (
          <>
            <p className="card-view__facts">{facts === null ? 'New card' : `${cardDueWords(cardNextReview(facts.due, facts.inSteps, now))}${facts.recall === null ? '' : ` · ${Math.round(facts.recall * 100)}% chance you remember it`}`}</p>
            <History card={card} data={data} />
          </>
        )}
        {!isFile && record !== undefined && (
          <button type="button" className="btn btn--wide" onClick={() => app.go({ type: 'open', route: { kind: 'page', path, at: card?.id ?? id } })}>
            {app.unit('Open page')}
          </button>
        )}
      </article>
    </Frame>
  )
}

/** The card's review history: one row for each answer (the Mac's table, read only; the review to come is the line above it). */
function History({ card, data }: { card: CardAtPage; data: NonNullable<ReturnType<typeof useVaultData>> }) {
  const settings = data.review
  const rows = cardHistory(card.reviews, settings)
  // A new card has no history: nothing to say (the line above says "New card").
  if (rows.length === 0) return null
  return (
    <section className="card-view__history" aria-label="Review history">
      <h3 className="section">{reviewsTitle(card.reviews.length)}</h3>
      {rows.length > 0 && (
        <table className="card-view__table">
          <thead>
            <tr>
              <th>Reviewed on</th>
              <th>Answer</th>
              <th>Next due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td>{cardFullDate(Date.parse(row.review.at))}</td>
                <td>{answerLabel(row.review.rating, settings)}</td>
                <td>{cardFullDate(row.due)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
