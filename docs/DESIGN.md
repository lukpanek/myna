# Myna — design

Lightweight desktop Matrix client for people who use Matrix as a **bridge hub**
(mautrix bridgev2: WhatsApp, Signal, Telegram, Meta, Discord…), not as a social
network. Beeper-like account handling, Slack-like UX. UI languages: Czech, Slovak, English.

## Stack

- **Tauri 2** shell (Rust): system WebView, small binary, native notifications,
  a `media://` protocol that adds auth to Matrix media and caches it on disk.
- **React 19 + TypeScript + Vite**, **Tailwind v4 + shadcn/ui** (new-york, neutral).
- **matrix-js-sdk** with Rust crypto (WASM) and IndexedDB sync store.
- **zustand** for app state, **TipTap** for the rich text composer.
- Fonts: Inter (body, `font-sans`), Inter SemiBold 600 (headings h1–h6 + dialog/sheet titles, `font-heading`), Noto Sans Mono (`font-mono`); bundled via @fontsource — never loaded from Google at runtime.
- Scrollbars: native vertical bars hidden; one floating overlay thumb (draggable, takes no space) shows on hover or while scrolling
  over the scroller under the pointer (`src/lib/scrollbars.ts`, `.overlay-scrollbar` in `index.css`). Horizontal bars stay native, thin.
  Scrollers opt in via `configureScrollbar` (label, fixed thumb); the timeline uses a fixed-size thumb and shows
  the day in view while scrolling/dragging. Content size changes never jump the thumb: the gap decays over ~320 ms while scrolling continues; dragging is absolute (thumb stays under the pointer;
  holding it at the top keeps loading history).

## Layout

```
┌──────────────── top bar: [   Hledat chat  ⌘K   ]  (drag region) ────────────────┐
│Rail │ Sidebar (300px)        │ Room                              │ Right panel   │
│68px │ header: view + account │ header: avatar, name, network,    │ (details or   │
│     │ sections:              │   bell, details                   │  thread, user)│
│ Vše │  Pozvánky              │ timeline (Slack style, no bubbles)│               │
│ WA  │  Žádosti o zprávu      │                                   │               │
│ Sig │  Oblíbené              │ typing line                       │               │
│ TG  │  Přímé zprávy          │ composer (rich text)              │               │
│ #   │  Skupiny / per-guild   │                                   │               │
│ ... │  Nízká priorita        │                                   │               │
│ 🔌 ⚙ 👤                      │                                   │               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Rail** = Slack's workspace switcher. "Vše" (unified inbox), one entry per
  bridged network (detected from `m.bridge` state), "Matrix" for native rooms,
  then real Matrix spaces. Bridge-generated personal spaces are *not* shown as
  spaces; they define **accounts** inside a network (account dropdown in the
  sidebar header when a network has more than one login).
- **Activity** (bell under "Vše", page `activity`) = Slack's Activity: the feed replaces the sidebar,
  the chosen item opens in the room view next to it (threads in the right panel). Items: newest
  incoming DM message per DM, mentions, replies to the user, newest reply in threads the user
  started or joined, reactions to the user's messages (grouped per message). Built from loaded
  events only (no server notifications API); grouped by day, tabs Vše/DMs/Zmínky/Vlákna/Reakce,
  unread filter, per-item read check (read receipt on the item's newest event).
- **Network badge** on the avatar in every list where networks mix (Vše, ⌘K,
  notifications) — the Beeper "where is this from" cue.
- Sidebar rows: avatar (round = person, rounded square = group), bold name when
  unread, time, one-line preview, red count for DMs/mentions, blue dot for plain
  unread. Muted rooms are dimmed. Right-click = room actions.

## Key data (src/matrix)

- `rooms-store.ts` — zustand `useRooms`: `rooms: Record<roomId, RoomSummary>`,
  `networks`, `spaces`. Batched recomputation from SDK events.
- `bridge.ts` — `getBridgeInfo(room)` parses `m.bridge` (`protocol`, `network`
  subgroup, `fi.mau.receiver` login id, `com.beeper.room_type(.v2)`).
- `push-rules.ts` — per-room level `default | all | mentions | mute` stored as
  standard push rules (syncs to phone).
- `media.ts` — `useThumbnail(mxc, size)`, `useMediaSrc(mxc, file?, mimetype?)`,
  `loadMediaBlobUrl`. Desktop uses `media://`; browser dev falls back to blobs.
