import { useEffect, useState } from 'react'
import type { CommentsPort } from '../comments/bridge'
import type { PageSettingKey } from '../comments/settingWrite'

/**
 * ONE OF THE PAGE'S ON/OFF ROWS IN ITS ⋯ (YAZ-5568 "Folding on this page", YAZ-5591 "Sticky headings on this page"):
 * the row writes the page's own key in its frontmatter on the comments' safe path (`settingWrite.ts`); the page shows
 * the change at once, and follows the file again when the file says it (or the write was refused, which it says).
 * `fileOn`: what the page shows from its file now (its own key, else the vault's mobile setting). `name`: the row's
 * name in the notice ("Folding"). YAZ-5658: a row of three choices (Wide tables on this page) passes the page's own value,
 * `null` for none ("Same as the vault", which takes the key away).
 */
export function usePageSettingRow<V extends boolean | null>(port: CommentsPort | null, path: string, key: PageSettingKey, fileOn: V, name: string, say: (words: string) => void): { on: V; set(on: V): void } {
  const [wanted, setWanted] = useState<{ path: string; on: V; id: string | null } | null>(null)
  const want = wanted?.path === path ? wanted : null
  const refusedWords = `The phone could not change this page's ${name} setting. Nothing was changed.`
  useEffect(() => {
    if (want !== null && want.on === fileOn && want.id !== null) setWanted(null)
  }, [want, fileOn])
  useEffect(() => {
    if (port === null || want?.id == null) return
    const id = want.id
    const check = () => {
      const entry = port.waiting(path).find((c) => c.id === id)
      if (entry?.refused === undefined) return
      setWanted(null)
      say(refusedWords)
    }
    check()
    return port.subscribe(check)
  }, [port, path, want?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (on: V) => {
    if (port === null) return
    setWanted({ path, on, id: null })
    port.add({ path, body: '', setting: { key, on } }).then(
      (c) => setWanted((w) => (w !== null && w.path === path && w.on === on ? { ...w, id: c.id } : w)),
      () => {
        setWanted(null)
        say(refusedWords)
      },
    )
  }
  return { on: want?.on ?? fileOn, set }
}
