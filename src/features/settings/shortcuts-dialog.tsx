import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type MessageKey, t } from '@/i18n';
import { modKey } from '@/lib/platform';
import { useUi } from '@/store/ui';
import { Kbd } from './settings-ui';

const GROUPS: { title: MessageKey; items: { keys: string[][]; label: MessageKey }[] }[] = [
  {
    title: 'settings.shortcutsNavigation',
    items: [
      { keys: [[modKey, 'K']], label: 'shell.switcherTitle' },
      { keys: [['⌥', '↑'], ['⌥', '↓']], label: 'settings.shortcutPrevNextChat' },
      { keys: [['⌥', '⇧', '↑'], ['⌥', '⇧', '↓']], label: 'settings.shortcutPrevNextUnread' },
      { keys: [[modKey, 'F']], label: 'room.searchInChat' },
      { keys: [[modKey, '⇧', 'F']], label: 'search.searchAllShortcut' },
      { keys: [[modKey, ',']], label: 'settings.title' },
      { keys: [[modKey, '/']], label: 'settings.tabShortcuts' },
    ],
  },
  {
    title: 'settings.shortcutsComposing',
    items: [
      { keys: [['Enter']], label: 'settings.shortcutSend' },
      { keys: [['Shift', 'Enter']], label: 'settings.shortcutNewline' },
      { keys: [['↑']], label: 'settings.shortcutEditLast' },
      { keys: [['Esc']], label: 'settings.shortcutCancelReply' },
    ],
  },
  {
    title: 'settings.shortcutsFormatting',
    items: [
      { keys: [[modKey, 'B']], label: 'settings.shortcutBold' },
      { keys: [[modKey, 'I']], label: 'settings.shortcutItalic' },
      { keys: [[modKey, '⇧', 'X']], label: 'settings.shortcutStrike' },
    ],
  },
];

/** ⌘/: cheat sheet of all keyboard shortcuts (Slack style). */
export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[min(640px,calc(100dvh-2rem))] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-base">{t('settings.tabShortcuts')}</DialogTitle>
          <DialogDescription className="text-[13px]">
            {t('settings.shortcutsDialogDescription', { shortcut: `${modKey}/` })}
          </DialogDescription>
        </DialogHeader>
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-2 text-[13px] font-semibold text-muted-foreground">{t(group.title)}</h3>
            <div className="divide-y rounded-md border">
              {group.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 px-3 py-2">
                  <span className="text-sm">{t(item.label)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {item.keys.map((combo, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="mr-1 text-[12px] text-muted-foreground">/</span>}
                        {combo.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
