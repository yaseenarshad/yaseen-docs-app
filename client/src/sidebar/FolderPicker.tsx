import { useEffect, useState } from 'react'
import type { DirsResponse, RecentRoots } from '@shared/types'
import { api, ApiRequestError } from '../api'

interface FolderPickerProps {
  /** Directory to start browsing from; null → server default ($HOME). */
  initialPath: string | null
  recent: RecentRoots
  onOpen: (path: string) => void
  /** Absent when there is no root yet (first launch): the picker cannot be dismissed. */
  onCancel?: () => void
}

export function FolderPicker({ initialPath, recent, onOpen, onCancel }: FolderPickerProps) {
  const [path, setPath] = useState<string | null>(initialPath)
  const [listing, setListing] = useState<DirsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    api.dirs(path ?? undefined).then(
      (res) => {
        if (!cancelled) setListing(res)
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof ApiRequestError ? err.message : 'Failed to list folder')
      },
    )
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(() => {
    if (onCancel === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const current = listing?.path ?? path
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="picker" role="dialog" aria-label="Open folder" onClick={(e) => e.stopPropagation()}>
        <header className="picker__head">
          <h2>Open folder</h2>
          {onCancel !== undefined && (
            <button type="button" className="picker__close" onClick={onCancel} aria-label="Close">
              ×
            </button>
          )}
        </header>
        {recent.length > 0 && (
          <section className="picker__recent">
            <h3>Recent</h3>
            <ul>
              {recent.slice(0, 5).map((r) => (
                <li key={r.path}>
                  <button type="button" onClick={() => onOpen(r.path)} title={r.path}>
                    <span className="picker__name">{basename(r.path)}</span>
                    <span className="picker__path">{r.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="picker__current" title={current ?? ''}>
          {current ?? '…'}
        </div>
        <ul className="picker__list">
          {listing?.parent !== null && listing?.parent !== undefined && (
            <li>
              <button type="button" onClick={() => setPath(listing.parent)}>
                ..
              </button>
            </li>
          )}
          {listing?.dirs.map((d) => (
            <li key={d.path}>
              <button type="button" onClick={() => setPath(d.path)}>
                {d.name}
              </button>
            </li>
          ))}
          {listing !== null && listing.dirs.length === 0 && <li className="picker__empty">No subfolders</li>}
          {error !== null && <li className="picker__error">{error}</li>}
        </ul>
        <footer className="picker__foot">
          <button type="button" className="btn btn--primary" disabled={current === null} onClick={() => current !== null && onOpen(current)}>
            Open this folder
          </button>
        </footer>
      </div>
    </div>
  )
}

export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || p
}
