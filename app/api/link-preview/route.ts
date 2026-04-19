import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { createServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

// ============================================================================
// POST /api/link-preview
// Body: { url: string }
// Returns: { preview: { url, title?, description?, image?, site_name?, favicon? } }
// ============================================================================
export async function POST(req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { url } = await req.json().catch(() => ({ url: '' }));
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'missing url' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  // Fallback preview (used when fetch/parse fails)
  const fallback = {
    url,
    site_name: parsed.hostname.replace(/^www\./, ''),
    favicon: `${parsed.origin}/favicon.ico`,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timeout);

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) {
      return NextResponse.json({ preview: fallback });
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const pick = (sel: string, attr = 'content') =>
      $(sel).attr(attr)?.trim() || undefined;

    const absolutize = (maybeUrl?: string) => {
      if (!maybeUrl) return undefined;
      try {
        return new URL(maybeUrl, url).href;
      } catch {
        return undefined;
      }
    };

    const preview = {
      url,
      title:
        pick('meta[property="og:title"]') ||
        pick('meta[name="twitter:title"]') ||
        $('title').text().trim() ||
        undefined,
      description:
        pick('meta[property="og:description"]') ||
        pick('meta[name="twitter:description"]') ||
        pick('meta[name="description"]') ||
        undefined,
      image: absolutize(
        pick('meta[property="og:image"]') ||
          pick('meta[property="og:image:url"]') ||
          pick('meta[name="twitter:image"]')
      ),
      site_name:
        pick('meta[property="og:site_name"]') ||
        parsed.hostname.replace(/^www\./, ''),
      favicon:
        absolutize(pick('link[rel="icon"]', 'href')) ||
        absolutize(pick('link[rel="shortcut icon"]', 'href')) ||
        `${parsed.origin}/favicon.ico`,
    };

    return NextResponse.json({ preview });
  } catch {
    return NextResponse.json({ preview: fallback });
  }
}
