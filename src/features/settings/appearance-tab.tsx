import { Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { LOCALES, type MessageKey, systemLocale, t } from '@/i18n';
import { cn } from '@/lib/utils';
import { type LanguagePref, type ListDensity, type Theme, useSettings } from '@/store/settings';
import { Section, SwitchRow, TabTitle } from './settings-ui';

const THEMES: { value: Theme; label: MessageKey }[] = [
  { value: 'system', label: 'settings.themeSystem' },
  { value: 'light', label: 'settings.themeLight' },
  { value: 'dark', label: 'settings.themeDark' },
];

const FONT_SIZES = [13, 14, 15, 16, 17];

export function AppearanceTab() {
  const s = useSettings();

  return (
    <>
      <TabTitle>{t('settings.tabAppearance')}</TabTitle>
      <Section title={t('settings.language')} description={t('settings.languageDescription')}>
        <Select value={s.language} onValueChange={(v) => s.set({ language: v as LanguagePref })}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">
              {t('settings.languageSystem', {
                language: LOCALES.find((l) => l.value === systemLocale())?.label ?? 'English',
              })}
            </SelectItem>
            {LOCALES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>
      <Section title={t('settings.theme')} description={t('settings.themeDescription')}>
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((theme) => (
            <button
              key={theme.value}
              type="button"
              onClick={() => s.set({ theme: theme.value })}
              className="group text-left outline-none"
              aria-pressed={s.theme === theme.value}
            >
              <div
                className={cn(
                  'overflow-hidden rounded-lg border-2 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring',
                  s.theme === theme.value ? 'border-primary' : 'border-border group-hover:border-muted-foreground/40',
                )}
              >
                <ThemePreview theme={theme.value} />
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[13px]">
                <span
                  className={cn(
                    'flex size-3.5 items-center justify-center rounded-full border',
                    s.theme === theme.value && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {s.theme === theme.value && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                {t(theme.label)}
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('settings.chatList')}>
        <div className="grid grid-cols-2 gap-3">
          <DensityOption
            value="comfortable"
            current={s.density}
            onSelect={(density) => s.set({ density })}
            label={t('settings.densityComfortable')}
            description={t('settings.densityComfortableDescription')}
          />
          <DensityOption
            value="compact"
            current={s.density}
            onSelect={(density) => s.set({ density })}
            label={t('settings.densityCompact')}
            description={t('settings.densityCompactDescription')}
          />
        </div>
      </Section>

      <Section title={t('settings.fontSize')} description={t('settings.fontSizeDescription')}>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(s.fontSize)}
          onValueChange={(v) => v && s.set({ fontSize: Number(v) })}
        >
          {FONT_SIZES.map((size) => (
            <ToggleGroupItem key={size} value={String(size)} className="min-w-11 tabular-nums">
              {size}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      <Section title={t('settings.timeline')}>
        <SwitchRow
          label={t('settings.showSystemEvents')}
          description={t('settings.showSystemEventsDescription')}
          checked={s.showSystemEvents}
          onCheckedChange={(showSystemEvents) => s.set({ showSystemEvents })}
        />
        <SwitchRow
          label={t('settings.showReadReceipts')}
          description={t('settings.showReadReceiptsDescription')}
          checked={s.showReadReceipts}
          onCheckedChange={(showReadReceipts) => s.set({ showReadReceipts })}
        />
        <SwitchRow
          label={t('settings.showMediaPreviews')}
          description={t('settings.showMediaPreviewsDescription')}
          checked={s.showMediaPreviews}
          onCheckedChange={(showMediaPreviews) => s.set({ showMediaPreviews })}
        />
      </Section>
    </>
  );
}

/** Miniature app window in fixed colors, independent of the active theme. */
function ThemePreview({ theme }: { theme: Theme }) {
  if (theme === 'system') {
    return (
      <div className="relative h-[84px]">
        <div className="absolute inset-0" style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}>
          <MiniWindow dark={false} />
        </div>
        <div className="absolute inset-0" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>
          <MiniWindow dark />
        </div>
      </div>
    );
  }
  return (
    <div className="h-[84px]">
      <MiniWindow dark={theme === 'dark'} />
    </div>
  );
}

function MiniWindow({ dark }: { dark: boolean }) {
  const c = dark
    ? { rail: '#18181b', sidebar: '#1f1f23', main: '#27272a', line: '#3f3f46', accent: '#3b82f6' }
    : { rail: '#e4e4e7', sidebar: '#f4f4f5', main: '#ffffff', line: '#d4d4d8', accent: '#2563eb' };
  return (
    <div className="flex size-full" style={{ background: c.main }}>
      <div className="w-[12%]" style={{ background: c.rail }} />
      <div className="flex w-[30%] flex-col gap-1.5 p-2" style={{ background: c.sidebar }}>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: c.accent }} />
        <div className="h-1.5 w-full rounded-full" style={{ background: c.line }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.line }} />
        <div className="h-1.5 w-5/6 rounded-full" style={{ background: c.line }} />
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1.5 p-2">
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.line }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.line }} />
        <div className="h-3 w-full rounded" style={{ border: `1px solid ${c.line}` }} />
      </div>
    </div>
  );
}

function DensityOption({
  value,
  current,
  onSelect,
  label,
  description,
}: {
  value: ListDensity;
  current: ListDensity;
  onSelect: (value: ListDensity) => void;
  label: string;
  description: string;
}) {
  const selected = value === current;
  const rows = value === 'compact' ? 5 : 3;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={selected}
      className={cn(
        'flex gap-3 rounded-lg border-2 p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary' : 'border-border hover:border-muted-foreground/40',
      )}
    >
      <div className="flex w-16 shrink-0 flex-col justify-center gap-1 rounded bg-muted p-1.5">
        {Array.from({ length: rows }, (_, i) =>
          value === 'compact' ? (
            <div key={i} className="flex items-center gap-1">
              <div className="size-1.5 rounded-sm bg-muted-foreground/50" />
              <div className="h-1 flex-1 rounded-full bg-muted-foreground/30" />
            </div>
          ) : (
            <div key={i} className="flex items-center gap-1">
              <div className="size-3 rounded bg-muted-foreground/50" />
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="h-1 w-full rounded-full bg-muted-foreground/40" />
                <div className="h-1 w-2/3 rounded-full bg-muted-foreground/25" />
              </div>
            </div>
          ),
        )}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[13px] text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}
