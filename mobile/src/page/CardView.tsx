import { useEffect, useRef, useState } from 'react'
import { cardInContent, titleOfCard, type CardAtPage } from '@client/review/cardRead'
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
import { tapOf } from './pageDom'
import { drawCard } from './pageLook'

/** The words of a card file that is not valid (round 15, item 3). */
export const NEEDS_A_FIX = 'This card file needs a fix on the Mac.'

/**
 * A CARD ALONE, READ ONLY (YAZ-5079, 4C; round 12 item 10): a tap on a card in Search opens it here. The card as Review
 * draws it (`renderCard`), its head "Title · ID", when it is due and how sure you are, its review history, and "Open
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
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [reads, setReads] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const media = useVaultMedia()
  useMediaWatch(host, media)
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
  const title = card !== null ? titleOfCard(card) : (record?.title ?? id)

  useEffect(() => {
    const el = host.current
    if (el === null || data === null || card === null) return
    const body = document.createElement('div')
    body.className = 'card__body'
    body.append(drawCard(data, path, card.text))
    el.replaceChildren(body)
    // `card.text` is the drawn text: a new read with the same text draws nothing again.
  }, [data, path, card?.text])

  const onTap = async (event: React.MouseEvent) => {
    if (data === null) return
    const tap = tapOf(event.target, data)
    // Any other link: the web opens Safari, the app's window stays (YAZ-5243).
    if (tap === null) return void guardLink(event)
    event.preventDefault()
    if (tap.kind === 'go') app.go(tap.action)
    else if (tap.kind === 'missing') setNotice(tap.text)
    else setNotice(await openFile(media, tap.path))
  }

  const facts = card === null || data === null ? null : cardFacts(card.reviews, data.review, now)
  return (
    <Frame title={title} back={() => app.go({ type: 'back' })} gear tabs>
      <article className="reader card-view" aria-label={title}>
        <h2 className="reader__title">
          {title}
          <span className="card-view__id"> · {card?.id ?? id}</span>
        </h2>
        {!isFile && record !== undefined && <p className="muted card-view__in">{app.unit(`in ${record.title}`)}</p>}
        {card?.off === true && <p className="muted">Archived</p>}
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
