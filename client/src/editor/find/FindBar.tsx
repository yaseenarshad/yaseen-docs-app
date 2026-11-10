/**
 * THE FIND BAR (YAZ-969): the React surface of the CMD+F engine (`findInPage.ts`), talking to it
 * through the ONE `FindChannel` the host also hands `createCrepe`. The bar keeps no search state of
 * its own — it renders the channel's snapshot (`useSyncExternalStore`) and calls the channel's
 * commands; while the channel is closed there is no bar at all.
 *
 * 🔒 THE CLAIM RULE (locked in YAZ-967, visibility amendment in YAZ-970) is why CMD+F is a WINDOW
 * CAPTURE listener, one per bar and with no coordinator between them: a `page` bar (a folder's Page
 * tab, YAZ-4584) claims the key while focus stands inside its own host, the `note` bar claims it
 * whenever focus is NOT inside any `.folder-page-doc` — and a HIDDEN editor never claims. With no
 * other note editor showing (a folder page and no note window), CMD+F belongs to the Page even from
 * the sidebar or the title. A `views` bar (a folder page's Table, Board, List, Cards or Calendar, YAZ-4613) claims
 * while focus stands in its pane (`[data-find-host]`), where the `note` bar declines. Exactly one bar answers; the other declines. Neither bar claims while focus stands in a code tab
 * (`.editor--code`): there CMD+F is Monaco's own find box (YAZ-3451, YAZ-3464).
 *
 * Focus: the input does not exist yet on the CMD+F that OPENS the bar, so that focus lands in a
 * layout effect on the open; a CMD+F on an already-open bar has an input to focus and refocuses it
 * from the handler itself — one call site, told apart by the ref being null or not.
 *
 * Folds (YAZ-4787): a note's bar has a fold button beside the count. Its menu sets what find does with folded bullets
 * for this note (`find-folds` in the note); "Use the default" hands it back to Settings › Editor › Find.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type RefObject } from 'react'
import type { FindFolds } from '@shared/types'
import { storage } from '../../lib/storage'
import { isNoteKey } from '../noteKeys'
import type { FindChannel } from './findChannel'
import './find.css'

export interface FindBarProps {
  /** The host's one channel per editor mount — the very instance `createCrepe` was given. */
  channel: FindChannel
  /** Which part of the claim rule this bar answers CMD+F by (🔒 YAZ-967); `views`: a folder page's views (YAZ-4613). */
  scope: 'note' | 'page' | 'views'
  /** The Page bar's own editor mount: its claim IS focus standing inside it. Unread for `note`. */
  hostRef: RefObject<HTMLElement | null>
  /** A note's fold menu (YAZ-4787): the note's own choice (null: none), the app's, and the door that writes the note's. */
  folds?: { own: FindFolds | null; app: FindFolds; onChange: (folds: FindFolds | null) => void }
}

/** The fold menu's rows (YAZ-4787), in Settings' order. */
const FOLD_CHOICES: { value: FindFolds; label: string; hint: string }[] = [
  { value: 'current', label: 'Open the one you are on', hint: 'Every match counts. Only the current one opens, and it folds again when you move on.' },
  { value: 'all', label: 'Open every match', hint: 'Every folded bullet that holds a match opens.' },
  { value: 'keep', label: 'Keep folded', hint: 'Finds only what shows. Text in folded bullets does not count.' },
]
const foldLabel = (folds: FindFolds): string => FOLD_CHOICES.find((choice) => choice.value === folds)?.label ?? ''

/** The fold button's glyph: a fold chevron pair. */
const FoldGlyph = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </svg>
)

/** One glyph for both directions; the previous button rotates it (find.css). */
const Chevron = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m4 6 4 4 4-4" />
  </svg>
)

