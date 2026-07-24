/**
 * Dialer — browser softphone for human outbound calls.
 *
 * Flow:
 *  1. On mount we mint a Twilio Voice access token (twilio-token edge fn)
 *     and register a Device. If Twilio secrets aren't configured yet the
 *     page stays usable but shows a setup banner.
 *  2. Type a number (or search Salesforce / ZoomInfo via
 *     dialer-contact-search) and hit Call. We insert a dialer_calls row,
 *     then Device.connect() — the twilio-voice TwiML app bridges us to
 *     the PSTN number and records the call dual-channel.
 *  3. Twilio webhooks (twilio-status / twilio-recording) drive the row
 *     through ringing → in-progress → completed, then attach recording,
 *     Deepgram transcript and Claude AI notes. A realtime subscription
 *     streams those updates into the history list live.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Device, Call } from '@twilio/voice-sdk';
import { nanoid } from 'nanoid';
import {
  Phone, PhoneOff, Mic, MicOff, Delete, Search, Loader2,
  User, ChevronDown, ChevronUp, Play, FileText, Sparkles, AlertTriangle,
  Clock, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge, Button, EmptyState } from '../components/ui';
import { supabase } from '../lib/supabase';
import type {
  DialerCallRow, DialerContact, ContactSearchResponse, TwilioTokenResponse, DialerAiNotes,
} from '../types/dialer';

/* ─────────────────────── helpers ─────────────────────── */

type CountryCode = '+1' | '+91';

/** Best-effort E.164 normalization with a selected default country. */
function toE164(raw: string, cc: CountryCode): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 7 ? `+${digits}` : null;
  if (cc === '+1') {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }
  if (cc === '+91') {
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  }
  return digits.length >= 7 ? `${cc}${digits}` : null;
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

const STATUS_BADGE: Record<string, { variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: string }> = {
  'queued': { variant: 'neutral', label: 'Queued' },
  'ringing': { variant: 'info', label: 'Ringing' },
  'in-progress': { variant: 'success', label: 'In progress' },
  'completed': { variant: 'default', label: 'Completed' },
  'no-answer': { variant: 'warning', label: 'No answer' },
  'busy': { variant: 'warning', label: 'Busy' },
  'failed': { variant: 'danger', label: 'Failed' },
  'canceled': { variant: 'neutral', label: 'Canceled' },
};

const SENTIMENT_BADGE: Record<string, { variant: 'success' | 'warning' | 'neutral'; label: string }> = {
  positive: { variant: 'success', label: 'Positive' },
  neutral: { variant: 'neutral', label: 'Neutral' },
  negative: { variant: 'warning', label: 'Negative' },
};

