/**
 * Sign-in screen. Shown by AuthGate when no Supabase session is active.
 * Magic-link first; Google OAuth as a one-click alternative.
 */
import { useState } from 'react';
import { Zap, Mail, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { signInWithMagicLink, signInWithGoogle } from '../lib/auth';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Magic-link section is hidden by default — pushes everyone toward Google sign-in,
   *  which doesn't go through Supabase's email rate limit. Click "Or sign in with
   *  email" to reveal the input. */
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

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await signInWithGoogle();
      if (!res.ok) setError(res.error ?? 'Google sign-in failed.');
      // On success the page will redirect, so we don't need to clear loading.
    } finally {
      // If we're still here, something didn't redirect — release the spinner.
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
            Use your work email — we'll send a one-click sign-in link.
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
              {/* Primary: Google sign-in. Recommended for everyone on @simpliigence.com — no email rate limit. */}
              <button
                onClick={handleGoogle}
                disabled={loading}
                className="w-full py-3 px-4 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <GoogleIcon />
                Continue with Google
              </button>
              <p className="text-[11px] text-slate-500 text-center mt-2 mb-5">
                Recommended — uses your @simpliigence.com account.
              </p>

              {/* Secondary: magic-link via email. Collapsed by default. */}
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
                    Magic-link email has a low rate limit — use Google sign-in if you hit a wall.
                  </p>
                </div>
              )}

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

/** Simple Google G logo (no extra dep). */
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.7 19 13 24 13c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5c-7.7 0-14.3 4.4-17.7 10.2z" />
      <path fill="#4CAF50" d="M24 43.5c5.5 0 10.4-1.9 14-5l-6.5-5.5c-1.9 1.4-4.4 2.5-7.5 2.5-5.2 0-9.6-3.3-11.2-8L6.4 31.6C9.7 38 16.4 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.4-4.1 5.9.0 0 0 0 0 0l6.5 5.5c-.5.5 7.3-5.3 7.3-15.4 0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}
