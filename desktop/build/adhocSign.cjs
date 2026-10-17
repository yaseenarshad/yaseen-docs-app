// electron-builder `afterPack` hook: trim Chromium's locale paks, then sign the packed macOS bundle.
//
// `mac.identity: null` makes electron-builder skip signing entirely, which leaves the app with
// only the linker signature Electron ships on its main binary and NO bundle seal
// (`_CodeSignature/CodeResources`). Gatekeeper reports a downloaded bundle in that state as
// "damaged and can't be opened" instead of the ordinary unidentified-developer prompt with its
// "Open Anyway". A deep ad-hoc signature (`codesign --sign -`) seals every nested binary and the
// resources, needs no certificate, and runs identically on a laptop and on the CI runner.
//
// But an ad-hoc identity is the bundle's cdhash, new on every build, and macOS keys each privacy
// permission to that identity: every update looked like a new app and asked again (YAZ-2976 D1).
// So the seal uses the free self-signed certificate "Yaseen Local Signing" (made for YAZ-2770)
// when the keychain has it: every build then has the identity
// `identifier "com.yasinarshad.yaseendocs" and certificate leaf = H"…"`, the permissions stay, and
// the updater accepts only a build that meets it. Without the certificate it falls back to ad-hoc
// with a warning; `REQUIRE_SIGN_IDENTITY=1` (the release workflow) makes that an error instead.
const { execFileSync } = require('node:child_process')
const { readdirSync, rmSync } = require('node:fs')
const path = require('node:path')

/**
 * Chromium's own UI strings — validation bubbles, file/date/colour pickers — ship in 55 languages
 * (220 `locale.pak`, 48.7 MB on the Mac) inside an app used in English only; this keeps the English
 * ones (🔒 YAZ-2131 D1, YAZ-2182). On a non-English macOS the app's default locale becomes en-US, so
 * sorting and dates follow en-US — accepted by D1. Framework-side only: the app's own
 * `Contents/Resources/*.lproj` markers stay, so AppKit's Open/Save panels and system menu items
 * still follow the OS language (`electronLanguages` would delete those too). On the Mac it must
 * run BEFORE codesign seals the bundle.
 */
function trimChromiumLocales(appOutDir, platform, productFilename) {
  if (platform === 'darwin') {
    const dir = path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources')
    for (const name of readdirSync(dir)) if (name.endsWith('.lproj') && name !== 'en.lproj' && !name.startsWith('en_')) rmSync(path.join(dir, name), { recursive: true })
  } else {
    const dir = path.join(appOutDir, 'locales')
    for (const name of readdirSync(dir)) if (name.endsWith('.pak') && name !== 'en-US.pak' && name !== 'en-GB.pak') rmSync(path.join(dir, name))
  }
}

/** Whether the keychain search list holds a code signing identity called `name` (a self-signed one is listed as not trusted, and `codesign` still signs with it). */
function hasIdentity(name) {
  try {
    return execFileSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' }).includes(`"${name}"`)
  } catch {
    return false
  }
}

/**
 * What `codesign --sign` gets: the certificate's name, or `-` (ad-hoc) when the keychain lacks it.
 * Throws when `env.REQUIRE_SIGN_IDENTITY` is `1` and the certificate is missing: a release never
 * ships an ad-hoc build (YAZ-2976 S27).
 */
function signIdentity(env, has = hasIdentity) {
  const name = env.MAC_SIGN_IDENTITY || 'Yaseen Local Signing'
  if (has(name)) return name
  if (env.REQUIRE_SIGN_IDENTITY === '1') throw new Error(`No code signing certificate "${name}" in the keychain, and REQUIRE_SIGN_IDENTITY=1.`)
  console.warn(`warning: no code signing certificate "${name}" in the keychain. This build is ad-hoc: macOS asks for each permission again after an update to it, and the updater refuses it.`)
  return '-'
}

module.exports = async function afterPack(context) {
  trimChromiumLocales(context.appOutDir, context.electronPlatformName, context.packager.appInfo.productFilename)
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', signIdentity(process.env), app], { stdio: 'inherit' })
}
module.exports.trimChromiumLocales = trimChromiumLocales
module.exports.signIdentity = signIdentity
