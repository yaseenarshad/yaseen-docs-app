import { lazyScreen } from './LazyScreen'

/**
 * The Friends tab (4E4, YAZ-5085): the screens and the friends logic are a chunk of their own (`friends/ui/`). The
 * shared boundary (`lazyScreen`) says so in plain words, with Try again, when the chunk does not load.
 */
const FriendsTab = lazyScreen(() => import('../friends/ui/FriendsTab'), { waiting: <section className="fr-wait" aria-label="Friends" aria-busy="true" /> })

export function Friends() {
  return <FriendsTab />
}
