import { toast } from 'sonner';
import { t } from '@/i18n';
import { useMatrixClient } from '@/matrix/context';
import { addReminder, useReminders } from './reminders';
import { formatWhen } from './when';
import { WhenDialog } from './when-dialog';

/** "Remind me later" for a chat or a message. Mount once in the app shell. */
export function ReminderDialog() {
  const client = useMatrixClient();
  const picking = useReminders((s) => s.picking);

  const pick = (at: number) => {
    const room = picking && client.getRoom(picking.roomId);
    if (!room) return;
    const event = picking.eventId ? (room.findEventById(picking.eventId) ?? undefined) : undefined;
    addReminder(client, room, at, event)
      .then(() => toast.success(t('later.reminderSet', { when: formatWhen(at) })))
      .catch(() => toast.error(t('later.reminderSaveFailed')));
  };

  return (
    <WhenDialog
      open={!!picking}
      title={picking?.eventId ? t('later.remindMessageTitle') : t('later.remindChatTitle')}
      description={t('later.remindDescription')}
      onPick={pick}
      onOpenChange={(open) => !open && useReminders.setState({ picking: null })}
    />
  );
}