export function FindBar({ channel, scope, hostRef, folds }: FindBarProps) {
  const state = useSyncExternalStore(channel.subscribe, channel.getState)
  const inputRef = useRef<HTMLInputElement>(null)
  const [foldMenu, setFoldMenu] = useState(false)
  const foldRef = useRef<HTMLDivElement>(null)

  // The fold menu closes on a press outside it, and with the bar.
  useEffect(() => {
    if (!foldMenu) return
    const onDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || foldRef.current?.contains(event.target) !== true) setFoldMenu(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [foldMenu])
  useEffect(() => {
    if (!state.open) setFoldMenu(false)
  }, [state.open])

  const focusInput = (): void => {
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }

  useLayoutEffect(() => {
    if (state.open) focusInput()
  }, [state.open])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Find's key as it is now (YAZ-3564 K4): the setting is read at each keydown.
      if (!isNoteKey(event, 'note.find', storage.getSettings()?.hotkeys)) return
      const active = document.activeElement
      // checkVisibility is absent under jsdom, where nothing is ever hidden — hence the ?? true.
      const shown = (el: Element | null): boolean => el instanceof HTMLElement && (el.checkVisibility?.() ?? true)
      // Never from a code tab (YAZ-3451, YAZ-3464): its ⌘F is Monaco's find box. A note or a Page tab in the other place would take it first.
      const inCode = active instanceof Element && active.closest('.editor--code') !== null
      const host = hostRef.current
      /** Another note editor shows: the Page's own mount is an `.editor-mount` too, so it does not count. */
      const otherNote = (): boolean => [...document.querySelectorAll('.editor-mount .ProseMirror')].some((el) => !host?.contains(el) && shown(el))
      /** In a folder page's own find: its Page tab, or its views (`[data-find-host]`, YAZ-4613). */
      const inPage = active instanceof Element && active.closest('.folder-page-doc, [data-find-host]') !== null
      const claims =
        scope === 'page'
          ? shown(host) && ((active !== null && host !== null && host.contains(active)) || (!inCode && !otherNote()))
          : scope === 'views'
            ? // The focus in the views (not in a note editor there), or in no page, with no note showing: the first shown views.
              shown(host) &&
              !inCode &&
              (active !== null && host !== null && host.contains(active)
                ? active.closest('.editor-mount') === null
                : !inPage && !otherNote() && [...document.querySelectorAll('[data-find-host]')].find(shown) === host)
            : shown(host) && !inCode && !inPage
      if (!claims) return
      event.preventDefault()
      event.stopPropagation()
      channel.open()
      // Non-null only when the bar was ALREADY open — the opening CMD+F focuses from the effect.
      focusInput()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [channel, scope, hostRef])

  /** The buttons act on the search; the caret stays where the reader left it, in the query. */
  const hold = (event: MouseEvent): void => event.preventDefault()

  // Keep the zero-height dock mounted while closed: the Page tab's editor appends itself in an effect,
  // so this existing first child is what gives the Page's sticky bar its top anchor (YAZ-4584).
  return (
    <div className={`find-bar-dock find-bar-dock--${scope}`}>
      {state.open && (
        <div className="find-bar">
          <input
            ref={inputRef}
            className="find-bar__input"
            type="text"
            aria-label="Find in page"
            placeholder="Find"
            spellCheck={false}
            value={state.query}
            onInput={(event) => channel.setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (event.shiftKey) channel.prev()
                else channel.next()
              } else if (scope === 'views' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                // A folder page's find steps on ↓ and ↑ too (YAZ-4613, D64).
                event.preventDefault()
                if (event.key === 'ArrowUp') channel.prev()
                else channel.next()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                // An open fold menu closes first (YAZ-4787).
                if (foldMenu) setFoldMenu(false)
                else channel.close()
              }
            }}
          />
          {/* Nothing has been asked yet on an empty query, so there is no count to answer with. */}
          {state.query !== '' && <span className="find-bar__count">{state.total === 0 ? '0 of 0' : `${state.activeIndex + 1} of ${state.total}`}</span>}
          {folds !== undefined && (
            <div className="find-bar__folds" ref={foldRef}>
              <button
                type="button"
                className={`find-bar__btn find-bar__btn--folds${foldMenu ? ' find-bar__btn--on' : ''}`}
                aria-label="Folded bullets"
                aria-haspopup="menu"
                aria-expanded={foldMenu}
                onMouseDown={hold}
                onClick={() => setFoldMenu((open) => !open)}
              >
                <FoldGlyph />
              </button>
              {foldMenu && (
                <div className="find-folds" role="menu" aria-label="Folded bullets while finding">
                  <div className="find-folds__head">Folded bullets while finding</div>
                  {FOLD_CHOICES.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={state.folds === choice.value}
                      className="find-folds__row"
                      onMouseDown={hold}
                      onClick={() => {
                        setFoldMenu(false)
                        // The app's own choice with no note choice yet: nothing to write.
                        if (folds.own === null && choice.value === folds.app) return
                        folds.onChange(choice.value)
                      }}
                    >
                      <span className="find-folds__check" aria-hidden>
                        {state.folds === choice.value ? '✓' : ''}
                      </span>
                      <span className="find-folds__text">
                        <span className="find-folds__label">{choice.label}</span>
                        <span className="find-folds__hint">{choice.hint}</span>
                      </span>
                    </button>
                  ))}
                  <div className="find-folds__rule" />
                  {folds.own === null ? (
                    <div className="find-folds__foot">For this note. The default is in Settings › Editor › Find.</div>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      className="find-folds__row find-folds__row--reset"
                      onMouseDown={hold}
                      onClick={() => {
                        setFoldMenu(false)
                        folds.onChange(null)
                      }}
                    >
                      <span className="find-folds__check" aria-hidden />
                      <span className="find-folds__text">
                        <span className="find-folds__label">Use the default</span>
                        <span className="find-folds__hint">{foldLabel(folds.app)} (Settings › Editor › Find)</span>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <button type="button" className="find-bar__btn find-bar__btn--prev" aria-label="Previous match" onMouseDown={hold} onClick={() => channel.prev()}>
            <Chevron />
          </button>
          <button type="button" className="find-bar__btn" aria-label="Next match" onMouseDown={hold} onClick={() => channel.next()}>
            <Chevron />
          </button>
          <button type="button" className="find-bar__btn find-bar__btn--close" aria-label="Close find" onMouseDown={hold} onClick={() => channel.close()}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}
