/**
 * Sign-in screen. Shown by AuthGate when no Supabase session is active.
 *
 * Microsoft 365 SSO is the only sign-in path. The magic-link fallback was
 * retired after Supabase's built-in SMTP rate-limit (~3 emails/hour)
 * repeatedly blocked users mid-timesheet-entry. Every authorized team
 * member has an @simpliigence.com Microsoft account, so there is no
 * legitimate reason to hit any other path.
 */
import { useState, useEffect } from 'react';
import { Zap, AlertCircle, Loader2 } from 'lucide-react';
import { signInWithMicrosoft } from '../lib/auth';

export default function SignInPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* If the user just came back from an OAuth round-trip and Supabase couldn't
   * establish a session, the callback URL (or its hash fragment) carries the
   * reason. Surface it so we don't quietly loop back to this page. Also logs
   * to the console so we can debug from a shared screenshot. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const errParam = params.get('error') || hash.get('error');
    const errDesc = params.get('error_description') || hash.get('error_description');
    if (errParam) {
      const msg = errDesc || errParam;
      console.warn('[auth] OAuth callback returned an error:', { error: errParam, description: errDesc });
      setError(`Microsoft sign-in failed: ${msg}. Try again, or contact your admin if this keeps happening.`);
      // Clean the URL so a refresh doesn't keep firing the same error.
      const clean = window.location.origin + window.location.pathname;
      window.history.replaceState({}, '', clean);
    }
  }, []);

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
            Use your Simpliigence Microsoft 365 account.
          </p>

          <button
            onClick={handleMicrosoft}
            disabled={loading}
            className="w-full py-3 px-4 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <MicrosoftIcon />}
            {loading ? 'Redirecting to Microsoft…' : 'Continue with Microsoft'}
          </button>
          <p className="text-[11px] text-slate-500 text-center mt-3">
            Sign-in is Microsoft 365 only. If your account isn't authorized, contact your admin.
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
              <span className="text-xs text-red-700">{error}</span>
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-500 text-center mt-6">
          Access is restricted to authorized Simpliigence team members.
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
