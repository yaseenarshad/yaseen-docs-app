/**
 * The `[[` link picker (Links B, GRO-2191): typing `[[` in the editor opens a suggestion popup
 * over every markdown note in the vault; typing filters, ↑/↓ navigate, Enter/click INSERTS THE
 * PLAIN TEXT `[[name]]` (the A- decorations restyle it on their next pass — never a schema or
 * doc-structure change, so round-trip stays byte-identical), Esc dismisses leaving the typed
 * text as-is.
 *
 * Anatomy — three cooperating pieces, one module:
 *  - a `$prose` plugin OWNS the state: the active completion session (position of the `[[`, the
 *    fragment before the caret, the matched rows, the highlighted index) recomputed per
 *    transaction from doc + selection, plus the Esc-dismissed anchor so the same `[[` never
 *    reopens until the caret leaves it. Candidates come from a `WikilinkCandidateSource` — the
 *    same mutable-holder pattern as A-'s resolve source: App owns one per window,
 *    `WikilinkIndexBridge` feeds it `linkCandidates(records)` per index snapshot, updates poke
 *    subscribed editors with a meta transaction (live rows, no remount). A CLOSED picker only ever
 *    OPENS on a doc-changing transaction (YAZ-908) — moving the caret into a closed `[[Alpha]]`
 *    reads like a fresh `[[Al` before it, so caret movement (and a candidate refresh) must never
 *    pop the popup; an already-open session survives caret moves within its own `[[`.
 *  - `SlashProvider` (@milkdown/kit/plugin/slash — the locked foundation; the machinery behind
 *    Crepe's own `/` menu) POSITIONS the popup element at the caret via floating-ui and toggles
 *    `data-show`. Its single-character `trigger` cannot express `[[`, so it runs with a custom
 *    `shouldShow` that just reads the plugin state; row rendering stays ours (plain DOM — the
 *    rows are ≤ 9 buttons). The `session === last` guard in `render` is an IDENTITY check and
 *    the plugin builds a fresh session object per transaction, so while the picker is open the
 *    rows are in fact rebuilt on every keystroke (GRO-2197 audit): ≤ 9 buttons of DOM, measured
 *    as not worth a structural comparison yet — recorded here so the next reader is not misled.
 *  - `wikilinkPickerKeymap` (`$shortcut`, priority 100 — CONTRACTS "Keyboard") binds
 *    ↑/↓/Enter/Esc. Every command returns false when no session is open, so the keys fall
 *    through untouched (the outliner keeps Enter in lists, Crepe keeps its arrows). Enter ties
 *    with the outliner's priority-100 Enter — createCrepe registers this keymap FIRST, and
 *    KeymapManager runs equal priorities in addition order, so an open picker wins
 *    (`wikilinkPicker.test.ts` pins it).
 *
 * Matching is the shared `links/completion.ts` (one matcher with the Bases cell editors —
 * locked ruling): case-insensitive substring, cap 8. A note with frontmatter aliases (E2,
 * GRO-2214) is offered twice — under its name (inserting `[[Name]]`) and under each alias,
 * which READS `CAC — Customer Acquisition Cost` and INSERTS the piped `[[Customer Acquisition
 * Cost|CAC]]`, so the link targets the note and displays the alias. A note with a frontmatter
 * `id` (YAZ-2293, 🔒) is offered under the same rows but every one of them inserts the plain
 * `[[id]]`. When nothing matches a non-empty fragment, a single "Create" row creates the page
 * (YAZ-1357, 🔒 D3 revised — through Links C's own `createFromLink`, staying put; see
 * `createPage`) and links it by the id it is born with — the vault's next number, which the door
 * in the main process gives (YAZ-2677 D4), so the link is `[[typed text]]` for the moment the
 * number takes to come — and `[[typed text]]` as-is when there is
 * no vault to create in, the vault does not use IDs (YAZ-2523 🔒 V3), or the creation fails. A `|` in the fragment is alias
 * entry: the popup closes and typing continues as plain text. Code is excluded like the
 * decorations: no picker inside `code_block` or inline-`code` text.
 */
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Plugin, PluginKey, TextSelection, type Command } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { SlashProvider } from '@milkdown/kit/plugin/slash'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { api } from '../../api'
import { matchLinkCandidates, trailingLinkFragment, type LinkCandidate } from '../../links/completion'
import { createFromLink } from './createFromLink'
import type { WikilinkNav } from './wikilinkClick'
import { linkPageName, type WikilinkResolveSource } from './wikilinkPlugin'
import './wikilinkPicker.css'

