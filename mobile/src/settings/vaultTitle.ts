/**
 * YAZ-5659: a vault's name in words, for its row in Settings › Vaults. The phone knows a vault only by its GitHub repo
 * (the Mac's display name lives in the Mac's own settings, not in the repo), so the name comes from the repo's name:
 * the owner goes, the words split on `-` and `_`, a last word "vault" goes, and each word starts with a capital
 * (`yaseenarshad/notecards-scratch-vault` → "Notecards Scratch"). A repo named only "vault" keeps it ("Vault").
 */
export function vaultTitle(repo: string): string {
  const name = repo.slice(repo.lastIndexOf('/') + 1)
  const words = name.split(/[-_\s]+/).filter((w) => w !== '')
  if (words.length > 1 && words[words.length - 1]!.toLowerCase() === 'vault') words.pop()
  if (words.length === 0) return name
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
}
