import { useEffect, useState } from 'react'
import { Editor } from './editor/Editor'

/** Temporary shell until the sidebar lands (GRO-1971): open a file via `#/abs/path.md`. */
export function App() {
  const [path, setPath] = useState<string | null>(() => hashPath())
  useEffect(() => {
    const onHash = () => setPath(hashPath())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return (
    <div className="app">
      <Editor path={path} />
    </div>
  )
}

function hashPath(): string | null {
  const h = decodeURIComponent(window.location.hash.slice(1))
  return h.startsWith('/') ? h : null
}