export const WIKILINK_PICKER_CLASS = 'wikilink-picker'
export const WIKILINK_PICKER_ITEM_CLASS = 'wikilink-picker__item'
export const WIKILINK_PICKER_CREATE_CLASS = 'wikilink-picker__item--create'

/** How the vault's candidates reach the picker; see `createWikilinkCandidateSource`. */
export interface WikilinkCandidateSource {
  /** Shortest unambiguous names + alias rows (`linkCandidates`); `[]` until the index first loads. */
  readonly candidates: readonly LinkCandidate[]
  /** Wakes subscribed editors (row recompute) whenever `candidates` is swapped. */
  subscribe(listener: () => void): () => void
}

export interface MutableWikilinkCandidateSource extends WikilinkCandidateSource {
  /** Swap in a fresh candidate list (index refetch) and notify every subscribed editor. */
  update(candidates: readonly LinkCandidate[]): void
}

export function createWikilinkCandidateSource(): MutableWikilinkCandidateSource {
  let current: readonly LinkCandidate[] = []
  const listeners = new Set<() => void>()
  return {
    get candidates() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(candidates) {
      current = candidates
      listeners.forEach((l) => l())
    },
  }
}

/**
 * One popup row: shows `label`, inserts `[[insert]]` — the two differ for every row of a note
 * with an id (it inserts the id, YAZ-2293) and for an id-less note's alias row, which reads
 * `CAC — Customer Acquisition Cost` and inserts the piped `[[Customer Acquisition Cost|CAC]]`
 * (E2, GRO-2214). `create` rows show as Create "…" (nothing matched) and make the
 * page — `insert` is then its typed NAME, and the link goes in by the new page's id (`insertRow`).
 */
interface PickerRow {
  label: string
  insert: string
  create: boolean
}

interface PickerSession {
  /** Doc position of the `[[`'s first bracket. */
  from: number
  /** The caret (end of the fragment) — the insert replaces from..to. */
  to: number
  fragment: string
  rows: PickerRow[]
  selected: number
}

/**
 * A Create row's link while the door gives its number (YAZ-2677 S35, S36): where the typed page
 * name stands inside its `[[…]]`, followed through every edit made meanwhile, so the id goes where
 * the name is and no character typed during the wait is touched.
 */
interface Waiting {
  key: number
  from: number
  to: number
}

interface PickerState {
  session: PickerSession | null
  /** `from` of an Esc-dismissed `[[`: that session stays closed until the context dissolves. */
  dismissed: number | null
  /** The links whose number has not come yet: almost always none, and never more than the creates in flight. */
  waiting: readonly Waiting[]
}

type PickerMeta = { type: 'move'; delta: 1 | -1 } | { type: 'dismiss' } | { type: 'refresh' } | ({ type: 'wait' } & Waiting) | { type: 'done'; key: number }

const NO_WAITING: readonly Waiting[] = []
let waits = 0

const pickerKey = new PluginKey<PickerState>('mdapp-wikilink-picker')

/** The unclosed `[[fragment` ending at the caret, or null (no cursor / code / alias `|`). */
function findContext(state: EditorState): { from: number; to: number; fragment: string } | null {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || !sel.empty) return null
  const $from = sel.$from
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.spec.code) return null
  if ($from.marks().some((m) => m.type.name === 'inlineCode')) return null
  // Leaf nodes become one object-replacement char, so offsets in `before` = parent offsets.
  const before = parent.textBetween(0, $from.parentOffset, undefined, '￼')
  const fragment = trailingLinkFragment(before)
  if (fragment === null || fragment.includes('|')) return null
  return { from: $from.pos - fragment.length - 2, to: $from.pos, fragment }
}

/** Matches through the shared matcher; a non-empty fragment nothing matches offers Create. */
function rowsFor(fragment: string, candidates: readonly LinkCandidate[]): PickerRow[] {
  const matches = matchLinkCandidates(candidates, fragment)
  if (matches.length > 0) return matches.map(({ label, insert }) => ({ label, insert, create: false }))
  return fragment.trim() === '' ? [] : [{ label: fragment, insert: fragment, create: true }]
}

