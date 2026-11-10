/**
 * LINK PILLS IN A DIAGRAM (YAZ-4748 D2): the board's link host (`useDrawingLinks`) spoken to draw.io's iframe. The
 * iframe (`desktop/drawio-overlay/js/yaseen-links.js`) draws the pills and reports the pointer; every rule — what a pill
 * shows, which gesture opens, the hover card, the one link menu, Edit link and Remove link — is the board's own code,
 * reached through its `hostLinks`. Nothing here decides a rule: it moves rects from the iframe's view into the
 * window's, and turns messages into calls.
 *
 * D3: the iframe asks for the looks of the links it draws; the host answers, and sends again the asked ones that
 * changed when the window's links change (a rename, a new page, an icon that finished drawing).
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { WIKILINK_RE } from '@shared/linkRewrite'
import type { MouseMods } from '@shared/keys'
import type { AnchorRect } from '../sidebar/previewPlacement'
import { wireLook, type DrawingLink, type DrawingLinkHit } from '../drawings/drawingLinks'
import type { PickerEditor } from '../drawings/drawingLinkPicker'
import type { BoardLinks } from '../drawings/useDrawingLinks'
import { linkClickAction } from '../editor/linkGesture'
import { basename } from '../lib/paths'
import { lastSidebarDrag, onSidebarDrag, sidebarDragOn, sidebarDropInFrame } from '../sidebar/sidebarDrag'
import type { WireLook } from './diagramLooks'
import type { DrawioEditorState, DrawioLinkMessage } from './drawioProtocol'

/** One whole `[[link]]` and nothing else, as the frame's `WHOLE_LINK` reads it. */
const WHOLE_LINK = /^\[\[[^[\]]+\]\]$/

const COMBOS: readonly MouseMods[] = Array.from({ length: 16 }, (_, bits) => ({ metaKey: (bits & 1) !== 0, ctrlKey: (bits & 2) !== 0, altKey: (bits & 4) !== 0, shiftKey: (bits & 8) !== 0 }))

/** The held modifiers as the iframe names them (`modsKey` in yaseen-links.js): ⌘, ⌃, ⌥, ⇧. */
export const modsKey = (mods: MouseMods): string => `${mods.metaKey ? 'M' : ''}${mods.ctrlKey ? 'C' : ''}${mods.altKey ? 'A' : ''}${mods.shiftKey ? 'S' : ''}`

/**
 * The modifier keys that open a link now: the iframe must decide at the press, before draw.io selects, so the host
 * hands it the answer of `linkClickAction` for each of the 16 sets. A read-only diagram adds the plain click.
 */
export function linkOpens(readOnly: boolean, hotkeys: HotkeyOverrides | undefined): string[] {
  return COMBOS.filter((mods) => linkClickAction({ editable: !readOnly }, mods, hotkeys) !== null).map(modsKey)
}

/** The links this diagram asked for, at most (A7): the oldest goes first. */
const MAX_ASKED = 2000

const sameLook = (a: WireLook | null | undefined, b: WireLook | null): boolean =>
  a === b || (a != null && b !== null && a.label === b.label && a.missing === b.missing && a.icon === b.icon)

/** The `inner` of each `[[inner]]` in `links` (a paste's or a drop's answer). */
const innersOf = (links: readonly string[]): string[] => links.flatMap((link) => [...link.matchAll(WIKILINK_RE)].map((m) => m[2]!))

/** `inner` was sent with this look last. */
const sentAlready = (sent: ReadonlyMap<string, WireLook | null>, inner: string, look: WireLook | null): boolean => sent.has(inner) && sameLook(sent.get(inner), look)

/** A rect in the iframe's view, in the window's. */
export const inWindow = (rect: AnchorRect, frame: AnchorRect): AnchorRect => ({ left: rect.left + frame.left, top: rect.top + frame.top, right: rect.right + frame.left, bottom: rect.bottom + frame.top })

export interface DrawioLinkLive {
  readOnly: boolean
  hotkeys: HotkeyOverrides | undefined
}

/**
 * The bridge for one diagram tab. `post` sends to the iframe; `ready` is draw.io's `init` (it listens); `onMessage` takes
 * each link message. With no `links` (a window with no link source) the pills stay raw text: the frame never gets the
 * `yaseenLinkOpens` that turns its link work on, and a stray paste or drop is answered with nothing.
 */
