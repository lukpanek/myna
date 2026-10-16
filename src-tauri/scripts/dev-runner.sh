#!/bin/sh
# Cargo runner on macOS: starts the dev binary from inside a minimal signed
# "Myna Dev.app", because UNUserNotificationCenter refuses processes without a
# bundle. Signs with $APPLE_SIGNING_IDENTITY (ad-hoc otherwise, which macOS
# denies notifications for). Other binaries (tests) run unchanged.
#
# With a development provisioning profile for app.myna.dev in
# profiles/myna-dev.provisionprofile (or $MYNA_DEV_PROVISIONING_PROFILE) the
# bundle embeds it and is signed with its entitlements, which enables
# communication notifications (sender avatar instead of the app icon). The
# signing identity must then belong to the profile's team.
set -e
bin="$1"
shift
[ "$(basename "$bin")" = myna ] || exec "$bin" "$@"

root="$(cd "$(dirname "$0")/.." && pwd)"
app="$(dirname "$bin")/Myna Dev.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/myna"
cp "$root/icons/icon.icns" "$app/Contents/Resources/icon.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>app.myna.dev</string>
  <key>CFBundleName</key><string>Myna Dev</string>
  <key>CFBundleDisplayName</key><string>Myna Dev</string>
  <key>CFBundleExecutable</key><string>myna</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.0</string>
  <key>CFBundleVersion</key><string>0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSUserActivityTypes</key><array><string>INSendMessageIntent</string></array>
</dict>
</plist>
PLIST
# SHA-1 of the profile's signing certificate when it is in the keychain. A profile
# only accepts its own certificate; anything else gets the app killed at launch
# by AMFI ("No matching profile found"), so the profile picks the identity.
profile_identity() {
  sha1="$(security cms -D -i "$1" 2>/dev/null | plutil -extract DeveloperCertificates.0 raw -o - - 2>/dev/null |
    base64 -d | openssl x509 -inform der -noout -fingerprint -sha1 2>/dev/null | sed 's/.*=//; s/://g')"
  [ -n "$sha1" ] && security find-identity -v -p codesigning | grep -q "$sha1" && echo "$sha1"
}
profile="${MYNA_DEV_PROVISIONING_PROFILE:-$root/profiles/myna-dev.provisionprofile}"
entitlements=""
identity="${APPLE_SIGNING_IDENTITY:--}"
[ -f "$profile" ] && profile_cert="$(profile_identity "$profile")"
if [ -n "$profile_cert" ]; then
  identity="$profile_cert"
  cp "$profile" "$app/Contents/embedded.provisionprofile"
  entitlements="$(dirname "$bin")/myna-dev.entitlements"
  security cms -D -i "$profile" | plutil -extract Entitlements xml1 -o "$entitlements" -
else
  rm -f "$app/Contents/embedded.provisionprofile"
fi
[ -f "$profile" ] && [ -z "$profile_cert" ] &&
  echo "dev-runner: certificate of $profile not in the keychain, signing without it (no communication notifications)" >&2
codesign --force --sign "$identity" ${entitlements:+--entitlements "$entitlements"} "$app" 2>/dev/null ||
  echo "dev-runner: codesign failed, notifications will not work" >&2
exec "$app/Contents/MacOS/myna" "$@"
