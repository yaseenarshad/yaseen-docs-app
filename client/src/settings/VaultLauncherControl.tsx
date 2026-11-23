/**
 * Settings › General › Vault app control (YAZ-5967, YAZ-6375).
 *
 * Shows the current vault's macOS `.app` launcher status and actions:
 * - Unsupported (non-macOS): renders nothing.
 * - No launcher: "Make a launcher…" button.
 * - Active launcher: icon preview, `<name>.app`, path, optional target badge, Edit…, Reveal, Test, Remove.
 * - Removed in Finder: clear notice with Recreate and Clear buttons.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import type { VaultLauncherStatus, VaultLauncherTarget } from '@shared/types'
import { api } from '../api'

const VaultLauncherModal = lazy(() => import('./VaultLauncherModal').then((m) => ({ default: m.VaultLauncherModal })))

export interface VaultLauncherControlProps {
  root: string
  defaultName: string
  onChanged?: () => void
}

function targetBadgeLabel(target?: VaultLauncherTarget): string | null {
  if (target === 'inbox') return 'Opens on Cards Inbox'
  if (target === 'today') return "Opens on Today's Daily Page"
  return null
}

export function VaultLauncherControl({ root, defaultName, onChanged }: VaultLauncherControlProps) {
  const [status, setStatus] = useState<VaultLauncherStatus | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    if (typeof window.yaseenDocs?.vaultLauncher?.status !== 'function') {
      setStatus({ supported: false, launcher: null, exists: false, iconDataUrl: null })
      return
    }
    void api.vaultLauncher
      .status(root)
      .then(
        (res) => {
          if (live) setStatus(res)
        },
        () => {
          if (live) setStatus({ supported: false, launcher: null, exists: false, iconDataUrl: null })
        },
      )
    return () => {
      live = false
    }
  }, [root])

  if (status === null || !status.supported) return null

  const { launcher, exists, iconDataUrl } = status
  const targetLabel = targetBadgeLabel(launcher?.target)

  const handleRemove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.vaultLauncher.remove(root)
      setStatus({ supported: true, launcher: null, exists: false, iconDataUrl: null })
      onChanged?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleReveal = async (): Promise<void> => {
    setError(null)
    try {
      await api.vaultLauncher.reveal(root)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleTest = async (): Promise<void> => {
    setError(null)
    try {
      await api.vaultLauncher.test(root)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="vault-launcher">
      {launcher === null ? (
        <div className="vault-launcher__empty">
          <button type="button" className="btn" onClick={() => setModalOpen(true)}>
            Make a launcher…
          </button>
        </div>
      ) : exists ? (
        <div className="vault-launcher__card">
          <div className="vault-launcher__summary">
            {iconDataUrl !== null && (
              <img className="vault-launcher__icon" src={iconDataUrl} alt="" width={48} height={48} />
            )}
            <div className="vault-launcher__meta">
              <div className="vault-launcher__name-line">
                <span className="vault-launcher__name">{launcher.name}.app</span>
                {targetLabel !== null && <span className="vault-launcher__target">{targetLabel}</span>}
              </div>
              <span className="vault-launcher__path" title={launcher.appPath}>{launcher.appPath}</span>
            </div>
          </div>
          <div className="vault-launcher__actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setModalOpen(true)}>
              Edit…
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void handleReveal()}>
              Reveal
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void handleTest()}>
              Test
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void handleRemove()}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="vault-launcher__missing">
          <p className="vault-launcher__missing-text" role="status">
            Launcher was removed in Finder.
          </p>
          <div className="vault-launcher__actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => setModalOpen(true)}>
              Recreate
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void handleRemove()}>
              Clear
            </button>
          </div>
        </div>
      )}

      {error !== null && (
        <p className="vault-launcher__error" role="alert">
          {error}
        </p>
      )}

      {modalOpen && (
        <Suspense fallback={null}>
          <VaultLauncherModal
            root={root}
            defaultName={defaultName}
            initial={launcher}
            initialIconDataUrl={iconDataUrl}
            onSaved={(next) => {
              setStatus(next)
              setModalOpen(false)
              setError(null)
              onChanged?.()
            }}
            onClose={() => setModalOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
