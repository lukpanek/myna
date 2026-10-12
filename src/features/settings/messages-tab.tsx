import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { t } from '@/i18n';
import { tn } from '@/i18n/rich';
import { useSettings } from '@/store/settings';
import { Section, TabTitle } from './settings-ui';

export function MessagesTab() {
  const sendWithShift = useSettings((s) => s.sendWithShift);
  const set = useSettings((s) => s.set);

  return (
    <>
      <TabTitle>{t('settings.tabMessages')}</TabTitle>
      <Section title={t('settings.sending')} description={t('settings.sendingDescription')}>
        <RadioGroup
          value={sendWithShift ? 'shift' : 'enter'}
          onValueChange={(v) => set({ sendWithShift: v === 'shift' })}
          className="gap-3"
        >
          <div className="flex items-start gap-3">
            <RadioGroupItem value="enter" id="send-enter" className="mt-0.5" />
            <Label htmlFor="send-enter" className="flex-col items-start gap-0.5 font-normal">
              <span className="text-sm">
                {tn('settings.enterSends', { key: <Kbd>Enter</Kbd> })}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {tn('settings.shiftEnterNewline', { keys: <ShiftEnter /> })}
              </span>
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <RadioGroupItem value="shift" id="send-shift" className="mt-0.5" />
            <Label htmlFor="send-shift" className="flex-col items-start gap-0.5 font-normal">
              <span className="text-sm">
                {tn('settings.enterSends', { key: <ShiftEnter /> })}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {tn('settings.enterNewline', { key: <Kbd>Enter</Kbd> })}
              </span>
            </Label>
          </div>
        </RadioGroup>
      </Section>
    </>
  );
}

function ShiftEnter() {
  return (
    <>
      <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd>
    </>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1.5 font-sans text-[11px] font-medium text-foreground/80">
      {children}
    </kbd>
  );
}
