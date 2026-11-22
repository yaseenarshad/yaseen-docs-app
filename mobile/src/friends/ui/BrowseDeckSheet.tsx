import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BrowsableVault, DeckFilePayload, DeckTreeFile, SharedCardItem } from '@shared/friendsApi'
import { NO_LINK_PILLS } from '@shared/linkPills'
import '@client/editor/card/card.css'
import '@client/review/cardScreens.css'
import type { WikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
import { swipeIsOurs } from '../../app/edgeSwipe'
import { sheetMotion, type SheetMotion } from '../../explore/sheetMotion'
import '../../explore/explore.css'
import '../../search/search.css'
import { drawLocalCard } from '../../media/ui/cardDraw'
import { browserFacts, whereAmI } from '../../pwa/homeScreen'
import { AcceptCardSheet, type AcceptTarget } from './AcceptCardSheet'
import { gistText } from './board'
import type { FriendsService } from './service'
import './friends.css'

export interface BrowseDeckSheetProps {
  ownerId: number
  ownerName: string
  ownerLogin: string
  vaults: BrowsableVault[]
  service: FriendsService
  onClose: () => void
  onNotice?: (message: string) => void
}

type DeckPanel =
  | { id: number; kind: 'tree' }
  | { id: number; kind: 'file'; repo: string; path: string; title: string }

interface TreeFolder {
  name: string
  path: string
  folders: TreeFolder[]
  files: DeckTreeFile[]
}

const SHEET_STEPS = 6
let nextPanelId = 1

function buildFolderTree(files: readonly DeckTreeFile[]): TreeFolder {
  const root: TreeFolder = { name: '', path: '', folders: [], files: [] }
  const folderMap = new Map<string, TreeFolder>([['', root]])

  const ensureFolder = (dirPath: string): TreeFolder => {
    const existing = folderMap.get(dirPath)
    if (existing) return existing
    const slash = dirPath.lastIndexOf('/')
    const parentPath = slash < 0 ? '' : dirPath.slice(0, slash)
    const name = slash < 0 ? dirPath : dirPath.slice(slash + 1)
    const parent = ensureFolder(parentPath)
    const folder: TreeFolder = { name, path: dirPath, folders: [], files: [] }
    parent.folders.push(folder)
    folderMap.set(dirPath, folder)
    return folder
  }

  for (const file of files) {
    if (file.kind !== 'md') continue
    const slash = file.path.lastIndexOf('/')
    const dir = slash < 0 ? '' : file.path.slice(0, slash)
    ensureFolder(dir).files.push(file)
  }

  const sortTree = (node: TreeFolder) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name))
    node.files.sort((a, b) => a.title.localeCompare(b.title))
    for (const child of node.folders) sortTree(child)
  }
  sortTree(root)
  return root
}

function collectFolderPaths(node: TreeFolder, out: Set<string>): void {
  if (node.path) out.add(node.path)
  for (const child of node.folders) collectFolderPaths(child, out)
}

function folderOfPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/**
 * Draggable Explore panel stack for browsing a friend's shared deck (YAZ-6284):
 * - Root sheet: Vault switcher (if >1 vault), 1:1 Search input, collapsible folder/file tree.
 * - Stacked sheets (unlimited nesting, swipe down / Escape / dim tap to dismiss):
 *   rendered Markdown + on-demand proxied images + wikilink navigation + "Add to my deck" button
 *   opening centered `AcceptCardSheet` (which also fetches referenced images into the vault).
 */