/**
 * The waiting links after `tr`: each place mapped through the edit — text typed AT either end of
 * the name is in it, so a name the user changed is seen to be changed — then the one that starts
 * to wait, at its place in the new document, or without the one whose number came.
 */
function waitingAfter(prev: readonly Waiting[], tr: Transaction | null, meta: PickerMeta | undefined): readonly Waiting[] {
  let waiting = prev
  if (waiting.length > 0 && tr?.docChanged === true) waiting = waiting.map(({ key, from, to }) => ({ key, from: tr.mapping.map(from, -1), to: tr.mapping.map(to, 1) }))
  if (meta?.type === 'wait') waiting = [...waiting, { key: meta.key, from: meta.from, to: meta.to }]
  if (meta?.type === 'done') waiting = waiting.filter((w) => w.key !== meta.key)
  return waiting
}

function compute(state: EditorState, prev: PickerState | null, tr: Transaction | null, source: WikilinkCandidateSource): PickerState {
  const meta = tr?.getMeta(pickerKey) as PickerMeta | undefined
  return { ...session(state, prev, tr, meta, source), waiting: waitingAfter(prev?.waiting ?? NO_WAITING, tr, meta) }
}

function session(state: EditorState, prev: PickerState | null, tr: Transaction | null, meta: PickerMeta | undefined, source: WikilinkCandidateSource): Pick<PickerState, 'session' | 'dismissed'> {
  let dismissed = prev === null || prev.dismissed === null ? null : tr?.docChanged ? tr.mapping.map(prev.dismissed) : prev.dismissed
  if (meta?.type === 'dismiss' && prev?.session != null) dismissed = prev.session.from
  const ctx = findContext(state)
  if (ctx === null) return { session: null, dismissed: null } // context gone: a fresh [[ starts clean
  if (dismissed !== null && ctx.from === dismissed) return { session: null, dismissed }
  // Only TYPING opens a closed picker (YAZ-908): walking the caret into a closed `[[Alpha]]` reads
  // like a fresh `[[Al` but must stay shut. `from` needs no mapping — when the doc changed the gate
  // passes anyway, and when it did not the positions are already comparable.
  const sameOpen = prev?.session != null && prev.session.from === ctx.from
  if (!sameOpen && tr?.docChanged !== true) return { session: null, dismissed }
  const rows = rowsFor(ctx.fragment, source.candidates)
  if (rows.length === 0) return { session: null, dismissed }
  const held =
    prev?.session != null && tr !== null && !tr.docChanged && prev.session.from === ctx.from && prev.session.fragment === ctx.fragment
      ? Math.min(prev.session.selected, rows.length - 1)
      : 0
  const selected = meta?.type === 'move' ? (held + meta.delta + rows.length) % rows.length : held
  return { session: { ...ctx, rows, selected }, dismissed }
}

/**
 * The Create row's other half (YAZ-1357, 🔒 D3 revised): the page is BORN here, not on a later
 * click — Yasin's ruling, so a picked "Create" shows up in the sidebar at once. Same placement as
 * create-on-click (`createFromLink` under `nav.createFolder()`), no navigation (the caret keeps
 * typing; the link turns from dim to resolved on the index echo), one passive notice either way.
 * Without a nav there is no vault to create in, so the row only inserts.
 *
 * 🔒 Where the vault uses IDs the order is fixed (YAZ-2677 S35): the NUMBER first, from the door
 * (`fs:mint-note-id`); then the link, `[[id]]` where the typed name stands (`wait`, the key of its
 * place); then the note, born WITH that id. Each step that fails leaves a link that reads: no
 * number, and the link stays the typed name; a name the user changed during the wait stays as
 * they left it, and the note is still made; no note, and nothing carries the id, so the id goes
 * back to the typed name — found by its text, which an id makes unique in the document, wherever
 * typing has since pushed it.
 *
 * No `wait`: the vault does not use IDs (`ids`, YAZ-2523 🔒 V3). The page is made the plain way, and
 * the link already holds the name that was typed.
 */
