#!/bin/sh
# Release build of Myna for your own Mac: signed with an Apple Development
# certificate and a development provisioning profile for app.myna.desktop, so
# communication notifications (sender avatar instead of the app icon) work.
# Not for distribution; that needs Developer ID signing and notarization.
#
#   src-tauri/scripts/build-personal.sh   (signs with the profile's certificate)
#
# Expects the profile in src-tauri/profiles/myna.provisionprofile (or
# $MYNA_PROVISIONING_PROFILE). The app ends up in
# src-tauri/target/release/bundle/macos/Myna.app, next to the signed updater
# archive (Myna.app.tar.gz + .sig) that scripts/release.sh publishes.
#
# The updater key defaults to ~/.tauri/myna.key (`pnpm tauri signer generate -w ~/.tauri/myna.key`);
# its public half is `plugins.updater.pubkey` in tauri.conf.json.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
# SHA-1 of the profile's signing certificate when it is in the keychain. A profile
# only accepts its own certificate; anything else gets the app killed at launch
# by AMFI ("No matching profile found"), so the profile picks the identity.
profile_identity() {
  sha1="$(security cms -D -i "$1" 2>/dev/null | plutil -extract DeveloperCertificates.0 raw -o - - 2>/dev/null |
    base64 -d | openssl x509 -inform der -noout -fingerprint -sha1 2>/dev/null | sed 's/.*=//; s/://g')"
  [ -n "$sha1" ] && security find-identity -v -p codesigning | grep -q "$sha1" && echo "$sha1"
}
profile="${MYNA_PROVISIONING_PROFILE:-$root/profiles/myna.provisionprofile}"
[ -f "$profile" ] || { echo "build-personal: missing $profile" >&2; exit 1; }
APPLE_SIGNING_IDENTITY="$(profile_identity "$profile")" ||
  { echo "build-personal: the certificate of $profile is not in the keychain" >&2; exit 1; }
export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.tauri/myna.key}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

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
