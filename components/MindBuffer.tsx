'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Check,
  Copy,
  Download,
  Edit3,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  LogIn,
  LogOut,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  appendLocalEntry,
  createLocalEntryDraft,
  mergeClientEntries,
  readLocalEntries,
  removeLocalEntry,
  updateLocalEntry,
} from '@/lib/local-entries';
import { compressImage, extractImagesFromClipboard } from '@/lib/image';
import { triggerHaptic } from '@/lib/native';
import { createBrowser } from '@/lib/supabase';
import {
  DEFAULT_CATEGORIES,
  extractUrls,
  mediaTypeOf,
  type Attachment,
  type ClientEntry,
  type Digest,
  type Entry,
  type LinkAttachment,
  type LocalEntryDraft,
  type MediaType,
} from '@/lib/types';

type Props = {
  initialEntries: Entry[];
  initialDigests: Digest[];
  userEmail: string;
  hasCloudAccount: boolean;
};

type SessionMode = 'authenticated' | 'guest';

type PendingAttachment =
  | {
      kind: 'image';
      tempId: string;
      file: File;
      previewUrl: string;
      uploading: boolean;
      storagePath?: string;
      width?: number;
      height?: number;
    }
  | {
      kind: 'link';
      tempId: string;
      url: string;
      fetching: boolean;
      preview?: LinkAttachment;
    };

const MEDIA_TYPES: { id: MediaType | 'all'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'text', label: '文字' },
  { id: 'image', label: '图片' },
  { id: 'link', label: '链接' },
  { id: 'mixed', label: '混合' },
];

const pad = (n: number) => n.toString().padStart(2, '0');

