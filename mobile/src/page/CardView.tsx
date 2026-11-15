import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { cardInContent, type CardAtPage } from '@client/review/cardRead'
import { cardDueWords, cardFacts, cardNextReview } from '@client/review/cardWords'
import { cardFileShape } from '@shared/cardFileFormat'
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
import { openLink, type LinkDoor } from './openLink'
import { useVaultLook } from './vaultLook'
import { UNTITLED_CARD, drawCard } from './pageLook'
import { useTables } from './useTables'
import { PageComments, PageCommentsCount } from './comments/PageComments'
import { shownText, useAnswers, useAnswersChanged } from '../cardMenu/useAnswers'
import { usePageCardMenu } from '../cardMenu/pageCardMenu'
import { cardMoreButton } from '../cardMenu/moreButton'
import { usePageTools } from './PageTools'

/** YAZ-5508: the strip is its own lazy chunk (with the properties rows): the first load's list of chunks stays as it was. */
const CardStrip = lazy(() => import('./cardStrip/CardStrip').then((m) => ({ default: m.CardStrip })))

/** The words of a card file that is not valid (round 15, item 3). */
export const NEEDS_A_FIX = 'This card file needs a fix on the Mac.'

/**
 * A CARD ALONE, READ ONLY (YAZ-5079, 4C; round 12 item 10): a tap on a card in Search opens it here. The card as Review
 * draws it (`renderCard`), in the Mac's card box (YAZ-5437, the card window): its head (ID, "Archived", and "Title
 * hidden in review" while Review is on) and its title band (none for a card with no title: the ID names it). The top
 * bar says the title ("Untitled card" with none); the heading "Title · ID" is for VoiceOver only, which names a card
 * with no title by its ID, when it is due and how sure you are, its review history, and "Open
 * page" for a card in a page (a card file's card has no other page: 4B, round 15). No Edit card.
 *
 * TWO ⋯ (YAZ-5527): the CARD's own ⋯ sits at the right of its head (its ID row), the same ⋯ and menu as a card inside
 * a page (`moreButton.ts`, `pageCardMenu.tsx`): Up next, Archive card, Fix later, Title on the front, two taps each.
 * The top bar's ⋯ is the PAGE's: the full title when the top bar cuts it (YAZ-5498), and Find in card. A card with no
 * ID has no card ⋯ (as in a page: the actions write its card line, found by its ID).
 *
 * A card file that is not valid (2 or more cards, text outside the card, or no card; from git or an agent): the first
 * card and one line, "This card file needs a fix on the Mac." (round 15, item 3). The fix actions stay on the Mac.
 *
 * 4B (Review) opens this view for "Open card" (`{ kind: 'card', path, id }`), and the page view for "Open page"
 * (`{ kind: 'page', path, at: id }`).
 *
 * YAZ-5508: under the card, the Mac's strip (`cardStrip/CardStrip.tsx`), closed; then the due line.
 *
 * YAZ-5477: a card file shows its comments under the card and its strip, with the page's Comment button and box
 * (`comments/PageComments.tsx`, the same block, no copy). A card in a page shows none: they are the page's.
 */
