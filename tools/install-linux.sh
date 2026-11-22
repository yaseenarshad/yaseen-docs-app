#!/usr/bin/env bash
# Install or update Yaseen Docs (Desktop + `yaseendocs` CLI) on Linux from GitHub Releases (YAZ-6314).
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yaseenarshad/yaseen-docs-app/main/tools/install-linux.sh | bash
# Optional env:
#   YASEEN_DOCS_TAG=v3.5         Install a specific release tag instead of latest
#   YASEEN_DOCS_INSTALL_DIR=...  Base directory (default: ~/.local/share/yaseen-docs)
#   YASEEN_DOCS_BIN_DIR=...      Symlink directory (default: ~/.local/bin)
#   GITHUB_TOKEN=...             Optional token to avoid GitHub API rate limits
set -euo pipefail

REPO="yaseenarshad/yaseen-docs-app"
INSTALL_BASE="${YASEEN_DOCS_INSTALL_DIR:-$HOME/.local/share/yaseen-docs}"
BIN_DIR="${YASEEN_DOCS_BIN_DIR:-$HOME/.local/bin}"

case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
esac

API_URL="https://api.github.com/repos/$REPO/releases/latest"
if [ -n "${YASEEN_DOCS_TAG:-}" ]; then
  API_URL="https://api.github.com/repos/$REPO/releases/tags/$YASEEN_DOCS_TAG"
fi

CURL_ARGS=(-fsSL -H "Accept: application/vnd.github+json")
if [ -n "${GITHUB_TOKEN:-}" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi

RELEASE_JSON="$(curl "${CURL_ARGS[@]}" "$API_URL")"
PARSED="$(python3 -c '
import json, sys
arch = sys.argv[1]
data = json.load(sys.stdin)
tag = data.get("tag_name") or ""
suffixes = (f"-linux-{arch}.tar.gz", "-linux-x86_64.tar.gz" if arch == "x64" else "-linux-aarch64.tar.gz")
asset = next((a for a in data.get("assets", []) if str(a.get("name", "")).endswith(suffixes)), None)
if not tag or not asset:
    label = tag or "<unknown>"
    sys.stderr.write(f"No {suffixes[0]} asset found in release {label}\n")
    sys.exit(1)
digest = str(asset.get("digest") or "")
if digest.startswith("sha256:"):
    digest = digest[len("sha256:"):]
print(tag)
print(asset["name"])
print(asset["browser_download_url"])
print(digest)
' "$ARCH" <<< "$RELEASE_JSON")"

TAG="$(printf '%s\n' "$PARSED" | sed -n '1p')"
NAME="$(printf '%s\n' "$PARSED" | sed -n '2p')"
URL="$(printf '%s\n' "$PARSED" | sed -n '3p')"
EXPECTED_SHA="$(printf '%s\n' "$PARSED" | sed -n '4p')"

# Validate single-segment TAG and NAME before any filesystem operations.
case "$TAG" in
  ""|.|..|*/*) echo "Refusing unsafe release tag: $TAG" >&2; exit 1 ;;
esac
case "$NAME" in
  ""|.|..|*/*) echo "Refusing unsafe asset name: $NAME" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
STAGE_DIR=""
cleanup() {
  rm -rf "$TMP"
  if [ -n "$STAGE_DIR" ]; then
    rm -rf "$STAGE_DIR"
  fi
}
trap cleanup EXIT

echo "Downloading $NAME ($TAG)..."
curl -fsSL -o "$TMP/$NAME" "$URL"

if [ -n "$EXPECTED_SHA" ] && command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "$TMP/$NAME" | awk '{print $1}')"
  if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    echo "SHA-256 mismatch for $NAME: expected $EXPECTED_SHA, got $ACTUAL_SHA" >&2
    exit 1
  fi
fi

TARGET_DIR="$INSTALL_BASE/$TAG"
STAGE_DIR="$INSTALL_BASE/.staging-$TAG-$$"
mkdir -p "$STAGE_DIR" "$BIN_DIR"
tar -xzf "$TMP/$NAME" -C "$STAGE_DIR" --strip-components=1
rm -rf "$TARGET_DIR"
mv "$STAGE_DIR" "$TARGET_DIR"
STAGE_DIR=""

ln -sfn "$TARGET_DIR/resources/bin/yaseendocs" "$BIN_DIR/yaseendocs"
ln -sfn "$TARGET_DIR/yaseen-docs" "$BIN_DIR/yaseen-docs"

echo "Installed Yaseen Docs $TAG ($ARCH) -> $TARGET_DIR"
echo "CLI linked at $BIN_DIR/yaseendocs"
if ! command -v yaseendocs >/dev/null 2>&1; then
  echo "Note: add $BIN_DIR to your PATH (e.g. export PATH=\"$BIN_DIR:\$PATH\")"
fi
