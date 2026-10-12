# Myna

Lightweight desktop Matrix client for people who use Matrix as a hub for bridged
chats (WhatsApp, Signal, Telegram, Messenger, Discord… via mautrix bridges).
Beeper-like account handling, Slack-like UX, Czech UI.

Built with Tauri 2 (Rust, system WebView), React 19, TypeScript, Vite,
Tailwind CSS v4, shadcn/ui and matrix-js-sdk.

## Features

- Unified inbox plus per-network views (one rail entry per bridged network) and Matrix spaces
- Slack-style timeline: threads, replies, reactions, edits, read markers, day dividers
- Rich text composer with markdown shortcuts, mentions, emoji, attachments and voice messages
- End-to-end encryption (Rust crypto), cross-signing and key backup
- Bridge management, including cookie-based logins in a separate window
- Native desktop notifications and an unread badge on the dock icon
- Authenticated media served through a cached `media://` protocol (fast restarts, video seeking)
- Small and fast: system WebView, virtualized lists, no web fonts

## Requirements

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install) (stable, 1.82+)
- macOS: Xcode Command Line Tools (`xcode-select --install`), macOS 13+
- Windows / Linux: see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Development

```sh
pnpm install
pnpm tauri dev     # desktop app with hot reload
```

`pnpm dev` runs only the web frontend in a browser (http://localhost:1420); native
features (notifications, media cache, cookie logins) fall back or are disabled there.

## Build

```sh
pnpm tauri build
```

The bundle (`.app` / `.dmg` on macOS, `.msi` / `.exe` on Windows, `.deb` / `.AppImage` on
Linux) ends up in `src-tauri/target/release/bundle/`.

To regenerate app icons after editing `src-tauri/icons/source.svg`:

```sh
pnpm tauri icon src-tauri/icons/source.svg
```

## License

[AGPL-3.0-only](https://www.gnu.org/licenses/agpl-3.0.html)
