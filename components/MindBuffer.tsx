'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Send, Search, Download, Sparkles, X, Trash2, Edit3, Check, FileText,
  Copy, Loader2, Image as ImageIcon, Link as LinkIcon, Paperclip, LogOut,
  Settings, ChevronDown,
} from 'lucide-react';
import { createBrowser } from '@/lib/supabase';
import { compressImage, extractImagesFromClipboard } from '@/lib/image';
import { triggerHaptic } from '@/lib/native';
import {
  DEFAULT_CATEGORIES,
  mediaTypeOf,
  extractUrls,
  type Entry,
  type Digest,
  type Attachment,
  type ImageAttachment,
  type LinkAttachment,
  type MediaType,
} from '@/lib/types';

// ============================================================================
// Props
// ============================================================================
type Props = {
  initialEntries: Entry[];
  initialDigests: Digest[];
  userEmail: string;
};

// ============================================================================
// Pending attachment (client-side only, before save)
// ============================================================================
type PendingAttachment =
  | { kind: 'image'; tempId: string; file: File; previewUrl: string; uploading: boolean; storagePath?: string; width?: number; height?: number }
  | { kind: 'link';  tempId: string; url: string; fetching: boolean; preview?: LinkAttachment };

const MEDIA_TYPES: { id: MediaType | 'all'; label: string }[] = [
  { id: 'all',   label: '全部' },
  { id: 'text',  label: '文字' },
  { id: 'image', label: '图片' },
  { id: 'link',  label: '链接' },
  { id: 'mixed', label: '混合' },
];

