import type { Attachment, ClientEntry, Entry, LocalEntryDraft } from '@/lib/types';

export const LOCAL_ENTRIES_STORAGE_KEY = 'mindbuffer.localEntries.v1';

type DraftInput = {
  localId: string;
  text: string | null;
  category: string;
  attachments?: Attachment[];
  source?: string;
  createdAt?: string;
};

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readLocalEntries(): LocalEntryDraft[] {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(LOCAL_ENTRIES_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isLocalEntryDraft).sort(sortLocalEntriesDesc);
  } catch {
    return [];
  }
}

export function saveLocalEntries(entries: LocalEntryDraft[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(
    LOCAL_ENTRIES_STORAGE_KEY,
    JSON.stringify([...entries].sort(sortLocalEntriesDesc))
  );
}

export function createLocalEntryDraft(input: DraftInput): LocalEntryDraft {
  const timestamp = input.createdAt || new Date().toISOString();
  return {
    local_id: input.localId,
    text: input.text,
    category: input.category,
    tags: [],
    attachments: input.attachments || [],
    source: input.source || 'local',
    created_at: timestamp,
    updated_at: timestamp,
    sync_state: 'local-only',
    last_error: null,
  };
}

export function appendLocalEntry(entry: LocalEntryDraft) {
  const entries = readLocalEntries();
  const next = [entry, ...entries.filter((item) => item.local_id !== entry.local_id)];
  saveLocalEntries(next);
  return next;
}

export function updateLocalEntry(
  localId: string,
  updater: (entry: LocalEntryDraft) => LocalEntryDraft
) {
  const entries = readLocalEntries();
  const next = entries.map((entry) =>
    entry.local_id === localId ? updater(entry) : entry
  );
  saveLocalEntries(next);
  return next;
}

export function removeLocalEntry(localId: string) {
  const entries = readLocalEntries();
  const next = entries.filter((entry) => entry.local_id !== localId);
  saveLocalEntries(next);
  return next;
}

export function toClientEntry(entry: Entry): ClientEntry {
  return {
    ...entry,
    client_id: entry.id,
    sync_state: 'synced',
    is_local: false,
    last_error: null,
  };
}

export function draftToClientEntry(draft: LocalEntryDraft): ClientEntry {
  return {
    id: `local:${draft.local_id}`,
    user_id: 'local',
    text: draft.text,
    category: draft.category,
    tags: draft.tags,
    attachments: draft.attachments,
    processed: false,
    last_digest_id: null,
    source: draft.source,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
    client_id: draft.local_id,
    sync_state: draft.sync_state,
    is_local: true,
    local_id: draft.local_id,
    last_error: draft.last_error || null,
  };
}

export function mergeClientEntries(
  remoteEntries: Entry[],
  localEntries: LocalEntryDraft[]
): ClientEntry[] {
  return [
    ...localEntries.map(draftToClientEntry),
    ...remoteEntries.map(toClientEntry),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function sortLocalEntriesDesc(a: LocalEntryDraft, b: LocalEntryDraft) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

function isLocalEntryDraft(value: unknown): value is LocalEntryDraft {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<LocalEntryDraft>;
  return (
    typeof candidate.local_id === 'string' &&
    typeof candidate.category === 'string' &&
    Array.isArray(candidate.attachments) &&
    typeof candidate.created_at === 'string' &&
    typeof candidate.updated_at === 'string' &&
    typeof candidate.sync_state === 'string'
  );
}
