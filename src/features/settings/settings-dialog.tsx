import { Accessibility, Bell, Info, Keyboard, MessageSquare, Palette, ShieldCheck, UserRound } from 'lucide-react';
import type { ComponentType } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { type MessageKey, t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useUi } from '@/store/ui';
import { AboutTab } from './about-tab';
import { AccountTab } from './account-tab';
import { AccessibilityTab } from './accessibility-tab';
import { AppearanceTab } from './appearance-tab';
import { MessagesTab } from './messages-tab';
import { NotificationsTab } from './notifications-tab';
import { SecurityTab } from './security-tab';
import { ShortcutsTab } from './shortcuts-tab';

const TABS: { key: string; label: MessageKey; icon: ComponentType<{ className?: string }> }[] = [
  { key: 'account', label: 'settings.tabAccount', icon: UserRound },
  { key: 'appearance', label: 'settings.tabAppearance', icon: Palette },
  { key: 'accessibility', label: 'settings.tabAccessibility', icon: Accessibility },
  { key: 'notifications', label: 'settings.tabNotifications', icon: Bell },
  { key: 'messages', label: 'settings.tabMessages', icon: MessageSquare },
  { key: 'security', label: 'settings.tabSecurity', icon: ShieldCheck },
  { key: 'shortcuts', label: 'settings.tabShortcuts', icon: Keyboard },
  { key: 'about', label: 'settings.tabAbout', icon: Info },
];

/** Slack-style preferences: tab list on the left, scrollable content on the right. */
export function SettingsDialog({ onLogout }: { onLogout: () => void }) {
  const open = useUi((s) => s.settingsOpen);
  const storedTab = useUi((s) => s.settingsTab);
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);
  const tab = TABS.some((x) => x.key === storedTab) ? storedTab : 'appearance';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeSettings()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(620px,calc(var(--app-viewport-height,100dvh)-2rem))] w-[860px] max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[860px]"
      >
        <nav className="flex w-max min-w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-sidebar p-3">
          <DialogTitle className="px-2 pt-1 pb-3 text-base">{t('settings.title')}</DialogTitle>
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => openSettings(key)}
              aria-current={tab === key ? 'page' : undefined}
              className={cn(
                'flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-left whitespace-nowrap text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                tab === key
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
              )}
            >
              <Icon className="size-4 shrink-0 opacity-80" />
              {t(label)}
            </button>
          ))}
        </nav>
        <div key={tab} className="min-w-0 flex-1 overflow-y-auto px-5 pt-6 pb-8">
          {tab === 'account' && (
            <AccountTab
              onLogout={() => {
                closeSettings();
                onLogout();
              }}
            />
          )}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'accessibility' && <AccessibilityTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'messages' && <MessagesTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'shortcuts' && <ShortcutsTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