export default function BrowseDeckSheet({
  ownerId,
  ownerName,
  ownerLogin,
  vaults,
  service,
  onClose,
  onNotice,
}: BrowseDeckSheetProps) {
  const [activeRepo, setActiveRepo] = useState(vaults[0]?.repo ?? '')
  const [treeFiles, setTreeFiles] = useState<DeckTreeFile[]>([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [stack, setStack] = useState<DeckPanel[]>(() => [{ id: nextPanelId++, kind: 'tree' }])
  const [acceptTarget, setAcceptTarget] = useState<AcceptTarget | null>(null)

  const activeVault = vaults.find((v) => v.repo === activeRepo) ?? vaults[0]

  useEffect(() => {
    if (!activeRepo || !service.browseDeckTree) {
      setTreeLoading(false)
      setTreeError('Deck browsing is not available.')
      return
    }
    let live = true
    setTreeLoading(true)
    setTreeError(null)
    void service
      .browseDeckTree(ownerId, activeRepo)
      .then((res) => {
        if (!live) return
        setTreeFiles(res.files)
      })
      .catch(() => {
        if (live) setTreeError('Could not load this deck. Try again.')
      })
      .finally(() => {
        if (live) setTreeLoading(false)
      })
    return () => {
      live = false
    }
  }, [ownerId, activeRepo, service])

  const popTop = () => {
    setStack((prev) => {
      if (prev.length <= 1) {
        onClose()
        return prev
      }
      return prev.slice(0, -1)
    })
  }

  const pushFile = (file: { repo: string; path: string; title: string }) => {
    setStack((prev) => [...prev, { id: nextPanelId++, kind: 'file', ...file }])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && acceptTarget === null) {
        e.preventDefault()
        popTop()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const mdFiles = useMemo(() => treeFiles.filter((f) => f.kind === 'md'), [treeFiles])
  const allPaths = useMemo(() => treeFiles.map((f) => f.path), [treeFiles])

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return mdFiles
    return mdFiles.filter((f) => f.title.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
  }, [mdFiles, query])

  const treeRoot = useMemo(() => buildFolderTree(filteredFiles), [filteredFiles])
  const allFolderPaths = useMemo(() => {
    const s = new Set<string>()
    collectFolderPaths(treeRoot, s)
    return s
  }, [treeRoot])

  const searching = query.trim() !== ''
  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const allCollapsed = allFolderPaths.size > 0 && [...allFolderPaths].every((p) => collapsed.has(p))
  const toggleAllFolders = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(allFolderPaths))
  }

  return createPortal(
    <>
      <div className="explore-layer">
        {stack.map((panel, i) => {
          const depth = stack.length - 1 - i
          const isTop = depth === 0 && acceptTarget === null
          const step = Math.min(i, SHEET_STEPS)
          if (panel.kind === 'tree') {
            const title = `${gistText(ownerName, 30) || 'Friend'} · ${activeVault?.name ?? activeRepo}`
            return (
              <DraggableDeckSheet
                key={panel.id}
                level={i}
                depth={depth}
                step={step}
                isTop={isTop}
                headerLabel={title}
                onDismiss={popTop}
              >
                <div className="fr-browse-deck">
                  {vaults.length > 1 && (
                    <div className="fr-browse-deck__vaults">
                      <label className="field" style={{ margin: 0 }}>
                        <span className="sr-only">Choose vault</span>
                        <select
                          aria-label="Choose vault"
                          className="fr-modal-card__input"
                          style={{ marginBottom: 8 }}
                          value={activeRepo}
                          onChange={(e) => {
                            setActiveRepo(e.target.value)
                            setQuery('')
                            setCollapsed(new Set())
                          }}
                        >
                          {vaults.map((v) => (
                            <option key={v.repo} value={v.repo}>
                              {v.name} ({v.repo})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  <div className="search__field">
                    <input
                      type="search"
                      name="deck-search"
                      className="search__box"
                      aria-label="Search cards and pages"
                      placeholder="Search cards and pages"
                      value={query}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      enterKeyHint="search"
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' && query !== '') {
                          e.stopPropagation()
                          setQuery('')
                        }
                      }}
                    />
                    {query !== '' ? (
                      <button type="button" className="search__clear" aria-label="Clear search" onClick={() => setQuery('')}>
                        <span aria-hidden>✕</span>
                      </button>
                    ) : (
                      allFolderPaths.size > 0 && (
                        <button
                          type="button"
                          className="search__clear"
                          aria-label={allCollapsed ? 'Expand all folders' : 'Collapse all folders'}
                          title={allCollapsed ? 'Expand all folders' : 'Collapse all folders'}
                          onClick={toggleAllFolders}
                        >
                          <span aria-hidden>{allCollapsed ? '⊞' : '⊟'}</span>
                        </button>
                      )
                    )}
                  </div>
                  {treeLoading ? (
                    <p className="muted" style={{ padding: '14px 4px' }}>
                      Loading deck…
                    </p>
                  ) : treeError !== null ? (
                    <p className="fr-line" role="alert">
                      {treeError}
                    </p>
                  ) : filteredFiles.length === 0 ? (
                    <p className="muted" style={{ padding: '14px 4px' }}>
                      {searching ? 'No matching cards or pages.' : 'No markdown files in this vault.'}
                    </p>
                  ) : (
                    <div className="fr-deck-tree" role="tree" aria-label="Deck files">
                      <DeckTreeBranch
                        node={treeRoot}
                        depth={0}
                        searching={searching}
                        collapsed={collapsed}
                        onToggleFolder={toggleFolder}
                        onOpenFile={(file) => pushFile({ repo: activeRepo, path: file.path, title: file.title })}
                      />
                    </div>
                  )}
                </div>
              </DraggableDeckSheet>
            )
          }

          const folder = folderOfPath(panel.path)
          const where = folder ? `${folder.split('/').join(' / ')} / ${panel.title}` : panel.title
          return (
            <DraggableDeckSheet
              key={panel.id}
              level={i}
              depth={depth}
              step={step}
              isTop={isTop}
              headerLabel={where}
              onDismiss={popTop}
            >
              <DeckFilePreview
                ownerId={ownerId}
                ownerLogin={ownerLogin}
                repo={panel.repo}
                path={panel.path}
                title={panel.title}
                allPaths={allPaths}
                mdFiles={mdFiles}
                service={service}
                onOpenLinkedFile={(targetFile) => pushFile({ repo: panel.repo, path: targetFile.path, title: targetFile.title })}
                onAddToDeck={(fileData) => {
                  const syntheticCard: SharedCardItem = {
                    id: `deck:${panel.repo}:${fileData.path}`,
                    folderId: null,
                    senderId: ownerId,
                    senderLogin: ownerLogin,
                    title: fileData.title,
                    markdown: fileData.markdown,
                    note: null,
                    attachments: [],
                    status: 'pending',
                    createdAt: new Date().toISOString(),
                  }
                  setAcceptTarget({
                    kind: 'card',
                    card: syntheticCard,
                    skipMarkAccepted: true,
                    loadAssets: async () => {
                      if (!service.browseDeckAsset || fileData.assetPaths.length === 0) return []
                      const fetched = await Promise.all(
                        fileData.assetPaths.map(async (assetPath) => {
                          try {
                            const { bytes } = await service.browseDeckAsset!(ownerId, panel.repo, assetPath)
                            return { path: assetPath, bytes }
                          } catch {
                            return null
                          }
                        }),
                      )
                      return fetched.filter((x): x is { path: string; bytes: Uint8Array } => x !== null)
                    },
                  })
                }}
              />
            </DraggableDeckSheet>
          )
        })}
      </div>
      {acceptTarget !== null && (
        <AcceptCardSheet
          target={acceptTarget}
          service={service}
          onClose={() => setAcceptTarget(null)}
          onDone={(msg) => {
            setAcceptTarget(null)
            onNotice?.(msg)
          }}
        />
      )}
    </>,
    document.body,
  )
}

function DraggableDeckSheet({
  level,
  depth,
  step,
  isTop,
  headerLabel,
  onDismiss,
  children,
}: {
  level: number
  depth: number
  step: number
  isTop: boolean
  headerLabel: string
  onDismiss: () => void
  children: React.ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const mark = useRef<HTMLDivElement>(null)
  const dim = useRef<HTMLDivElement>(null)
  const motion = useRef<SheetMotion | null>(null)
  const isNew = useRef(true)

  useLayoutEffect(() => {
    if (!isTop || !box.current || !head.current || !body.current || !mark.current || !dim.current) return
    const m = sheetMotion(
      { box: box.current, head: head.current, body: body.current, top: mark.current, dim: dim.current },
      { onClosed: onDismiss, edge: swipeIsOurs(whereAmI(browserFacts())) },
    )
    motion.current = m
    if (isNew.current) m.open()
    isNew.current = false
    box.current.focus({ preventScroll: true })
    return () => {
      m.destroy()
      motion.current = null
    }
  }, [isTop, onDismiss])

  const closeAnimated = () => {
    if (motion.current) motion.current.close()
    else onDismiss()
  }

  const place = depth === 0 ? '' : depth === 1 ? ' explore-sheet--under' : ' explore-sheet--under explore-sheet--deep'

  return (
    <>
      <div
        ref={dim}
        className={isTop ? 'explore-dim explore-dim--top' : 'explore-dim'}
        style={{ zIndex: level * 2 }}
        onClick={isTop ? closeAnimated : undefined}
        aria-hidden="true"
      />
      <div
        className={`explore-sheet${place}`}
        style={{ zIndex: level * 2 + 1, '--sheet-step': step } as CSSProperties}
        aria-hidden={isTop ? undefined : true}
      >
        <div ref={box} className="explore-sheet__box" role="dialog" aria-modal={isTop} aria-label={headerLabel} tabIndex={-1}>
          <div ref={head} className="explore-sheet__head">
            <span className="explore-sheet__grab" aria-hidden="true" />
            <span className="explore-sheet__where">{headerLabel}</span>
            <button type="button" className="explore-sheet__more" aria-label="Close" onClick={closeAnimated}>
              ✕
            </button>
          </div>
          <div ref={body} className="explore-sheet__body">
            <div ref={mark} className="explore-sheet__top" aria-hidden="true" />
            {children}
          </div>
        </div>
      </div>
    </>
  )
}

function DeckTreeBranch({
  node,
  depth,
  searching,
  collapsed,
  onToggleFolder,
  onOpenFile,
}: {
  node: TreeFolder
  depth: number
  searching: boolean
  collapsed: ReadonlySet<string>
  onToggleFolder: (path: string) => void
  onOpenFile: (file: DeckTreeFile) => void
}) {
  return (
    <>
      {node.folders.map((folder) => {
        const isOpen = searching || !collapsed.has(folder.path)
        return (
          <div key={folder.path} role="treeitem" aria-expanded={isOpen}>
            <button
              type="button"
              className="fr-deck-tree__row fr-deck-tree__row--folder"
              style={{ paddingLeft: 8 + depth * 16 }}
              onClick={() => onToggleFolder(folder.path)}
            >
              <span className="fr-deck-tree__chev" aria-hidden="true">
                {isOpen ? '▾' : '▸'}
              </span>
              <span className="fr-deck-tree__icon" aria-hidden="true">
                📁
              </span>
              <span className="fr-deck-tree__label">{folder.name}</span>
            </button>
            {isOpen && (
              <div role="group">
                <DeckTreeBranch
                  node={folder}
                  depth={depth + 1}
                  searching={searching}
                  collapsed={collapsed}
                  onToggleFolder={onToggleFolder}
                  onOpenFile={onOpenFile}
                />
              </div>
            )}
          </div>
        )
      })}
      {node.files.map((file) => (
        <button
          key={file.path}
          type="button"
          role="treeitem"
          className="fr-deck-tree__row fr-deck-tree__row--file"
          style={{ paddingLeft: 24 + depth * 16 }}
          onClick={() => onOpenFile(file)}
        >
          <span className="fr-deck-tree__icon" aria-hidden="true">
            📄
          </span>
          <span className="fr-deck-tree__label">{file.title}</span>
        </button>
      ))}
    </>
  )
}

function DeckFilePreview({
  ownerId,
  ownerLogin,
  repo,
  path,
  title,
  allPaths,
  mdFiles,
  service,
  onOpenLinkedFile,
  onAddToDeck,
}: {
  ownerId: number
  ownerLogin: string
  repo: string
  path: string
  title: string
  allPaths: readonly string[]
  mdFiles: readonly DeckTreeFile[]
  service: FriendsService
  onOpenLinkedFile: (file: DeckTreeFile) => void
  onAddToDeck: (file: DeckFilePayload) => void
}) {
  const [file, setFile] = useState<DeckFilePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!service.browseDeckFile) {
      setLoading(false)
      setError('Deck preview is not available.')
      return
    }
    let live = true
    setLoading(true)
    setError(null)
    void service
      .browseDeckFile(ownerId, repo, path)
      .then((res) => {
        if (live) setFile(res)
      })
      .catch(() => {
        if (live) setError('Could not load this file.')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [ownerId, repo, path, service])

  const wikilinkSource = useMemo<WikilinkResolveSource>(
    () => ({
      resolve: null,
      records: [],
      folders: [],
      ids: false,
      letters: [],
      pills: NO_LINK_PILLS,
      vault: '',
      subscribe: () => () => {},
    }),
    [],
  )

  useEffect(() => {
    const el = host.current
    if (!el || !file) return
    const drawn = drawLocalCard(
      file.markdown,
      { sides: 99, shown: 99, next: null },
      {
        links: wikilinkSource,
        files: allPaths,
        holder: file.path,
      },
    )
    el.replaceChildren(drawn)

    // Hydrate proxied images on demand from the friend's repo via the Worker.
    const urls: string[] = []
    let live = true
    if (service.browseDeckAsset) {
      const imgs = [...el.querySelectorAll<HTMLImageElement>('img[data-vault-src]')]
      for (const img of imgs) {
        const assetPath = img.dataset.vaultSrc
        if (!assetPath) continue
        void service
          .browseDeckAsset(ownerId, repo, assetPath)
          .then(({ bytes, contentType }) => {
            if (!live || bytes.byteLength === 0) return
            const copy = new Uint8Array(bytes.byteLength)
            copy.set(bytes)
            const url = URL.createObjectURL(new Blob([copy], { type: contentType || 'application/octet-stream' }))
            urls.push(url)
            img.src = url
          })
          .catch(() => undefined)
      }
    }

    return () => {
      live = false
      for (const u of urls) URL.revokeObjectURL(u)
    }
  }, [file, allPaths, wikilinkSource, ownerId, repo, service])

  const handleTap = (e: React.MouseEvent) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-path], [data-target], .wikilink') : null
    if (!target) return
    const rawTarget = target.dataset.path ?? target.dataset.target ?? target.textContent?.trim() ?? ''
    if (!rawTarget) return
    const lower = rawTarget.toLowerCase().replace(/\.md$/i, '')
    const hit = mdFiles.find(
      (f) =>
        f.path.toLowerCase() === rawTarget.toLowerCase() ||
        f.path.toLowerCase().replace(/\.md$/i, '') === lower ||
        f.title.toLowerCase() === lower,
    )
    if (hit) {
      e.preventDefault()
      onOpenLinkedFile(hit)
    }
  }

  return (
    <article className="reader explore-sheet__reader fr-browse-preview" aria-label={title}>
      <div className="fr-browse-preview__bar">
        <div className="fr-browse-preview__meta">
          <h2 className="reader__title" style={{ margin: 0 }}>
            {file?.title ?? title}
          </h2>
          <span className="muted" style={{ fontSize: 12 }}>
            @{ownerLogin} · {path}
          </span>
        </div>
        {file !== null && (
          <button type="button" className="btn btn--primary" onClick={() => onAddToDeck(file)}>
            Add to my deck
          </button>
        )}
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error !== null && (
        <p className="fr-line" role="alert">
          {error}
        </p>
      )}
      <div className="reader__body card__body" ref={host} onClick={handleTap} />
    </article>
  )
}
