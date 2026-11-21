import './imageCell.css'
import { useUnit } from '../../vault/unitWord'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IMAGE_EXTENSIONS, IMAGE_SIZE_DEFAULT, type PropertyDecl, type TreeNode } from '@shared/types'
import { api } from '../../api'
import { HoverTip } from '../../components/HoverTip'
import { extFor, imageFile, writeImageNamed } from '../../editor/image/insertImage'
import { imageSrc } from '../../editor/image/imageSrc'
import { fetchTree, latestTree } from '../../lib/treeFeed'
import { relTo } from '../../lib/paths'
import { LinkValue } from '../expr'
import { Popover } from './Popover'

/**
 * The Image column (YAZ-4802): one picture per page, for any use — a company's mark, a product photo, a screenshot, a
 * person's photo, a card cover. The page holds a link to a file in the vault, `Image: "[[assets/images/acme.png]]"`; a
 * plain vault path or an `http(s)` address written by hand shows too. The picture loads through `app://vault/…`, the
 * door page images use (`editor/image/imageSrc.ts`): main finds the file root-relative, then by its name anywhere.
 * The column's look (`size`, `shape`) is on its declaration in `.folder.md`.
 */

/** The vault the shown pictures are in: the folder page's views and a page's Properties panel each provide theirs. */
export const ImageVault = createContext<string | null>(null)

/** What a stored value names: a link's target, else the text as written (a path or a web address); null for none. */
export function imageRef(v: unknown): string | null {
  if (v instanceof LinkValue) return v.target.trim() || null
  if (Array.isArray(v)) return v.length > 0 ? imageRef(v[0]) : null
  if (typeof v !== 'string') return null
  const text = v.trim()
  if (text === '') return null
  const link = /^\[\[([^[\]|#]*)(?:[|#][^[\]]*)?\]\]$/.exec(text)
  return link === null ? text : link[1].trim() || null
}

/** The `<img>` source of `ref` in `root`'s vault: `app://vault/…` (from the vault's top), a web address as it is. */
export function imageUrl(root: string | null, ref: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref
  return root === null ? null : imageSrc(root, '', ref)
}

/** The value an Image cell writes for a vault file: a link, so a rename of the file keeps it (`links/renameLinks.ts`). */
export const imageValue = (path: string): string => `[[${path}]]`

export const imageSize = (decl: PropertyDecl | undefined): number => decl?.size ?? IMAGE_SIZE_DEFAULT

/** A picture in its box: `size` px square; as is (whole, never cropped), rounded or circle (filled). A missing file is a quiet placeholder. */
export function ImageThumb({ src, size, shape, preview = true }: { src: string | null; size: number; shape?: PropertyDecl['shape']; preview?: boolean }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  const box: CSSProperties = { width: size, height: size }
  if (src === null || broken)
    return (
      <span className="image-thumb image-thumb--broken" style={box} role="img" aria-label="Picture not found">
        <svg viewBox="0 0 16 16" width={Math.min(size, 16)} height={Math.min(size, 16)} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <path d="m2.5 11.5 3-3 2.5 2.5M10 9.5l1.5-1.5 2 2M3 3l10 10" />
        </svg>
      </span>
    )
  const img = <img className={`image-thumb image-thumb--${shape ?? 'as-is'}`} style={box} src={src} width={size} height={size} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
  // The bigger picture on hover: the app's own hover box (`HoverTip`), after its short wait.
  return preview ? <HoverTip className="image-thumb__hover" text={<img className="image-thumb__preview" src={src} alt="" />}>{img}</HoverTip> : img
}

/** A stored value's picture at its column's look, or null for no value. */
export function ImageOf({ value, decl }: { value: unknown; decl?: PropertyDecl }) {
  const root = useContext(ImageVault)
  const ref = imageRef(value)
  if (ref === null) return null
  return <ImageThumb src={imageUrl(root, ref)} size={imageSize(decl)} shape={decl?.shape} />
}

/** Writes a chosen or pasted picture into `assets/images/` (never over a file) and answers its vault path; `stem` names a picture that has no name of its own (a pasted one). */
export async function saveImageFile(root: string, file: File, stem?: string): Promise<string> {
  const dot = file.name.lastIndexOf('.')
  const named = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : ''
  const ext = file.type.startsWith('image/') ? extFor(file.type) : (IMAGE_EXTENSIONS as readonly string[]).includes(named) ? named : 'png'
  return writeImageNamed(root, stem ?? (dot > 0 ? file.name.slice(0, dot) : file.name || 'image'), new Uint8Array(await file.arrayBuffer()), ext)
}

/** The picture on the clipboard, as a file (a screenshot, a copied image); null when it holds none or can not be read. */
export async function clipboardImage(): Promise<File | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (type !== undefined) return new File([await item.getType(type)], `image.${extFor(type)}`, { type })
    }
  } catch {
    // No clipboard read: the text paste goes on as before.
  }
  return null
}

/** "Paste a link": main downloads the picture once (`downloadImage`), and it is saved like a chosen file. */
export async function saveImageLink(root: string, url: string): Promise<string> {
  const { bytes, mimeType, name } = await api.downloadImage({ url })
  return writeImageNamed(root, name || 'image', bytes, extFor(mimeType))
}

/** The vault's picture files, by vault path, A to Z. */
function vaultImages(root: string, tree: readonly TreeNode[]): string[] {
  const out: string[] = []
  const walk = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === 'dir') walk(node.children)
      else if ((IMAGE_EXTENSIONS as readonly string[]).includes(node.name.slice(node.name.lastIndexOf('.') + 1).toLowerCase())) out.push(relTo(root, node.path))
    }
  }
  walk(tree)
  return out.sort((a, b) => a.localeCompare(b))
}

