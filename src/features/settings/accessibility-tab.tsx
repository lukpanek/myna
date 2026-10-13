import { t } from '@/i18n';
import { useSettings } from '@/store/settings';
import { Section, SwitchRow, TabTitle } from './settings-ui';

export function AccessibilityTab() {
  const s = useSettings();
  return (
    <>
      <TabTitle>{t('settings.tabAccessibility')}</TabTitle>
      <Section title={t('settings.readability')}>
        <SwitchRow
          label={t('settings.highContrast')}
          description={t('settings.highContrastDescription')}
          checked={s.highContrast}
          onCheckedChange={(highContrast) => s.set({ highContrast })}
        />
        <SwitchRow
          label={t('settings.accessibleNames')}
          description={t('settings.accessibleNamesDescription')}
          checked={s.accessibleNames}
          onCheckedChange={(accessibleNames) => s.set({ accessibleNames })}
        />
      </Section>
      <Section title={t('settings.motion')}>
        <SwitchRow
          label={t('settings.reduceMotion')}
          description={t('settings.reduceMotionDescription')}
          checked={s.reduceMotion}
          onCheckedChange={(reduceMotion) => s.set({ reduceMotion })}
        />
      </Section>
    </>
  );
}
