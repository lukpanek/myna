import { Accessibility, Bell, MessageSquare, Palette, Settings2, UserRound } from 'lucide-react';
import type { ComponentType } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { type MessageKey, t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useUi } from '@/store/ui';
import { AccountTab } from './account-tab';
import { AccessibilityTab } from './accessibility-tab';
import { AppearanceTab } from './appearance-tab';
import { ChatsTab } from './chats-tab';
import { GeneralTab, useAppVersion } from './general-tab';
import { NotificationsTab } from './notifications-tab';

const TABS: { key: string; label: MessageKey; icon: ComponentType<{ className?: string }> }[] = [
  { key: 'general', label: 'settings.tabGeneral', icon: Settings2 },
  { key: 'appearance', label: 'settings.tabAppearance', icon: Palette },
  { key: 'chats', label: 'settings.tabChats', icon: MessageSquare },
  { key: 'notifications', label: 'settings.tabNotifications', icon: Bell },
  { key: 'account', label: 'settings.tabAccountSecurity', icon: UserRound },
  { key: 'accessibility', label: 'settings.tabAccessibility', icon: Accessibility },
];

/** Slack-style preferences: tab list on the left, scrollable content on the right. */
export function SettingsDialog({ onLogout }: { onLogout: () => void }) {
  const open = useUi((s) => s.settingsOpen);
  const storedTab = useUi((s) => s.settingsTab);
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);
  const tab = TABS.some((x) => x.key === storedTab) ? storedTab : 'general';
  const version = useAppVersion();

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
          <button
            type="button"
            onClick={() => openSettings('general')}
            className="mt-auto px-2 pt-3 text-left text-[11px] text-muted-foreground hover:text-foreground"
          >
            Myna {version}
          </button>
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
          {tab === 'general' && <GeneralTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'chats' && <ChatsTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'accessibility' && <AccessibilityTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
