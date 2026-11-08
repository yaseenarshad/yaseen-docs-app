import type { ComponentStore } from '../library/componentStore'
import type { MediaStore } from '../library/mediaStore'
import type { FavoriteCopies } from '../library/favoriteCopies'
import type { MediaProviders } from '../media/providers'
import type { IconPacks } from '../media/iconPacks'
import type { GitSyncManager } from '../git/manager'
import type { Sharing } from '../share/sharing'

/** App-owned services, passed explicitly. The public registry never names an IPC channel. */
export interface AutomationServices {
  components: ComponentStore
  media: MediaStore
  copies: FavoriteCopies
  studio: { providers: MediaProviders; packs: IconPacks }
  sync: GitSyncManager
  sharing: Sharing
  credentials: { hasPixabay(): Promise<boolean>; setPixabay(value: string | null): Promise<void> }
}
