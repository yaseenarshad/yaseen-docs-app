import { useEffect, useMemo, useRef, useState } from 'react'
import { own, type PeopleRead } from '@shared/people'
import { readCommentsAndShape } from '@shared/comments'
import { useApp } from '../../app/AppState'
import { githubClient } from '../../github/client'
import type { CommentsPort } from '../../comments/bridge'
import { commentSigner, readPeople } from '../../comments/signer'
import { CommentsView } from './CommentsView'

/**
 * YAZ-5461: the comments of the open PAGE (not of a card, for now), at the end of the page view. The page view mounts
 * it once (`PageView.tsx`) with the page's stored text; everything else is here: the port to the comment list (the
 * answer list's `comments`, `ShellSync.review()`), the people file's names and the signer.
 */
export function PageComments({ path, text }: { path: string; text: string }) {
  const app = useApp()
  const { store, tokens } = app.services
  const vault = app.vaultKey!
  const port = useCommentsPort()
  const [version, setVersion] = useState(0)
  const [people, setPeople] = useState<PeopleRead | null>(null)
  useEffect(() => (port === null ? undefined : port.subscribe(() => setVersion((n) => n + 1))), [port])
  useEffect(() => {
    let live = true
    void readPeople(store, vault).then((p) => live && setPeople(p))
    return () => {
      live = false
    }
  }, [store, vault, text])

  // The `by`, worked out once for this page (an IndexedDB read; `GET /user` only when the sign-in kept no account).
  const signed = useRef<Promise<string | undefined> | null>(null)
  const signer = () =>
    (signed.current ??= commentSigner(store, vault, async () => {
      const token = await tokens.read(vault)
      if (token === null) throw new Error('No token')
      const user = (await githubClient(token, { fetch: app.services.fetch }).request('/user')).data as { login: string; name: string | null }
      return { login: user.login, name: user.name ?? null }
    }).then((by) => {
      if (by === undefined) signed.current = null
      return by
    }))

  const { comments, shape } = useMemo(() => readCommentsAndShape(text), [text])
  const nameOf = (handle: string | undefined) => {
    if (handle === undefined || handle.trim() === '') return 'Someone'
    return (people === null ? undefined : own(people.people, handle)?.name) ?? handle
  }
  return <CommentsView path={path} comments={comments} shape={shape} port={port} signer={signer} nameOf={nameOf} version={version} />
}

/** The open vault's comment list, once the engine has loaded (`review()` gives the one answer list). */
function useCommentsPort(): CommentsPort | null {
  const { sync } = useApp().services
  const [port, setPort] = useState<CommentsPort | null>(null)
  useEffect(() => {
    let live = true
    let found = false
    const ask = () => {
      if (found || sync.review === undefined) return
      void sync
        .review()
        .then((link) => {
          const p = link?.answers.comments
          if (!live || p === undefined) return
          found = true
          setPort(p)
        })
        .catch(() => {})
    }
    ask()
    const off = sync.subscribe((event) => {
      if (event.type === 'state') ask()
    })
    return () => {
      live = false
      off()
    }
  }, [sync])
  return port
}
