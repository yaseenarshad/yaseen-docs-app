/** Confirmation dialog when removing item(s) from a Focus or Favorites scope list in the Sidebar. */
import { createPortal } from 'react-dom'
import type { ListScope } from '@shared/types'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { basename } from '../lib/paths'

export interface ScopeConfirmProps {
  kind: 'focus' | 'favorites'
  paths: readonly string[]
  scope: ListScope
  staysInOther: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ScopeConfirm({ kind, paths, scope, staysInOther, onConfirm, onCancel }: ScopeConfirmProps) {
  const list = kind === 'focus' ? 'focus' : 'favorites'
  const other = scope === 'workspace' ? 'vault' : 'workspace'
  const what = paths.length === 1 ? `"${basename(paths[0]).replace(/\.md$/i, '')}"` : `${paths.length} items`
  return createPortal(
    <ConfirmSheet
      labelId="confirm-scope-off-text"
      text={
        <>
          <strong>
            Remove {what} from the {scope} {list}?
          </strong>
          <br />
          {paths.length === 1 ? 'It leaves' : 'They leave'} this list.{' '}
          {staysInOther ? `${paths.length === 1 ? 'It stays' : 'They stay'} in the ${other} ${list}.` : `${paths.length === 1 ? 'It is' : 'They are'} in no other ${list} list.`} Your files do not change.
        </>
      }
      confirmLabel="Remove"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
    document.body,
  )
}
