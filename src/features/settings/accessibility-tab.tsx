import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/i18n';
import { useSettings } from '@/store/settings';
import { Row, Section, SwitchRow, TabTitle } from './settings-ui';

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
      <Section title={t('settings.scaling')}>
        <Row label={<label htmlFor="interface-scale">{t('settings.interfaceScale')}</label>} description={t('settings.interfaceScaleDescription')}>
          <Select value={String(s.interfaceScale)} onValueChange={(v) => s.set({ interfaceScale: Number(v) })}>
            <SelectTrigger id="interface-scale" className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[80, 90, 100, 110, 125, 150].map((size) => <SelectItem key={size} value={String(size)}>{size}%</SelectItem>)}
            </SelectContent>
          </Select>
        </Row>
        <Row label={<label htmlFor="text-size">{t('settings.fontSize')}</label>} description={t('settings.fontSizeDescription')}>
          <Select value={String(s.fontSize)} onValueChange={(v) => s.set({ fontSize: Number(v) })}>
            <SelectTrigger id="text-size" className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[13, 14, 15, 16, 17, 18, 20, 22, 24].map((size) => <SelectItem key={size} value={String(size)}>{size} px</SelectItem>)}
            </SelectContent>
          </Select>
        </Row>
      </Section>
    </>
  );
}