export function useDrawioLinkBridge(links: BoardLinks | undefined, frame: RefObject<HTMLIFrameElement | null>, post: (msg: Record<string, unknown>) => void, live: DrawioLinkLive) {
  const listening = useRef(false)
  /**
   * The links this diagram asked for, and the look each was sent last (A8): when the window's links change, only a
   * look that changed goes again. At most MAX_ASKED, oldest out (A7).
   */
  const asked = useRef(new Map<string, WireLook | null>())
  const hostLinks = links?.hostLinks

  /** The looks of `inners` now, each kept as sent; `changedOnly`: only those that differ from the last sent. */
  const looksOf = useCallback(
    (inners: Iterable<string>, changedOnly = false): Record<string, WireLook | null> => {
      const looks: Record<string, WireLook | null> = {}
      if (hostLinks === undefined) return looks
      const sent = asked.current
      for (const inner of inners) {
        const look = wireLook(hostLinks.resolve(inner) as DrawingLink | null)
        if (changedOnly && sentAlready(sent, inner, look)) continue
        sent.delete(inner)
        sent.set(inner, look)
        if (sent.size > MAX_ASKED) sent.delete(sent.keys().next().value!)
        looks[inner] = look
      }
      return looks
    },
    [hostLinks],
  )

  useEffect(
    () =>
      hostLinks?.subscribe?.(() => {
        const looks = looksOf([...asked.current.keys()], true)
        if (Object.keys(looks).length > 0) post({ action: 'yaseenLinkLooks', looks })
      }),
    [hostLinks, looksOf, post],
  )

  // D4: the frame takes a drop only while the sidebar drags pages.
  useEffect(() => {
    if (hostLinks === undefined) return
    return onSidebarDrag(() => post({ action: 'yaseenSidebarDrag', on: sidebarDragOn() }))
  }, [hostLinks, post])

  const sendOpens = useCallback(() => {
    if (listening.current && hostLinks !== undefined) post({ action: 'yaseenLinkOpens', opens: linkOpens(live.readOnly, live.hotkeys) })
  }, [hostLinks, post, live.readOnly, live.hotkeys])
  useEffect(sendOpens, [sendOpens])

  const frameRect = (): AnchorRect => frame.current?.getBoundingClientRect() ?? { left: 0, top: 0, right: 0, bottom: 0 }

  /** The pill as the board's hit: its cell, its link, its box in the window, and the replace of Edit link / Remove link. */
  const hitOf = (inner: string, cellId: string | null, rect: AnchorRect): DrawingLinkHit => ({
    elementId: cellId ?? '',
    inner,
    start: 0,
    end: 0,
    rect,
    ...(live.readOnly || cellId === null ? {} : { replace: (text: string) => post({ action: 'yaseenLinkReplace', cellId, inner, text }) }),
  })

  /** The label editor as the board's `[[` picker reads it (D5): its caret box in the window, its writes sent back. */
  const pickerEditor = (state: DrawioEditorState): PickerEditor => ({
    text: state.text,
    caret: state.caret,
    typed: state.typed,
    caretRect: () => inWindow(state.rect, frameRect()),
    replace: (start, end, text) => post({ action: 'yaseenEditorReplace', start, end, text }),
    // The frame finds the link in the open editor, or in the label once it closed; a missing one changes nothing.
    replaceLink: (raw, text) => {
      post({ action: 'yaseenEditorReplaceLink', cellId: state.cellId, raw, text })
      return true
    },
  })

  const onMessage = (msg: DrawioLinkMessage): void => {
    if (hostLinks === undefined) {
      // The frame asks nothing with no link source (A3); should it ever, no entry of its waits forever.
      if (msg.event === 'yaseenPaste') post({ action: 'yaseenPasteAnswer', id: msg.id, link: null })
      else if (msg.event === 'yaseenDrop') post({ action: 'yaseenDropLinks', id: msg.id, links: [] })
      return
    }
    const frameAt = frameRect()
    switch (msg.event) {
      case 'yaseenLinkLooks': {
        const looks = looksOf(msg.inners)
        if (msg.inners.length > 0) post({ action: 'yaseenLinkLooks', looks })
        return
      }
      case 'yaseenLinkHover':
        hostLinks.onHover?.(msg.inner === null || msg.rect === null ? null : hitOf(msg.inner, null, inWindow(msg.rect, frameAt)))
        return
      case 'yaseenLinkClick': {
        // The board's click reads only the modifier keys of the event.
        const point = { left: frameAt.left, top: frameAt.top, right: frameAt.left, bottom: frameAt.top }
        hostLinks.onPointerDown?.(hitOf(msg.inner, msg.cellId, point), { ...msg.mods, button: 0 } as unknown as PointerEvent)
        return
      }
      case 'yaseenLinkMenu': {
        const x = msg.x + frameAt.left
        const y = msg.y + frameAt.top
        // The menu opens at the pointer, in the window.
        hostLinks.onContextMenu?.(hitOf(msg.inner, msg.cellId, { left: x, top: y, right: x, bottom: y }), { clientX: x, clientY: y } as MouseEvent)
        return
      }
      case 'yaseenPaste': {
        // A13: the link's look goes with it, so the frame sizes a new box for the pill. A whole `[[link]]` (the frame asks
        // only on the canvas) is already a link: it comes back as it is, so its box is a pill too (YAZ-4808 5E).
        const whole = msg.text.trim()
        const link = hostLinks.pasteLink(msg.text) ?? (WHOLE_LINK.test(whole) ? whole : null)
        post({ action: 'yaseenPasteAnswer', id: msg.id, link, ...(link === null ? {} : { looks: looksOf(innersOf([link])) }) })
        return
      }
      case 'yaseenEditor':
        hostLinks.onEditorChange(msg.state === null ? null : pickerEditor(msg.state))
        return
      case 'yaseenEditorKey':
        // The board's picker reads only the key.
        hostLinks.onEditorKeyDown({ key: msg.key, isComposing: false } as KeyboardEvent)
        return
      case 'yaseenDrop': {
        // A6: only the drag's paths the frame took as pages (by name); its pictures are the frame's own import.
        const names = new Set(msg.names)
        const dropped = hostLinks.dropPaths(lastSidebarDrag().filter((path) => names.has(basename(path)))) ?? []
        // A5: the drop landed in the app, though the window heard none.
        sidebarDropInFrame()
        post({ action: 'yaseenDropLinks', id: msg.id, links: dropped, looks: looksOf(innersOf(dropped)) })
        return
      }
      case 'yaseenShapeLink':
        // D8: a shape's own link, as a board's link icon opens it. A web link never comes up here.
        links!.openShapeLink(msg.link, msg.mods)
        return
    }
  }

  /** draw.io listens: it learns which keys open a link. Looks it asks for come by `onMessage`. */
  const ready = (): void => {
    listening.current = true
    sendOpens()
  }

  return { onMessage, ready }
}
