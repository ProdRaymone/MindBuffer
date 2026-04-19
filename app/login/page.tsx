'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createBrowser } from '@/lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError(null);

    const supabase = createBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0c0c0d] text-[#e8e6e1] p-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="flex items-center justify-center gap-3 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#e8b85c] shadow-[0_0_8px_#e8b85c]" />
            <h1 className="font-serif text-2xl font-medium tracking-tight">灵感中转站</h1>
          </div>
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#5a5855]">
            MindBuffer
          </div>
          <p className="mt-4 text-sm leading-relaxed text-[#8e8c87]">
            应用现在支持先本地记录。
            <br />
            登录的作用是把内容同步到云端，而不是阻塞你先记下来。
          </p>
        </div>

        {sent ? (
          <div className="border border-[#26262a] rounded-xl p-6 bg-[#141416] text-center">
            <div className="font-serif text-base mb-2">检查你的邮箱</div>
            <div className="text-sm text-[#8e8c87] leading-relaxed">
              登录链接已经发送到 <span className="text-[#e8e6e1]">{email}</span>
              <br />
              点开邮件里的链接后，就能把本地记录同步到账号。
            </div>
            <button
              onClick={() => {
                setSent(false);
                setEmail('');
              }}
              className="mt-4 text-xs text-[#e8b85c] hover:underline"
            >
              换个邮箱
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-[#141416] border border-[#26262a] rounded-lg text-sm outline-none focus:border-[#3a3a3f] transition-colors"
            />
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full py-3 bg-[#e8e6e1] text-[#0c0c0d] rounded-lg text-sm font-medium disabled:opacity-30 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              发送登录链接
            </button>
            {error ? (
              <div className="text-xs text-[#c78b8b] text-center">{error}</div>
            ) : null}
          </form>
        )}

        <div className="mt-10 text-center text-[11px] text-[#5a5855] font-mono tracking-wider">
          LOCAL-FIRST · CLOUD SYNC
        </div>
      </div>
    </div>
  );
}
