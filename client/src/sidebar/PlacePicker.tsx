/**
 * The in-app place picker (YAZ-3556 D6, with Yaseen's change): one sheet for the New… box's folder (⌘N), the Files &
 * Links folder field and ⌘D's folder or file. Not the macOS dialog: it shows only the folders of the window's vaults.
 *
 * It opens on the folders of the vault in front, as a list you click through: a folder row goes in, the path bar goes
 * back, and "Choose this folder" picks the folder on show. Typing filters every folder of that vault (with the vault
 * list on show, of every vault). With two or more vaults the bar starts with "Vaults", and the vault in front is the
 * first of them. In `files` mode the rows are the folders and the files, and a file row picks.
 *
 * The folders are the sidebar's tree (`latestTree`, one walk shared with it); a vault whose tree is not in yet asks for
 * one. At most `PLACE_ROWS` rows are drawn. The input keeps the keyboard: ↑ ↓ move, ⏎ acts, ⌫ in an empty field goes
 * back, Esc clears the text, then closes. A portal on the window's `.app` (its icon rules are scoped there): it opens over
 * the Settings dialog too.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { TreeNode } from '@shared/types'
import { fetchTree, latestTree, onTree } from '../lib/treeFeed'
import { allDirs, findDirNode } from '../lib/treeState'
import { SearchIcon } from '../views/view/icons'
import { FileIcon } from './FileIcon'
import { placeRel } from './goToPlace'

/** The most rows the sheet draws: a vault with thousands of folders is typed into, not scrolled. */
export const PLACE_ROWS = 50

export interface PlaceVault {
  root: string
  name: string
}

interface PlacePickerProps {
  /** The window's vaults, the vault in front first; never empty. */
  vaults: readonly PlaceVault[]
  /** `files`: ⌘D's "A file…", whose rows are files too. Default `folders`. */
  mode?: 'folders' | 'files'
  /** The folder the list opens on (absolute), when it is in one of `vaults`; else the first vault's root. */
  start?: string
  /** The sheet's name: "Choose a folder", "Choose a file". */
  label: string
  /** The chosen folder or file (absolute) and its vault. The caller closes the sheet. */
  onPick: (path: string, vault: string) => void
  onClose: () => void
}

type Row =
  | { kind: 'choose'; path: string }
  | { kind: 'vault'; root: string; name: string }
  | { kind: 'dir' | 'file'; path: string; name: string; where?: string }

const byName = (a: TreeNode, b: TreeNode): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

/** Every file of `tree`, any depth. */
const allFiles = (tree: readonly TreeNode[]): TreeNode[] => tree.flatMap((n) => (n.type === 'dir' ? allFiles(n.children) : [n]))

/** The trees of `roots`, as the sidebar's feed has them, and each new one it delivers; a root with none yet asks for it. */
function usePlaceTrees(roots: readonly string[]): ReadonlyMap<string, readonly TreeNode[]> {
  const key = roots.join('\n')
  const [trees, setTrees] = useState<ReadonlyMap<string, readonly TreeNode[]>>(() => new Map(roots.flatMap((root) => {
    const latest = latestTree(root)
    return latest === null ? [] : [[root, latest.tree] as const]
  })))
  useEffect(() => {
    const offs = roots.map((root) =>
      onTree(root, (outcome) => setTrees((now) => new Map(now).set(root, outcome.status === 'fulfilled' ? outcome.value.tree : (now.get(root) ?? [])))),
    )
    for (const root of roots) if (latestTree(root) === null) void fetchTree(root).catch(() => undefined)
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by value: a new array of the same vaults is no new feed
  }, [key])
  return trees
}