const fmtTime = (ts: string | number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDay = (ts: string | number) => {
  const d = new Date(ts);
  const now = new Date();
  const today = d.toDateString() === now.toDateString();
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = d.toDateString() === yesterdayDate.toDateString();

  if (today) return '今天';
  if (yesterday) return '昨天';
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function groupByDay(entries: ClientEntry[]) {
  const map = new Map<string, { key: string; ts: string; items: ClientEntry[] }>();

  for (const entry of entries) {
    const key = new Date(entry.created_at).toDateString();
    if (!map.has(key)) map.set(key, { key, ts: entry.created_at, items: [] });
    map.get(key)!.items.push(entry);
  }

  return [...map.values()].sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
  );
}

export default function MindBuffer({
  initialEntries,
  initialDigests,
  userEmail,
  hasCloudAccount,
}: Props) {
  const supabase = useMemo(() => createBrowser(), []);

  const [cloudEntries, setCloudEntries] = useState<Entry[]>(initialEntries);
  const [localEntries, setLocalEntries] = useState<LocalEntryDraft[]>([]);
  const [digests, setDigests] = useState<Digest[]>(initialDigests);
  const [input, setInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('idea');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterMedia, setFilterMedia] = useState<MediaType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [digestView, setDigestView] = useState<Digest | null>(null);
  const [showDigestList, setShowDigestList] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showGuestFilters, setShowGuestFilters] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [isSyncingLocal, setIsSyncingLocal] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const sessionMode = hasCloudAccount ? 'authenticated' : 'guest';
  const isGuestMode = sessionMode === 'guest';

  const entries = useMemo(
    () => mergeClientEntries(cloudEntries, localEntries),
    [cloudEntries, localEntries]
  );

  const editingEntry = useMemo(
    () => entries.find((entry) => entry.id === editingId) || null,
    [editingId, entries]
  );

  const unsyncedEntries = useMemo(
    () => localEntries.filter((entry) => entry.sync_state !== 'syncing'),
    [localEntries]
  );

  const syncingCount = useMemo(
    () => localEntries.filter((entry) => entry.sync_state === 'syncing').length,
    [localEntries]
  );

  const guestBannerCopy = {
    title: '内容保存在本机',
    detail:
      unsyncedEntries.length > 0
        ? `已有 ${unsyncedEntries.length} 条记录暂存在这台设备里，登录后就能同步到账号。`
        : '现在就能先记下来，登录后再同步到云端。',
  };

  useEffect(() => {
    setCloudEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    setDigests(initialDigests);
  }, [initialDigests]);

  useEffect(() => {
    setLocalEntries(readLocalEntries());
  }, []);

  useEffect(() => {
    if (!hasCloudAccount) return;

    const needed = new Set<string>();
    for (const entry of entries) {
      for (const attachment of entry.attachments || []) {
        if (attachment.type === 'image' && attachment.storage_path && !signedUrls[attachment.storage_path]) {
          needed.add(attachment.storage_path);
        }
      }
    }

    if (needed.size === 0) return;

    void (async () => {
      try {
        const res = await fetch('/api/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: 'entries-images', paths: [...needed] }),
        });
        const { urls } = await res.json();
        if (urls) setSignedUrls((prev) => ({ ...prev, ...urls }));
      } catch {
        // ignore signed URL failures for now
      }
    })();
  }, [entries, hasCloudAccount, signedUrls]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExport(false);
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showExport || showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExport, showMenu]);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  const buildFinalAttachments = useCallback((text: string) => {
    const attachments: Attachment[] = [];
    const seenUrls = new Set<string>();

    for (const item of pending) {
      if (item.kind === 'image') {
        if (!hasCloudAccount) {
          return { error: '登录后才可以上传图片' };
        }
        if (!item.storagePath || item.uploading) {
          return { error: '图片仍在上传，请稍候' };
        }

        attachments.push({
          type: 'image',
          storage_path: item.storagePath,
          width: item.width,
          height: item.height,
        });
        continue;
      }

      seenUrls.add(item.url);
      if (item.preview) attachments.push({ ...item.preview, type: 'link' });
      else attachments.push({ type: 'link', url: item.url });
    }

    for (const url of extractUrls(text)) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      attachments.push({ type: 'link', url });
    }

    return { attachments };
  }, [hasCloudAccount, pending]);

  const syncDraftToCloud = useCallback(async (draft: LocalEntryDraft, silent = false) => {
    if (!hasCloudAccount) return false;

    setLocalEntries(
      updateLocalEntry(draft.local_id, (entry) => ({
        ...entry,
        sync_state: 'syncing',
        last_error: null,
        updated_at: new Date().toISOString(),
      }))
    );

    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: draft.text,
        category: draft.category,
        tags: draft.tags,
        attachments: draft.attachments,
        source: draft.source,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setLocalEntries(
        updateLocalEntry(draft.local_id, (entry) => ({
          ...entry,
          sync_state: 'failed',
          last_error: err.error || 'sync_failed',
          updated_at: new Date().toISOString(),
        }))
      );
      if (!silent) showToast('已保存在本地，云端同步失败');
      return false;
    }

    const { entry } = await res.json();
    setCloudEntries((prev) => [entry, ...prev.filter((item) => item.id !== entry.id)]);
    setLocalEntries(removeLocalEntry(draft.local_id));
    return true;
  }, [hasCloudAccount, showToast]);

  const syncLocalEntries = useCallback(async () => {
    if (!hasCloudAccount || isSyncingLocal) return;

    const drafts = readLocalEntries().filter((entry) => entry.sync_state !== 'syncing');
    if (drafts.length === 0) {
      showToast('没有需要同步的本地记录');
      return;
    }

    setIsSyncingLocal(true);

    let successCount = 0;
    for (const draft of drafts) {
      if (await syncDraftToCloud(draft, true)) successCount += 1;
    }

    setIsSyncingLocal(false);
    setLocalEntries(readLocalEntries());

    if (successCount === drafts.length) {
      showToast(`已同步 ${successCount} 条记录`);
    } else if (successCount > 0) {
      showToast(`已同步 ${successCount} 条，剩余稍后重试`);
    } else {
      showToast('本地记录暂时同步失败');
    }
  }, [hasCloudAccount, isSyncingLocal, showToast, syncDraftToCloud]);

  const addEntry = async () => {
    const text = input.trim();
    const hasPending = pending.length > 0;
    if (!text && !hasPending) return;

    const built = buildFinalAttachments(text);
    if (built.error) {
      showToast(built.error);
      return;
    }

    const draft = createLocalEntryDraft({
      localId: uid(),
      text: text || null,
      category: selectedCategory,
      attachments: built.attachments,
      source: hasCloudAccount ? 'web' : 'local',
    });

    if (hasCloudAccount) draft.sync_state = 'syncing';

    triggerHaptic('light');
    setLocalEntries(appendLocalEntry(draft));
    setInput('');
    setPending([]);
    inputRef.current?.focus();

    if (hasCloudAccount) {
      void syncDraftToCloud(draft);
    }
  };

  const deleteEntry = async (entry: ClientEntry) => {
    if (entry.is_local && entry.local_id) {
      setLocalEntries(removeLocalEntry(entry.local_id));
      return;
    }

    await fetch(`/api/entries/${entry.id}`, { method: 'DELETE' });
    setCloudEntries((prev) => prev.filter((item) => item.id !== entry.id));
  };

  const startEdit = (entry: ClientEntry) => {
    setEditingId(entry.id);
    setEditText(entry.text || '');
  };

  const saveEdit = async () => {
    if (!editingId || !editingEntry) return;

    if (editingEntry.is_local && editingEntry.local_id) {
      setLocalEntries(
        updateLocalEntry(editingEntry.local_id, (entry) => ({
          ...entry,
          text: editText.trim() || null,
          updated_at: new Date().toISOString(),
        }))
      );
      setEditingId(null);
      setEditText('');
      return;
    }

    const res = await fetch(`/api/entries/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: editText.trim() || null }),
    });

    if (res.ok) {
      const { entry } = await res.json();
      setCloudEntries((prev) => prev.map((item) => (item.id === editingId ? entry : item)));
    }

    setEditingId(null);
    setEditText('');
  };

  const addImagesToPending = async (files: File[]) => {
    if (!hasCloudAccount) {
      showToast('登录后才可以上传图片');
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      showToast('登录状态已失效，请重新登录');
      return;
    }

    for (const file of files) {
      const tempId = uid();
      const previewUrl = URL.createObjectURL(file);

      setPending((prev) => [
        ...prev,
        { kind: 'image', tempId, file, previewUrl, uploading: true },
      ]);

      try {
        const compressed = await compressImage(file);
        const storagePath = `${user.id}/drafts/${tempId}-${compressed.filename}`;
        const { error } = await supabase.storage
          .from('entries-images')
          .upload(storagePath, compressed.blob, {
            contentType: compressed.mimeType,
            upsert: false,
          });

        if (error) throw error;

        setPending((prev) =>
          prev.map((item) =>
            item.kind === 'image' && item.tempId === tempId
              ? {
                  ...item,
                  uploading: false,
                  storagePath,
                  width: compressed.width,
                  height: compressed.height,
                }
              : item
          )
        );
      } catch (e: any) {
        showToast(`上传失败: ${e.message}`);
        setPending((prev) =>
          prev.filter((item) => !(item.kind === 'image' && item.tempId === tempId))
        );
      }
    }
  };

  const addLinkToPending = async (url: string) => {
    const tempId = uid();

    if (!hasCloudAccount) {
      setPending((prev) => [
        ...prev,
        {
          kind: 'link',
          tempId,
          url,
          fetching: false,
          preview: { type: 'link', url },
        },
      ]);
      return;
    }

    setPending((prev) => [...prev, { kind: 'link', tempId, url, fetching: true }]);

    try {
      const res = await fetch('/api/link-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const payload = await res.json().catch(() => ({}));
      const preview = payload.preview ? { type: 'link', ...payload.preview } : { type: 'link', url };

      setPending((prev) =>
        prev.map((item) =>
          item.kind === 'link' && item.tempId === tempId
            ? { ...item, fetching: false, preview }
            : item
        )
      );
    } catch {
      setPending((prev) =>
        prev.map((item) =>
          item.kind === 'link' && item.tempId === tempId
            ? { ...item, fetching: false, preview: { type: 'link', url } }
            : item
        )
      );
    }
  };

  const removePending = (tempId: string) => {
    setPending((prev) => {
      const removed = prev.find((item) => item.tempId === tempId);
      if (removed?.kind === 'image') URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((item) => item.tempId !== tempId);
    });
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = extractImagesFromClipboard(e.nativeEvent as ClipboardEvent);
    if (files.length === 0) return;

    e.preventDefault();
    await addImagesToPending(files);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) await addImagesToPending(files);
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) await addImagesToPending(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const filteredEntries = useMemo(() => {
    let result = entries;

    if (filterCategory) result = result.filter((entry) => entry.category === filterCategory);
    if (filterMedia !== 'all') result = result.filter((entry) => mediaTypeOf(entry) === filterMedia);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((entry) => {
        if (entry.text?.toLowerCase().includes(q)) return true;
        return (entry.attachments || []).some((attachment) =>
          attachment.type === 'link'
            ? `${attachment.title || ''} ${attachment.url}`.toLowerCase().includes(q)
            : false
        );
      });
    }

    return result;
  }, [entries, filterCategory, filterMedia, searchQuery]);

  const grouped = useMemo(() => groupByDay(filteredEntries), [filteredEntries]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const category of DEFAULT_CATEGORIES) counts[category.id] = 0;
    for (const entry of entries) counts[entry.category] = (counts[entry.category] || 0) + 1;
    return counts;
  }, [entries]);

  const generateDigest = async () => {
    if (!hasCloudAccount) {
      showToast('登录后才可以使用 AI 整理');
      return;
    }

    setIsGenerating(true);
    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'today' }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || '生成失败');
        return;
      }

      const { digest } = await res.json();
      setDigests((prev) => [digest, ...prev]);
      setDigestView(digest);

      const entriesRes = await fetch('/api/entries?limit=500');
      const payload = await entriesRes.json().catch(() => ({}));
      if (payload.entries) setCloudEntries(payload.entries);
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadFile = (text: string, filename: string, mime: string) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportJSON = () => {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        entries,
        localEntries,
        digests,
      },
      null,
      2
    );
    downloadFile(payload, `mindbuffer-${Date.now()}.json`, 'application/json');
    setShowExport(false);
  };

  const exportMarkdown = () => {
    const groups = groupByDay(entries);
    let md = `# MindBuffer\n\n> 导出时间: ${new Date().toLocaleString('zh-CN')}\n\n`;

    for (const group of groups) {
      const d = new Date(group.ts);
      md += `## ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}\n\n`;

      for (const entry of group.items) {
        const category = DEFAULT_CATEGORIES.find((item) => item.id === entry.category);
        md += `- \`${fmtTime(entry.created_at)}\` **[${category?.label || entry.category}]** ${entry.text || ''}`;
        for (const attachment of entry.attachments || []) {
          if (attachment.type === 'link') md += ` [${attachment.title || attachment.url}](${attachment.url})`;
          if (attachment.type === 'image') md += ' `[图片]`';
        }
        if (entry.sync_state !== 'synced') md += ` _(状态: ${syncStateLabel(entry.sync_state)})_`;
        md += '\n';
      }

      md += '\n';
    }

    downloadFile(md, `mindbuffer-${Date.now()}.md`, 'text/markdown');
    setShowExport(false);
  };

  const copyNotion = async () => {
    const groups = groupByDay(entries);
    let output = '';

    for (const group of groups) {
      const d = new Date(group.ts);
      output += `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}\n`;
      for (const entry of group.items) {
        const category = DEFAULT_CATEGORIES.find((item) => item.id === entry.category);
        output += `• [${category?.label || entry.category}] ${fmtTime(entry.created_at)} - ${entry.text || ''}`;
        for (const attachment of entry.attachments || []) {
          if (attachment.type === 'link') output += ` (${attachment.url})`;
        }
        output += '\n';
      }
      output += '\n';
    }

    try {
      await navigator.clipboard.writeText(output);
      showToast('已复制为 Notion 友好格式');
    } catch {
      showToast('复制失败');
    }
    setShowExport(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const openLogin = () => {
    window.location.href = '/login';
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void addEntry();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (input.length < 120 && !input.includes('\n')) {
        e.preventDefault();
        void addEntry();
      }
    }
  };

  const selectedCategoryDef =
    DEFAULT_CATEGORIES.find((category) => category.id === selectedCategory) || DEFAULT_CATEGORIES[0];

  return (
    <div
      className="relative w-full h-[100dvh] flex flex-col bg-[var(--bg)] text-[var(--text)] mb-noise overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="relative z-10 flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-[var(--border-soft)] mb-safe-top">
        <div className="flex items-center gap-2.5 font-serif text-[17px] font-medium tracking-tight">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
          <span>灵感中转站</span>
          <span className="hidden md:inline font-mono text-[10px] tracking-[0.08em] uppercase text-[var(--text-faint)] ml-1">
            MindBuffer
          </span>
        </div>

        <div className="flex items-center gap-1">
          <IconBtn
            active={showSearch}
            onClick={() => {
              setShowSearch((value) => !value);
              if (showSearch) setSearchQuery('');
            }}
            title="搜索"
          >
            <Search size={15} />
          </IconBtn>
          {isGuestMode ? (
            <button
              onClick={openLogin}
              className="h-8 px-3 rounded-full border border-[var(--border)] text-[12px] text-[var(--accent)] hover:border-[#3a3a3f] transition-colors"
            >
              登录同步
            </button>
          ) : null}
          {!isGuestMode && (
            <>
              <IconBtn
                onClick={() => {
                  if (!hasCloudAccount) {
                    showToast('登录后才可以查看 Digest 历史');
                    return;
                  }
                  setShowDigestList(true);
                }}
                title="Digest 历史"
              >
                <FileText size={15} />
              </IconBtn>
              <IconBtn
                onClick={generateDigest}
                disabled={isGenerating}
                title="AI 整理"
                style={{ color: isGenerating ? undefined : 'var(--accent)' }}
              >
                {isGenerating ? <Loader2 size={15} className="mb-spin" /> : <Sparkles size={15} />}
              </IconBtn>
              <IconBtn onClick={() => setShowExport((value) => !value)} title="导出">
                <Download size={15} />
              </IconBtn>
            </>
          )}
          <IconBtn onClick={() => setShowMenu((value) => !value)} title="菜单">
            <Settings size={15} />
          </IconBtn>
        </div>
      </div>

      {isGuestMode ? (
        <div className="relative z-10 px-4 md:px-5 py-3 border-b border-[var(--border-soft)] bg-[var(--bg)]">
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium tracking-[0.01em]">
                  {guestBannerCopy.title}
                </div>
                <div className="mt-1 text-[12.5px] leading-[1.6] text-[var(--text-dim)]">
                  {guestBannerCopy.detail}
                </div>
              </div>
              <button
                onClick={openLogin}
                className="flex-shrink-0 text-[11px] px-3 py-1.5 rounded-full border border-[var(--border)] hover:border-[#3a3a3f] text-[var(--accent)] transition-colors"
              >
                登录同步
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative z-10 px-4 md:px-5 py-2 border-b border-[var(--border-soft)] bg-[var(--bg)]">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <StatusBadge tone="default">已连接云端</StatusBadge>
            {syncingCount > 0 ? <StatusBadge tone="muted">{syncingCount} 条同步中</StatusBadge> : null}
            {unsyncedEntries.length > 0 ? (
              <StatusBadge tone="warn">{unsyncedEntries.length} 条待同步</StatusBadge>
            ) : null}
            <span className="text-[var(--text-faint)]">
              发送后会先本地显示，再后台写入云端
            </span>
            <div className="ml-auto flex items-center gap-2">
              {unsyncedEntries.length > 0 ? (
                <button
                  onClick={() => void syncLocalEntries()}
                  disabled={isSyncingLocal}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--border)] hover:border-[#3a3a3f] text-[var(--accent)] disabled:opacity-40"
                >
                  {isSyncingLocal ? '同步中...' : '同步到账号'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {showExport ? (
        <div
          ref={exportMenuRef}
          className="absolute right-4 top-[88px] z-50 bg-[var(--bg-elev)] border border-[var(--border)] rounded-lg p-1 min-w-[220px] shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
        >
          <MenuItem onClick={copyNotion}>
            <Copy size={13} /> 复制为 Notion 格式
          </MenuItem>
          <MenuItem onClick={exportMarkdown}>
            <FileText size={13} /> 下载 Markdown
          </MenuItem>
          <MenuItem onClick={exportJSON}>
            <Download size={13} /> 下载 JSON
          </MenuItem>
        </div>
      ) : null}

      {showMenu ? (
        <div
          ref={menuRef}
          className="absolute right-4 top-[88px] z-50 bg-[var(--bg-elev)] border border-[var(--border)] rounded-lg p-1 min-w-[220px] shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
        >
          <div className="px-3 py-2 text-[11px] text-[var(--text-faint)] font-mono tracking-wider border-b border-[var(--border-soft)] mb-1">
            {hasCloudAccount ? userEmail : 'LOCAL MODE'}
          </div>
          {hasCloudAccount ? (
            <MenuItem onClick={signOut}>
              <LogOut size={13} /> 退出登录
            </MenuItem>
          ) : (
            <MenuItem onClick={openLogin}>
              <LogIn size={13} /> 登录同步
            </MenuItem>
          )}
          {hasCloudAccount && unsyncedEntries.length > 0 ? (
            <MenuItem onClick={() => void syncLocalEntries()}>
              <RefreshCw size={13} /> 同步本地记录
            </MenuItem>
          ) : null}
        </div>
      ) : null}

      {showSearch ? (
        <div className="relative z-10 px-4 md:px-5 pt-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              autoFocus
              placeholder="搜索内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[var(--bg-elev)] border border-[var(--border)] rounded-lg text-[13px] outline-none focus:border-[#3a3a3f]"
            />
          </div>
        </div>
      ) : null}

      {isGuestMode ? (
        <div className="relative z-10 px-4 md:px-5 pt-3">
          <button
            onClick={() => setShowGuestFilters((value) => !value)}
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[#3a3a3f] transition-colors"
          >
            {showGuestFilters ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showGuestFilters ? '收起筛选' : '筛选'}
          </button>
        </div>
      ) : null}

      {!isGuestMode || showGuestFilters ? (
        <div className="relative z-10 flex items-center gap-4 px-4 md:px-5 py-2.5 border-b border-[var(--border-soft)] overflow-x-auto mb-hide-scroll flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <Chip active={filterCategory === null} onClick={() => setFilterCategory(null)}>
              全部
              <span className="ml-0.5 font-mono text-[10px] text-[var(--text-faint)]">
                {entries.length}
              </span>
            </Chip>
            {DEFAULT_CATEGORIES.map((category) => (
              <Chip
                key={category.id}
                active={filterCategory === category.id}
                onClick={() => setFilterCategory(filterCategory === category.id ? null : category.id)}
              >
                <span className="text-[13px]" style={{ color: category.color }}>
                  {category.symbol}
                </span>
                {category.label}
                {categoryCounts[category.id] > 0 ? (
                  <span className="ml-0.5 font-mono text-[10px] text-[var(--text-faint)]">
                    {categoryCounts[category.id]}
                  </span>
                ) : null}
              </Chip>
            ))}
          </div>

          <div className="h-4 w-px bg-[var(--border)] flex-shrink-0" />

          <div className="flex items-center gap-1.5">
            {MEDIA_TYPES.map((media) => (
              <Chip
                key={media.id}
                active={filterMedia === media.id}
                onClick={() => setFilterMedia(media.id)}
                size="sm"
              >
                {media.label}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      <div className="relative z-10 flex-1 overflow-y-auto mb-scroll px-4 md:px-5 pt-4 pb-5">
        {grouped.length === 0 ? (
          entries.length === 0 && isGuestMode ? (
            <div className="max-w-[560px] rounded-[28px] border border-[var(--border)] bg-[var(--bg-elev)] px-5 py-6 text-left">
              <div className="text-[15px] font-medium tracking-[0.01em]">第一条先写下来</div>
              <div className="mt-2 text-[13px] leading-[1.7] text-[var(--text-dim)]">
                想到什么就先记什么，稍后再登录同步或整理。
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-[var(--text-faint)]">
              <div className="font-serif italic text-[15px] text-[var(--text-dim)] mb-2">
                {entries.length === 0 ? '这里还空着。' : '没有匹配的条目。'}
              </div>
              <div className="text-[13px] leading-relaxed">
                {entries.length === 0
                  ? '想到什么就先丢进来，应用会先帮你存在本地。'
                  : '试试换个分类或者搜索词。'}
              </div>
            </div>
          )
        ) : (
          grouped.map((group) => (
            <div key={group.key}>
              <div className="flex items-center gap-2.5 my-4 first:mt-0">
                <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[var(--text-faint)]">
                  {fmtDay(group.ts)}
                </span>
                <div className="flex-1 h-px bg-[var(--border-soft)]" />
              </div>
              {group.items.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  signedUrls={signedUrls}
                  isEditing={editingId === entry.id}
                  editText={editText}
                  onEditTextChange={setEditText}
                  onStartEdit={() => startEdit(entry)}
                  onSaveEdit={saveEdit}
                  onCancelEdit={() => {
                    setEditingId(null);
                    setEditText('');
                  }}
                  onDelete={() => void deleteEntry(entry)}
                  sessionMode={sessionMode}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <div className="relative z-10 border-t border-[var(--border-soft)] bg-[var(--bg)] flex-shrink-0 mb-safe-bottom">
        {pending.length > 0 ? (
          <div className="flex gap-2 px-4 md:px-5 pt-3 overflow-x-auto mb-hide-scroll">
            {pending.map((item) => (
              <PendingChip key={item.tempId} attachment={item} onRemove={() => removePending(item.tempId)} />
            ))}
          </div>
        ) : null}

        <div className={`flex gap-1.5 px-4 md:px-5 pt-2.5 overflow-x-auto mb-hide-scroll ${isGuestMode ? 'pt-3' : ''}`}>
          {DEFAULT_CATEGORIES.map((category) => {
            const active = selectedCategory === category.id;
            return (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] whitespace-nowrap transition-all ${
                  active
                    ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                    : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                <span className="text-[12px]" style={{ color: active ? undefined : category.color }}>
                  {category.symbol}
                </span>
                {category.label}
              </button>
            );
          })}
        </div>

        <div className={`p-2.5 md:p-3 pt-2 ${isGuestMode ? 'pt-3' : ''}`}>
          <div
            className={`flex items-end gap-2 border border-[var(--border)] px-3.5 transition-colors focus-within:border-[#3a3a3f] ${
              isGuestMode
                ? 'rounded-[24px] bg-[var(--bg-elev)]/90 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.16)]'
                : 'rounded-xl bg-[var(--bg-elev)] py-2'
            }`}
          >
            <span className="text-[15px] pb-1" style={{ color: selectedCategoryDef.color }}>
              {selectedCategoryDef.symbol}
            </span>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              onPaste={handlePaste}
              placeholder={
                isGuestMode
                  ? `写下${selectedCategoryDef.label}，回头再整理`
                  : `输入${selectedCategoryDef.label}...（Cmd/Ctrl + Enter 发送）`
              }
              rows={1}
              className={`flex-1 bg-transparent outline-none resize-none placeholder:text-[var(--text-faint)] ${
                isGuestMode
                  ? 'text-[15px] leading-[1.6] py-2 min-h-[72px] max-h-[220px]'
                  : 'text-[14px] leading-[1.55] py-1 min-h-[22px] max-h-[160px]'
              }`}
              style={{
                height: `${Math.min(
                  isGuestMode ? 220 : 160,
                  Math.max(isGuestMode ? 72 : 22, input.split('\n').length * 22 + (isGuestMode ? 22 : 4))
                )}px`,
              }}
            />
            {!isGuestMode ? (
              <>
                <button
                  onClick={() => {
                    if (!hasCloudAccount) {
                      showToast('登录后才可以上传图片');
                      return;
                    }
                    fileInputRef.current?.click();
                  }}
                  className="w-8 h-8 rounded-lg text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--bg-elev-2)] flex items-center justify-center transition-colors disabled:opacity-40"
                  title={hasCloudAccount ? '附加图片' : '登录后可上传图片'}
                >
                  <ImageIcon size={14} />
                </button>
                <button
                  onClick={async () => {
                    const url = prompt('粘贴链接 URL：');
                    if (url?.trim()) await addLinkToPending(url.trim());
                  }}
                  className="w-8 h-8 rounded-lg text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--bg-elev-2)] flex items-center justify-center transition-colors"
                  title="附加链接"
                >
                  <Paperclip size={14} />
                </button>
              </>
            ) : null}
            <button
              onClick={() => void addEntry()}
              disabled={!input.trim() && pending.length === 0}
              className={`bg-[var(--text)] text-[var(--bg)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center hover:opacity-90 transition-opacity ${
                isGuestMode ? 'w-11 h-11 rounded-2xl' : 'w-8 h-8 rounded-lg'
              }`}
            >
              <Send size={isGuestMode ? 15 : 13} />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFilePick}
            className="hidden"
          />
        </div>
      </div>

      {digestView ? (
        <ModalBackdrop onClose={() => setDigestView(null)}>
          <ModalHeader
            title={`Daily Digest · ${new Date(digestView.created_at).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}`}
            onClose={() => setDigestView(null)}
          />
          <div className="overflow-y-auto mb-scroll flex-1 px-5 py-4 text-[13.5px] leading-[1.65]">
            <RenderMarkdown text={digestView.content} />
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-soft)]">
            <Btn
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(digestView.content);
                  showToast('已复制 Digest');
                } catch {
                  showToast('复制失败');
                }
              }}
            >
              <Copy size={12} /> 复制
            </Btn>
            <Btn
              onClick={() =>
                downloadFile(
                  digestView.content,
                  `digest-${new Date(digestView.created_at).toISOString().slice(0, 10)}.md`,
                  'text/markdown'
                )
              }
            >
              <Download size={12} /> 下载
            </Btn>
            <Btn primary onClick={() => setDigestView(null)}>
              完成
            </Btn>
          </div>
        </ModalBackdrop>
      ) : null}

      {showDigestList ? (
        <ModalBackdrop onClose={() => setShowDigestList(false)}>
          <ModalHeader title="Digest 历史" onClose={() => setShowDigestList(false)} />
          <div className="overflow-y-auto mb-scroll flex-1 px-5 py-4">
            {digests.length === 0 ? (
              <div className="text-center py-10 text-[var(--text-faint)]">
                <div className="font-serif italic text-[14px] text-[var(--text-dim)] mb-1.5">
                  还没有 Digest。
                </div>
                <div className="text-[12.5px]">点右上角的 AI 整理，把今天的内容整理成日报。</div>
              </div>
            ) : (
              digests.map((digest) => (
                <div
                  key={digest.id}
                  onClick={() => {
                    setDigestView(digest);
                    setShowDigestList(false);
                  }}
                  className="px-3 py-2.5 border border-[var(--border-soft)] rounded-lg mb-1.5 cursor-pointer hover:border-[var(--border)] hover:bg-[var(--bg-elev-2)] transition-all"
                >
                  <div className="font-mono text-[11px] text-[var(--text-faint)]">
                    {new Date(digest.created_at).toLocaleString('zh-CN')} · {digest.entry_count} 条
                  </div>
                  <div className="text-[12px] text-[var(--text-dim)] mt-1 truncate">
                    {digest.content.replace(/[#*`]/g, '').slice(0, 100)}...
                  </div>
                </div>
              ))
            )}
          </div>
        </ModalBackdrop>
      ) : null}

      {toast ? (
        <div className="mb-toast fixed bottom-28 left-1/2 -translate-x-1/2 bg-[var(--text)] text-[var(--bg)] px-3.5 py-1.5 rounded-full text-[12px] z-[200]">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function syncStateLabel(state: ClientEntry['sync_state']) {
  switch (state) {
    case 'local-only':
      return '仅本地';
    case 'syncing':
      return '同步中';
    case 'failed':
      return '未同步';
    default:
      return '已同步';
  }
}

function syncStateTone(state: ClientEntry['sync_state']) {
  switch (state) {
    case 'local-only':
      return 'warn';
    case 'syncing':
      return 'muted';
    case 'failed':
      return 'danger';
    default:
      return 'default';
  }
}

function StatusBadge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'muted' | 'warn' | 'danger';
}) {
  const style =
    tone === 'warn'
      ? 'border-[#5d4824] text-[#f0c978] bg-[#19140a]'
      : tone === 'danger'
        ? 'border-[#553030] text-[#d7a0a0] bg-[#1a1010]'
        : tone === 'muted'
          ? 'border-[var(--border)] text-[var(--text-dim)] bg-[var(--bg-elev)]'
          : 'border-[var(--border)] text-[var(--text)] bg-[var(--bg-elev)]';

  return (
    <span className={`px-2 py-0.5 rounded-full border text-[11px] ${style}`}>
      {children}
    </span>
  );
}

function IconBtn({
  children,
  active,
  onClick,
  disabled,
  title,
  style,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      className={`w-8 h-8 rounded-md flex items-center justify-center transition-all border ${
        active
          ? 'bg-[var(--bg-elev)] text-[var(--accent)] border-[var(--border)]'
          : 'border-transparent text-[var(--text-dim)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)] hover:border-[var(--border)]'
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Chip({
  children,
  active,
  onClick,
  size = 'md',
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
}) {
  const padding = size === 'sm' ? 'px-2.5 py-[3px] text-[11px]' : 'px-3 py-[5px] text-[12px]';
  return (
    <button
      onClick={onClick}
      className={`${padding} rounded-full border flex items-center gap-1.5 whitespace-nowrap transition-all ${
        active
          ? 'bg-[var(--bg-elev)] text-[var(--text)] border-[#4a4a50]'
          : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[#3a3a3f]'
      }`}
    >
      {children}
    </button>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2 rounded text-[13px] cursor-pointer hover:bg-[var(--bg-elev-2)] transition-colors ${
        danger ? 'text-[var(--danger)]' : 'text-[var(--text)]'
      }`}
    >
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-md border text-[12.5px] flex items-center gap-1.5 transition-colors ${
        primary
          ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)] hover:opacity-85'
          : 'border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-elev-2)]'
      }`}
    >
      {children}
    </button>
  );
}

function ModalBackdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-5"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-elev)] border border-[var(--border)] rounded-2xl max-w-[640px] w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
      <div className="font-serif text-[15px] font-medium">{title}</div>
      <IconBtn onClick={onClose}>
        <X size={15} />
      </IconBtn>
    </div>
  );
}

function EntryRow({
  entry,
  signedUrls,
  isEditing,
  editText,
  onEditTextChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  sessionMode,
}: {
  entry: ClientEntry;
  signedUrls: Record<string, string>;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (value: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  sessionMode: SessionMode;
}) {
  const category = DEFAULT_CATEGORIES.find((item) => item.id === entry.category);
  const isGuestMode = sessionMode === 'guest';
  const showEntryStatusBadge = !isGuestMode
    ? entry.sync_state !== 'synced'
    : entry.sync_state === 'syncing' || entry.sync_state === 'failed';

  return (
    <div
      className={`group items-start transition-colors ${
        isGuestMode
          ? 'flex gap-3 rounded-[24px] border border-[var(--border-soft)] bg-[var(--bg-elev)]/70 px-4 py-3 mb-2.5'
          : 'flex gap-3 py-1.5 pl-0.5 pr-1 rounded hover:bg-white/[0.015]'
      }`}
    >
      {!isGuestMode ? (
        <div className="flex items-center gap-2.5 pt-0.5 flex-shrink-0">
          <span className="text-[15px] leading-none w-3.5 text-center" style={{ color: category?.color }}>
            {category?.symbol}
          </span>
          <span className="font-mono text-[11px] text-[var(--text-faint)] min-w-[38px]">
            {fmtTime(entry.created_at)}
          </span>
        </div>
      ) : null}

      {isEditing ? (
        <>
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => onEditTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSaveEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
            className="flex-1 bg-[var(--bg-elev)] border border-[var(--border)] text-[14px] px-2.5 py-1 rounded-md resize-y min-h-[32px] outline-none focus:border-[#3a3a3f]"
          />
          <div className="flex gap-1 opacity-100 self-center">
            <MiniBtn onClick={onSaveEdit}>
              <Check size={13} />
            </MiniBtn>
            <MiniBtn onClick={onCancelEdit}>
              <X size={13} />
            </MiniBtn>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            {isGuestMode ? (
              <div className="flex items-center gap-2 mb-2 text-[11px] text-[var(--text-faint)]">
                <span
                  className="inline-flex w-5 h-5 rounded-full items-center justify-center text-[12px] bg-[var(--bg-elev-2)]"
                  style={{ color: category?.color }}
                >
                  {category?.symbol}
                </span>
                <span>{category?.label || entry.category}</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {showEntryStatusBadge ? (
                  <StatusBadge tone={syncStateTone(entry.sync_state)}>
                    {syncStateLabel(entry.sync_state)}
                  </StatusBadge>
                ) : null}
                {entry.last_error ? (
                  <span className="text-[11px] text-[var(--text-faint)] truncate">
                    {entry.last_error}
                  </span>
                ) : null}
              </div>
            )}
            {isGuestMode && entry.last_error ? (
              <div className="text-[11px] text-[var(--text-faint)] mb-2 truncate">{entry.last_error}</div>
            ) : null}
            {entry.text ? (
              <div
                className={`whitespace-pre-wrap break-words ${
                  isGuestMode ? 'text-[15px] leading-[1.75]' : 'text-[14px] leading-[1.6]'
                }`}
              >
                {entry.text}
              </div>
            ) : null}
            {(entry.attachments?.length || 0) > 0 ? (
              <div className={`${isGuestMode ? 'mt-2.5' : 'mt-1.5'} flex flex-wrap gap-2`}>
                {entry.attachments.map((attachment, index) => (
                  <AttachmentView
                    key={`${entry.id}-${index}`}
                    attachment={attachment}
                    signedUrls={signedUrls}
                  />
                ))}
              </div>
            ) : null}
            {isGuestMode ? (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-faint)]">
                <span>{fmtTime(entry.created_at)}</span>
                {showEntryStatusBadge ? (
                  <StatusBadge tone={syncStateTone(entry.sync_state)}>
                    {syncStateLabel(entry.sync_state)}
                  </StatusBadge>
                ) : null}
              </div>
            ) : null}
          </div>
          <div
            className={`flex gap-0.5 self-center transition-opacity ${
              isGuestMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <MiniBtn onClick={onStartEdit}>
              <Edit3 size={12} />
            </MiniBtn>
            <MiniBtn onClick={onDelete} danger>
              <Trash2 size={12} />
            </MiniBtn>
          </div>
        </>
      )}
    </div>
  );
}

function MiniBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-6 h-6 rounded flex items-center justify-center text-[var(--text-faint)] hover:bg-[var(--bg-elev)] transition-colors ${
        danger ? 'hover:text-[var(--danger)]' : 'hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  );
}

function AttachmentView({
  attachment,
  signedUrls,
}: {
  attachment: Attachment;
  signedUrls: Record<string, string>;
}) {
  if (attachment.type === 'image') {
    const url = signedUrls[attachment.storage_path];
    if (!url) {
      return (
        <div className="w-28 h-28 bg-[var(--bg-elev)] border border-[var(--border-soft)] rounded-lg flex items-center justify-center">
          <Loader2 size={14} className="mb-spin text-[var(--text-faint)]" />
        </div>
      );
    }

    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt=""
          className="max-w-[320px] max-h-[260px] rounded-lg border border-[var(--border-soft)] object-cover"
        />
      </a>
    );
  }

  if (attachment.type === 'link') {
    let hostname = attachment.url;
    try {
      hostname = new URL(attachment.url).hostname;
    } catch {
      hostname = attachment.url;
    }

    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-2.5 border border-[var(--border-soft)] hover:border-[var(--border)] rounded-lg p-2 max-w-[380px] bg-[var(--bg-elev)]/40 transition-colors"
      >
        {attachment.image ? (
          <img src={attachment.image} alt="" className="w-12 h-12 object-cover rounded flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 bg-[var(--bg-elev-2)] rounded flex items-center justify-center flex-shrink-0">
            <LinkIcon size={14} className="text-[var(--text-faint)]" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium truncate">{attachment.title || attachment.url}</div>
          <div className="text-[11px] text-[var(--text-faint)] mt-0.5 truncate">
            {attachment.site_name || hostname}
          </div>
          {attachment.description ? (
            <div className="text-[11px] text-[var(--text-dim)] mt-1 line-clamp-2 leading-snug">
              {attachment.description}
            </div>
          ) : null}
        </div>
      </a>
    );
  }

  if (attachment.type === 'audio') {
    return (
      <div className="text-[12px] text-[var(--text-dim)] border border-[var(--border-soft)] rounded-md px-2 py-1">
        音频 {Math.round(attachment.duration_sec)}s
      </div>
    );
  }

  return null;
}

function PendingChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  if (attachment.kind === 'image') {
    return (
      <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-[var(--border)] flex-shrink-0">
        <img src={attachment.previewUrl} alt="" className="w-full h-full object-cover" />
        {attachment.uploading ? (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 size={14} className="mb-spin text-white" />
          </div>
        ) : null}
        <button
          onClick={onRemove}
          className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 hover:bg-black/90 rounded-full flex items-center justify-center"
        >
          <X size={11} className="text-white" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2 pl-2 pr-8 py-1.5 border border-[var(--border)] rounded-lg max-w-[260px] flex-shrink-0 bg-[var(--bg-elev)]/60">
      {attachment.fetching ? (
        <Loader2 size={12} className="mb-spin text-[var(--text-faint)]" />
      ) : (
        <LinkIcon size={12} className="text-[var(--text-faint)]" />
      )}
      <span className="text-[12px] text-[var(--text-dim)] truncate">
        {attachment.preview?.title || attachment.preview?.site_name || attachment.url}
      </span>
      <button
        onClick={onRemove}
        className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-faint)] hover:text-[var(--text)]"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div>
      {lines.map((line, index) => {
        if (line.startsWith('## ')) {
          return (
            <h2
              key={index}
              className="text-[15px] font-semibold tracking-[0.02em] text-[var(--accent)]"
              style={{ marginTop: index === 0 ? 0 : '20px', marginBottom: '10px' }}
            >
              {line.slice(3)}
            </h2>
          );
        }

        if (line.startsWith('# ')) {
          return (
            <h1 key={index} className="text-[18px] font-semibold mb-3">
              {line.slice(2)}
            </h1>
          );
        }

        if (/^[-*]\s/.test(line)) {
          return (
            <div key={index} className="pl-4 relative mb-1.5 leading-[1.6]">
              <span className="absolute left-0 text-[var(--text-faint)]">•</span>
              {line.replace(/^[-*]\s/, '')}
            </div>
          );
        }

        if (line.trim() === '') return <div key={index} className="h-2" />;

        return (
          <div key={index} className="mb-1.5 leading-[1.65]">
            {line}
          </div>
        );
      })}
    </div>
  );
}
