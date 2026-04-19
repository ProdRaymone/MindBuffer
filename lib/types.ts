// ============================================================================
// Categories
// ============================================================================
export type CategoryDef = {
  id: string;
  label: string;
  en: string;
  symbol: string;
  color: string;
};

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: 'idea',     label: '灵感', en: 'Idea',   symbol: '✦', color: '#e8b85c' },
  { id: 'todo',     label: '待办', en: 'Todo',   symbol: '◇', color: '#7cb87c' },
  { id: 'music',    label: '音乐', en: 'Music',  symbol: '♪', color: '#b28bc7' },
  { id: 'feeling',  label: '感受', en: 'Feel',   symbol: '○', color: '#8ba5c7' },
  { id: 'diary',    label: '日记', en: 'Diary',  symbol: '◈', color: '#c78b8b' },
  { id: 'question', label: '问题', en: 'Ask',    symbol: '?', color: '#e8d35c' },
  { id: 'link',     label: '链接', en: 'Link',   symbol: '↗', color: '#9ca3af' },
  { id: 'note',     label: '笔记', en: 'Note',   symbol: '—', color: '#d1d5db' },
];

// ============================================================================
// Attachment types
// ============================================================================
export type ImageAttachment = {
  type: 'image';
  storage_path: string;  // e.g. "{user_id}/{entry_id}/{filename}.webp"
  width?: number;
  height?: number;
  size_bytes?: number;
  thumb_path?: string;
  ocr_text?: string;
};

export type LinkAttachment = {
  type: 'link';
  url: string;
  title?: string;
  description?: string;
  image?: string;       // og:image URL
  site_name?: string;
  favicon?: string;
};

export type AudioAttachment = {
  type: 'audio';
  storage_path: string;
  duration_sec: number;
  transcript?: string;
  waveform_peaks?: number[];
};

export type Attachment = ImageAttachment | LinkAttachment | AudioAttachment;

// ============================================================================
// DB models (shape matches Supabase rows)
// ============================================================================
export type Entry = {
  id: string;
  user_id: string;
  text: string | null;
  category: string;
  tags: string[];
  attachments: Attachment[];
  processed: boolean;
  last_digest_id: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type Digest = {
  id: string;
  user_id: string;
  content: string;
  entry_count: number;
  entry_ids: string[];
  period_start: string | null;
  period_end: string | null;
  kind: string;
  created_at: string;
};

export type Preferences = {
  user_id: string;
  digest_enabled: boolean;
  digest_time: string;     // "HH:MM:SS"
  digest_min_entries: number;
  weekly_summary: boolean;
  custom_categories: CategoryDef[] | null;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// UI helpers
// ============================================================================
export type MediaType = 'text' | 'image' | 'link' | 'audio' | 'mixed';

export function mediaTypeOf(entry: Pick<Entry, 'text' | 'attachments'>): MediaType {
  const atts = entry.attachments || [];
  const hasText = !!(entry.text && entry.text.trim());
  if (atts.length === 0) return 'text';
  const kinds = new Set(atts.map((a) => a.type));
  if (kinds.size > 1 || (hasText && kinds.size === 1)) {
    // text + any attachment, or mixed attachment types
    if (kinds.size === 1 && hasText) return [...kinds][0] as MediaType;
    return 'mixed';
  }
  return [...kinds][0] as MediaType;
}

// ============================================================================
// URL extraction (for auto link-unfurl)
// ============================================================================
const URL_RE = /https?:\/\/[^\s<>"]+/g;
export function extractUrls(text: string): string[] {
  if (!text) return [];
  return Array.from(new Set(text.match(URL_RE) || []));
}
