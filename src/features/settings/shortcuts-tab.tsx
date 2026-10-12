import { type MessageKey, t } from '@/i18n';
import { modKey } from '@/lib/platform';
import { Kbd } from './messages-tab';
import { Section, TabTitle } from './settings-ui';

const GROUPS: { title: MessageKey; items: { keys: string[][]; label: MessageKey }[] }[] = [
  {
    title: 'settings.shortcutsNavigation',
    items: [
      { keys: [[modKey, 'K']], label: 'shell.switcherTitle' },
      { keys: [['⌥', '↑'], ['⌥', '↓']], label: 'settings.shortcutPrevNextChat' },
      { keys: [['⌥', '⇧', '↑'], ['⌥', '⇧', '↓']], label: 'settings.shortcutPrevNextUnread' },
      { keys: [[modKey, ',']], label: 'settings.title' },
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

export function ShortcutsTab() {
  return (
    <>
      <TabTitle>{t('settings.tabShortcuts')}</TabTitle>
      {GROUPS.map((group) => (
        <Section key={group.title} title={t(group.title)}>
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
        </Section>
      ))}
    </>
  );
}
