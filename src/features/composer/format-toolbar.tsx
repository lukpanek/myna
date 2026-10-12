import { type Editor, useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  SquareCode,
  Strikethrough,
  TextQuote,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/i18n';
import { isMac, modKey } from '@/lib/platform';
import { cn } from '@/lib/utils';

const shift = isMac ? '⇧' : 'Shift+';
const alt = isMac ? '⌥' : 'Alt+';
const mod = isMac ? modKey : `${modKey}+`;

interface Item {
  key: string;
  label: string;
  shortcut: string;
  icon: LucideIcon;
  run: (editor: Editor) => void;
}

/** `null` entries render as separators. */
export function formatItems(onLink: () => void): (Item | null)[] {
  return [
    { key: 'bold', label: t('composer.bold'), shortcut: `${mod}B`, icon: Bold, run: (e) => e.chain().focus().toggleBold().run() },
    { key: 'italic', label: t('composer.italic'), shortcut: `${mod}I`, icon: Italic, run: (e) => e.chain().focus().toggleItalic().run() },
    {
      key: 'strike',
      label: t('composer.strike'),
      shortcut: `${mod}${shift}X`,
      icon: Strikethrough,
      run: (e) => e.chain().focus().toggleStrike().run(),
    },
    null,
    { key: 'link', label: t('composer.link'), shortcut: `${mod}${shift}U`, icon: Link, run: () => onLink() },
    null,
    {
      key: 'orderedList',
      label: t('composer.orderedList'),
      shortcut: `${mod}${shift}7`,
      icon: ListOrdered,
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'bulletList',
      label: t('composer.bulletList'),
      shortcut: `${mod}${shift}8`,
      icon: List,
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    null,
    {
      key: 'blockquote',
      label: t('composer.blockquote'),
      shortcut: `${mod}${shift}9`,
      icon: TextQuote,
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    { key: 'code', label: t('composer.code'), shortcut: `${mod}${shift}C`, icon: Code, run: (e) => e.chain().focus().toggleCode().run() },
    {
      key: 'codeBlock',
      label: t('composer.codeBlock'),
      shortcut: `${mod}${alt}${shift}C`,
      icon: SquareCode,
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
  ];
}

export function FormatToolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      link: e.isActive('link'),
      orderedList: e.isActive('orderedList'),
      bulletList: e.isActive('bulletList'),
      blockquote: e.isActive('blockquote'),
      code: e.isActive('code'),
      codeBlock: e.isActive('codeBlock'),
    }),
  }) as Record<string, boolean>;

  return (
    <div className="flex items-center gap-0.5 border-b px-1.5 py-1" role="toolbar" aria-label={t('composer.formatting')}>
      {formatItems(onLink).map((item, i) =>
        item ? (
          <button
            key={item.key}
            type="button"
            title={`${item.label} (${item.shortcut})`}
            aria-label={item.label}
            aria-pressed={active[item.key]}
            // Keep the editor selection: buttons must not take focus on mousedown.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => item.run(editor)}
            className={cn(
              'flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
              active[item.key] && 'bg-accent text-foreground',
            )}
          >
            <item.icon className="size-4" />
          </button>
        ) : (
          <span key={`sep-${i}`} className="mx-1 h-4 w-px bg-border" />
        ),
      )}
    </div>
  );
}
