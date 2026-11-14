import { useEffect, useState } from 'react'

/**
 * The phone's own signal (`navigator.onLine`, and its `online` and `offline` events). In airplane mode the dot goes
 * grey at once; the engine learns it only at its next poll (15 s). `true` can still mean no internet (a captive Wi-Fi):
 * then the engine's `off` makes it grey.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const read = () => setOnline(navigator.onLine !== false)
    window.addEventListener('online', read)
    window.addEventListener('offline', read)
    read()
    return () => {
      window.removeEventListener('online', read)
      window.removeEventListener('offline', read)
    }
  }, [])
  return online
}
