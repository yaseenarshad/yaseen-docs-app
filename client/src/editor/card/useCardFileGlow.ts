/**
 * D2b (YAZ-5925): a card page's outside-change glow. A card page is no editor, so it has no change list of its own: this
 * hook keeps the card's last drawn text (`CardGlowTracker`), lights what an outside write changed (`cardGlow.ts`), and
 * gives the page's bar (`OutsideChangesBar`) a channel of its own — "1 outside change", Next change, Mark all checked,
 * the timed Glow's countdown and Keep. The mouse on a glow shows the page's box (`mountOutsideTip`). Memory only.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { OutsideChangeGlow } from '@shared/types'
import { isOwnWrite } from '../../lib/twinEditors'
import type { CardBodyGlow } from '../../review/cardParts'
import { mountOutsideTip, OUTSIDE_ACTIVE_CLASS, OUTSIDE_TIP_ATTR, wordDiff } from '../external/outsideChanges'
import { createOutsideChangesChannel, type OutsideChangesChannel } from '../external/outsideChangesChannel'
import { CardGlowTracker, paintCardGlow, tipOf } from './cardGlow'

export interface CardFileGlow {
  /** The bar's channel. */
  channel: OutsideChangesChannel
  /** The read card's glow (`CardPane` `glow`); absent while nothing glows. */
  body: CardBodyGlow | undefined
  /** A read of the file: its card's text (null: no card) and the file's mtime; the app's own write never glows. */
  seen: (text: string | null, mtime: number) => void
}

/** `text`: the card as the tab first drew it. `glow`: the page's cog, else Settings. `root`: the tab's body, for the box and Next. */
export function useCardFileGlow(path: string, text: string | null, glow: OutsideChangeGlow, root: RefObject<HTMLElement | null>): CardFileGlow {
  const [version, setVersion] = useState(0)
  const channel = useMemo(() => createOutsideChangesChannel(), [])
  const tracker = useMemo(() => {
    const made = new CardGlowTracker(
      () => channel.getGlow(),
      () => setVersion((v) => v + 1),
    )
    if (text !== null) made.seen(text, false)
    return made
    // The first text only: later reads come through `seen`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])
  const textRef = useRef(text)
  textRef.current = text
  /** Next change asked: the ring scrolls into view once the card is drawn again. */
  const scroll = useRef(false)
  useEffect(() => () => tracker.destroy(), [tracker])
  useEffect(() => channel.setGlow(glow), [channel, glow])
  useEffect(() => {
    const go = (): void => {
      scroll.current = true
      tracker.setActive(true)
      setVersion((v) => v + 1)
    }
    return channel.bind({
      next: go,
      go,
      rows: () => {
        const now = tracker.current
        const shown = textRef.current
        return now === null || shown === null ? [] : [{ id: 1, number: 1, active: now.active === true, parts: tipOf(wordDiff(now.before, shown)) }]
      },
      clear: () => tracker.check(),
      markWholePage: () => undefined,
      setGlow: (next) => tracker.setGlow(next),
    })
  }, [channel, tracker])
  const tip = useRef<{ hide: () => void; destroy: () => void } | null>(null)
  const present = text !== null
  useEffect(() => {
    const el = root.current
    if (el === null) return
    const box = mountOutsideTip(el, (target) => {
      const span = document.createElement('span')
      span.textContent = target.getAttribute(OUTSIDE_TIP_ATTR) ?? ''
      return [span]
    })
    tip.current = box
    return () => {
      box.destroy()
      tip.current = null
    }
  }, [root, present])
  const current = tracker.current
  useEffect(() => {
    tip.current?.hide()
    channel.sync({ count: tracker.current === null ? 0 : 1, wholePage: false, fadesAt: tracker.current === null ? null : tracker.ends }, version)
    if (!scroll.current) return
    scroll.current = false
    // jsdom has no scrollIntoView.
    root.current?.querySelector(`.${OUTSIDE_ACTIVE_CLASS}`)?.scrollIntoView?.({ block: 'center' })
  }, [channel, tracker, version, root])
  return {
    channel,
    body: current === null ? undefined : { key: `${version}`, paint: (drawn, now, render) => paintCardGlow(drawn, now, current, render) },
    seen: (next, mtime) => {
      if (next !== null) tracker.seen(next, !isOwnWrite(path, mtime))
    },
  }
}
