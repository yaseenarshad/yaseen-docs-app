/**
 * A card's look in a vault (YAZ-4961; YAZ-4962 for the card window and the Inbox): the link pills as the page's
 * (label, resolved, icon), the pictures and sounds by the page's folder, the board embeds by their links. One function
 * for the page and the screens outside it. Its own file, with no editor import (YAZ-5153, 2A1 of YAZ-5055), so the
 * review screen and the phone app draw a card without the editor.
 *
 * Pictures and sounds: `image.src` turns a vault path, as a card writes it, into the URL the page loads. The desktop
 * leaves it out and gets `imageSrc` (`app://vault/…`, which Electron serves); the phone gives its own (stored bytes).
 */
import { fileKind } from '@shared/fileKind'
import { basename } from '@shared/types'
import { imageSrc, pageDirRel } from '../image/imageSrc'
import { cardLinkTitle, linkCard, linkIsResolved, linkPath, linksAsShown, type LinkLook, type WikilinkResolveSource } from '../wikilink/linkResolve'
import type { ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import type { CardLook } from './cardRender'

/** The URL of a picture or a sound: `src` as written in a page whose folder is `pageDirRel` (relative to `root`). */
export type CardMediaSrc = (root: string, pageDirRel: string, src: string) => string

/** Where a card's pictures, sounds and boards resolve: the vault, the page that holds the card, and the media URL. */
export interface CardLookPlace {
  /** The vault's root (absolute). */
  root: string
  /** The ABSOLUTE path of the page or card file that holds the card. */
  pagePath: string
  /** The URL of a picture or a sound. Absent: `imageSrc`, the desktop's `app://vault/…`. */
  src?: CardMediaSrc
}

export function cardLook(wikilinks: WikilinkResolveSource, viewOnly: ViewOnlyLinkSource | undefined, image?: CardLookPlace, linkLook?: LinkLook): CardLook {
  const mediaSrc = image?.src ?? imageSrc
  return {
    link: (inner) => {
      // A link to a card (YAZ-5030): its title, its ID and the card icon, as the page's card pill.
      const card = inner.includes('|') ? null : linkCard(inner, wikilinks)
      if (card !== null) return { label: cardLinkTitle(card), resolved: true, card: card.id }
      const path = linkPath(inner, wikilinks, viewOnly)
      return {
        label: linksAsShown(`[[${inner}]]`, wikilinks, viewOnly),
        resolved: linkIsResolved(inner, wikilinks, viewOnly),
        attrs: path === null || linkLook === undefined ? undefined : linkLook.icon(path, fileKind(basename(path)) === null),
      }
    },
    image: image === undefined ? undefined : (src) => mediaSrc(image.root, pageDirRel(image.root, image.pagePath), src),
    // A board embed's file (YAZ-5015): where its link resolves, in the page's vault.
    board:
      image === undefined
        ? undefined
        : (inner) => {
            const path = linkPath(inner, wikilinks, viewOnly)
            return path === null ? null : { root: image.root, path }
          },
  }
}
