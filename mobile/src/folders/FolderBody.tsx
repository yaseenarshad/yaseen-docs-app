import { useVaultData } from '../search/vaultData'
import { folderTitleOf } from './folderTitle'

/**
 * A FOLDER'S PAGE, READ ONLY (YAZ-5460), in a sheet or full screen: what the Mac's folder page shows for the folder.
 * A chunk of its own (with the Mac's view engine); the first load never carries it.
 */
export default function FolderBody({ path }: { path: string; onDrawn?(): void }) {
  const data = useVaultData()
  const title = folderTitleOf(data?.folders ?? [], path)
  return (
    <article className="reader folder-page" aria-label={title}>
      <h2 className="reader__title">{title}</h2>
    </article>
  )
}
