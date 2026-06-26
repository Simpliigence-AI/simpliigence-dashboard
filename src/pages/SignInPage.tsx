/**
 * Sign-in screen. Shown by AuthGate when no Supabase session is active.
 *
 * Two options, in order of preference:
 *   1. Microsoft 365 OAuth  ← Simpliigence's identity provider. Use this.
 *   2. Magic link via email ← fallback for the rare case Microsoft SSO is
 *      unavailable (e.g. external partners). Rate-limited (Supabase SMTP).
 */
import { useState } from 'react';
import { Zap, Mail, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { signInWithMagicLink, signInWithMicrosoft } from '../lib/auth';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Magic-link section hides by default — most people use Microsoft SSO. */
  const [showEmail, setShowEmail] = useState(false);

  const handleMagicLink = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await signInWithMagicLink(email);
      if (!res.ok) setError(res.error ?? 'Sign-in failed.');
      else setSent(true);
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoft = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await signInWithMicrosoft();
      if (!res.ok) setError(res.error ?? 'Microsoft sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950 p-6">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-lg">
            <Zap size={24} className="text-white" />
          </div>
          <div>
            <div className="text-white text-xl font-bold tracking-tight">Simpliigence</div>
            <div className="text-slate-400 text-xs uppercase tracking-widest">Operations Cockpit</div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h1 className="text-xl font-bold text-slate-900 mb-1">Sign in to continue</h1>
          <p className="text-sm text-slate-500 mb-6">
            Use your Simpliigence work account.
          </p>

          {sent ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-bold text-emerald-900">Check your inbox</div>
                  <div className="text-xs text-emerald-700 mt-1">
                    We sent a sign-in link to <strong>{email}</strong>. The link expires in 1 hour.
                  </div>
                  <button
                    onClick={() => { setSent(false); setEmail(''); }}
                    className="text-xs text-emerald-700 underline mt-2 hover:text-emerald-900"
                  >
                    Use a different email
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Primary: Microsoft 365 SSO. */}
              <button
                onClick={handleMicrosoft}
                disabled={loading}
                className="w-full py-3 px-4 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <MicrosoftIcon />
                Continue with Microsoft
              </button>
              <p className="text-[11px] text-slate-500 text-center mt-2 mb-4">
                Uses your Simpliigence Microsoft 365 account. This is the standard sign-in.
              </p>

              {/* Fallback: magic-link via email. Collapsed by default. */}
              <div className="mt-3">
                {!showEmail ? (
                  <button
                    type="button"
                    onClick={() => setShowEmail(true)}
                    className="w-full text-xs text-slate-500 hover:text-slate-800 underline-offset-4 hover:underline transition-colors py-2"
                  >
                    Or sign in with email (magic link)
                  </button>
                ) : (
                  <div className="border-t border-slate-200 pt-4">
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                      Work email
                    </label>
                    <div className="relative mb-3">
                      <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && email) handleMagicLink(); }}
                        placeholder="you@simpliigence.com"
                        disabled={loading}
                        autoFocus
                        className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:bg-slate-50"
                      />
                    </div>
                    <button
                      onClick={handleMagicLink}
                      disabled={loading || !email.trim()}
                      className="w-full py-2 px-4 bg-white border border-slate-300 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                      {loading ? 'Sending…' : 'Send magic link'}
                    </button>
                    <p className="text-[10px] text-slate-400 text-center mt-2">
                      Magic-link email has a low rate limit — Microsoft sign-in is preferred.
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
                  <AlertCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-red-700">{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        <p className="text-[11px] text-slate-500 text-center mt-6">
          Access is restricted to authorized Simpliigence team members.
          Contact your admin if you need access.
        </p>
      </div>
    </div>
  );
}

/** Microsoft 4-square logo (no extra dep). */
function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden>
      <rect x="1"  y="1"  width="10" height="10" fill="#F25022" />
      <rect x="12" y="1"  width="10" height="10" fill="#7FBA00" />
      <rect x="1"  y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

