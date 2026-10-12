import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { t } from '@/i18n';
import { useMatrixClient } from '@/matrix/context';
import { leaveRooms, networkRemovalPlan, spaceRemovalPlan } from '@/matrix/room-actions';
import { type View, useUi, viewKey } from '@/store/ui';

export interface RemoveTarget {
  view: Extract<View, { kind: 'space' | 'network' }>;
  name: string;
}

/**
 * Confirms leaving a space or a bridged network with all its chats, e.g. before
 * a bridge re-syncs a re-logged account.
 */
export function RemoveSpaceDialog({
  target,
  onOpenChange,
}: {
  target: RemoveTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useMatrixClient();
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => {
    if (!target) return [];
    return target.view.kind === 'space'
      ? spaceRemovalPlan(client, target.view.spaceId)
      : networkRemovalPlan(client, target.view.networkId);
  }, [client, target]);
  const chatCount = plan.filter((id) => !client.getRoom(id)?.isSpaceRoom()).length;

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    const ui = useUi.getState();
    if (viewKey(ui.view) === viewKey(target.view)) ui.setView({ kind: 'all' });
    const toastId = toast.loading(t('shell.removingSpace', { done: 0, total: plan.length }));
    onOpenChange(false);
    try {
      await leaveRooms(client, plan, (done, total) =>
        toast.loading(t('shell.removingSpace', { done, total }), { id: toastId }),
      );
      toast.success(t('shell.spaceRemoved', { name: target.name }), { id: toastId });
    } catch {
      toast.error(t('shell.removeSpaceFailed'), { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('shell.removeSpaceTitle', { name: target?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('shell.removeSpaceDescription', { count: chatCount })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={busy || plan.length === 0} onClick={() => void remove()}>
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
