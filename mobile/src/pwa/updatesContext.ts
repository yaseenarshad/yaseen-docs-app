import { createContext } from 'react'
import type { Updates } from './updates'

/** YAZ-5593: the service worker's update for screens over the tabs (Settings › Check for updates); null: no worker. */
export const UpdatesContext = createContext<Updates | null>(null)
