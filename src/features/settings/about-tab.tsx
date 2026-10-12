import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { t } from '@/i18n';
import { isTauri } from '@/lib/platform';
import { Row, Section, TabTitle } from './settings-ui';

/** Fallback when not running inside Tauri (browser dev); keep in sync with package.json. */
const PACKAGE_VERSION = '0.1.0';

function useAppVersion(): string {
  const [version, setVersion] = useState(PACKAGE_VERSION);
  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => undefined);
  }, []);
  return version;
}

export function AboutTab() {
  const version = useAppVersion();
  return (
    <>
      <TabTitle>{t('settings.tabAbout')}</TabTitle>
      <div className="mb-5 flex items-center gap-4">
        <Logo size={56} />
        <div>
          <div className="text-lg font-semibold">Myna</div>
          <div className="text-[13px] text-muted-foreground">{t('settings.versionLabel', { version })}</div>
        </div>
      </div>
      <Section title="Myna" description={t('settings.aboutDescription')}>
        <Row label={t('settings.version')}>
          <span className="font-mono text-[13px] text-muted-foreground select-text">{version}</span>
        </Row>
        <Row label={t('settings.license')}>
          <span className="text-sm text-muted-foreground">AGPL-3.0</span>
        </Row>
      </Section>
      <Section title={t('settings.credits')}>
        <p className="text-[13px] text-muted-foreground">
          {t('settings.creditsText')}
        </p>
      </Section>
    </>
  );
}
