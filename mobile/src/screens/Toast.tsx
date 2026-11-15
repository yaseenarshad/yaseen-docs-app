import { useCallback, useEffect, useState } from 'react'

/**
 * THE app's one quiet toast (YAZ-5469): a few words that fade after about 2 s. `role="status"`, so VoiceOver reads them
 * without moving the focus. `top`: under the top bar (the dot's "Synced · up to date"); else near the thumb.
 */
export function Toast({ text, top = false }: { text: string; top?: boolean }) {
  return (
    <p className={top ? 'toast toast--top' : 'toast'} role="status">
      {text}
    </p>
  )
}

/** The words a toast shows, and `say` to show new ones; they go after `ms`. A new `say` starts the time again. */
export function useToast(ms = 2000): [string | null, (text: string) => void] {
  const [said, setSaid] = useState<{ text: string } | null>(null)
  useEffect(() => {
    if (said === null) return
    const timer = setTimeout(() => setSaid(null), ms)
    return () => clearTimeout(timer)
  }, [said, ms])
  return [said?.text ?? null, useCallback((text: string) => setSaid({ text }), [])]
}
