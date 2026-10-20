import { BOARD_TYPE_NAME, fileKind } from '@shared/fileKind'
import type { BoardHeadResponse } from '@shared/types'
import { formatBytes, formatDateTime } from '../lib/format'
import { basename, boardFolder } from '../lib/paths'
import { relativeTime } from '../lib/relativeTime'
import './boardPreview.css'

/**
 * The "Info" popover's body (Draw's 🔒 YAZ-1835 D6/D7, ported by YAZ-3028 D11): the board as its own
 * file head says — `fs:board-head`, read when the popover opens, because Docs' tree carries no dates
 * and is not read again on a save. A board with no
 * dates yet says so instead of inventing them. Type names the engine (Draw's 🔒 YAZ-1802 D13).
 */
export default function BoardInfo({ info, root, now }: { info: BoardHeadResponse; root: string; now: number }) {
  const kind = fileKind(info.path)
  const when = (ms: number) => (
    <>
      {formatDateTime(ms)} <span className="board-info__ago">· {relativeTime(ms, now)}</span>
    </>
  )
  const unstamped = <span className="board-info__ago">Not stamped yet · written on the next save</span>
  const name = basename(info.path)
  return (
    <dl className="board-info" aria-label={`Info for ${name}`}>
      <dt>Name</dt>
      <dd className="board-info__name">{name}</dd>
      {(kind === 'drawing' || kind === 'diagram') && (
        <>
          <dt>Type</dt>
          <dd>{BOARD_TYPE_NAME[kind]}</dd>
        </>
      )}
      <dt>Folder</dt>
      <dd>{boardFolder(root, info.path)}</dd>
      <dt>Size</dt>
      <dd>{formatBytes(info.size)}</dd>
      <dt>Created</dt>
      <dd>{info.meta ? when(info.meta.createdAt) : unstamped}</dd>
      <dt>Updated</dt>
      <dd>{info.meta ? when(info.meta.updatedAt) : unstamped}</dd>
      <dt>On disk</dt>
      <dd>{when(info.mtime)}</dd>
    </dl>
  )
}
