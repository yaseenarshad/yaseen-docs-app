#!/bin/sh
# Machine-agnostic dev launcher: agent shells often lack npm in PATH, and its
# install location differs per machine (Homebrew ARM/Intel, nvm, Volta, fnm).
set -e
cd "$(dirname "$0")/.."

find_npm() {
  command -v npm 2>/dev/null && return 0
  for p in /opt/homebrew/bin/npm /usr/local/bin/npm /usr/bin/npm \
    "$HOME"/.volta/bin/npm "$HOME"/.nvm/versions/node/*/bin/npm \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/npm; do
    [ -x "$p" ] && echo "$p" && return 0
  done
  return 1
}

NPM="$(find_npm)" || { echo "npm not found — install Node.js >= 20.19" >&2; exit 1; }

[ -d node_modules ] || "$NPM" install
exec "$NPM" run dev