async function createPage(view: EditorView | undefined, nav: WikilinkNav, name: string, ids: boolean, wait?: number): Promise<void> {
  const page = name.split('#', 1)[0]
  /** The id the note is born with, and the id the LINK holds: a note that is not born gives the link its typed name back. */
  let id: string | undefined
  let linked: string | undefined
  let numbered = ids
  if (wait !== undefined) {
    const given = await api.mintNoteId(nav.root).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    const placed = placeId(view, wait, page, typeof given === 'string' ? given : undefined)
    if (given instanceof Error) return nav.onNotice(`Can't create "${linkPageName(name)}": ${given.message}`)
    // `null`: the vault stopped using IDs after the pick. The page is made the plain way, and the link holds its name.
    if (given === null) numbered = false
    else {
      id = given
      if (placed) linked = given
    }
  }
  const result = await createFromLink(nav.root, name, numbered, nav.createFolder(), id)
  if (result.status === 'created') return nav.onNotice(`Created "${linkPageName(name)}"`)
  if (result.status === 'error') nav.onNotice(result.message)
  if (linked === undefined || view === undefined || view.isDestroyed) return
  let from = -1
  view.state.doc.descendants((node, pos) => {
    const at = node.text?.indexOf(`[[${linked}`) ?? -1
    if (at !== -1) from = pos + at + 2
  })
  if (from !== -1) view.dispatch(view.state.tr.insertText(page, from, from + linked.length))
}

/**
 * The wait of the link `key` ends: `id` (when one came) replaces the typed `page` name where it
 * stands now — only while it still reads as it was typed. True when the link holds the id.
 */
function placeId(view: EditorView | undefined, key: number, page: string, id: string | undefined): boolean {
  if (view === undefined || view.isDestroyed) return false
  const at = pickerKey.getState(view.state)?.waiting.find((w) => w.key === key)
  const tr = view.state.tr.setMeta(pickerKey, { type: 'done', key } satisfies PickerMeta)
  const stands = id !== undefined && at !== undefined && at.from < at.to && view.state.doc.textBetween(at.from, at.to) === page
  if (stands) tr.insertText(id, at.from, at.to)
  view.dispatch(tr)
  return stands
}

/**
 * Replace the `[[fragment` with the full `[[insert]]` text, park the caret after it — and, for the
 * Create row, make the page (`createPage`). Where the vault uses IDs the link goes in as the typed
 * name and WAITS for its number (YAZ-2677 S35, S36): the brackets are closed at once, so what the
 * user types next lands after the link and is never part of it. Where the vault does not use IDs
 * (`links.ids`, YAZ-2523 🔒 V3) no number is asked for, and the typed name is the link.
 */
function insertRow(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, session: PickerSession, row: PickerRow, links: WikilinkResolveSource, nav?: WikilinkNav, view?: EditorView): boolean {
  if (dispatch) {
    const text = `[[${row.insert}]]`
    const tr = state.tr.insertText(text, session.from, session.to)
    tr.setSelection(TextSelection.create(tr.doc, session.from + text.length))
    const born = row.create && nav !== undefined
    // A name with no page part (`[[#heading]]`) makes no page, so it waits for no number.
    const wait = born && links.ids && linkPageName(row.insert) !== '' ? ++waits : undefined
    if (wait !== undefined) tr.setMeta(pickerKey, { type: 'wait', key: wait, from: session.from + 2, to: session.from + 2 + row.insert.split('#', 1)[0].length } satisfies PickerMeta)
    dispatch(tr.scrollIntoView())
    if (born) void createPage(view, nav, row.insert, links.ids, wait)
  }
  return true
}

const insertSelected = (links: WikilinkResolveSource, nav?: WikilinkNav): Command => (state, dispatch, view) => {
  const session = pickerKey.getState(state)?.session ?? null
  if (session === null) return false
  const row = session.rows[session.selected]
  if (row === undefined) return false
  return insertRow(state, dispatch, session, row, links, nav, view)
}

const move = (delta: 1 | -1): Command => (state, dispatch) => {
  if (pickerKey.getState(state)?.session == null) return false
  if (dispatch) dispatch(state.tr.setMeta(pickerKey, { type: 'move', delta } satisfies PickerMeta))
  return true
}

const dismiss: Command = (state, dispatch) => {
  if (pickerKey.getState(state)?.session == null) return false
  if (dispatch) dispatch(state.tr.setMeta(pickerKey, { type: 'dismiss' } satisfies PickerMeta))
  return true
}

