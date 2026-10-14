import { ClientEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { toast } from 'sonner';
import { create } from 'zustand';
import { t } from '@/i18n';
import { isWindowFocused, showNotification } from '@/lib/native';
import { describeEvent } from '@/matrix/event-text';
import { markRoomUnread } from '@/matrix/room-actions';
import { useRooms } from '@/matrix/rooms-store';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/** Account data: reminders follow the account to every device running Myna. */
const REMINDERS_TYPE = 'cz.myna.reminders';
const CHECK_MS = 15 * 1000;
const TEXT_MAX = 140;

export interface Reminder {
  id: string;
  roomId: string;
  /** Message reminders jump to this event. */
  eventId?: string;
  /** Message excerpt; only for unencrypted rooms, account data is not encrypted. */
  text?: string;
  at: number;
}

interface RemindersState {
  reminders: Reminder[];
  /** Target of the "remind me" dialog. */
  picking: { roomId: string; eventId?: string } | null;
}

export const useReminders = create<RemindersState>(() => ({ reminders: [], picking: null }));

export function pickReminder(roomId: string, eventId?: string) {
  useReminders.setState({ picking: { roomId, eventId } });
}

function isReminder(value: unknown): value is Reminder {
  const r = value as Reminder;
  return !!r && typeof r.id === 'string' && typeof r.roomId === 'string' && typeof r.at === 'number';
}

function read(client: MatrixClient): Reminder[] {
  const list = client.getAccountData(REMINDERS_TYPE as never)?.getContent()?.reminders;
  return Array.isArray(list) ? list.filter(isReminder) : [];
}

/** The store is updated first: the account data echo arrives only with the next sync. */
async function write(client: MatrixClient, reminders: Reminder[]) {
  useReminders.setState({ reminders });
  await client.setAccountData(REMINDERS_TYPE as never, { reminders } as never);
}

export function addReminder(client: MatrixClient, room: Room, at: number, event?: MatrixEvent) {
  const reminder: Reminder = { id: crypto.randomUUID(), roomId: room.roomId, at };
  if (event?.getId()) {
    reminder.eventId = event.getId();
    if (!room.hasEncryptionStateEvent()) reminder.text = describeEvent(event).slice(0, TEXT_MAX);
  }
  const reminders = [...useReminders.getState().reminders, reminder].sort((a, b) => a.at - b.at);
  return write(client, reminders);
}

export function removeReminder(client: MatrixClient, id: string) {
  return write(client, useReminders.getState().reminders.filter((r) => r.id !== id));
}

/** Earliest pending reminder per room. */
export function remindersByRoom(reminders: Reminder[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of reminders) {
    const prev = map.get(r.roomId);
    if (prev === undefined || r.at < prev) map.set(r.roomId, r.at);
  }
  return map;
}

function fire(client: MatrixClient, reminder: Reminder) {
  const room = client.getRoom(reminder.roomId);
  if (!room) return;
  const name = room.name;
  const body = reminder.text || (reminder.eventId ? t('later.reminderMessageBody') : t('later.reminderChatBody'));
  void markRoomUnread(client, room).catch(() => undefined);
  toast(t('later.reminderTitle', { name }), {
    description: body,
    duration: 30_000,
    action: {
      label: t('later.open'),
      onClick: () => useUi.getState().openRoom(reminder.roomId, { eventId: reminder.eventId }),
    },
  });
  if (!isWindowFocused()) {
    void showNotification({
      title: t('later.reminderTitle', { name }),
      body,
      roomId: reminder.roomId,
      eventId: reminder.eventId,
      sound: useSettings.getState().notifications.sound,
      avatarMxc: useRooms.getState().rooms[reminder.roomId]?.avatarMxc,
    }).catch(() => undefined);
  }
}

/** Keeps `useReminders` in sync with account data and fires due reminders. Returns a cleanup function. */
export function attachReminders(client: MatrixClient): () => void {
  let firing = false;

  const check = async () => {
    if (firing || !client.isInitialSyncComplete()) return;
    const all = useReminders.getState().reminders;
    const now = Date.now();
    const due = all.filter((r) => r.at <= now);
    if (due.length === 0) return;
    firing = true;
    try {
      // Removed first: another device may fire the same reminder, but not twice from here.
      await write(client, all.filter((r) => r.at > now));
      for (const r of due) fire(client, r);
    } catch (err) {
      console.warn('Reminders could not be updated', err);
    } finally {
      firing = false;
    }
  };

  const onAccountData = (event: MatrixEvent) => {
    if (event.getType() !== REMINDERS_TYPE) return;
    useReminders.setState({ reminders: read(client) });
    void check();
  };

  useReminders.setState({ reminders: read(client) });
  client.on(ClientEvent.AccountData, onAccountData);
  const timer = setInterval(() => void check(), CHECK_MS);
  void check();
  return () => {
    client.off(ClientEvent.AccountData, onAccountData);
    clearInterval(timer);
    useReminders.setState({ reminders: [], picking: null });
  };
}
