/**
 * The "File changed on disk" bar (🔒 YAZ-1810): a document host shows it when a genuine outside
 * change lands on a DIRTY buffer, or its own save meets a stale mtime. Reload takes the disk's
 * version, Keep mine overwrites it with the tab's. Shared by `DrawingEditor` and `DrawioEditor`
 * (YAZ-1802) so both kinds of board answer a conflict with the same two words.
 */
export function ConflictBar({ onReload, onKeepBoth, onKeepMine }: { onReload: () => void; onKeepBoth?: () => void; onKeepMine: () => void }) {
  return (
    <div className="conflict-bar" role="alert">
      <span>File changed on disk.</span>
      <button type="button" onClick={onReload}>
        {onKeepBoth !== undefined ? 'Keep theirs' : 'Reload'}
      </button>
      {onKeepBoth !== undefined && (
        <button type="button" onClick={onKeepBoth}>
          Keep both
        </button>
      )}
      <button type="button" onClick={onKeepMine}>
        Keep mine
      </button>
    </div>
  )
}
