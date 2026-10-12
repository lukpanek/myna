import { KnownMembership, type MatrixClient } from 'matrix-js-sdk';
import { toast } from 'sonner';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { addRelation, type Content, errorText, sendContent } from '@/features/composer/send';
import { t } from '@/i18n';

const CHECK_MS = 10 * 1000;

export interface ScheduledMessage {
  id: string;
  /** Account that scheduled it; other accounts on this computer leave it alone. */
  userId: string;
  roomId: string;
  threadId?: string;
  replyTo?: string | null;
  /** Message content without relations; those are added when it is sent. */
  content: Content;
  at: number;
  /** Sending failed; waits for "send now" or deletion. */
  failed?: boolean;
}

interface ScheduledState {
  messages: ScheduledMessage[];
  /** Ids being sent right now. */
  sending: string[];
}

/**
 * Messages sent later from this computer. Kept locally, not in account data, so
 * two running devices never send the same message twice.
 */
export const useScheduled = create<ScheduledState>()(
  persist(() => ({ messages: [] as ScheduledMessage[], sending: [] as string[] }), {
    name: 'myna.scheduled',
    version: 1,
    partialize: (s) => ({ messages: s.messages }),
  }),
);

export function scheduleMessage(message: Omit<ScheduledMessage, 'id'>) {
  const entry = { ...message, id: crypto.randomUUID() };
  useScheduled.setState((s) => ({ messages: [...s.messages, entry].sort((a, b) => a.at - b.at) }));
}

export function removeScheduled(id: string) {
  useScheduled.setState((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
}

export async function sendScheduled(client: MatrixClient, id: string) {
  const message = useScheduled.getState().messages.find((m) => m.id === id);
  if (!message || useScheduled.getState().sending.includes(id)) return;
  const room = client.getRoom(message.roomId);
  if (!room || room.getMyMembership() !== KnownMembership.Join) {
    markFailed(id);
    toast.error(t('later.scheduledRoomMissing'));
    return;
  }
  useScheduled.setState((s) => ({ sending: [...s.sending, id] }));
  try {
    const content = { ...message.content };
    addRelation(content, room, message.threadId, message.replyTo ?? null);
    await sendContent(room, message.threadId, content);
    removeScheduled(id);
  } catch (err) {
    markFailed(id);
    toast.error(t('later.scheduledFailed', { name: room.name, error: errorText(err) }));
  } finally {
    useScheduled.setState((s) => ({ sending: s.sending.filter((x) => x !== id) }));
  }
}

function markFailed(id: string) {
  useScheduled.setState((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, failed: true } : m)) }));
}

/** Sends due messages of this account while the app runs; overdue ones go out right after start. */
export function attachScheduledSender(client: MatrixClient): () => void {
  const check = () => {
    if (!client.isInitialSyncComplete()) return;
    const me = client.getUserId();
    const now = Date.now();
    for (const m of useScheduled.getState().messages) {
      if (m.userId === me && !m.failed && m.at <= now) void sendScheduled(client, m.id);
    }
  };
  const timer = setInterval(check, CHECK_MS);
  check();
  return () => clearInterval(timer);
}
