import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EmojiPicker } from '@/features/emoji/emoji-picker';
import { t } from '@/i18n';
import { QUICK_REACTION_COUNT, useSettings } from '@/store/settings';
import { Row, Section, SwitchRow, TabTitle } from './settings-ui';

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
      <QuickReactionsSection />
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

/** The emoji offered in the message hover toolbar: recently used, or a fixed choice. */
function QuickReactionsSection() {
  const quick = useSettings((s) => s.quickReactions);
  const recent = useSettings((s) => s.recentEmoji);
  const set = useSettings((s) => s.set);
  const shown = quick ?? recent.slice(0, QUICK_REACTION_COUNT);

  const pick = (index: number, emoji: string) => {
    const next = [...shown];
    // Picking an emoji that sits in another slot swaps the two.
    const existing = next.indexOf(emoji);
    if (existing >= 0) next[existing] = next[index];
    next[index] = emoji;
    set({ quickReactions: next });
  };

  return (
    <Section title={t('settings.quickReactions')} description={t('settings.quickReactionsDescription')}>
      <SwitchRow
        label={t('settings.quickReactionsRecent')}
        description={t('settings.quickReactionsRecentDescription')}
        checked={quick === null}
        onCheckedChange={(useRecent) => set({ quickReactions: useRecent ? null : shown })}
      />
      <Row label={t('settings.quickReactionsPick')} className={quick === null ? 'opacity-60' : undefined}>
        {shown.map((emoji, i) => (
          <EmojiSlot key={i} emoji={emoji} index={i} disabled={quick === null} onPick={(e) => pick(i, e)} />
        ))}
      </Row>
    </Section>
  );
}

function EmojiSlot(props: { emoji: string; index: number; disabled: boolean; onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={props.disabled}
          aria-label={t('settings.quickReactionsSlot', { n: props.index + 1, emoji: props.emoji })}
          className="flex size-10 items-center justify-center rounded-lg border text-xl transition-colors hover:bg-accent disabled:pointer-events-none"
        >
          {props.emoji}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <EmojiPicker
          onPick={(emoji) => {
            setOpen(false);
            props.onPick(emoji);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
