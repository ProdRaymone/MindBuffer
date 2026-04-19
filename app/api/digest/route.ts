import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServer } from '@/lib/supabase-server';
import type { Entry, Attachment } from '@/lib/types';
import { DEFAULT_CATEGORIES } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ============================================================================
// GET: list digests
// ============================================================================
export async function GET(_req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('digests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ digests: data });
}

// ============================================================================
// POST: generate digest for a given period
// Body: { kind?: 'today' | 'all-unprocessed' | 'custom', since?, until? }
// ============================================================================
export async function POST(req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const kind = body.kind || 'today';

  // ---------- Select entries ----------
  let query = supabase
    .from('entries')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  let periodStart: string;
  let periodEnd = new Date().toISOString();

  if (kind === 'today') {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    periodStart = d.toISOString();
    query = query.gte('created_at', periodStart);
  } else if (kind === 'all-unprocessed') {
    periodStart = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    query = query.eq('processed', false).limit(200);
  } else {
    periodStart = body.since || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const since = body.since;
    const until = body.until;
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lte('created_at', until);
  }

  const { data: entries, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: '没有可整理的内容' }, { status: 400 });
  }

  // ---------- Build prompt ----------
  const prompt = buildDigestPrompt(entries as Entry[]);

  // ---------- Call Claude ----------
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || undefined,
    authToken: process.env.ANTHROPIC_AUTH_TOKEN || undefined,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });
  let content = '';
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    });
    content = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  } catch (e: any) {
    return NextResponse.json({ error: `AI 调用失败: ${e.message}` }, { status: 500 });
  }

  // ---------- Save digest + mark entries ----------
  const { data: digest, error: insertErr } = await supabase
    .from('digests')
    .insert({
      user_id: user.id,
      content,
      entry_count: entries.length,
      entry_ids: entries.map((e) => e.id),
      period_start: periodStart,
      period_end: periodEnd,
      kind,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  await supabase
    .from('entries')
    .update({ processed: true, last_digest_id: digest.id })
    .in('id', entries.map((e) => e.id));

  return NextResponse.json({ digest });
}

// ============================================================================
// Prompt
// ============================================================================
function buildDigestPrompt(entries: Entry[]): string {
  const catMap = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.id, c.label]));

  const lines = entries.map((e) => {
    const d = new Date(e.created_at);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const catLabel = catMap[e.category] || e.category;
    const atts = (e.attachments as Attachment[]) || [];
    const attachDesc = atts.length
        ? ` [附件: ${atts.map((a) => {
            if (a.type === 'link') return `链接(${a.title || a.url})`;
            if (a.type === 'image') return '图片';
            if (a.type === 'audio') return `音频(${Math.round((a as any).duration_sec || 0)}s)`;
            return '附件';
          }).join(', ')}]`
        : '';
    const tagStr = e.tags?.length ? ` #${e.tags.join(' #')}` : '';
    return `[${catLabel}] ${time} — ${e.text || '(无文字)'}${attachDesc}${tagStr}`;
  });

  const dateLabel = new Date(entries[0].created_at).toLocaleDateString('zh-CN');

  return `你是 Raymone 的个人 AI 整理助手。以下是他通过灵感中转站记录的原始想法。请整理成一份 Daily Digest。

背景：Raymone 是音乐制作人，主方向是 Travis Scott 风格的 trap 制作，2024 年起向 NewJeans 启发的多流派研究扩展。他的第二大脑在 Notion，有灵感库、待办、音乐宇宙、日记这几个数据库。

原始记录（${dateLabel}，共 ${entries.length} 条）：
${lines.join('\n')}

请按以下结构输出 Markdown：

## 今日主题
(1-2 句话概括今天的主要关注点)

## 💡 可执行想法
(真正有行动价值的，按重要性排序，每条给一个建议的下一步)

## ✅ 待办事项
(标注优先级 [高]/[中]/[低])

## 🎵 音乐相关
(音乐类内容单独提炼——这是他的核心方向)

## 📖 日记/心境摘要
(2-3 句话)

## 🔗 建议迁移到 Notion
(格式: [条目简述] → [建议的 Notion 数据库])

## 🗑️ 建议归档/舍弃
(日常噪音，不需要进一步处理的)

要求：精准、简洁、专业，不要重复原文。没有内容的段落直接省略。`;
}
