/**
 * SETTINGS › IMAGES (YAZ-3038, YAZ-3028 D10; ported from Draw's Settings › Images and Files › Library folder):
 * what the drawing tab's canvas panel needs from the user, on one page.
 *
 * - The Pixabay API key (Draw's 🔒 YAZ-1775 D4). Its id is not a `SettingsState` field: the state file is
 *   broadcast to every window, and a key in it would be a key in every devtools console. The row
 *   writes through `secrets:set` and reads back only "set" / "not set" (`PixabayKeyControl`).
 * - The library folder (Draw's 🔒 YAZ-1775 D5): ONE folder every vault shares, for saved components and
 *   media favorites; `SettingsState.libraryFolder`, null = `<settings folder>/library` with a settings folder
 *   (YAZ-4364), else `<userData>/library`. Draw keeps it under
 *   Files; in Docs, Files & Links is about notes, and the library is the canvas panel's.
 * - The favorites (YAZ-4363): their count, the size of their own copies, and "all saved" or "3 still saving".
 * - Icon packs (YAZ-4359), its own group: every Iconify pack on this Mac, and where they live (`IconPacksControl`).
 * - Add panel › Hover zoom (YAZ-4447, D34): the same `mediaHoverZoom` as the panel's Filter › Hover zoom.
 */
import { Segmented } from './controls'
import { FavoriteCopiesLine } from './FavoriteCopiesLine'
import { IconPacksControl } from './IconPacksControl'
import { LibraryFolderControl, LibraryFolderHint } from './LibraryFolderControl'
import { ON_OFF_OPTIONS } from './options'
import { PixabayKeyControl } from './PixabayKeyControl'
import type { SettingsSection } from './registry'

export const IMAGES_SECTION: SettingsSection = {
  id: 'images',
  title: 'Images',
  groups: [
    {
      items: [
        {
          id: 'pixabayApiKey',
          label: 'Pixabay API key',
          hint: "Stored in this app's data folder, readable only by your user, and never shown again. Iconify needs no key.",
          keywords: ['pixabay', 'api key', 'iconify', 'photos', 'icons', 'image studio', 'secret'],
          wide: true,
          render: () => <PixabayKeyControl />,
        },
      ],
    },
    {
      title: 'Library',
      items: [
        {
          // `wide`: the row's real content is the resolved path, which is long. The hint is a component:
          // only main can resolve the default.
          id: 'libraryFolder',
          label: 'Library folder',
          hint: 'Your saved components and media favorites, shared by every vault. With a settings folder, it lives there and syncs with your settings. A new folder gets a copy of your library, and the old one stays.',
          keywords: ['library', 'components', 'favorites', 'media', 'folder'],
          wide: true,
          render: ({ settings, onChange }) => (
            <>
              <LibraryFolderHint setting={settings.libraryFolder} />
              <div className="settings__options" role="group" aria-label="Library folder">
                <LibraryFolderControl settings={settings} onChange={onChange} />
              </div>
            </>
          ),
        },
        {
          id: 'favoriteCopies',
          label: 'Favorites',
          hint: 'Each favorite keeps its own copy in the library folder: the full-quality picture of an icon or photo, the elements of a shape, a component or a hand-drawn item. So it still adds with no network, and after its source is gone.',
          keywords: ['favorites', 'copies', 'saved', 'offline', 'size', 'backup', 'iconify', 'pixabay'],
          wide: true,
          render: () => <FavoriteCopiesLine />,
        },
      ],
    },
    {
      title: 'Icon packs',
      items: [
        {
          // YAZ-4359: never downloads by itself; the confirm box says how much comes.
          id: 'iconPacks',
          label: 'Icon packs',
          hint: 'Download every Iconify icon pack to this Mac once. Then icon search, tiles and adds are instant, complete and offline. One folder serves every vault on this Mac.',
          keywords: ['icon packs', 'iconify', 'download', 'offline', 'icons', 'update', 'check for new icons', 'folder'],
          wide: true,
          render: ({ settings, onChange }) => <IconPacksControl settings={settings} onChange={onChange} />,
        },
      ],
    },
    {
      title: 'Add panel',
      items: [
        {
          id: 'mediaHoverZoom',
          label: 'Hover zoom',
          hint: "Rest the pointer on a picture in a drawing's Add panel to see it bigger. The panel's Filter menu has the same switch.",
          keywords: ['hover zoom', 'zoom', 'bigger', 'enlarge', 'preview', 'add panel', 'image studio', 'tiles', 'pictures', 'icons'],
          render: ({ settings, onChange }) => <Segmented options={ON_OFF_OPTIONS} value={settings.mediaHoverZoom} onChange={(mediaHoverZoom) => onChange({ ...settings, mediaHoverZoom })} ariaLabel="Hover zoom" />,
        },
      ],
    },
  ],
}
