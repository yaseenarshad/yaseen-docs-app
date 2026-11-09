/**
 * LINK PILLS IN A DIAGRAM (YAZ-4748 D2): the board's link host (`useDrawingLinks`) spoken to draw.io's iframe. The
 * iframe (`desktop/drawio-overlay/js/yaseen-links.js`) draws the pills and reports the pointer; every rule — what a pill
 * shows, which gesture opens, the hover card, the one link menu, Edit link and Remove link — is the board's own code,
 * reached through its `hostLinks`. Nothing here decides a rule: it moves rects from the iframe's view into the
 * window's, and turns messages into calls.
 *
 * D3: the iframe asks for the looks of the links it draws; the host answers, and sends the asked ones again when the
 * window's links change (a rename, a new page, an icon that finished drawing).
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { MouseMods } from '@shared/keys'
import type { AnchorRect } from '../sidebar/previewPlacement'
import type { DrawingLink, DrawingLinkHit } from '../drawings/drawingLinks'
import type { PickerEditor } from '../drawings/drawingLinkPicker'
import type { BoardLinks } from '../drawings/useDrawingLinks'
import { linkClickAction } from '../editor/linkGesture'
import { lastSidebarDrag, onSidebarDrag, sidebarDragOn } from '../sidebar/sidebarDrag'
import type { DrawioEditorState, DrawioLinkMessage } from './drawioProtocol'

/** A pill's look as the iframe takes it: the icon as its data URL; null, no icon; absent, not drawn yet. */
export interface WireLook {
  label: string
  missing?: boolean
  folder?: boolean
  icon?: string | null
}

export function wireLook(look: DrawingLink | null): WireLook | null {
  if (look === null) return null
  const { label, missing, folder, icon } = look
  return { label, ...(missing ? { missing } : {}), ...(folder ? { folder } : {}), ...(icon === undefined ? {} : { icon: icon === null ? null : icon.url }) }
}

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

/** A rect in the iframe's view, in the window's. */
export const inWindow = (rect: AnchorRect, frame: AnchorRect): AnchorRect => ({ left: rect.left + frame.left, top: rect.top + frame.top, right: rect.right + frame.left, bottom: rect.bottom + frame.top })

export interface DrawioLinkLive {
  readOnly: boolean
  hotkeys: HotkeyOverrides | undefined
}

/**
 * The bridge for one diagram tab. `post` sends to the iframe; `ready` is draw.io's `init` (it listens); `onMessage` takes
 * each link message. With no `links` (a window with no link source) the pills stay raw text: no look is ever sent.
 */
export function useDrawioLinkBridge(links: BoardLinks | undefined, frame: RefObject<HTMLIFrameElement | null>, post: (msg: Record<string, unknown>) => void, live: DrawioLinkLive) {
  const listening = useRef(false)
  /** The links this diagram asked for: their looks go again when the window's links change. Bounded by the diagram. */
  const asked = useRef(new Set<string>())
  const hostLinks = links?.hostLinks

  const sendLooks = useCallback(
    (inners: Iterable<string>) => {
      if (hostLinks === undefined) return
      const looks: Record<string, WireLook | null> = {}
      for (const inner of inners) looks[inner] = wireLook(hostLinks.resolve(inner) as DrawingLink | null)
      if (Object.keys(looks).length > 0) post({ action: 'yaseenLinkLooks', looks })
    },
    [hostLinks, post],
  )

  useEffect(() => hostLinks?.subscribe?.(() => sendLooks(asked.current)), [hostLinks, sendLooks])

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
    if (hostLinks === undefined) return
    const frameAt = frameRect()
    switch (msg.event) {
      case 'yaseenLinkLooks':
        for (const inner of msg.inners) asked.current.add(inner)
        sendLooks(msg.inners)
        return
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
      case 'yaseenPaste':
        post({ action: 'yaseenPasteAnswer', id: msg.id, link: hostLinks.pasteLink(msg.text) })
        return
      case 'yaseenEditor':
        hostLinks.onEditorChange(msg.state === null ? null : pickerEditor(msg.state))
        return
      case 'yaseenEditorKey':
        // The board's picker reads only the key.
        hostLinks.onEditorKeyDown({ key: msg.key, isComposing: false } as KeyboardEvent)
        return
      case 'yaseenDrop':
        post({ action: 'yaseenDropLinks', id: msg.id, links: hostLinks.dropPaths(lastSidebarDrag()) ?? [] })
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
