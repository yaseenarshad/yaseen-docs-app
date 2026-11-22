/**
 * BrowseDeckModal (YAZ-6284):
 * Desktop Explore modal (portaled to `document.body`) for browsing a friend's shared deck:
 * - Vault switcher (when friend shares >1 vault)
 * - 1:1 instant search bar + collapsible folder/file tree of the friend's live GitHub repo
 * - Stacked Explore preview panels (unlimited nesting, Back / Esc to pop) with rendered Markdown,
 *   on-demand proxied images, and an "Add to my deck" button opening AcceptCardSheet with attachments.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { splitFrontmatter } from '@shared/frontmatter'
import type {
  BrowsableVault,
  DeckFilePayload,
  DeckTreeFile,
  FriendBoardMember,
} from '@shared/friendsApi'
import { NO_LINK_PILLS } from '@shared/linkPills'
import { readCardSides, readPageSwitches } from '@shared/pageSwitches'
import { api } from '../api'
import { useReadOnlyPage } from '../editor/useReadOnlyPage'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { useUnit } from '../vault/unitWord'
import { AcceptCardSheet, type AcceptCardTarget } from './AcceptCardSheet'
import '../search/quickLook.css'

export interface BrowseDeckModalProps {
  friend: FriendBoardMember
  vaultRoot: string
  onNotice?: (message: string) => void
  onClose: () => void
}

interface TreeFolderNode {
  kind: 'folder'
  name: string
  path: string
  children: TreeEntryNode[]
}

interface TreeFileNode {
  kind: 'file'
  name: string
  path: string
  title: string
}

type TreeEntryNode = TreeFolderNode | TreeFileNode

interface LoadedAsset {
  path: string
  name: string
  mime: string
  dataBase64: string
  dataUrl: string
}

interface PreviewPanel {
  key: string
  repo: string
  path: string
  title: string
  loading: boolean
  error: string | null
  file: DeckFilePayload | null
  assets: Record<string, LoadedAsset>
}

function buildFolderTree(files: readonly DeckTreeFile[]): TreeEntryNode[] {
  const root: TreeFolderNode = { kind: 'folder', name: '', path: '', children: [] }
  const folderMap = new Map<string, TreeFolderNode>([['', root]])

  const ensureFolder = (folderPath: string): TreeFolderNode => {
    const existing = folderMap.get(folderPath)
    if (existing) return existing
    const parts = folderPath.split('/')
    const name = parts[parts.length - 1] ?? folderPath
    const parentPath = parts.slice(0, -1).join('/')
    const parent = ensureFolder(parentPath)
    const node: TreeFolderNode = { kind: 'folder', name, path: folderPath, children: [] }
    parent.children.push(node)
    folderMap.set(folderPath, node)
    return node
  }

  for (const f of files) {
    if (f.kind !== 'md') continue
    const parts = f.path.split('/')
    const parentPath = parts.slice(0, -1).join('/')
    const parent = ensureFolder(parentPath)
    parent.children.push({
      kind: 'file',
      name: parts[parts.length - 1] ?? f.title,
      path: f.path,
      title: f.title,
    })
  }

  const sortChildren = (nodes: TreeEntryNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) {
      if (n.kind === 'folder') sortChildren(n.children)
    }
  }
  sortChildren(root.children)
  return root.children
}

function resolveRelativePath(baseFilePath: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split('#')[0].split('?')[0]).replace(/\\/g, '/')
  if (cleanHref.startsWith('/')) return cleanHref.slice(1)
  const baseParts = baseFilePath.split('/').slice(0, -1)
  for (const seg of cleanHref.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') baseParts.pop()
    else baseParts.push(seg)
  }
  return baseParts.join('/')
}

function base64ToBlobUrl(mime: string, dataBase64: string): { url: string; revoke: boolean } {
  if (typeof URL.createObjectURL !== 'function' || typeof atob !== 'function') {
    return { url: `data:${mime};base64,${dataBase64}`, revoke: false }
  }
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { url: URL.createObjectURL(new Blob([bytes], { type: mime })), revoke: true }
}

function DeckMarkdownPreview({
  markdown,
  filePath,
  assets,
  allMdFiles,
  onOpenFile,
}: {
  markdown: string
  filePath: string
  assets: Record<string, LoadedAsset>
  allMdFiles: readonly DeckTreeFile[]
  onOpenFile: (file: { path: string; title: string }) => void
}) {
  const unit = useUnit()
  const hostRef = useRef<HTMLDivElement>(null)

  const { body, switches, cardSides } = useMemo(() => {
    const stripped = splitFrontmatter(markdown).body
    return {
      body: stripped,
      switches: readPageSwitches(markdown),
      cardSides: readCardSides(markdown),
    }
  }, [markdown])

  const { wikilinks, findByTarget } = useMemo(() => {
    const byPath = new Map<string, DeckTreeFile>()
    const byTitle = new Map<string, DeckTreeFile>()
    for (const f of allMdFiles) {
      const lowPath = f.path.toLowerCase()
      byPath.set(lowPath, f)
      byPath.set(lowPath.replace(/\.md$/i, ''), f)
      const lowTitle = f.title.toLowerCase()
      if (!byTitle.has(lowTitle)) byTitle.set(lowTitle, f)
    }
    const find = (rawTarget: string): DeckTreeFile | null => {
      const clean = rawTarget.split('#')[0].split('|')[0].trim().toLowerCase()
      if (!clean) return null
      return byPath.get(clean) ?? byTitle.get(clean) ?? null
    }
    const source: WikilinkResolveSource = {
      resolve: (target: string) => find(target)?.path ?? null,
      records: [],
      folders: [],
      ids: false,
      letters: [],
      pills: NO_LINK_PILLS,
      vault: null,
      subscribe: () => () => undefined,
    }
    return { wikilinks: source, findByTarget: find }
  }, [allMdFiles])

  // Exact same read-only Crepe renderer used by Desktop Search QuickLook / ReadOnlyPage
  useReadOnlyPage(hostRef, body.trim() === '' ? null : body, wikilinks, switches)

  // Hydrate relative <img> sources rendered by Crepe via proxied on-demand Blob URLs (revoked on cleanup)
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const assetKeys = Object.keys(assets)
    if (assetKeys.length === 0) return

    const urlCache = new Map<string, { url: string; revoke: boolean }>()
    const getUrl = (key: string, asset: LoadedAsset): string => {
      const existing = urlCache.get(key)
      if (existing) return existing.url
      const created = base64ToBlobUrl(asset.mime, asset.dataBase64)
      urlCache.set(key, created)
      return created.url
    }

    const hydrate = () => {
      const imgs = el.querySelectorAll('img')
      for (const img of imgs) {
        const rawSrc = img.dataset.browseOrigSrc ?? img.getAttribute('src') ?? ''
        if (!rawSrc || /^https?:|^data:|^blob:/i.test(rawSrc)) continue
        const resolved = resolveRelativePath(filePath, rawSrc)
        const key = assets[resolved] ? resolved : assets[rawSrc] ? rawSrc : null
        if (!key) continue
        img.dataset.browseOrigSrc = rawSrc
        const nextUrl = getUrl(key, assets[key])
        if (img.getAttribute('src') !== nextUrl) img.src = nextUrl
      }
    }

    hydrate()
    const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(hydrate) : null
    observer?.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
    return () => {
      observer?.disconnect()
      for (const entry of urlCache.values()) {
        if (entry.revoke) URL.revokeObjectURL(entry.url)
      }
    }
  }, [filePath, assets])

  // Intercept clicks on rendered [[wikilink]] pills and relative .md <a> links to push another stacked panel
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const handleClick = (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null
      if (!targetEl) return

      const wikiEl = targetEl.closest<HTMLElement>('.wikilink, .wikilink__group')
      if (wikiEl) {
        const rawText = wikiEl.textContent?.trim() ?? ''
        // If the link is inside a paragraph with `[[target|alias]]`, extract the target before `|` if present
        const bracketMatch = /\[\[([^\]]+)\]\]/.exec(wikiEl.parentElement?.textContent ?? '')
        const candidate =
          findByTarget(rawText) ??
          (bracketMatch ? findByTarget(bracketMatch[1]) : null)
        if (candidate) {
          e.preventDefault()
          e.stopPropagation()
          onOpenFile({ path: candidate.path, title: candidate.title })
          return
        }
      }

      const anchor = targetEl.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (!href || /^https?:|^mailto:/i.test(href)) return
      const resolved = resolveRelativePath(filePath, href)
      const target = allMdFiles.find(
        (f) => f.path.toLowerCase() === resolved.toLowerCase() || f.path.toLowerCase() === `${resolved.toLowerCase()}.md`,
      )
      if (target) {
        e.preventDefault()
        e.stopPropagation()
        onOpenFile({ path: target.path, title: target.title })
      }
    }
    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [filePath, allMdFiles, findByTarget, onOpenFile])

  return (
    <div
      ref={hostRef}
      className="quicklook__page fr-browse-preview__body"
      data-card-sides={cardSides ?? undefined}
    >
      {body.trim() === '' && <p className="editor-msg">{unit('Empty page')}</p>}
    </div>
  )
}

function relativeAssetName(filePath: string, assetPath: string): string {
  const cleanAsset = assetPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const dirParts = filePath.replace(/\\/g, '/').split('/').slice(0, -1)
  const dirPrefix = dirParts.length > 0 ? `${dirParts.join('/')}/` : ''
  const rel = dirPrefix && cleanAsset.startsWith(dirPrefix) ? cleanAsset.slice(dirPrefix.length) : cleanAsset
  const safeParts = rel
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..' && !s.startsWith('.'))
  return safeParts.join('/') || cleanAsset.split('/').pop() || cleanAsset
}

export function BrowseDeckModal({ friend, vaultRoot, onNotice, onClose }: BrowseDeckModalProps) {
  const unit = useUnit()
  const vaults: BrowsableVault[] = useMemo(() => friend.browsableVaults ?? [], [friend.browsableVaults])
  const [activeRepo, setActiveRepo] = useState<string>(() => vaults[0]?.repo ?? '')
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [files, setFiles] = useState<DeckTreeFile[]>([])
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [stack, setStack] = useState<PreviewPanel[]>([])
  const [acceptTarget, setAcceptTarget] = useState<AcceptCardTarget | null>(null)
  const [preparingImport, setPreparingImport] = useState(false)
  const panelSeqRef = useRef(0)

  useEffect(() => {
    if (!activeRepo && vaults[0]?.repo) setActiveRepo(vaults[0].repo)
  }, [activeRepo, vaults])

  useEffect(() => {
    let live = true
    if (!activeRepo || typeof api.friends.browseDeckTree !== 'function') {
      setTreeLoading(false)
      setTreeError('Deck browsing is unavailable.')
      return
    }
    setTreeLoading(true)
    setTreeError(null)
    setFiles([])
    setStack([])
    api.friends.browseDeckTree(friend.id, activeRepo).then(
      (res) => {
        if (!live) return
        setTreeLoading(false)
        if (!res.ok) {
          setTreeError(res.error === 'forbidden' ? 'You do not have permission to browse this deck.' : res.error)
          return
        }
        setFiles(res.tree.files)
      },
      (err: unknown) => {
        if (!live) return
        setTreeLoading(false)
        setTreeError(err instanceof Error ? err.message : 'Could not load deck.')
      },
    )
    return () => {
      live = false
    }
  }, [friend.id, activeRepo])

  const popPanel = useCallback(() => {
    setStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev))
  }, [])

  // Esc pops the top preview panel; when stack is empty (and AcceptCardSheet is closed), Esc closes modal
  useEffect(() => {
    if (acceptTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (stack.length > 0) popPanel()
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [stack.length, acceptTarget, popPanel, onClose])

  const openFilePanel = useCallback(
    (item: { path: string; title: string }) => {
      if (!activeRepo || typeof api.friends.browseDeckFile !== 'function') return
      const panelKey = `${++panelSeqRef.current}:${activeRepo}:${item.path}`
      setStack((prev) => [
        ...prev,
        {
          key: panelKey,
          repo: activeRepo,
          path: item.path,
          title: item.title,
          loading: true,
          error: null,
          file: null,
          assets: {},
        },
      ])

      void api.friends.browseDeckFile(friend.id, activeRepo, item.path).then(
        async (res) => {
          if (!res.ok) {
            setStack((prev) =>
              prev.map((p) => (p.key === panelKey ? { ...p, loading: false, error: res.error } : p)),
            )
            return
          }
          const loadedFile = res.file
          setStack((prev) =>
            prev.map((p) =>
              p.key === panelKey ? { ...p, loading: false, file: loadedFile, title: loadedFile.title || p.title } : p,
            ),
          )

          // Fetch referenced assets on demand
          if (loadedFile.assetPaths.length > 0 && typeof api.friends.browseDeckAsset === 'function') {
            const entries = await Promise.all(
              loadedFile.assetPaths.map(async (assetPath) => {
                const aRes = await api.friends.browseDeckAsset!(friend.id, activeRepo, assetPath).catch(() => null)
                if (!aRes || !aRes.ok) return null
                const name = relativeAssetName(loadedFile.path, assetPath)
                const asset: LoadedAsset = {
                  path: assetPath,
                  name,
                  mime: aRes.mime,
                  dataBase64: aRes.dataBase64,
                  dataUrl: `data:${aRes.mime};base64,${aRes.dataBase64}`,
                }
                return [assetPath, asset] as const
              }),
            )
            const assetMap: Record<string, LoadedAsset> = {}
            for (const pair of entries) {
              if (pair) assetMap[pair[0]] = pair[1]
            }
            if (Object.keys(assetMap).length > 0) {
              setStack((prev) =>
                prev.map((p) => (p.key === panelKey ? { ...p, assets: { ...p.assets, ...assetMap } } : p)),
              )
            }
          }
        },
        (err: unknown) => {
          setStack((prev) =>
            prev.map((p) =>
              p.key === panelKey
                ? { ...p, loading: false, error: err instanceof Error ? err.message : 'Could not load file.' }
                : p,
            ),
          )
        },
      )
    },
    [activeRepo, friend.id],
  )

  const handleAddToMyDeck = async (panel: PreviewPanel) => {
    if (!panel.file || preparingImport) return
    setPreparingImport(true)
    try {
      const attachments: { name: string; mime: string; dataBase64: string }[] = []
      for (const assetPath of panel.file.assetPaths) {
        const cached = panel.assets[assetPath]
        if (cached) {
          attachments.push({ name: cached.name, mime: cached.mime, dataBase64: cached.dataBase64 })
        } else if (typeof api.friends.browseDeckAsset === 'function') {
          const aRes = await api.friends.browseDeckAsset(friend.id, panel.repo, assetPath).catch(() => null)
          if (aRes?.ok) {
            attachments.push({
              name: relativeAssetName(panel.file.path, assetPath),
              mime: aRes.mime,
              dataBase64: aRes.dataBase64,
            })
          }
        }
      }
      setAcceptTarget({
        id: `browse:${panel.repo}:${panel.file.path}`,
        title: panel.file.title,
        markdown: panel.file.markdown,
        senderLogin: friend.login,
        ...(attachments.length > 0 ? { attachments } : {}),
      })
    } finally {
      setPreparingImport(false)
    }
  }

  const mdFiles = useMemo(() => files.filter((f) => f.kind === 'md'), [files])
  const folderTree = useMemo(() => buildFolderTree(mdFiles), [mdFiles])
  const normalizedQuery = query.trim().toLowerCase()
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return []
    return mdFiles.filter(
      (f) => f.title.toLowerCase().includes(normalizedQuery) || f.path.toLowerCase().includes(normalizedQuery),
    )
  }, [mdFiles, normalizedQuery])

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  const renderTreeNodes = (nodes: readonly TreeEntryNode[], depth = 0) =>
    nodes.map((node) => {
      if (node.kind === 'folder') {
        const isCollapsed = collapsed[node.path] === true
        return (
          <div key={`dir:${node.path}`} className="fr-browse-tree__group">
            <button
              type="button"
              className="fr-browse-tree__folder"
              style={{ paddingLeft: 10 + depth * 16 }}
              aria-expanded={!isCollapsed}
              onClick={() => toggleFolder(node.path)}
            >
              <span className="fr-browse-tree__chev" aria-hidden="true">
                {isCollapsed ? '▸' : '▾'}
              </span>
              <span className="fr-browse-tree__name">{node.name}</span>
            </button>
            {!isCollapsed && <div>{renderTreeNodes(node.children, depth + 1)}</div>}
          </div>
        )
      }
      return (
        <button
          key={`file:${node.path}`}
          type="button"
          className="fr-browse-tree__file"
          style={{ paddingLeft: 24 + depth * 16 }}
          onClick={() => openFilePanel({ path: node.path, title: node.title })}
        >
          <span className="fr-browse-tree__name">{node.title}</span>
        </button>
      )
    })

  const activeVault = vaults.find((v) => v.repo === activeRepo) ?? vaults[0]

  return createPortal(
    <div className="fr-modal-backdrop fr-browse-backdrop" role="presentation" onClick={onClose}>
      <div
        className="fr-browse-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Browse ${friend.name}'s deck`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fr-browse-modal__head">
          <div style={{ minWidth: 0 }}>
            <h3 className="fr-modal__title" style={{ margin: 0 }}>
              {friend.name}&apos;s deck
            </h3>
            {activeVault && (
              <div style={{ fontSize: 12, color: 'var(--fr-muted)', marginTop: 2 }}>{activeVault.name}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {vaults.length > 1 && (
              <select
                className="fr-select"
                aria-label="Choose vault"
                style={{ width: 'auto', minWidth: 140 }}
                value={activeRepo}
                onChange={(e) => setActiveRepo(e.target.value)}
              >
                {vaults.map((v) => (
                  <option key={v.repo} value={v.repo}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="fr-browse-modal__search">
          <input
            type="search"
            className="fr-input"
            aria-label="Search deck"
            placeholder={`Search ${friend.name}'s deck…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="fr-browse-modal__body">
          {treeLoading ? (
            <p className="fr-line">Loading deck…</p>
          ) : treeError ? (
            <p className="fr-error" role="alert">
              {treeError}
            </p>
          ) : normalizedQuery ? (
            searchResults.length === 0 ? (
              <p className="fr-line">No matches for &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <div className="fr-browse-tree" role="list" aria-label="Search results">
                {searchResults.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    className="fr-browse-tree__file fr-browse-tree__file--result"
                    onClick={() => openFilePanel({ path: f.path, title: f.title })}
                  >
                    <span className="fr-browse-tree__name">{f.title}</span>
                    <span className="fr-browse-tree__path">{f.path}</span>
                  </button>
                ))}
              </div>
            )
          ) : mdFiles.length === 0 ? (
            <p className="fr-line">{unit('No cards or pages in this vault yet.')}</p>
          ) : (
            <div className="fr-browse-tree" role="tree" aria-label="Deck files">
              {renderTreeNodes(folderTree)}
            </div>
          )}

          {/* Stacked Explore preview panels (unlimited nesting) */}
          {stack.map((panel, idx) => (
            <div
              key={panel.key}
              className="fr-browse-panel"
              style={{ zIndex: 10 + idx }}
              role="region"
              aria-label={`Preview ${panel.title}`}
            >
              <div className="fr-browse-panel__head">
                <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" onClick={popPanel}>
                  ← Back
                </button>
                <div className="fr-browse-panel__title" title={panel.path}>
                  {panel.title}
                </div>
                <button
                  type="button"
                  className="fr-btn fr-btn--primary fr-btn--sm"
                  disabled={!panel.file || preparingImport}
                  onClick={() => void handleAddToMyDeck(panel)}
                >
                  {preparingImport ? 'Preparing…' : 'Add to my deck'}
                </button>
              </div>
              <div className="fr-browse-panel__content">
                {panel.loading ? (
                  <p className="fr-line">Loading…</p>
                ) : panel.error ? (
                  <p className="fr-error" role="alert">
                    {panel.error}
                  </p>
                ) : panel.file ? (
                  <DeckMarkdownPreview
                    markdown={panel.file.markdown}
                    filePath={panel.file.path}
                    assets={panel.assets}
                    allMdFiles={mdFiles}
                    onOpenFile={openFilePanel}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {acceptTarget && (
        <AcceptCardSheet
          cards={[acceptTarget]}
          vaultRoot={vaultRoot}
          skipServerState
          onImported={(res) => {
            onNotice?.(`Added "${acceptTarget.title}" to ${res.dir || 'your vault'}`)
            setAcceptTarget(null)
          }}
          onClose={() => setAcceptTarget(null)}
        />
      )}
    </div>,
    document.body,
  )
}