const KEYPAD: Array<{ digit: string; letters: string }> = [
  { digit: '1', letters: '' }, { digit: '2', letters: 'ABC' }, { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' }, { digit: '5', letters: 'JKL' }, { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' }, { digit: '8', letters: 'TUV' }, { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' }, { digit: '0', letters: '+' }, { digit: '#', letters: '' },
];

type SoftphoneState = 'init' | 'unconfigured' | 'ready' | 'connecting' | 'ringing' | 'in-call' | 'error';

/* ─────────────────────── AI notes block ─────────────────────── */

function AiNotesView({ notes }: { notes: DialerAiNotes }) {
  const sentiment = notes.sentiment ? SENTIMENT_BADGE[notes.sentiment] : null;
  const listBlock = (title: string, items?: string[]) =>
    items && items.length > 0 ? (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">{title}</p>
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="text-sm text-slate-700 flex gap-2">
              <span className="text-slate-300 mt-0.5">•</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        {notes.summary && <p className="text-sm text-slate-700 leading-relaxed">{notes.summary}</p>}
        {sentiment && <Badge variant={sentiment.variant}>{sentiment.label}</Badge>}
      </div>
      {listBlock('Key points', notes.key_points)}
      {listBlock('Action items', notes.action_items)}
      {listBlock('Objections', notes.objections)}
      {listBlock('Opportunity signals', notes.opportunity_signals)}
      {(notes.next_steps || notes.follow_up_recommended) && (
        <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
          {notes.next_steps && <p><span className="font-semibold">Next steps:</span> {notes.next_steps}</p>}
          {notes.follow_up_recommended && (
            <p className="mt-0.5"><span className="font-semibold">Follow up:</span> {notes.follow_up_recommended}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── history row ─────────────────────── */

function CallHistoryRow({ call }: { call: DialerCallRow }) {
  const [expanded, setExpanded] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [manualNotes, setManualNotes] = useState(call.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);

  const badge = STATUS_BADGE[call.status] || STATUS_BADGE.queued;

  const loadAudio = useCallback(async () => {
    if (audioUrl || !call.recording_path) return;
    setAudioLoading(true);
    const { data } = await supabase.storage.from('call-recordings').createSignedUrl(call.recording_path, 3600);
    setAudioUrl(data?.signedUrl || null);
    setAudioLoading(false);
  }, [audioUrl, call.recording_path]);

  const saveNotes = async () => {
    setSavingNotes(true);
    await supabase.from('dialer_calls').update({
      notes: manualNotes || null,
      updated_at: new Date().toISOString(),
      updated_by: 'dialer-ui',
    }).eq('id', call.id);
    setSavingNotes(false);
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          call.status === 'in-progress' ? 'bg-emerald-100 text-emerald-600'
          : call.status === 'completed' ? 'bg-slate-100 text-slate-500'
          : ['failed', 'busy', 'no-answer'].includes(call.status) ? 'bg-red-50 text-red-500'
          : 'bg-blue-50 text-blue-500'
        }`}>
          <Phone size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 truncate">
            {call.to_name || call.to_phone}
            {call.to_company && <span className="font-normal text-slate-500"> · {call.to_company}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {call.to_name ? `${call.to_phone} · ` : ''}{timeAgo(call.created_at)}
            {call.duration_sec != null && ` · ${fmtDuration(call.duration_sec)}`}
            {call.placed_by && ` · ${call.placed_by.split('@')[0]}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {call.ai_status === 'done' && <Sparkles size={14} className="text-violet-500" />}
          {(call.ai_status === 'transcribing' || call.ai_status === 'analyzing') && (
            <Loader2 size={14} className="text-violet-400 animate-spin" />
          )}
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-4">
          {call.error_msg && (
            <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5 flex items-center gap-1.5">
              <AlertTriangle size={12} /> {call.error_msg}
            </p>
          )}

          {/* Recording */}
          {call.recording_path && (
            <div>
              {audioUrl ? (
                <audio controls src={audioUrl} className="w-full h-9" preload="none" />
              ) : (
                <Button variant="secondary" size="sm" onClick={loadAudio} disabled={audioLoading}>
                  {audioLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  Load recording
                </Button>
              )}
            </div>
          )}

          {/* AI notes */}
          {call.ai_status === 'done' && call.ai_notes ? (
            <div className="bg-violet-50/60 border border-violet-100 rounded-lg p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-violet-500 mb-2 flex items-center gap-1.5">
                <Sparkles size={12} /> AI call notes
              </p>
              <AiNotesView notes={call.ai_notes} />
            </div>
          ) : call.ai_status === 'transcribing' || call.ai_status === 'analyzing' ? (
            <p className="text-xs text-violet-500 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              AI is {call.ai_status === 'transcribing' ? 'transcribing the recording' : 'writing call notes'}…
            </p>
          ) : call.ai_status === 'failed' ? (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <AlertTriangle size={12} /> AI analysis failed for this call.
            </p>
          ) : null}

          {/* Transcript */}
          {call.transcript && (
            <div>
              <button
                className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1"
                onClick={() => setShowTranscript((s) => !s)}
              >
                <FileText size={12} /> {showTranscript ? 'Hide transcript' : 'Show transcript'}
              </button>
              {showTranscript && (
                <pre className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap max-h-64 overflow-y-auto font-sans">
                  {call.transcript}
                </pre>
              )}
            </div>
          )}

          {/* Manual notes */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">My notes</p>
            <textarea
              className="w-full text-sm border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y min-h-[60px]"
              placeholder="Type your own notes about this call…"
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
            />
            {manualNotes !== (call.notes || '') && (
              <Button size="sm" variant="secondary" className="mt-1.5" onClick={saveNotes} disabled={savingNotes}>
                {savingNotes ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Save notes
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── page ─────────────────────── */

export default function DialerPage() {
  // Softphone
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [phoneState, setPhoneState] = useState<SoftphoneState>('init');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  // Dial input
  const [rawNumber, setRawNumber] = useState('');
  const [country, setCountry] = useState<CountryCode>('+1');
  const [selectedContact, setSelectedContact] = useState<DialerContact | null>(null);

  // Contact search
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DialerContact[]>([]);
  const [searchMeta, setSearchMeta] = useState<ContactSearchResponse | null>(null);

  // History
  const [calls, setCalls] = useState<DialerCallRow[]>([]);
  const [userEmail, setUserEmail] = useState<string>('');

  const e164 = useMemo(() => toE164(rawNumber, country), [rawNumber, country]);
  const inCall = phoneState === 'connecting' || phoneState === 'ringing' || phoneState === 'in-call';

  /* ── device init ── */
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setUserEmail(data?.user?.email || '');

      const { data: tok, error } = await supabase.functions.invoke<TwilioTokenResponse>('twilio-token', { body: {} });
      if (cancelled) return;
      if (error || !tok?.ok || !tok.token) {
        setPhoneState('unconfigured');
        setSetupError(tok?.error || error?.message || 'Could not fetch Twilio token');
        return;
      }
      try {
        const device = new Device(tok.token, {
          logLevel: 'error',
          codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        });
        device.on('tokenWillExpire', async () => {
          const { data: t2 } = await supabase.functions.invoke<TwilioTokenResponse>('twilio-token', { body: {} });
          if (t2?.token) device.updateToken(t2.token);
        });
        device.on('error', (e: { message?: string }) => {
          console.error('[dialer] device error', e);
          setSetupError(e?.message || 'Twilio device error');
        });
        deviceRef.current = device;
        setPhoneState('ready');
      } catch (e) {
        setPhoneState('error');
        setSetupError((e as Error).message);
      }
    }
    init();

    return () => {
      cancelled = true;
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
    };
  }, []);

  /* ── call timer ── */
  useEffect(() => {
    if (phoneState !== 'in-call') return;
    setCallSeconds(0);
    const t = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phoneState]);

  /* ── history load + realtime ── */
  useEffect(() => {
    let mounted = true;
    supabase.from('dialer_calls')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { if (mounted && data) setCalls(data as DialerCallRow[]); });

    const channel = supabase.channel('dialer-calls-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dialer_calls' }, (payload) => {
        setCalls((prev) => {
          const row = payload.new as DialerCallRow;
          if (!row?.id) return prev;
          const idx = prev.findIndex((c) => c.id === row.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = row;
            return next;
          }
          return [row, ...prev].slice(0, 50);
        });
      })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(channel); };
  }, []);

  /* ── contact search (debounced) ── */
  useEffect(() => {
    if (search.trim().length < 2) { setSearchResults([]); setSearchMeta(null); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase.functions.invoke<ContactSearchResponse>('dialer-contact-search', {
        body: { query: search.trim(), limit: 8 },
      });
      setSearching(false);
      if (data?.ok) { setSearchResults(data.results); setSearchMeta(data); }
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  /* ── place / end call ── */
  const placeCall = async () => {
    const device = deviceRef.current;
    if (!device || !e164 || inCall) return;

    const callId = nanoid();
    setActiveCallId(callId);
    setPhoneState('connecting');
    setMuted(false);

    await supabase.from('dialer_calls').insert({
      id: callId,
      to_phone: e164,
      to_name: selectedContact?.name || null,
      to_title: selectedContact?.title || null,
      to_company: selectedContact?.company || null,
      contact_source: selectedContact ? selectedContact.source : 'manual',
      contact_id: selectedContact?.id || null,
      placed_by: userEmail || null,
      status: 'queued',
      updated_by: 'dialer-ui',
    });

    try {
      const call = await device.connect({ params: { To: e164, callId } });
      callRef.current = call;
      call.on('ringing', () => setPhoneState('ringing'));
      call.on('accept', () => setPhoneState('in-call'));
      const done = () => {
        callRef.current = null;
        setPhoneState('ready');
        setMuted(false);
        setActiveCallId(null);
      };
      call.on('disconnect', done);
      call.on('cancel', done);
      call.on('reject', done);
      call.on('error', (e: { message?: string }) => {
        console.error('[dialer] call error', e);
        done();
      });
    } catch (e) {
      console.error('[dialer] connect failed', e);
      setPhoneState('ready');
      setActiveCallId(null);
      await supabase.from('dialer_calls').update({
        status: 'failed',
        error_msg: (e as Error).message?.slice(0, 300) || 'connect failed (mic permission?)',
        updated_by: 'dialer-ui',
      }).eq('id', callId);
    }
  };

  const hangUp = () => callRef.current?.disconnect();

  const toggleMute = () => {
    const call = callRef.current;
    if (!call) return;
    call.mute(!muted);
    setMuted(!muted);
  };

  const pressKey = (digit: string) => {
    if (phoneState === 'in-call' && callRef.current) {
      callRef.current.sendDigits(digit);
    } else {
      setRawNumber((n) => n + digit);
      setSelectedContact(null);
    }
  };

  const pickContact = (c: DialerContact) => {
    const num = c.mobile || c.phone;
    if (num) {
      setRawNumber(num);
      setSelectedContact(c);
      setSearch('');
      setSearchResults([]);
    }
  };

  const statusLine =
    phoneState === 'connecting' ? 'Connecting…'
    : phoneState === 'ringing' ? 'Ringing…'
    : phoneState === 'in-call' ? fmtDuration(callSeconds)
    : phoneState === 'ready' ? 'Ready'
    : phoneState === 'init' ? 'Starting softphone…'
    : 'Not configured';

  const activeRow = activeCallId ? calls.find((c) => c.id === activeCallId) : null;

  return (
    <div>
      <PageHeader
        title="Dialer"
        subtitle="Call contacts from Salesforce / ZoomInfo or dial any number — calls are recorded, transcribed and summarized by AI."
      />

      {(phoneState === 'unconfigured' || phoneState === 'error') && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">Softphone not ready</p>
            <p className="mt-0.5">{setupError}</p>
            <p className="mt-1 text-amber-700/80">
              Twilio secrets need to be configured — see <code className="font-mono text-xs bg-amber-100 px-1 rounded">DIALER_SETUP.md</code> in the repo.
              Contact search and call history still work.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">
        {/* ── left column: dial pad + search ── */}
        <div className="space-y-6">
          <Card>
            {/* status + number display */}
            <div className="text-center mb-4">
              <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider mb-3">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  phoneState === 'ready' ? 'bg-emerald-500'
                  : inCall ? 'bg-emerald-500 animate-pulse'
                  : phoneState === 'init' ? 'bg-slate-300'
                  : 'bg-amber-400'
                }`} />
                <span className={inCall ? 'text-emerald-600' : 'text-slate-400'}>{statusLine}</span>
              </div>

              {selectedContact && (
                <p className="text-sm font-semibold text-slate-700 mb-1">
                  {selectedContact.name}
                  {selectedContact.company && <span className="font-normal text-slate-500"> · {selectedContact.company}</span>}
                </p>
              )}

              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-slate-200 overflow-hidden flex-shrink-0">
                  {(['+1', '+91'] as CountryCode[]).map((cc) => (
                    <button
                      key={cc}
                      className={`px-2.5 py-2 text-xs font-bold transition-colors ${
                        country === cc ? 'bg-primary text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                      onClick={() => setCountry(cc)}
                      disabled={inCall}
                    >
                      {cc}
                    </button>
                  ))}
                </div>
                <input
                  className="flex-1 text-xl font-semibold text-slate-800 tracking-wide text-center border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:ring-2 focus:ring-primary/40 tabular-nums min-w-0"
                  placeholder="(555) 123-4567"
                  value={rawNumber}
                  onChange={(e) => { setRawNumber(e.target.value); setSelectedContact(null); }}
                  disabled={inCall}
                  inputMode="tel"
                />
                <button
                  className="p-2 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                  onClick={() => { setRawNumber((n) => n.slice(0, -1)); setSelectedContact(null); }}
                  disabled={inCall || !rawNumber}
                  title="Backspace"
                >
                  <Delete size={18} />
                </button>
              </div>
              {rawNumber && !inCall && (
                <p className={`text-xs mt-1.5 ${e164 ? 'text-slate-400' : 'text-red-500'}`}>
                  {e164 ? `Will dial ${e164}` : 'Not a valid number yet'}
                </p>
              )}
            </div>

            {/* keypad */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {KEYPAD.map((k) => (
                <button
                  key={k.digit}
                  className="h-12 rounded-lg bg-slate-50 hover:bg-slate-100 active:bg-slate-200 transition-colors flex flex-col items-center justify-center"
                  onClick={() => pressKey(k.digit)}
                >
                  <span className="text-lg font-semibold text-slate-800 leading-none">{k.digit}</span>
                  {k.letters && <span className="text-[9px] text-slate-400 tracking-widest mt-0.5">{k.letters}</span>}
                </button>
              ))}
            </div>
            {phoneState === 'in-call' && (
              <p className="text-[11px] text-slate-400 text-center -mt-2 mb-3">Keypad sends touch-tones during the call</p>
            )}

            {/* call controls */}
            {inCall ? (
              <div className="flex items-center justify-center gap-3">
                <button
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    muted ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  onClick={toggleMute}
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
                <button
                  className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-colors"
                  onClick={hangUp}
                  title="Hang up"
                >
                  <PhoneOff size={22} />
                </button>
              </div>
            ) : (
              <button
                className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold flex items-center justify-center gap-2 shadow-sm transition-colors"
                onClick={placeCall}
                disabled={!e164 || phoneState !== 'ready'}
              >
                <Phone size={18} /> Call
              </button>
            )}

            {activeRow && inCall && (
              <p className="text-xs text-slate-400 text-center mt-3 flex items-center justify-center gap-1">
                <Clock size={11} /> Call is being recorded for AI notes
              </p>
            )}
          </Card>

          {/* contact search */}
          <Card title="Find a contact">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full text-sm border border-slate-200 rounded-lg py-2 pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Search Salesforce & ZoomInfo by name, company or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {searching && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />}
            </div>

            {searchResults.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {searchResults.map((c) => {
                  const num = c.mobile || c.phone;
                  return (
                    <button
                      key={`${c.source}-${c.id}`}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors text-left disabled:opacity-50"
                      onClick={() => pickContact(c)}
                      disabled={!num}
                      title={num ? `Dial ${num}` : 'No phone number on record'}
                    >
                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <User size={13} className="text-slate-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">{c.name}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {[c.title, c.company].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <Badge variant={c.source === 'salesforce' ? 'info' : 'default'}>
                          {c.source === 'salesforce' ? 'SF' : 'ZI'}
                        </Badge>
                        <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">{num || 'no phone'}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {search.trim().length >= 2 && !searching && searchResults.length === 0 && (
              <p className="text-xs text-slate-400 mt-3">No matches.</p>
            )}

            {searchMeta && (searchMeta.salesforce?.error || searchMeta.zoominfo?.error || searchMeta.zoominfo?.configured === false) && (
              <div className="mt-3 text-[11px] text-slate-400 space-y-0.5">
                {searchMeta.salesforce?.error && <p>Salesforce: {searchMeta.salesforce.error}</p>}
                {searchMeta.zoominfo?.configured === false
                  ? <p>ZoomInfo: not configured yet (Salesforce-only results).</p>
                  : searchMeta.zoominfo?.error && <p>ZoomInfo: {searchMeta.zoominfo.error}</p>}
              </div>
            )}
          </Card>
        </div>

        {/* ── right column: history ── */}
        <Card
          title="Recent calls"
          action={
            <button
              className="text-slate-400 hover:text-slate-600 transition-colors"
              title="Refresh"
              onClick={async () => {
                const { data } = await supabase.from('dialer_calls')
                  .select('*').order('created_at', { ascending: false }).limit(50);
                if (data) setCalls(data as DialerCallRow[]);
              }}
            >
              <RefreshCw size={15} />
            </button>
          }
        >
          {calls.length === 0 ? (
            <EmptyState
              icon={<Phone size={28} />}
              title="No calls yet"
              description="Place your first call and it will show up here with its recording, transcript and AI notes."
            />
          ) : (
            <div className="space-y-2">
              {calls.map((c) => <CallHistoryRow key={c.id} call={c} />)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