// ============================================================================
// Utils
// ============================================================================
const pad = (n: number) => n.toString().padStart(2, '0');
const fmtTime = (ts: string | number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDay = (ts: string | number) => {
  const d = new Date(ts);
  const now = new Date();
  const today = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = d.toDateString() === y.toDateString();
  if (today) return '今天';
  if (yesterday) return '昨天';
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function groupByDay(entries: Entry[]) {
  const map = new Map<string, { key: string; ts: string; items: Entry[] }>();
  for (const e of entries) {
    const k = new Date(e.created_at).toDateString();
    if (!map.has(k)) map.set(k, { key: k, ts: e.created_at, items: [] });
    map.get(k)!.items.push(e);
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
  );
}

// ============================================================================
// Component
// ============================================================================
export default function MindBuffer({ initialEntries, initialDigests, userEmail }: Props) {
  const supabase = useMemo(() => createBrowser(), []);

  const [entries, setEntries] = useState<Entry[]>(initialEntries);
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  // ---------- Fetch signed URLs for image attachments ----------
  useEffect(() => {
    const needed: string[] = [];
    for (const e of entries) {
      for (const a of (e.attachments || [])) {
        if (a.type === 'image' && a.storage_path && !signedUrls[a.storage_path]) {
          needed.push(a.storage_path);
        }
      }
    }
    if (needed.length === 0) return;

    // Batch fetch
    (async () => {
      try {
        const res = await fetch('/api/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: 'entries-images', paths: needed }),
        });
        const { urls } = await res.json();
        if (urls) setSignedUrls((prev) => ({ ...prev, ...urls }));
      } catch { /* ignore */ }
    })();
  }, [entries, signedUrls]);

  // ---------- Click outside handlers ----------
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

  // ---------- Register service worker ----------
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // ============================================================================
  // CRUD
  // ============================================================================
  const addEntry = async () => {
    const text = input.trim();
    const hasPending = pending.length > 0;
    if (!text && !hasPending) return;

    // Auto-detect URLs in text → link attachments
    const urls = extractUrls(text);
    const linkPromises = urls.map(async (url) => {
      // Skip if already pending as link
      if (pending.some((p) => p.kind === 'link' && p.url === url)) return null;
      try {
        const res = await fetch('/api/link-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const { preview } = await res.json();
        return { type: 'link', ...preview } as LinkAttachment;
      } catch {
        return { type: 'link', url } as LinkAttachment;
      }
    });

    const autoLinks = (await Promise.all(linkPromises)).filter(Boolean) as LinkAttachment[];

    // Build final attachments from pending (wait for uploads)
    const finalAttachments: Attachment[] = [];
    for (const p of pending) {
      if (p.kind === 'image') {
        if (!p.storagePath || p.uploading) {
          showToast('图片仍在上传，请稍候');
          return;
        }
        finalAttachments.push({
          type: 'image',
          storage_path: p.storagePath,
          width: p.width,
          height: p.height,
        });
      } else if (p.kind === 'link') {
        if (p.preview) finalAttachments.push({ ...p.preview, type: 'link' });
        else finalAttachments.push({ type: 'link', url: p.url });
      }
    }
    finalAttachments.push(...autoLinks);

    triggerHaptic('light');

    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text || null,
        category: selectedCategory,
        attachments: finalAttachments,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || '发送失败');
      return;
    }

    const { entry } = await res.json();
    setEntries((prev) => [entry, ...prev]);
    setInput('');
    setPending([]);
    inputRef.current?.focus();
  };

  const deleteEntry = async (id: string) => {
    await fetch(`/api/entries/${id}`, { method: 'DELETE' });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const startEdit = (e: Entry) => {
    setEditingId(e.id);
    setEditText(e.text || '');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const res = await fetch(`/api/entries/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: editText.trim() || null }),
    });
    if (res.ok) {
      const { entry } = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === editingId ? entry : e)));
    }
    setEditingId(null);
    setEditText('');
  };

  // ============================================================================
  // Attachment handling
  // ============================================================================
  const addImagesToPending = async (files: File[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

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
          prev.map((p) =>
            p.kind === 'image' && p.tempId === tempId
              ? { ...p, uploading: false, storagePath, width: compressed.width, height: compressed.height }
              : p
          )
        );
      } catch (e: any) {
        showToast(`上传失败: ${e.message}`);
        setPending((prev) => prev.filter((p) => p.kind === 'image' && p.tempId !== tempId));
      }
    }
  };

  const addLinkToPending = async (url: string) => {
    const tempId = uid();
    setPending((prev) => [...prev, { kind: 'link', tempId, url, fetching: true }]);
    try {
      const res = await fetch('/api/link-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const { preview } = await res.json();
      setPending((prev) =>
        prev.map((p) =>
          p.kind === 'link' && p.tempId === tempId
            ? { ...p, fetching: false, preview: { type: 'link', ...preview } }
            : p
        )
      );
    } catch {
      setPending((prev) =>
        prev.map((p) =>
          p.kind === 'link' && p.tempId === tempId
            ? { ...p, fetching: false, preview: { type: 'link', url } }
            : p
        )
      );
    }
  };

  const removePending = (tempId: string) => {
    setPending((prev) => {
      const removed = prev.find((p) => (p.kind === 'image' ? p.tempId : p.tempId) === tempId);
      if (removed?.kind === 'image') URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((p) => (p.kind === 'image' ? p.tempId : p.tempId) !== tempId);
    });
  };

  // ---------- Paste handler ----------
  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = extractImagesFromClipboard(e.nativeEvent as ClipboardEvent);
    if (files.length > 0) {
      e.preventDefault();
      await addImagesToPending(files);
    }
  };

  // ---------- Drop handler ----------
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) await addImagesToPending(files);
  };

  // ---------- File picker ----------
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) await addImagesToPending(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ============================================================================
  // Filter & Group
  // ============================================================================
  const filteredEntries = useMemo(() => {
    let r = entries;
    if (filterCategory) r = r.filter((e) => e.category === filterCategory);
    if (filterMedia !== 'all') r = r.filter((e) => mediaTypeOf(e) === filterMedia);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      r = r.filter((e) => {
        if (e.text?.toLowerCase().includes(q)) return true;
        for (const a of e.attachments || []) {
          if (a.type === 'link' && (a.title?.toLowerCase().includes(q) || a.url.toLowerCase().includes(q))) return true;
        }
        return false;
      });
    }
    return r;
  }, [entries, filterCategory, filterMedia, searchQuery]);

  const grouped = useMemo(() => groupByDay(filteredEntries), [filteredEntries]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of DEFAULT_CATEGORIES) counts[c.id] = 0;
    for (const e of entries) counts[e.category] = (counts[e.category] || 0) + 1;
    return counts;
  }, [entries]);

  // ============================================================================
  // AI Digest
  // ============================================================================
  const generateDigest = async () => {
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

      // Refresh entries to show processed state
      const entriesRes = await fetch('/api/entries?limit=500');
      const { entries: fresh } = await entriesRes.json();
      if (fresh) setEntries(fresh);
    } finally {
      setIsGenerating(false);
    }
  };

  // ============================================================================
  // Export
  // ============================================================================
  const exportJSON = () => {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), entries, digests }, null, 2);
    downloadFile(data, `mindbuffer-${Date.now()}.json`, 'application/json');
    setShowExport(false);
  };

  const exportMarkdown = () => {
    const groups = groupByDay(entries);
    let md = `# 灵感中转站 · MindBuffer\n\n> 导出时间: ${new Date().toLocaleString('zh-CN')}  \n> 共 ${entries.length} 条记录\n\n---\n\n`;
    for (const g of groups) {
      const d = new Date(g.ts);
      md += `## ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}\n\n`;
      for (const e of g.items) {
        const cat = DEFAULT_CATEGORIES.find((c) => c.id === e.category);
        md += `- \`${fmtTime(e.created_at)}\` **[${cat?.label || ''}]** ${e.text || ''}`;
        for (const a of e.attachments || []) {
          if (a.type === 'link') md += ` [${a.title || a.url}](${a.url})`;
          if (a.type === 'image') md += ` \`[图片]\``;
        }
        md += '\n';
      }
      md += '\n';
    }
    downloadFile(md, `mindbuffer-${Date.now()}.md`, 'text/markdown');
    setShowExport(false);
  };

  const copyNotion = async () => {
    const groups = groupByDay(entries);
    let out = '';
    for (const g of groups) {
      const d = new Date(g.ts);
      out += `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}\n`;
      for (const e of g.items) {
        const cat = DEFAULT_CATEGORIES.find((c) => c.id === e.category);
        out += `• [${cat?.label}] ${fmtTime(e.created_at)} — ${e.text || ''}`;
        for (const a of e.attachments || []) {
          if (a.type === 'link') out += ` (${a.url})`;
        }
        out += '\n';
      }
      out += '\n';
    }
    try {
      await navigator.clipboard.writeText(out);
      showToast('已复制到剪贴板');
    } catch {
      showToast('复制失败');
    }
    setShowExport(false);
  };

  const downloadFile = (text: string, filename: string, mime: string) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---------- Sign out ----------
  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  // ---------- Input key ----------
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addEntry();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      // Short entries use plain Enter to send; composition input (Chinese IME) is respected
      if (input.length < 120 && !input.includes('\n')) {
        e.preventDefault();
        addEntry();
      }
    }
  };

  const selectedCat = DEFAULT_CATEGORIES.find((c) => c.id === selectedCategory)!;

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <div
      className="relative w-full h-[100dvh] flex flex-col bg-[var(--bg)] text-[var(--text)] mb-noise overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* ---------- Header ---------- */}
      <div className="relative z-10 flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-[var(--border-soft)] mb-safe-top">
        <div className="flex items-center gap-2.5 font-serif text-[17px] font-medium tracking-tight">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
          <span>灵感中转站</span>
          <span className="hidden md:inline font-mono text-[10px] tracking-[0.08em] uppercase text-[var(--text-faint)] ml-1">
            MindBuffer
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IconBtn active={showSearch} onClick={() => { setShowSearch((v) => !v); if (showSearch) setSearchQuery(''); }} title="搜索">
            <Search size={15} />
          </IconBtn>
          <IconBtn onClick={() => setShowDigestList(true)} title="Digest 历史">
            <FileText size={15} />
          </IconBtn>
          <IconBtn onClick={generateDigest} disabled={isGenerating} title="AI 整理" style={{ color: isGenerating ? undefined : 'var(--accent)' }}>
            {isGenerating ? <Loader2 size={15} className="mb-spin" /> : <Sparkles size={15} />}
          </IconBtn>
          <IconBtn onClick={() => setShowExport((v) => !v)} title="导出">
            <Download size={15} />
          </IconBtn>
          <IconBtn onClick={() => setShowMenu((v) => !v)} title="菜单">
            <Settings size={15} />
          </IconBtn>
        </div>
      </div>

      {/* Export dropdown */}
      {showExport && (
        <div
          ref={exportMenuRef}
          className="absolute right-4 top-[52px] z-50 bg-[var(--bg-elev)] border border-[var(--border)] rounded-lg p-1 min-w-[200px] shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
        >
          <MenuItem onClick={copyNotion}><Copy size={13} /> 复制为 Notion 格式</MenuItem>
          <MenuItem onClick={exportMarkdown}><FileText size={13} /> 下载 Markdown</MenuItem>
          <MenuItem onClick={exportJSON}><Download size={13} /> 下载 JSON（完整数据）</MenuItem>
        </div>
      )}

      {/* User menu */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute right-4 top-[52px] z-50 bg-[var(--bg-elev)] border border-[var(--border)] rounded-lg p-1 min-w-[220px] shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
        >
          <div className="px-3 py-2 text-[11px] text-[var(--text-faint)] font-mono tracking-wider border-b border-[var(--border-soft)] mb-1">
            {userEmail}
          </div>
          <MenuItem onClick={signOut}><LogOut size={13} /> 登出</MenuItem>
        </div>
      )}

      {/* ---------- Search ---------- */}
      {showSearch && (
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
      )}

      {/* ---------- Filter bar ---------- */}
      <div className="relative z-10 flex items-center gap-4 px-4 md:px-5 py-2.5 border-b border-[var(--border-soft)] overflow-x-auto mb-hide-scroll flex-shrink-0">
        {/* Category row */}
        <div className="flex items-center gap-1.5">
          <Chip active={filterCategory === null} onClick={() => setFilterCategory(null)}>
            全部 <span className="ml-0.5 font-mono text-[10px] text-[var(--text-faint)]">{entries.length}</span>
          </Chip>
          {DEFAULT_CATEGORIES.map((c) => (
            <Chip
              key={c.id}
              active={filterCategory === c.id}
              onClick={() => setFilterCategory(filterCategory === c.id ? null : c.id)}
            >
              <span className="text-[13px]" style={{ color: c.color }}>{c.symbol}</span>
              {c.label}
              {categoryCounts[c.id] > 0 && (
                <span className="ml-0.5 font-mono text-[10px] text-[var(--text-faint)]">{categoryCounts[c.id]}</span>
              )}
            </Chip>
          ))}
        </div>
        {/* Divider */}
        <div className="h-4 w-px bg-[var(--border)] flex-shrink-0" />
        {/* Media row */}
        <div className="flex items-center gap-1.5">
          {MEDIA_TYPES.map((m) => (
            <Chip
              key={m.id}
              active={filterMedia === m.id}
              onClick={() => setFilterMedia(m.id)}
              size="sm"
            >
              {m.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* ---------- Feed ---------- */}
      <div className="relative z-10 flex-1 overflow-y-auto mb-scroll px-4 md:px-5 pt-4 pb-5">
        {grouped.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-faint)]">
            <div className="font-serif italic text-[15px] text-[var(--text-dim)] mb-2">
              {entries.length === 0 ? '空空如也。' : '没有匹配的条目。'}
            </div>
            <div className="text-[13px] leading-relaxed">
              {entries.length === 0
                ? '把脑海里一闪而过的东西丢进来。'
                : '试试换个分类或搜索词。'}
            </div>
          </div>
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
                  onCancelEdit={() => { setEditingId(null); setEditText(''); }}
                  onDelete={() => deleteEntry(entry.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* ---------- Composer ---------- */}
      <div className="relative z-10 border-t border-[var(--border-soft)] bg-[var(--bg)] flex-shrink-0 mb-safe-bottom">
        {/* Pending attachments */}
        {pending.length > 0 && (
          <div className="flex gap-2 px-4 md:px-5 pt-3 overflow-x-auto mb-hide-scroll">
            {pending.map((p) => (
              <PendingChip key={p.tempId} p={p} onRemove={() => removePending(p.tempId)} />
            ))}
          </div>
        )}

        {/* Category chips */}
        <div className="flex gap-1.5 px-4 md:px-5 pt-2.5 overflow-x-auto mb-hide-scroll">
          {DEFAULT_CATEGORIES.map((c) => {
            const active = selectedCategory === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedCategory(c.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] whitespace-nowrap transition-all ${
                  active
                    ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                    : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                <span className="text-[12px]" style={{ color: active ? undefined : c.color }}>
                  {c.symbol}
                </span>
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Input row */}
        <div className="p-2.5 md:p-3 pt-2">
          <div className="flex items-end gap-2 bg-[var(--bg-elev)] border border-[var(--border)] rounded-xl px-3.5 py-2 focus-within:border-[#3a3a3f] transition-colors">
            <span className="text-[15px] pb-1" style={{ color: selectedCat.color }}>
              {selectedCat.symbol}
            </span>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              onPaste={handlePaste}
              placeholder={`输入${selectedCat.label}... (⌘↵ 发送, 粘贴图片自动上传)`}
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-[14px] leading-[1.55] py-1 min-h-[22px] max-h-[160px] placeholder:text-[var(--text-faint)]"
              style={{ height: `${Math.min(160, Math.max(22, input.split('\n').length * 22 + 4))}px` }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-8 h-8 rounded-lg text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--bg-elev-2)] flex items-center justify-center transition-colors"
              title="附加图片"
            >
              <ImageIcon size={14} />
            </button>
            <button
              onClick={async () => {
                const url = prompt('粘贴链接 URL:');
                if (url?.trim()) await addLinkToPending(url.trim());
              }}
              className="w-8 h-8 rounded-lg text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--bg-elev-2)] flex items-center justify-center transition-colors"
              title="附加链接"
            >
              <Paperclip size={14} />
            </button>
            <button
              onClick={addEntry}
              disabled={!input.trim() && pending.length === 0}
              className="w-8 h-8 rounded-lg bg-[var(--text)] text-[var(--bg)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center hover:opacity-90 transition-opacity"
            >
              <Send size={13} />
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

      {/* ---------- Digest modal ---------- */}
      {digestView && (
        <ModalBackdrop onClose={() => setDigestView(null)}>
          <ModalHeader title={`Daily Digest · ${new Date(digestView.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}${digestView.entry_count ? ` · ${digestView.entry_count} 条` : ''}`} onClose={() => setDigestView(null)} />
          <div className="overflow-y-auto mb-scroll flex-1 px-5 py-4 text-[13.5px] leading-[1.65]">
            <RenderMarkdown text={digestView.content} />
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-soft)]">
            <Btn onClick={async () => {
              try { await navigator.clipboard.writeText(digestView.content); showToast('已复制 Digest'); }
              catch { showToast('复制失败'); }
            }}>
              <Copy size={12} /> 复制
            </Btn>
            <Btn onClick={() => downloadFile(digestView.content, `digest-${new Date(digestView.created_at).toISOString().slice(0, 10)}.md`, 'text/markdown')}>
              <Download size={12} /> 下载
            </Btn>
            <Btn primary onClick={() => setDigestView(null)}>完成</Btn>
          </div>
        </ModalBackdrop>
      )}

      {/* ---------- Digest history ---------- */}
      {showDigestList && (
        <ModalBackdrop onClose={() => setShowDigestList(false)}>
          <ModalHeader title="Digest 历史" onClose={() => setShowDigestList(false)} />
          <div className="overflow-y-auto mb-scroll flex-1 px-5 py-4">
            {digests.length === 0 ? (
              <div className="text-center py-10 text-[var(--text-faint)]">
                <div className="font-serif italic text-[14px] text-[var(--text-dim)] mb-1.5">还没有 Digest。</div>
                <div className="text-[12.5px]">点右上角 ✨ 让 AI 整理今天的内容。</div>
              </div>
            ) : (
              digests.map((d) => (
                <div
                  key={d.id}
                  onClick={() => { setDigestView(d); setShowDigestList(false); }}
                  className="px-3 py-2.5 border border-[var(--border-soft)] rounded-lg mb-1.5 cursor-pointer hover:border-[var(--border)] hover:bg-[var(--bg-elev-2)] transition-all"
                >
                  <div className="font-mono text-[11px] text-[var(--text-faint)]">
                    {new Date(d.created_at).toLocaleString('zh-CN')} · {d.entry_count} 条 · {d.kind}
                  </div>
                  <div className="text-[12px] text-[var(--text-dim)] mt-1 truncate">
                    {d.content.replace(/[#*`]/g, '').slice(0, 80)}...
                  </div>
                </div>
              ))
            )}
          </div>
        </ModalBackdrop>
      )}

      {/* ---------- Toast ---------- */}
      {toast && (
        <div className="mb-toast fixed bottom-28 left-1/2 -translate-x-1/2 bg-[var(--text)] text-[var(--bg)] px-3.5 py-1.5 rounded-full text-[12px] z-[200]">
          {toast}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================
function IconBtn({ children, active, onClick, disabled, title, style }: { children: React.ReactNode; active?: boolean; onClick?: () => void; disabled?: boolean; title?: string; style?: React.CSSProperties }) {
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

function Chip({ children, active, onClick, size = 'md' }: { children: React.ReactNode; active?: boolean; onClick?: () => void; size?: 'sm' | 'md' }) {
  const pad = size === 'sm' ? 'px-2.5 py-[3px] text-[11px]' : 'px-3 py-[5px] text-[12px]';
  return (
    <button
      onClick={onClick}
      className={`${pad} rounded-full border flex items-center gap-1.5 whitespace-nowrap transition-all ${
        active
          ? 'bg-[var(--bg-elev)] text-[var(--text)] border-[#4a4a50]'
          : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[#3a3a3f]'
      }`}
    >
      {children}
    </button>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2 rounded text-[13px] cursor-pointer hover:bg-[var(--bg-elev-2)] transition-colors ${danger ? 'text-[var(--danger)]' : 'text-[var(--text)]'}`}
    >
      {children}
    </div>
  );
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick?: () => void; primary?: boolean }) {
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

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
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
      <IconBtn onClick={onClose}><X size={15} /></IconBtn>
    </div>
  );
}

// ---------- Entry row with attachments ----------
function EntryRow({
  entry, signedUrls, isEditing, editText, onEditTextChange, onStartEdit, onSaveEdit, onCancelEdit, onDelete,
}: {
  entry: Entry;
  signedUrls: Record<string, string>;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (v: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const cat = DEFAULT_CATEGORIES.find((c) => c.id === entry.category);
  return (
    <div className="group flex gap-3 py-1.5 pl-0.5 pr-1 items-start rounded transition-colors hover:bg-white/[0.015]">
      <div className="flex items-center gap-2.5 pt-0.5 flex-shrink-0">
        <span className="text-[15px] leading-none w-3.5 text-center" style={{ color: cat?.color }}>
          {cat?.symbol}
        </span>
        <span className="font-mono text-[11px] text-[var(--text-faint)] min-w-[38px]">
          {fmtTime(entry.created_at)}
        </span>
      </div>

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
            <MiniBtn onClick={onSaveEdit}><Check size={13} /></MiniBtn>
            <MiniBtn onClick={onCancelEdit}><X size={13} /></MiniBtn>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            {entry.text && (
              <div className="text-[14px] leading-[1.6] whitespace-pre-wrap break-words">
                {entry.text}
              </div>
            )}
            {(entry.attachments?.length || 0) > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {entry.attachments.map((a, i) => (
                  <AttachmentView key={i} attachment={a} signedUrls={signedUrls} />
                ))}
              </div>
            )}
          </div>
          <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 self-center transition-opacity">
            <MiniBtn onClick={onStartEdit}><Edit3 size={12} /></MiniBtn>
            <MiniBtn onClick={onDelete} danger><Trash2 size={12} /></MiniBtn>
          </div>
        </>
      )}
    </div>
  );
}

function MiniBtn({ children, onClick, danger }: { children: React.ReactNode; onClick?: () => void; danger?: boolean }) {
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

// ---------- Attachment renderer ----------
function AttachmentView({ attachment, signedUrls }: { attachment: Attachment; signedUrls: Record<string, string> }) {
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
            {attachment.site_name || new URL(attachment.url).hostname}
          </div>
          {attachment.description && (
            <div className="text-[11px] text-[var(--text-dim)] mt-1 line-clamp-2 leading-snug">
              {attachment.description}
            </div>
          )}
        </div>
      </a>
    );
  }

  if (attachment.type === 'audio') {
    return (
      <div className="text-[12px] text-[var(--text-dim)] border border-[var(--border-soft)] rounded-md px-2 py-1">
        🎤 {Math.round(attachment.duration_sec)}s
      </div>
    );
  }

  return null;
}

// ---------- Pending attachment chip ----------
function PendingChip({ p, onRemove }: { p: PendingAttachment; onRemove: () => void }) {
  if (p.kind === 'image') {
    return (
      <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-[var(--border)] flex-shrink-0">
        <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
        {p.uploading && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 size={14} className="mb-spin text-white" />
          </div>
        )}
        <button
          onClick={onRemove}
          className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 hover:bg-black/90 rounded-full flex items-center justify-center"
        >
          <X size={11} className="text-white" />
        </button>
      </div>
    );
  }
  // link
  return (
    <div className="relative flex items-center gap-2 pl-2 pr-8 py-1.5 border border-[var(--border)] rounded-lg max-w-[260px] flex-shrink-0 bg-[var(--bg-elev)]/60">
      {p.fetching ? (
        <Loader2 size={12} className="mb-spin text-[var(--text-faint)]" />
      ) : (
        <LinkIcon size={12} className="text-[var(--text-faint)]" />
      )}
      <span className="text-[12px] text-[var(--text-dim)] truncate">
        {p.preview?.title || p.preview?.site_name || p.url}
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

// ---------- Minimal markdown renderer ----------
function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div>
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <h2
              key={i}
              className="text-[15px] font-semibold tracking-[0.02em] text-[var(--accent)]"
              style={{ marginTop: i === 0 ? 0 : '20px', marginBottom: '10px' }}
            >
              {line.slice(3)}
            </h2>
          );
        }
        if (line.startsWith('# ')) {
          return <h1 key={i} className="text-[18px] font-semibold mb-3">{line.slice(2)}</h1>;
        }
        if (line.match(/^[-*]\s/)) {
          return (
            <div key={i} className="pl-4 relative mb-1.5 leading-[1.6]">
              <span className="absolute left-0 text-[var(--text-faint)]">·</span>
              {line.replace(/^[-*]\s/, '')}
            </div>
          );
        }
        if (line.trim() === '') return <div key={i} className="h-2" />;
        return <div key={i} className="mb-1.5 leading-[1.65]">{line}</div>;
      })}
    </div>
  );
}
