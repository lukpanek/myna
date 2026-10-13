import { t } from '@/i18n';
import { useSettings } from '@/store/settings';
import { Section, SwitchRow, TabTitle } from './settings-ui';

/** What shows up inside a conversation. */
export function ChatsTab() {
  const s = useSettings();
  return (
    <>
      <TabTitle>{t('settings.tabChats')}</TabTitle>
      <Section title={t('settings.chatContent')}>
        <SwitchRow
          label={t('settings.showMediaPreviews')}
          description={t('settings.showMediaPreviewsDescription')}
          checked={s.showMediaPreviews}
          onCheckedChange={(showMediaPreviews) => s.set({ showMediaPreviews })}
        />
        <SwitchRow
          label={t('settings.showLinkPreviews')}
          description={t('settings.showLinkPreviewsDescription')}
          checked={s.showLinkPreviews}
          onCheckedChange={(showLinkPreviews) => s.set({ showLinkPreviews })}
        />
        <SwitchRow
          label={t('settings.showReadReceipts')}
          description={t('settings.showReadReceiptsDescription')}
          checked={s.showReadReceipts}
          onCheckedChange={(showReadReceipts) => s.set({ showReadReceipts })}
        />
        <SwitchRow
          label={t('settings.showSystemEvents')}
          description={t('settings.showSystemEventsDescription')}
          checked={s.showSystemEvents}
          onCheckedChange={(showSystemEvents) => s.set({ showSystemEvents })}
        />
      </Section>
      <Section title={t('settings.bridgedChats')}>
        <SwitchRow
          label={t('settings.markBridgeHistoryRead')}
          description={t('settings.markBridgeHistoryReadDescription')}
          checked={s.markBridgeHistoryRead}
          onCheckedChange={(markBridgeHistoryRead) => s.set({ markBridgeHistoryRead })}
        />
      </Section>
    </>
  );
}