/** Priority above Crepe's keymaps (50); registered before the outliner so Enter ties break to us. */
const PRIORITY = 100

/**
 * ↑/↓/Enter/Esc while the picker is open; every command declines (false) when it is closed, so
 * the keys fall through — the outliner keeps Tab/Enter in lists, nothing is ever swallowed.
 */
export const createWikilinkPickerKeymap = (links: WikilinkResolveSource, nav?: WikilinkNav) =>
  $shortcut(() => ({
    WikilinkPickerNext: { key: 'ArrowDown', priority: PRIORITY, onRun: () => move(1) },
    WikilinkPickerPrev: { key: 'ArrowUp', priority: PRIORITY, onRun: () => move(-1) },
    WikilinkPickerInsert: { key: 'Enter', priority: PRIORITY, onRun: () => insertSelected(links, nav) },
    WikilinkPickerDismiss: { key: 'Escape', priority: PRIORITY, onRun: () => dismiss },
  }))

/** The popup element + its rows; mousedown-preventDefault so picking never blurs the editor. */
function buildPopup(view: EditorView, links: WikilinkResolveSource, nav?: WikilinkNav): { element: HTMLElement; render: (session: PickerSession | null) => void } {
  const element = document.createElement('div')
  element.className = WIKILINK_PICKER_CLASS
  element.setAttribute('role', 'listbox')
  element.setAttribute('aria-label', 'Link suggestions')
  let last: PickerSession | null = null
  const render = (session: PickerSession | null) => {
    if (session === last) return
    last = session
    element.replaceChildren()
    if (session === null) return
    session.rows.forEach((row, i) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'option')
      item.className = row.create ? `${WIKILINK_PICKER_ITEM_CLASS} ${WIKILINK_PICKER_CREATE_CLASS}` : WIKILINK_PICKER_ITEM_CLASS
      item.setAttribute('aria-selected', String(i === session.selected))
      item.textContent = row.create ? `Create "${row.label}"` : row.label
      item.addEventListener('mousedown', (e) => e.preventDefault())
      item.addEventListener('click', () => {
        // Re-read the live session: the state may have moved between render and click.
        const current = pickerKey.getState(view.state)?.session ?? null
        if (current === null) return
        const liveRow = current.rows[i]
        if (liveRow === undefined) return
        insertRow(view.state, (tr) => view.dispatch(tr), current, liveRow, links, nav, view)
        view.focus()
      })
      element.appendChild(item)
    })
  }
  return { element, render }
}

export function createWikilinkPicker(source: WikilinkCandidateSource, links: WikilinkResolveSource, nav?: WikilinkNav) {
  return $prose(
    () =>
      new Plugin<PickerState>({
        key: pickerKey,
        state: {
          init: (_, state) => compute(state, null, null, source),
          apply: (tr, value, _old, state) =>
            tr.docChanged || tr.selectionSet || tr.getMeta(pickerKey) !== undefined ? compute(state, value, tr, source) : value,
        },
        view: (editorView) => {
          const popup = buildPopup(editorView, links, nav)
          // Attached (hidden) from the start — the provider would only append it on its first
          // debounced pass; its later appendChild of the same node into the same parent is a no-op.
          popup.element.dataset.show = 'false'
          editorView.dom.parentElement?.appendChild(popup.element)
          const provider = new SlashProvider({
            content: popup.element,
            debounce: 0, // state is already exact per transaction; only positioning is deferred
            shouldShow: (view) => pickerKey.getState(view.state)?.session != null,
          })
          const unsubscribe = source.subscribe(() => {
            editorView.dispatch(editorView.state.tr.setMeta(pickerKey, { type: 'refresh' } satisfies PickerMeta))
          })
          return {
            update: (view, prevState) => {
              const session = pickerKey.getState(view.state)?.session ?? null
              popup.render(session)
              // hide() directly when closed: the provider's own update skips meta-only
              // transactions (same doc + selection — exactly what Esc's dismiss is).
              if (session === null) provider.hide()
              else provider.update(view, prevState)
            },
            destroy: () => {
              unsubscribe()
              provider.destroy()
              popup.element.remove()
            },
          }
        },
      }),
  )
}
