"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError("That email and password don't match — try again."); setBusy(false); }
    else window.location.href = "/crm";
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5">
      {/* ambient glows */}
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[640px] -translate-x-1/2 rounded-full bg-teal/20 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[360px] w-[480px] rounded-full bg-teal/10 blur-[110px]" />

      <div className="relative w-full max-w-[400px]">
        {/* brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Momentum Landscaping" className="mb-5 h-20 w-auto" />
          <h1 className="font-display text-[26px] font-bold tracking-tight text-[color:var(--ink)]">Momentum Landscaping</h1>
          <p className="mt-1 text-sm text-[color:var(--body)]">Operations · sign in to your workspace</p>
        </div>

        <form onSubmit={handleSubmit} className="mo-card aiv-glow space-y-4 p-6 sm:p-7">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-[color:var(--body)]">Email</span>
            <div className="flex items-center gap-2.5 rounded-2xl border border-[color:var(--border)] bg-white/[0.05] px-4 transition focus-within:border-teal focus-within:bg-white/[0.07] focus-within:shadow-glow">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[color:var(--body)]/60" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/></svg>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="email"
                placeholder="you@momentumlandscapingut.com" spellCheck={false}
                className="h-12 w-full bg-transparent text-[15px] text-[color:var(--ink)] outline-none placeholder:text-[color:var(--body)]/40" />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-[color:var(--body)]">Password</span>
            <div className="flex items-center gap-2.5 rounded-2xl border border-[color:var(--border)] bg-white/[0.05] px-4 transition focus-within:border-teal focus-within:bg-white/[0.07] focus-within:shadow-glow">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[color:var(--body)]/60" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="10" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPw ? "text" : "password"} required autoComplete="current-password"
                placeholder="••••••••"
                className="h-12 w-full bg-transparent text-[15px] text-[color:var(--ink)] outline-none placeholder:text-[color:var(--body)]/40" />
              <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1}
                className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--body)]/60 transition hover:text-teal">{showPw ? "Hide" : "Show"}</button>
            </div>
          </label>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] text-red">
              <span className="mt-0.5">⚠</span>{error}
            </div>
          )}

          <button disabled={busy} className="mo-primary h-12 w-full rounded-2xl text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-60">
            {busy ? (
              <span className="inline-flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Signing in…</span>
            ) : "Sign in"}
          </button>

          <p className="pt-1 text-center text-[12px] text-[color:var(--body)]/60">Trouble signing in? Text Connor.</p>
        </form>

        <p className="mt-7 text-center text-[11px] text-[color:var(--body)]/45">
          © {new Date().getFullYear()} Momentum Landscaping LLC · Salt Lake County
        </p>
      </div>
    </main>
  );
}
