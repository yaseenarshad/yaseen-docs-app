import { useEffect, useRef, type MutableRefObject } from 'react'
import { fileKind } from '@shared/fileKind'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { ExploreLinkPreview } from '../explore/ExplorePage'
import { linkOpenHint } from '../editor/linkGesture'
import type { WikilinkHover } from '../editor/wikilink/wikilinkHover'
import { pageLabel } from '../lib/pageLabel'
import type { AnchorRect } from '../sidebar/previewPlacement'
import { CardPreviewHost, useCardPreview } from '../tabs/cardPreview'

const NO_TITLES: ReadonlyMap<string, string> = new Map()

/**
 * Lazy-loaded hover preview host for Inbox cards (YAZ-6059). Kept in its own chunk so `CardInbox.tsx` stays free of
 * editor modules (`reviewGraph.test.ts`, YAZ-5067).
 */
export function InboxLinkPreview({
  linkPreview,
  hotkeys,
  hoverRef,
}: {
  linkPreview: ExploreLinkPreview
  hotkeys?: HotkeyOverrides
  hoverRef: MutableRefObject<WikilinkHover | null>
}) {
  const hotkeysRef = useRef(hotkeys)
  hotkeysRef.current = hotkeys
  const linkAt = useRef<{ path: string; rect: AnchorRect; editable: boolean } | null>(null)
  const hover = useCardPreview(linkPreview.on() === true, (p) => (linkAt.current?.path === p ? linkAt.current.rect : null))

  useEffect(() => {
    hoverRef.current = {
      onHover: (p, rect, editable) => {
        linkAt.current = { path: p, rect, editable }
        hover.hoverCard(p, p)
      },
      onLeave: () => {
        if (linkAt.current !== null) hover.leaveCard(linkAt.current.path)
        linkAt.current = null
      },
    }
    return () => {
      hoverRef.current = null
    }
  }, [hover, hoverRef])

  const linkCard = (_: string, p: string): { root: string | null; name: string; hint?: string } => ({
    root: null,
    name: pageLabel(p, false, NO_TITLES),
    hint: linkOpenHint(hotkeysRef.current, linkAt.current?.editable ?? false, fileKind(p) === 'markdown'),
  })

  return <CardPreviewHost store={hover.store} cardOf={linkCard} scopeOf={linkPreview.scopeOf} diagramDarkColors={linkPreview.diagramDarkColors} />
}