/** How many of the vault's pictures the list draws at once; the search finds the rest. */
const SHOWN_IMAGES = 120

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * The picker an Image cell opens (YAZ-4802): "Images in the vault", searchable, and "Upload / link": a file from the
 * Mac or a web address, each saved into `assets/images/` first. A pick answers the value to write; Remove answers null.
 */
function ImagePicker({ anchor, root, current, label, onPick, onClose }: { anchor: HTMLElement | null; root: string | null; current: string | null; label: string; onPick: (value: string | null) => void; onClose: () => void }) {
  const unit = useUnit()
  const [tab, setTab] = useState<'vault' | 'upload'>('vault')
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[] | null>(null)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (root === null) return
    let live = true
    const known = latestTree(root)
    if (known !== null) setFiles(vaultImages(root, known.tree))
    void fetchTree(root).then(
      (answer) => live && setFiles(vaultImages(root, answer.tree)),
      (err: unknown) => live && known === null && setError(message(err)),
    )
    return () => {
      live = false
    }
  }, [root])
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    return (files ?? []).filter((path) => words === '' || path.toLowerCase().includes(words))
  }, [files, query])
  const save = async (work: () => Promise<string>) => {
    setBusy(true)
    setError(null)
    try {
      onPick(imageValue(await work()))
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }
  return (
    <Popover label={label} anchor={anchor} onClose={onClose} className="image-picker" focusOn="field">
      <div className="view-seg image-picker__tabs" role="tablist" aria-label="Where the picture comes from">
        <button type="button" role="tab" className="view-seg__opt" aria-pressed={tab === 'vault'} aria-selected={tab === 'vault'} onClick={() => setTab('vault')}>
          Images in the vault
        </button>
        <button type="button" role="tab" className="view-seg__opt" aria-pressed={tab === 'upload'} aria-selected={tab === 'upload'} onClick={() => setTab('upload')}>
          Upload / link
        </button>
      </div>
      {root === null ? (
        <p className="image-picker__note">{unit('This page is not in a vault.')}</p>
      ) : tab === 'vault' ? (
        <>
          <input className="view-input image-picker__search" type="search" aria-label="Search images" placeholder="Search images" value={query} onChange={(e) => setQuery(e.target.value)} />
          {files === null ? (
            <p className="image-picker__note">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="image-picker__note">{files.length === 0 ? 'No pictures in this vault yet.' : 'No picture matches.'}</p>
          ) : (
            <div className="image-picker__grid" role="listbox" aria-label="Images in the vault">
              {shown.slice(0, SHOWN_IMAGES).map((path) => (
                <button key={path} type="button" role="option" aria-selected={path === current} className="image-picker__item" title={path} onClick={() => onPick(imageValue(path))}>
                  <ImageThumb src={imageUrl(root, path)} size={40} preview={false} />
                  <span className="image-picker__name">{path.slice(path.lastIndexOf('/') + 1)}</span>
                </button>
              ))}
            </div>
          )}
          {shown.length > SHOWN_IMAGES && <p className="image-picker__note">{shown.length - SHOWN_IMAGES} more: search to narrow.</p>}
        </>
      ) : (
        <div className="image-picker__upload">
          <button type="button" className="view-menu__action" disabled={busy} onClick={() => input.current?.click()}>
            Choose file…
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file !== undefined) void save(() => saveImageFile(root, file))
            }}
          />
          <form
            className="image-picker__link"
            onSubmit={(e) => {
              e.preventDefault()
              const url = link.trim()
              if (!/^https?:\/\//i.test(url)) return setError('Paste a link that starts with http:// or https://')
              void save(() => saveImageLink(root, url))
            }}
          >
            <input className="view-input" type="text" aria-label="Paste a link" placeholder="Paste a link to a picture" value={link} onChange={(e) => setLink(e.target.value)} disabled={busy} />
            <button type="submit" className="view-menu__action" disabled={busy || link.trim() === ''}>
              Save
            </button>
          </form>
          <p className="image-picker__note">The picture is saved in assets/images.</p>
        </div>
      )}
      {busy && <p className="image-picker__note">Saving…</p>}
      {error !== null && (
        <p className="view-relation__error" role="alert">
          {error}
        </p>
      )}
      {current !== null && (
        <div className="view-menu__foot">
          <button type="button" className="view-menu__action" onClick={() => onPick(null)}>
            Remove
          </button>
        </div>
      )}
    </Popover>
  )
}

