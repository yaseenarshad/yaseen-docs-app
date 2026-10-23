import { memo, useCallback, useEffect, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { MAX_VAULT_NAME, cleanVaultName, rootOfPath, type Session } from '@shared/types'
import { api } from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { pageLabel, type PathTitles } from '../lib/pageLabel'
import { storage } from '../lib/storage'
import { TextField } from '../views/view/TextField'
import { ContextMenu } from './ContextMenu'
import type { MenuSection } from './menuSections'

/** The help line of an empty Sessions tab (YAZ-3147 S37). */
export const NO_SESSIONS_HELP = 'Save your open tabs as a session. Restore them later in one click.'

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const failed = (what: string) => (err: unknown): void => console.error(`[sessions] ${what} failed:`, err)

interface SessionListProps {
  /** The names of the pages (YAZ-2420 D14): a tab row with no display name shows its page's name, as the tab strip does. */
  titles: PathTitles
  /** A click on a tab row (S33): App's `openCurrent`, as a click on a tree row — the preview tab. */
  onOpenFile: (path: string) => void
  /** "Restore session" (D3): App adds the session's tabs to this window. */
  onRestore: (id: string) => void
  /** "Save open tabs" (D5): App saves this window's tabs as a new session. */
  onSave?: () => void
  /** "Update with open tabs" (S28): App saves this window's tabs into the session. */
  onUpdate?: (id: string) => void
  /** A save just made this session (D5, S1): its row opens its name field, with the name selected, once it is in the list. */
  renameRequest?: string | null
  /** The request was acted on: it must not open the field again. */
  onRenameConsumed?: () => void
}

type Menu = { x: number; y: number; id: string; tab: number | null }

/**
 * The Sessions tab (YAZ-3147 D4, D6): the saved sessions, last used first as main keeps them. A bar
 * counts them and saves the open tabs. A session row folds and unfolds on a click, and its name
 * becomes a field on a double-click. Each row has its menu; a tab row opens its page.
 * It reads the sessions from the cache, which answers the same array until they change, so the list
 * renders again only then (and for its own folds, menus and field).
 */
export function SessionList({ titles, onOpenFile, onRestore, onSave, onUpdate, renameRequest = null, onRenameConsumed }: SessionListProps) {
  const sessions = useSyncExternalStore(storage.subscribe, storage.getSessions)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)
  // The new session reaches the cache with main's broadcast, which can come after the save's answer: the field opens when its row is there.
  useEffect(() => {
    if (renameRequest === null || !sessions.some((s) => s.id === renameRequest)) return
    setRenaming(renameRequest)
    onRenameConsumed?.()
  }, [renameRequest, sessions, onRenameConsumed])

  const toggle = useCallback((id: string) => setOpen((was) => {
    const next = new Set(was)
    if (!next.delete(id)) next.add(id)
    return next
  }), [])
  const openMenu = useCallback((e: MouseEvent, id: string, tab: number | null) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, id, tab })
  }, [])
  const rename = useCallback((id: string, name: string) => {
    void api.window.renameSession(id, name).catch(failed('rename'))
  }, [])
  const endRename = useCallback(() => setRenaming(null), [])

  const target = menu === null ? undefined : sessions.find((s) => s.id === menu.id)
  const sections = (session: Session, tab: number | null): MenuSection[] =>
    tab === null
      ? [
          [
            { id: 'restore-session', label: 'Restore session', onSelect: () => onRestore(session.id) },
            { id: 'update-session', label: 'Update with open tabs', onSelect: () => onUpdate?.(session.id) },
            { id: 'rename-session', label: 'Rename', onSelect: () => setRenaming(session.id) },
          ],
          [{ id: 'delete-session', label: 'Delete session', danger: true, onSelect: () => setDeleting(session) }],
        ]
      : [[{
          id: 'remove-from-session',
          label: 'Remove from session',
          // The tab leaves the saved copy only (S30): the file and the open tabs do not change.
          onSelect: () => void api.window.setSessionTabs(session.id, session.tabs.filter((_, i) => i !== tab)).catch(failed('remove from session')),
        }]]

  return (
    <>
      <div className="sidebar__focus-bar">
        <span>{sessions.length === 0 ? 'No sessions' : count(sessions.length, 'session', 'sessions')}</span>
        <button type="button" className="sidebar__focus-clear" onClick={onSave}>
          Save open tabs
        </button>
      </div>
      {sessions.length === 0 && <p className="sidebar__msg">{NO_SESSIONS_HELP}</p>}
      {sessions.length > 0 && (
        <ul className="tree" role="tree" aria-label="Sessions">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              open={open.has(session.id)}
              renaming={renaming === session.id}
              titles={titles}
              onToggle={toggle}
              onStartRename={setRenaming}
              onRename={rename}
              onEndRename={endRename}
              onMenu={openMenu}
              onOpenFile={onOpenFile}
            />
          ))}
        </ul>
      )}
      {menu !== null && target !== undefined && <ContextMenu x={menu.x} y={menu.y} sections={sections(target, menu.tab)} onClose={() => setMenu(null)} />}
      {deleting !== null && (
        <ConfirmSheet
          labelId="confirm-delete-session-text"
          text={
            <>
              <strong>Delete &quot;{deleting.name}&quot;?</strong>
              <br />
              Its tabs and files do not change.
            </>
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setDeleting(null)
            void api.window.removeSession(deleting.id).catch(failed('delete'))
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}

interface SessionRowProps {
  session: Session
  open: boolean
  renaming: boolean
  titles: PathTitles
  onToggle: (id: string) => void
  onStartRename: (id: string) => void
  onRename: (id: string, name: string) => void
  onEndRename: () => void
  onMenu: (e: MouseEvent, id: string, tab: number | null) => void
  onOpenFile: (path: string) => void
}

/** One session and, unfolded, its tabs (D6). Memo: a fold, a menu or a field of another row does not render it again. */
const SessionRow = memo(function SessionRow({ session, open, renaming, titles, onToggle, onStartRename, onRename, onEndRename, onMenu, onOpenFile }: SessionRowProps) {
  const { id, name, tabs, roots } = session
  return (
    <li role="treeitem" aria-expanded={open}>
      {renaming ? (
        // The name field (S11–S15): the name selected; Return saves, Esc keeps the name, a blank name is refused, a long one is cut at 80.
        <div className="create-inline" style={{ paddingLeft: 8 }}>
          <TextField className="create-inline__input" value={name} aria-label="Session name" autoFocus selectOnMount maxLength={MAX_VAULT_NAME} normalize={cleanVaultName} onCommit={(next) => onRename(id, next)} onDone={onEndRename} />
        </div>
      ) : (
        <button type="button" className="tree__row tree__row--dir" onClick={() => onToggle(id)} onDoubleClick={() => onStartRename(id)} onContextMenu={(e) => onMenu(e, id, null)}>
          <span className={`tree__chevron${open ? ' tree__chevron--open' : ''}`} />
          <span className="tree__label">{name}</span>
          <span className="tree__count">{count(tabs.length, 'tab', 'tabs')}</span>
        </button>
      )}
      {open && tabs.length > 0 && (
        <ul className="tree" role="group">
          {tabs.map((tab, i) => {
            const vault = rootOfPath(roots, tab.path)
            return (
              // A session may hold two copies of one page: the place in the list is the key.
              <li key={i} role="treeitem">
                <button type="button" className="tree__row tree__row--file" style={{ paddingLeft: 36 }} title={tab.path} onClick={() => onOpenFile(tab.path)} onContextMenu={(e) => onMenu(e, id, i)}>
                  <span className="tree__label">{tab.name ?? pageLabel(tab.path, false, titles)}</span>
                  {vault !== null && <span className="tree__vault">{storage.vaultName(vault)}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
})
