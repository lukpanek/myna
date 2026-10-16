#!/bin/sh
# Publishes a new version to GitHub Releases, where the in-app updater finds it
# (`plugins.updater.endpoints` in tauri.conf.json points at latest.json of the
# latest release).
#
#   1. Bump "version" in package.json (tauri.conf.json reads it from there).
#   2. src-tauri/scripts/release.sh "Co je nového"
#
# Builds with build-personal.sh, then creates the release v<version> with the
# signed archive and latest.json. Needs the GitHub CLI (`gh auth login`).
set -e
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

version="$(node -p "require('./package.json').version")"
tag="v$version"
notes="${1:-Myna $version}"
repo="${MYNA_RELEASE_REPO:-lukpanek/myna}"

case "$(uname -m)" in
  arm64) platform="darwin-aarch64"; arch="aarch64" ;;
  *) platform="darwin-x86_64"; arch="x86_64" ;;
esac

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  echo "release: $tag already exists; bump the version in package.json first" >&2
  exit 1
fi

src-tauri/scripts/build-personal.sh

bundle="src-tauri/target/release/bundle/macos"
[ -f "$bundle/Myna.app.tar.gz.sig" ] || { echo "release: missing $bundle/Myna.app.tar.gz.sig" >&2; exit 1; }

out="$(mktemp -d)"
archive="Myna_${version}_${arch}.app.tar.gz"
cp "$bundle/Myna.app.tar.gz" "$out/$archive"

node -e '
const [file, version, notes, platform, signature, url] = process.argv.slice(1);
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: { [platform]: { signature, url } },
};
require("fs").writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
' "$out/latest.json" "$version" "$notes" "$platform" "$(cat "$bundle/Myna.app.tar.gz.sig")" \
  "https://github.com/$repo/releases/download/$tag/$archive"

gh release create "$tag" --repo "$repo" --title "Myna $version" --notes "$notes" \
  "$out/$archive" "$out/latest.json"
rm -rf "$out"
echo "release: published $tag"