export default function CardView({ path, id }: { path: string; id: string }) {
  const app = useApp()
  const { store, sync } = app.services
  const vault = app.vaultKey!
  const data = useVaultData()
  // YAZ-5455: the vault's link pills (their CSS variables) and its "Clicking a link".
  const look = useVaultLook(app.services.store, data)
  const door: LinkDoor = { go: app.go, vaultKey: app.vaultKey, click: look?.click }
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [reads, setReads] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const media = useVaultMedia()
  useMediaWatch(host, media)
  // YAZ-5471: its tables get their widths and frame; a wide one opens full screen (⤢).
  useTables(host, look?.table ?? null)
  const now = app.services.now?.() ?? Date.now()

  // Read again when a pass brings a new version of the file.
  useEffect(
    () =>
      sync.subscribe((event) => {
        if (event.type === 'changed' && event.vault === vault && (event.diff == null || event.diff.changed.includes(path))) setReads((n) => n + 1)
      }),
    [sync, vault, path],
  )
  // YAZ-5504: the card as the phone shows it (with the waiting actions), so a change from its ⋯ shows at once.
  const answers = useAnswers()
  useAnswersChanged(answers, path, () => setReads((n) => n + 1))
  useEffect(() => {
    let live = true
    void shownText(store, vault, path, answers).then((content) => {
      if (live) setText(content)
    })
    return () => {
      live = false
    }
  }, [store, vault, path, reads, answers])

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
  // YAZ-5527: the top bar's ⋯ holds the page tools only (the full title, Find in card); the card's own ⋯ is on its head.
  const tools = usePageTools(host, { title, path, label: 'Card tools', find: 'Find in card', headings: false })
  const cardMenu = usePageCardMenu(host, { path, answers, upNext: reviewOn })
  const head = card === null ? null : `${card.id ?? id}\n${card.title}\n${card.off}\n${reviewOn && card.notitle === true}`
  useEffect(() => {
    const el = host.current
    if (el === null || data === null || card === null) return
    const body = document.createElement('div')
    body.className = 'card__body'
    body.append(drawCard(data, path, card.text))
    const top = cardHead({ id: card.id ?? id, title: card.title, off: card.off, notitle: reviewOn && card.notitle === true })
    // YAZ-5527: the card's own ⋯ at the right of its head, as a card in a page (only a card with its own ID: it is what the actions write by).
    if (top !== null && card.id !== null) top.append(cardMoreButton(card.id, card.title))
    if (card.id !== null) el.dataset.cardId = card.id
    else delete el.dataset.cardId
    const parts = [top, titleBand(card.title), body]
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
    if (tap.kind === 'go') openLink({ go: app.go, vaultKey: app.vaultKey, click: look?.click }, tap.target)
    // A missing page's link, or a heading of a page (a card has none), does nothing (YAZ-5455).
    else if (tap.kind === 'none' || tap.kind === 'heading') return
    else setNotice(await openFile(media, tap.path))
  }

  const facts = card === null || data === null ? null : cardFacts(card.reviews, data.review, now)
  return (
    <Frame title={title} back={() => app.go({ type: 'back' })} gear tabs reader kind={isFile ? 'card-file' : 'card'} tools={tools.button} notice={tools.bar} foot={<PageArrows data={data} at={{ kind: 'card', path, id }} go={app.go} noun="card" />}>
      <article className="reader card-view" aria-label={label} style={look?.style}>
        {/* YAZ-5478: a card file's comment count, at the top right; a tap goes to its comments under the card. */}
        {isFile && typeof text === 'string' && <PageCommentsCount text={text} />}
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
        {card !== null && data !== null && (
          <>
            {/* YAZ-5508: the Mac's strip, tucked under the card and closed: Reviews, Properties, Linked mentions (and a card
                file's Embedded in), each opening its drawer. Review off: none, as the Mac. */}
            {reviewOn && (
              <Suspense fallback={null}>
                <CardStrip key={`${path}\n${card.id ?? id}`} reviews={card.reviews} settings={data.review} properties={card.properties ?? {}} data={data} door={door} pages={card.id === null ? undefined : { id: card.id, embeds: isFile }} />
              </Suspense>
            )}
            {/* The due line under the strip, as the Mac's card window says it under its strip. */}
            <p className="card-view__facts">{facts === null ? 'New card' : `${cardDueWords(cardNextReview(facts.due, facts.inSteps, now))}${facts.recall === null ? '' : ` · ${Math.round(facts.recall * 100)}% chance you remember it`}`}</p>
          </>
        )}
        {!isFile && record !== undefined && (
          <button type="button" className="btn btn--wide" onClick={() => app.go({ type: 'open', route: { kind: 'page', path, at: card?.id ?? id } })}>
            {app.unit('Open page')}
          </button>
        )}
        {/* YAZ-5477: a card FILE's comments (its front matter's), and its Comment button; a card in a page has none. */}
        {isFile && typeof text === 'string' && <PageComments path={path} text={text} noun="card file" />}
        {cardMenu}
      </article>
    </Frame>
  )
}
