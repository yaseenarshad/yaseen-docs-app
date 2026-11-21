import './placeBubble.css'

/**
 * The card's place in full (YAZ-5713, Yaseen's pick): a tap on the card's breadcrumb opens this small bubble under it,
 * the whole path ("New cards test / History / History cards") and ONE button that shows the page where it lives: the
 * Mac's "Show in sidebar", the phone's "Show in Search" (YAZ-5714). The phone's Review and the Mac's Inbox draw the
 * same bubble; each closes it by its own menu rule (a tap outside, Escape, the phone's Back).
 */
export function PlaceBubble({ parts, action, onAction }: { parts: readonly string[]; action: string; onAction: () => void }) {
  const path = parts.join(' / ')
  return (
    <div className="place-bubble" role="dialog" aria-label={`Card's place: ${path}`}>
      <p className="place-bubble__path">{path}</p>
      <button type="button" className="place-bubble__go" onClick={onAction}>
        {action}
      </button>
    </div>
  )
}
