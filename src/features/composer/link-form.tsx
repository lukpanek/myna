import type { Editor } from '@tiptap/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';

export interface LinkDraft {
  from: number;
  to: number;
  text: string;
  url: string;
  existing: boolean;
}

/** Captures the selection (extended to the whole link when inside one) for the link form. */
export function readLinkDraft(editor: Editor): LinkDraft {
  if (editor.isActive('link')) editor.commands.extendMarkRange('link');
  const { from, to } = editor.state.selection;
  const href = (editor.getAttributes('link').href as string | undefined) ?? '';
  return { from, to, text: editor.state.doc.textBetween(from, to, ' '), url: href, existing: !!href };
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`;
  return `https://${trimmed}`;
}

export function applyLink(editor: Editor, draft: LinkDraft, text: string, url: string) {
  const href = normalizeUrl(url);
  const range = { from: draft.from, to: draft.to };
  if (!href) {
    editor.chain().focus().setTextSelection(range).unsetLink().run();
    return;
  }
  const label = text.trim() || href;
  editor
    .chain()
    .focus()
    .insertContentAt(range, { type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] })
    // Links are inclusive while autolinking; stop the mark from leaking into what is typed next.
    .command(({ tr }) => {
      tr.setStoredMarks([]);
      return true;
    })
    .run();
}

export function LinkForm({
  draft,
  onSubmit,
  onRemove,
}: {
  draft: LinkDraft;
  onSubmit: (text: string, url: string) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(draft.text);
  const [url, setUrl] = useState(draft.url);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text, url);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="composer-link-text">{t('composer.linkText')}</Label>
        <Input id="composer-link-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('composer.linkTextPlaceholder')} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="composer-link-url">{t('composer.link')}</Label>
        <Input
          id="composer-link-url"
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <div className="flex justify-end gap-2">
        {draft.existing && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t('composer.removeLink')}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!url.trim()}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