/**
 * An Image cell's editor (YAZ-4802): the picture (or Empty) as the cell's `[data-edit]` button; a click or Enter opens
 * the picker. A picture file dropped on the cell, or pasted while it has the focus, is saved and linked at once. Every
 * write is the cell's own `commit`, so Undo and Confirm changes see it like any edit.
 */
export function ImageCellEditor({ raw, decl, label, readOnly, onCommit, after }: { raw: unknown; decl?: PropertyDecl; label: string; readOnly: boolean; onCommit: (next: unknown) => void; after?: ReactNode }) {
  const root = useContext(ImageVault)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const ref = imageRef(raw)
  // An empty picture cell shows nothing (YAZ-4802 demo: a narrow column cut "Empty" to "Em"): a faint picture glyph
  // only while the row or the cell is under the pointer or focused, so the place to add one still shows.
  const shown =
    ref === null ? (
      <span className="image-cell__empty" aria-label="No picture">
        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x={2} y={2} width={12} height={12} rx={2} />
          <circle cx={6} cy={6.5} r={1.3} />
          <path d="M3 12l3.5-3.5L9 11l2-2 2 2" />
        </svg>
      </span>
    ) : (
      <ImageOf value={raw} decl={decl} />
    )
  if (readOnly) return <span className="view-cell-edit view-cell-edit--read-only image-cell">{shown}</span>
  const take = (file: File | null): boolean => {
    if (file === null || root === null) return false
    setError(null)
    saveImageFile(root, file).then((path) => onCommit(imageValue(path)), (err: unknown) => setError(message(err)))
    return true
  }
  const onDrag = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }
  return (
    <span
      ref={wrap}
      className="view-cell-edit image-cell"
      onDragOver={onDrag}
      onDragEnter={onDrag}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
        take(imageFile(e.dataTransfer))
      }}
      onPaste={(e) => {
        if (take(imageFile(e.clipboardData))) e.preventDefault()
      }}
    >
      {/*
        * In a table a plain click only selects the cell (the table's rule) and a double-click opens: the picture takes
        * the pointer for its preview, so its clicks come here. Enter on the cell clicks this button from code (no detail).
        */}
      <button
        type="button"
        className="view-cell-edit__display"
        data-edit=""
        aria-label={label}
        onClick={(e) => {
          const cell = e.currentTarget.closest<HTMLElement>('[data-cell]')
          if (e.detail > 0 && cell !== null) cell.focus()
          else setOpen(true)
        }}
        onDoubleClick={(e) => {
          if (e.currentTarget.closest('[data-cell]') !== null) setOpen(true)
        }}
      >
        {shown}
      </button>
      {after}
      {error !== null && (
        <span className="view-table__chip view-table__chip--error view-cell-edit__error" role="alert" title={error}>
          Save failed
        </span>
      )}
      {open &&
        createPortal(
          <ImagePicker anchor={wrap.current} root={root} current={ref} label={label} onClose={() => setOpen(false)} onPick={(value) => {
            setOpen(false)
            onCommit(value)
            wrap.current?.closest<HTMLElement>('[data-cell]')?.focus()
          }} />,
          document.body,
        )}
    </span>
  )
}