- `event-text.ts` — `describeEvent` (previews), `isMessageEvent`, voice helpers.
- `room-actions.ts` — mark read/unread, tags, leave, permalink.
- `pins.ts` — `m.room.pinned_events`: `pinnedEventIds`, `canPin`, `togglePin`.
- `backfill.ts` — `isBackfill` (bridge history predates `m.room.create`), auto-read of old history.
- `hooks.ts` — `useRoom`, `useRoomSummary`, `useRerenderOn`.
- `context.tsx` — `useMatrixClient()`, `useEmitterEvent(emitter, event, fn)`.

## UI state (src/store)

- `ui.ts` — `useUi`: view, page (`chat | activity | bridges`), activity tab/unread filter/width, roomId, rightPanel
  (`details | thread | user`; a profile remembers the panel it was opened from), settings dialog, ⌘K, `focusEventId` (jump to event).
- `settings.ts` — `useSettings` (persisted): theme, density, font size,
  system events, read receipts, `sendWithShift`, recent emoji, `quickReactions` (null = recent), notifications
  (enabled, sound, soundId, soundVolume, showContent, pausedUntil, per-network defaults), bridge URLs.

## Module contracts

| Module | Export | Owner |
| --- | --- | --- |
| `features/room/room-view.tsx` | `RoomView({ roomId })` | timeline |
| `features/room/thread-panel.tsx` | `ThreadPanel({ roomId, rootId })` | timeline |
| `features/composer/composer.tsx` | `Composer({ room, threadId? })` | composer |
| `features/composer/composer-store.ts` | reply/edit/files/drafts per `composerKey` | shared |
| `features/emoji/emoji-picker.tsx` | `EmojiPicker({ onPick })` | composer |
| `features/details/details-panel.tsx` | `DetailsPanel({ roomId })` | settings |
| `features/settings/settings-dialog.tsx` | `SettingsDialog({ onLogout })` | settings |
| `features/settings/shortcuts-dialog.tsx` | `ShortcutsDialog()` (⌘/, `useUi.shortcutsOpen`) | settings |
| `features/notifications/use-notifications.ts` | `useDesktopNotifications()` | settings |
| `features/notifications/sounds.ts` | `NOTIFICATION_SOUNDS`, `playNotificationSound(id, volume)` (Web Audio synth; OS notification stays silent) | settings |
| `features/crypto/crypto-prompts.tsx` | `CryptoPrompts()` | settings |
| `features/bridges/bridges-page.tsx` | `BridgesPage()` | bridges |
| `features/new-chat/new-chat-dialog.tsx` | `NewChatDialog({ open, onOpenChange })` | bridges |
| `features/activity/activity.ts` | `useActivity`, `attachActivity(client)`, `matchesTab`, `activityBadge`, `markActivityRead` | activity |
| `features/activity/activity-feed.tsx` | `ActivityFeed()` (left column of the activity page) | activity |
| `features/later/reminders.ts` | `useReminders`, `attachReminders(client)`; account data `cz.myna.reminders` | later |
| `features/later/scheduled.ts` | `useScheduled` (localStorage), `attachScheduledSender(client)` | later |
| `features/search/search.ts` | `searchServer`, `searchLoaded`, `historyScanner(client, roomId)`, `mergeHits` | search |
| `features/search/search-panel.tsx` | `SearchPanel({ scope, initialQuery })` (right panel `search`) | search |
| `features/room/link-preview.tsx` | `LinkPreviews({ content, ts })`, `embedFor(url)` | timeline |
| `features/details/room-settings-dialog.tsx` | `RoomSettingsDialog`, `InviteDialog`, `roomPermissions` | settings |
| `lib/native.ts` | native integration (below) | native |
| `matrix/connection.ts` | `useConnection` (state, restored, unsent), `attachConnection(client)`, `isQueued(event)` | native |
| `features/shell/connection-banner.tsx` | `ConnectionBanner()` (offline / server down / back online) | native |
| `lib/updater.ts` | `useUpdater`, `checkForUpdates`, `installUpdate`, `useUpdateChecks()` | native |
| `lib/global-shortcut.ts` | `useGlobalShortcut()`, `GLOBAL_SHORTCUTS`, `formatShortcut` | native |
| `lib/popout.ts` | `usePopouts`, `openPopout(roomId, title)`, `closePopout`, `getActiveScope`, `isPopoutFocused` | native |
| `features/popout/popout-host.tsx` | `PopoutHost()` (portals each pop-out's `RoomView`) | native |
| `features/room/edit-history-dialog.tsx` | `EditHistoryDialog({ event, onClose })` | timeline |

`lib/native.ts`:

```ts
useNativeIntegration(): void            // media session, dock badge + tray count, focus tracking
useTraySync(): void                     // tray icon on/off + menu labels (app root)
getAutostart(): Promise<boolean>; setAutostart(enabled: boolean): Promise<void>
showNotification(o: { title: string; body: string; roomId: string; eventId?: string; sound: boolean; avatarMxc?: string; sender?: NotificationSender }): Promise<void>
isWindowFocused(): boolean
openExternal(url: string): Promise<void>
cookieLogin(o: { url: string; userAgent?: string; cookies: { name: string; domain?: string }[];
  title: string }): Promise<Record<string, string> | null>   // null = user closed the window
```

## UX rules

- Slack timeline: left-aligned messages, avatar + name on the first message of
  a group (same sender, < 5 min), hover shows time in the gutter. Sticky day
  dividers ("Dnes", "Včera", "pondělí 6. října"). Red "Nové" line at the read
  marker. Hover toolbar: 3 quick reactions (recent emoji, or a fixed set from Nastavení → Chaty), add reaction, reply, thread, ⋯ menu.
- Reactions are pills under the message; own reaction outlined in primary.
- Primary colour matches the logo blue (`#2B59C3`, `oklch(0.5 0.17 264)`). Login offers preset
  homeservers (matrix.org, mozilla.org) in an editable combobox, probes login flows and shows SSO only when offered.
- Replies show a one-line quote above the message; click jumps to the original.
- Images inline (max ~360px), blurhash/placeholder sized from `info.w/h` so the
  timeline does not jump. Click opens a lightbox. Video: poster + play.
- Voice messages: play button, waveform, duration, speed 1×/1.5×/2×.
- Composer: rich text WYSIWYG with live markdown shortcuts, toolbar toggle (Aa),
  @mentions, :emoji:, attachments (+, paste, drop), voice recording, Enter sends,
  Shift+Enter newline, ↑ edits last message, Esc cancels reply/edit.
- State events (joins, renames) hidden unless enabled in settings — bridges are noisy.
- Every user-facing string goes through `t()` (`src/i18n`); catalogs per namespace in
  `src/i18n/messages/` with cs (source of truth) / sk / en — add new strings in all three.
  Errors are toasts with a concrete message.
- Search (⌘F chat, ⌘⇧F all, or "Hledat …" in ⌘K): server `/search` covers unencrypted rooms;
  encrypted ones are matched locally (loaded events + a `/messages` history scan inside one chat).
  Matching ignores case and diacritics.
- Link previews: bridge `com.beeper.linkpreviews` first, else the homeserver preview API. YouTube/
  Vimeo are click-to-play iframes, Spotify/Apple Music load directly; the iframes are sandboxed
  without top navigation and their hosts are allowed in `window.rs` (`EMBED_HOSTS`).
- Tray icon (`tray.rs`, setting `trayIcon`): unread count as the macOS menu bar title; with it on,
  closing the window keeps the app running on Windows/Linux too. Launch at login starts hidden.
- Settings tabs: Obecné (language, sending, launch at login, tray, about) · Vzhled (theme, chat
  list, scaling) · Chaty (what shows in a conversation, bridge history) · Notifikace · Účet a
  zabezpečení (profile, encryption, sessions, logout) · Přístupnost. A setting goes where the user
  would look for its effect, not where it is implemented.
- Connection: sync errors or `navigator.onLine === false` lasting 4 s show an amber strip under the top
  bar ("Bez připojení" / "Server neodpovídá", unsent count, retry). Messages that failed for lack of
  connection read "Čeká na připojení" (not red) and are resent when sync recovers; other failures
  keep "Neodesláno · Zkusit znovu".
- "(upraveno)" is a button: edit history dialog (all `m.replace` versions, newest first).
- Chat pop-outs ("Otevřít v novém okně" in the room header and row menu): `window.open('about:blank')`
  creates a native window sharing the main webview's WebKit config (`window.rs`), and `PopoutHost`
  portals `RoomView` into it, so the client, crypto and stores are shared. Rules for code that may
  render there: Radix portals use `usePortalContainer()`; no `instanceof HTMLElement` (other realm);
  frames/listeners via `viewOf(node)` / `usePopoutScope()`. The right panel stays in the main window:
  threads, profiles and details opened in a pop-out show there next to the same chat.
- Updates: Settings → Obecné → O aplikaci; background check at launch and every 6 h, install waits for
  the user. Releases: `src-tauri/scripts/release.sh` (GitHub Releases, `latest.json`).
- Global shortcut (default ⌥⌘M, Settings → Obecné → Systém) brings Myna forward with ⌘K open.
- Keep it light: virtualized lists, `content-visibility` on messages, no heavy deps.