export function PlacePicker({ vaults, mode = 'folders', start, label, onPick, onClose }: PlacePickerProps) {
  const roots = useMemo(() => vaults.map((v) => v.root), [vaults])
  const trees = usePlaceTrees(roots)
  const multi = vaults.length > 1
  const vaultOf = (path: string): PlaceVault | undefined => vaults.find((v) => path === v.root || path.startsWith(`${v.root}/`))
  /** The folder on show (absolute); null is the list of vaults, with two or more. */
  const [at, setAt] = useState<string | null>(() => (start !== undefined && vaultOf(start) !== undefined ? start : vaults[0].root))
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const vault = at === null ? null : (vaultOf(at) ?? vaults[0])
  const tree = vault === null ? [] : trees.get(vault.root)
  // A folder that went away while the sheet was open shows its vault's root.
  const shown = at === null || vault === null || tree === undefined ? at : at === vault.root || findDirNode(tree, at) !== null ? at : vault.root
  const loading = vault !== null && tree === undefined

  const rows = useMemo((): Row[] => {
    const q = query.trim().toLowerCase()
    if (q !== '') {
      const scope = vault === null ? vaults : [vault]
      const hits = scope.flatMap((v) => {
        const t = trees.get(v.root) ?? []
        const nodes = mode === 'files' ? allFiles(t) : allDirs([...t]).map((path) => findDirNode(t, path) as TreeNode)
        return nodes.flatMap((n) => {
          const rel = placeRel(v.root, n.path)
          const name = n.name.toLowerCase()
          const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : rel.toLowerCase().includes(q) ? 2 : -1
          if (rank < 0) return []
          const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
          const where = multi ? (parent === '' ? v.name : `${v.name}/${parent}`) : parent
          return [{ rank, row: { kind: n.type, path: n.path, name: n.name, where } as Row }]
        })
      })
      // A stable sort: in rank, the tree's order (outer before inner) stays.
      return hits.sort((a, b) => a.rank - b.rank).map((h) => h.row)
    }
    if (shown === null) return vaults.map((v) => ({ kind: 'vault', root: v.root, name: v.name }))
    if (tree === undefined || vault === null) return []
    const node = shown === vault.root ? null : findDirNode(tree, shown)
    const children = [...(node === null ? tree : node.type === 'dir' ? node.children : [])].sort(byName)
    const dirs = children.filter((n) => n.type === 'dir').map((n): Row => ({ kind: 'dir', path: n.path, name: n.name }))
    if (mode === 'files') return [...dirs, ...children.filter((n) => n.type === 'file').map((n): Row => ({ kind: 'file', path: n.path, name: n.name }))]
    return [{ kind: 'choose', path: shown }, ...dirs]
  }, [query, vault, vaults, trees, mode, multi, shown, tree])
  const drawn = rows.slice(0, PLACE_ROWS)
  const cur = Math.min(sel, Math.max(0, drawn.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('.place-picker__row--active')?.scrollIntoView?.({ block: 'nearest' })
  }, [cur])

  const go = (next: string | null) => {
    setAt(next)
    setQuery('')
    setSel(0)
  }
  const act = (row: Row | undefined) => {
    if (row === undefined) return
    if (row.kind === 'vault') return go(row.root)
    // A folder of the list goes in; a folder the text found is the pick, as a file is.
    if (row.kind === 'dir' && (query.trim() === '' || mode === 'files')) return go(row.path)
    const home = vaultOf(row.path)
    if (home !== undefined) onPick(row.path, home.root)
  }
  /** One step up: the parent folder, the vault list from a vault's root (with two or more). */
  const up = () => {
    if (shown === null || vault === null) return
    if (shown === vault.root) return multi ? go(null) : undefined
    go(shown.slice(0, shown.lastIndexOf('/')))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const handled = e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape' || (e.key === 'Backspace' && query === '')
    if (!handled) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'ArrowDown') setSel(Math.min(cur + 1, drawn.length - 1))
    else if (e.key === 'ArrowUp') setSel(Math.max(cur - 1, 0))
    else if (e.key === 'Enter') act(drawn[cur])
    else if (e.key === 'Backspace') up()
    else if (query !== '') {
      setQuery('')
      setSel(0)
    } else onClose()
  }

  // The path bar: "Vaults" with two or more, the vault, then each folder down to the one on show.
  const crumbs: { label: string; to: string | null }[] = [
    ...(multi ? [{ label: 'Vaults', to: null }] : []),
    ...(shown === null || vault === null
      ? []
      : [{ label: vault.name, to: vault.root }, ...placeRel(vault.root, shown).split('/').filter((s) => s !== '').map((s, i, all) => ({ label: s, to: `${vault.root}/${all.slice(0, i + 1).join('/')}` }))]),
  ]

  const rowLabel = (row: Row) => {
    if (row.kind === 'choose') return <span className="place-picker__name">Choose this folder</span>
    if (row.kind === 'vault') return <span className="place-picker__name">{row.name}</span>
    return (
      <>
        <FileIcon path={row.path} folder={row.kind === 'dir'} />
        <span className="place-picker__name">{row.name}</span>
        {row.where !== undefined && row.where !== '' && <span className="place-picker__where">{row.where}</span>}
        {row.kind === 'dir' && (query.trim() === '' || mode === 'files') && <span className="place-picker__in" aria-hidden>›</span>}
      </>
    )
  }

  return createPortal(
    <div className="confirm-overlay place-picker-overlay" onMouseDown={onClose}>
      <div className="confirm place-picker" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        <div className="sidebar__search">
          <SearchIcon />
          <input
            className="sidebar__search-input"
            type="text"
            autoFocus
            spellCheck={false}
            placeholder={mode === 'files' ? 'Type to find a file' : 'Type to find a folder'}
            aria-label={label}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSel(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {query.trim() === '' && (
          <nav className="place-picker__bar" aria-label="Path">
            {crumbs.map((c, i) => (
              <span key={`${i}:${c.to ?? ''}`} className="place-picker__crumb-wrap">
                {i > 0 && <span className="place-picker__sep" aria-hidden>/</span>}
                <button type="button" className="place-picker__crumb" aria-current={i === crumbs.length - 1 ? 'location' : undefined} onClick={() => go(c.to)}>
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
        )}
        {loading ? (
          <p className="sidebar__msg">Loading the folders…</p>
        ) : drawn.length === 0 ? (
          <p className="sidebar__msg">{query.trim() !== '' ? 'No matches' : mode === 'files' ? 'This folder is empty' : 'No folders'}</p>
        ) : (
          <div className="place-picker__list" role="listbox" aria-label={label} ref={listRef}>
            {drawn.map((row, i) => (
              <div
                key={row.kind === 'vault' ? `v:${row.root}` : `${row.kind}:${row.path}`}
                role="option"
                aria-selected={i === cur}
                className={`place-picker__row place-picker__row--${row.kind}${i === cur ? ' place-picker__row--active' : ''}`}
                onMouseMove={() => i !== cur && setSel(i)}
                onClick={() => act(row)}
              >
                {rowLabel(row)}
              </div>
            ))}
            {rows.length > drawn.length && <p className="place-picker__more">{rows.length - drawn.length} more — type to narrow the list</p>}
          </div>
        )}
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  )
}
