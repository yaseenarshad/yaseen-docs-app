import { lazy, Suspense } from 'react'

/** The Friends tab (4E4, YAZ-5085): the screens and the friends logic are a chunk of their own (`friends/ui/`). */
const FriendsTab = lazy(() => import('../friends/ui/FriendsTab'))

export function Friends() {
  return (
    <Suspense fallback={<section className="fr-wait" aria-label="Friends" aria-busy="true" />}>
      <FriendsTab />
    </Suspense>
  )
}
