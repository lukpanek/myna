# CLAUDE.md

Myna — lightweight Matrix desktop client focused on mautrix bridges (Beeper-like
account handling, Slack-like UX). Tauri 2 + React 19 + TypeScript + Vite +
Tailwind v4 + shadcn/ui + matrix-js-sdk. Read `docs/DESIGN.md` before changing
structure; it lists module contracts and UX rules.

- Package manager: **pnpm**. `pnpm tauri dev` runs the desktop app, `pnpm dev` the web UI only.
- UI strings (incl. error messages) go through `t()` from `src/i18n`; catalogs per namespace live in
  `src/i18n/messages/` with **cs** (source of truth), **sk** and **en**. Add new strings in all three.
- Don't start the dev server or run builds yourself; the user runs and verifies the app.
- Matrix state lives in `src/matrix/` (rooms store, bridge detection, push rules,
  media). UI state in `src/store/`. Features in `src/features/<area>/`.
- Bridges: networks are detected from `m.bridge` state; bridge login uses the
  mautrix bridgev2 provisioning API (`/_matrix/provision/v3`).
- Native side (`src-tauri/`): `media://` protocol (authenticated media + disk
  cache), cookie login webview, notifications.
- macOS notifications need a signed bundle: `pnpm tauri dev` runs the binary inside
  `target/debug/Myna Dev.app` (`src-tauri/scripts/dev-runner.sh`), signed with
  `$APPLE_SIGNING_IDENTITY` (ad-hoc builds get denied). With
  `src-tauri/profiles/myna-dev.provisionprofile` (gitignored, team MNV3XN75FD) it also
  gets the communication-notifications entitlement: sender avatar instead of the app icon.
  `src-tauri/scripts/build-personal.sh` does the same for a release build (`app.myna.desktop`,
  profile `profiles/myna.provisionprofile`), for the developer's own Mac only.
- License: AGPL-3.0-only (code ported from Sable/Cinny and mautrix-manager).
