import { useEffect, useState } from 'react'
import { Editor } from './editor/Editor'
import { useWatch } from './hooks/useWatch'

/** Temporary shell until the sidebar lands (GRO-1971): open a file via `#/abs/path.md`. */
export function App() {
  const [path, setPath] = useState<string | null>(() => hashPath())
  useEffect(() => {
    const onHash = () => setPath(hashPath())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const watch = useWatch(path === null ? null : path.slice(0, path.lastIndexOf('/')))
  return (
    <div className="app">
      <Editor path={path} watch={watch} />
    </div>
  )
}

function hashPath(): string | null {
  const h = decodeURIComponent(window.location.hash.slice(1))
  return h.startsWith('/') ? h : null
}
