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
- Fonts: system stack (SF Pro on macOS). No web fonts.

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

- `ui.ts` — `useUi`: view, page (`chat | bridges`), roomId, rightPanel
  (`details | thread | user`; a profile remembers the panel it was opened from), settings dialog, ⌘K, `focusEventId` (jump to event).
- `settings.ts` — `useSettings` (persisted): theme, density, font size,
  system events, read receipts, `sendWithShift`, recent emoji, notifications
  (enabled, sound, showContent, pausedUntil, per-network defaults), bridge URLs.

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
| `features/notifications/use-notifications.ts` | `useDesktopNotifications()` | settings |
| `features/crypto/crypto-prompts.tsx` | `CryptoPrompts()` | settings |
| `features/bridges/bridges-page.tsx` | `BridgesPage()` | bridges |
| `features/new-chat/new-chat-dialog.tsx` | `NewChatDialog({ open, onOpenChange })` | bridges |
| `features/later/reminders.ts` | `useReminders`, `attachReminders(client)`; account data `cz.myna.reminders` | later |
| `features/later/scheduled.ts` | `useScheduled` (localStorage), `attachScheduledSender(client)` | later |
| `lib/native.ts` | native integration (below) | native |

`lib/native.ts`:

```ts
useNativeIntegration(): void            // media session, dock badge, focus tracking
showNotification(o: { title: string; body: string; roomId: string; eventId?: string; sound: boolean }): Promise<void>
isWindowFocused(): boolean
openExternal(url: string): Promise<void>
cookieLogin(o: { url: string; userAgent?: string; cookies: { name: string; domain?: string }[];
  title: string }): Promise<Record<string, string> | null>   // null = user closed the window
```

## UX rules

- Slack timeline: left-aligned messages, avatar + name on the first message of
  a group (same sender, < 5 min), hover shows time in the gutter. Sticky day
  dividers ("Dnes", "Včera", "pondělí 6. října"). Red "Nové" line at the read
  marker. Hover toolbar: 3 recent emoji, add reaction, reply, thread, ⋯ menu.
- Reactions are pills under the message; own reaction outlined in primary.
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
- Keep it light: virtualized lists, `content-visibility` on messages, no heavy deps.
