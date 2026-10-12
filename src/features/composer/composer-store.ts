import { create } from 'zustand';

/**
 * Per-conversation composer state shared between the timeline (reply/edit/drop
 * actions) and the composer. Key: `roomId` for the main timeline,
 * `roomId|threadRootId` for a thread.
 */
export function composerKey(roomId: string, threadId?: string | null): string {
  return threadId ? `${roomId}|${threadId}` : roomId;
}

export interface PendingFile {
  id: string;
  file: File;
}

interface ComposerEntry {
  replyToEventId: string | null;
  editEventId: string | null;
  files: PendingFile[];
  /** Bumped to ask the composer to take focus (after reply/edit is chosen). */
  focusNonce: number;
}

const EMPTY: ComposerEntry = { replyToEventId: null, editEventId: null, files: [], focusNonce: 0 };

interface ComposerState {
  entries: Record<string, ComposerEntry>;
  /** Unsent drafts (editor HTML) per key, kept in memory while switching chats. */
  drafts: Record<string, string>;
  get: (key: string) => ComposerEntry;
  setReplyTo: (key: string, eventId: string | null) => void;
  startEdit: (key: string, eventId: string | null) => void;
  addFiles: (key: string, files: File[]) => void;
  removeFile: (key: string, id: string) => void;
  clearFiles: (key: string) => void;
  focus: (key: string) => void;
  setDraft: (key: string, html: string) => void;
}

let fileSeq = 0;

export const useComposerStore = create<ComposerState>((set, get) => {
  const patch = (key: string, fn: (e: ComposerEntry) => Partial<ComposerEntry>) =>
    set((s) => {
      const prev = s.entries[key] ?? EMPTY;
      return { entries: { ...s.entries, [key]: { ...prev, ...fn(prev) } } };
    });
  return {
    entries: {},
    drafts: {},
    get: (key) => get().entries[key] ?? EMPTY,
    setReplyTo: (key, eventId) =>
      patch(key, (e) => ({ replyToEventId: eventId, editEventId: null, focusNonce: e.focusNonce + 1 })),
    startEdit: (key, eventId) =>
      patch(key, (e) => ({ editEventId: eventId, replyToEventId: null, focusNonce: e.focusNonce + 1 })),
    addFiles: (key, files) =>
      patch(key, (e) => ({
        files: [...e.files, ...files.map((file) => ({ id: `f${++fileSeq}`, file }))],
        focusNonce: e.focusNonce + 1,
      })),
    removeFile: (key, id) => patch(key, (e) => ({ files: e.files.filter((f) => f.id !== id) })),
    clearFiles: (key) => patch(key, () => ({ files: [] })),
    focus: (key) => patch(key, (e) => ({ focusNonce: e.focusNonce + 1 })),
    setDraft: (key, html) => set((s) => ({ drafts: { ...s.drafts, [key]: html } })),
  };
});

export function useComposerEntry(key: string): ComposerEntry {
  return useComposerStore((s) => s.entries[key] ?? EMPTY);
}
