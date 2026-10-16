import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import { PluginKey } from '@tiptap/pm/state';
import { Extension, InputRule, markInputRule, markPasteRule, type Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion';
import type { Room } from 'matrix-js-sdk';
import { emojiByShortcode, normalizeText, searchEmoji } from '@/features/emoji/emoji-data';
import { useRooms } from '@/matrix/rooms-store';
import { useSettings } from '@/store/settings';
import { ROOM_MENTION_ID } from './serialize';
import type { SuggestionEntry, SuggestionSink } from './suggestion-popup';

export const MENTION_KEY = new PluginKey('mentionSuggestion');
export const EMOJI_KEY = new PluginKey('emojiSuggestion');

// Slack semantics: *bold*, _italic_, ~strike~. The delimiter must hug the text and must
// not be doubled, so StarterKit's **bold** / ~~strike~~ rules still work.
const SLACK_BOLD = /(?:^|\s)(\*([^*\s](?:[^*]*[^*\s])?)\*)$/;
const SLACK_ITALIC = /(?:^|\s)(_([^_\s](?:[^_]*[^_\s])?)_)$/;
const SLACK_STRIKE = /(?:^|\s)(~([^~\s](?:[^~]*[^~\s])?)~)$/;
const SLACK_BOLD_PASTE = /(?:^|\s)(\*([^*\s](?:[^*]*[^*\s])?)\*)(?=\s|$)/g;
const SLACK_ITALIC_PASTE = /(?:^|\s)(_([^_\s](?:[^_]*[^_\s])?)_)(?=\s|$)/g;
const SLACK_STRIKE_PASTE = /(?:^|\s)(~([^~\s](?:[^~]*[^~\s])?)~)(?=\s|$)/g;
const SHORTCODE = /(?:^|\s)(:([a-z0-9_+-]{2,}):)$/;

interface ComposerExtensionOptions {
  onLink: () => void;
}

/**
 * Slack-style markdown rules and shortcuts. High priority so its input rules run
 * before StarterKit's (where a single `*` means italic).
 */
const SlackFormatting = Extension.create<ComposerExtensionOptions>({
  name: 'slackFormatting',
  priority: 1000,

  addOptions() {
    return { onLink: () => {} };
  },

  addInputRules() {
    const { bold, italic, strike } = this.editor.schema.marks;
    return [
      markInputRule({ find: SLACK_BOLD, type: bold }),
      markInputRule({ find: SLACK_ITALIC, type: italic }),
      markInputRule({ find: SLACK_STRIKE, type: strike }),
      new InputRule({
        find: SHORTCODE,
        handler: ({ state, range, match }) => {
          const emoji = emojiByShortcode(match[2]);
          if (!emoji) return null;
          const start = range.from + match[0].indexOf(match[1]);
          state.tr.insertText(emoji.unicode, start, range.to);
          useSettings.getState().pushRecentEmoji(emoji.unicode);
        },
      }),
    ];
  },

  addPasteRules() {
    const { bold, italic, strike } = this.editor.schema.marks;
    return [
      markPasteRule({ find: SLACK_BOLD_PASTE, type: bold }),
      markPasteRule({ find: SLACK_ITALIC_PASTE, type: italic }),
      markPasteRule({ find: SLACK_STRIKE_PASTE, type: strike }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-Shift-c': () => this.editor.commands.toggleCode(),
      'Mod-Alt-Shift-c': () => this.editor.commands.toggleCodeBlock(),
      'Mod-Shift-7': () => this.editor.commands.toggleOrderedList(),
      'Mod-Shift-8': () => this.editor.commands.toggleBulletList(),
      'Mod-Shift-9': () => this.editor.commands.toggleBlockquote(),
      'Mod-Shift-u': () => {
        this.options.onLink();
        return true;
      },
    };
  },
});

function suggestionRender(sink: SuggestionSink, pluginKey: PluginKey) {
  return () => {
    let el: HTMLDivElement | null = null;
    let unmount: (() => void) | null = null;
    const push = (props: SuggestionProps<SuggestionEntry, never>) => {
      if (!el) return;
      sink({
        el,
        items: props.items,
        command: props.command as unknown as (entry: SuggestionEntry) => void,
        pluginKey,
      });
    };
    return {
      onStart: (props: SuggestionProps<SuggestionEntry, never>) => {
        // The editor's own document: in a chat pop-out the popup has to open there, not in the main window.
        const doc = props.editor.view.dom.ownerDocument;
        el = doc.createElement('div');
        el.style.zIndex = '50';
        doc.body.append(el);
        unmount = props.mount(el);
        push(props);
      },
      onUpdate: push,
      onExit: () => {
        unmount?.();
        unmount = null;
        el?.remove();
        el = null;
        sink(null);
      },
    };
  };
}

function mentionItems(room: Room, query: string): SuggestionEntry[] {
  const me = room.client.getUserId();
  const q = normalizeText(query);
  const scored: { entry: SuggestionEntry; score: number }[] = [];
  for (const m of room.getJoinedMembers()) {
    if (m.userId === me) continue;
    const name = normalizeText(m.name || m.userId);
    const id = m.userId.slice(1).toLowerCase();
    let score = -1;
    if (!q || name.startsWith(q)) score = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1;
    else if (id.startsWith(q)) score = 2;
    else if (name.includes(q) || id.includes(q)) score = 3;
    if (score < 0) continue;
    scored.push({
      entry: { kind: 'member', userId: m.userId, name: m.name || m.userId, avatarMxc: m.getMxcAvatarUrl() ?? null },
      score,
    });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (a.entry.kind === 'member' && b.entry.kind === 'member' ? a.entry.name.localeCompare(b.entry.name, 'cs') : 0),
  );
  const out = scored.slice(0, 8).map((s) => s.entry);
  const isDm = useRooms.getState().rooms[room.roomId]?.isDm ?? false;
  if (!isDm && (!q || 'room'.startsWith(q) || 'vsichni'.startsWith(q) || 'everyone'.startsWith(q))) {
    if (q) out.unshift({ kind: 'room' });
    else out.push({ kind: 'room' });
  }
  return out.slice(0, 9);
}

/** Pills in the editor; also turns matrix.to user links (edits, pasted HTML) back into pills. */
const MatrixMention = Mention.extend({
  parseHTML() {
    return [
      { tag: 'span[data-type="mention"]' },
      {
        tag: 'a[href]',
        priority: 100,
        getAttrs: (el: HTMLElement) => {
          const m = /^https:\/\/matrix\.to\/#\/(@[^/?#]+)/.exec(el.getAttribute('href') ?? '');
          if (!m) return false;
          const id = decodeURIComponent(m[1]);
          return { id, label: (el.textContent ?? '').replace(/^@/, '') || id };
        },
      },
    ];
  },
});

export function buildExtensions(opts: {
  room: Room;
  placeholder: () => string;
  onLink: () => void;
  sink: SuggestionSink;
}): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      horizontalRule: false,
      underline: false,
      link: { autolink: true, openOnClick: false, linkOnPaste: true, defaultProtocol: 'https' },
    }),
    Placeholder.configure({ placeholder: opts.placeholder }),
    SlackFormatting.configure({ onLink: opts.onLink }),
    MatrixMention.configure({
      HTMLAttributes: { class: 'mention-pill' },
      deleteTriggerWithBackspace: true,
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      suggestion: {
        char: '@',
        pluginKey: MENTION_KEY,
        placement: 'top-start',
        items: ({ query }) => mentionItems(opts.room, query) as never[],
        render: suggestionRender(opts.sink, MENTION_KEY) as never,
        command: ({ editor, range, props }) => {
          const entry = props as unknown as SuggestionEntry;
          if (entry.kind === 'emoji') return;
          const attrs =
            entry.kind === 'room' ? { id: ROOM_MENTION_ID, label: 'room' } : { id: entry.userId, label: entry.name };
          const after = editor.view.state.selection.$to.nodeAfter;
          if (after?.text?.startsWith(' ')) range.to += 1;
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'mention', attrs },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
      },
    }),
    Extension.create({
      name: 'emojiSuggestion',
      addProseMirrorPlugins() {
        return [
          Suggestion<SuggestionEntry, SuggestionEntry>({
            editor: this.editor,
            char: ':',
            pluginKey: EMOJI_KEY,
            minQueryLength: 2,
            placement: 'top-start',
            items: async ({ query }) => {
              // ":)" and friends are not shortcodes.
              if (!/^[\p{L}\p{N}_+-]+$/u.test(query)) return [];
              const found = await searchEmoji(query, 8);
              return found.map((emoji) => ({ kind: 'emoji' as const, emoji }));
            },
            render: suggestionRender(opts.sink, EMOJI_KEY) as never,
            command: ({ editor, range, props }) => {
              if (props.kind !== 'emoji') return;
              useSettings.getState().pushRecentEmoji(props.emoji.unicode);
              editor.chain().focus().insertContentAt(range, `${props.emoji.unicode} `).run();
            },
          }),
        ];
      },
    }),
  ];
}
