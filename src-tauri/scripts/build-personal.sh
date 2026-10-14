#!/bin/sh
# Release build of Myna for your own Mac: signed with an Apple Development
# certificate and a development provisioning profile for app.myna.desktop, so
# communication notifications (sender avatar instead of the app icon) work.
# Not for distribution; that needs Developer ID signing and notarization.
#
#   APPLE_SIGNING_IDENTITY="Apple Development: …" src-tauri/scripts/build-personal.sh
#
# Expects the profile in src-tauri/profiles/myna.provisionprofile (or
# $MYNA_PROVISIONING_PROFILE). The app ends up in
# src-tauri/target/release/bundle/macos/Myna.app.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
profile="${MYNA_PROVISIONING_PROFILE:-$root/profiles/myna.provisionprofile}"
[ -n "$APPLE_SIGNING_IDENTITY" ] || { echo "build-personal: set APPLE_SIGNING_IDENTITY" >&2; exit 1; }
[ -f "$profile" ] || { echo "build-personal: missing $profile" >&2; exit 1; }

# The profile grants exactly these entitlements; sign with the same set.
entitlements="$root/profiles/myna.entitlements"
security cms -D -i "$profile" | plutil -extract Entitlements xml1 -o "$entitlements" -
config="$root/profiles/tauri.personal.conf.json"
cat > "$config" <<JSON
{
  "bundle": {
    "macOS": {
      "signingIdentity": "$APPLE_SIGNING_IDENTITY",
      "entitlements": "$entitlements",
      "files": { "embedded.provisionprofile": "$profile" }
    }
  }
}
JSON

cd "$root/.."
exec pnpm tauri build --bundles app --config "$config" "$@"
