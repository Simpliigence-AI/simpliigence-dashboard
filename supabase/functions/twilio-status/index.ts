/**
 * Supabase Edge Function: twilio-status
 *
 * Call-lifecycle status callbacks for the dialer's PSTN leg (set on the
 * <Number> noun in twilio-voice). Keeps dialer_calls.status fresh so the
 * UI can show ringing → in-progress → completed/no-answer/busy live.
 *
 * Deploy with --no-verify-jwt; authenticity via X-Twilio-Signature.
 *
 * Required secrets: TWILIO_AUTH_TOKEN.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_AUTH_TOKEN = env('TWILIO_AUTH_TOKEN');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const SKIP_SIG = env('DIALER_SKIP_TWILIO_SIG') === 'true';

const jsonHeaders = { 'Content-Type': 'application/json' };

async function validSignature(req: Request, form: URLSearchParams): Promise<boolean> {
  if (SKIP_SIG) return true;
  if (!TWILIO_AUTH_TOKEN) return false;
  const sigHeader = req.headers.get('x-twilio-signature');
  if (!sigHeader) return false;
  const u = new URL(req.url);
  const url = `${SUPABASE_URL}/functions/v1${u.pathname.replace(/^\/functions\/v1/, '')}${u.search}`;
  const keys = [...new Set([...form.keys()])].sort();
  let data = url;
  for (const k of keys) data += k + (form.get(k) ?? '');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(TWILIO_AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  let b64 = '';
  for (const b of new Uint8Array(sig)) b64 += String.fromCharCode(b);
  return btoa(b64) === sigHeader;
}

/** Twilio CallStatus → our dialer_calls.status. */
function mapStatus(s: string): string | null {
  switch (s) {
    case 'initiated':
    case 'queued':
    case 'ringing': return 'ringing';
    case 'answered':
    case 'in-progress': return 'in-progress';
    case 'completed': return 'completed';
    case 'busy': return 'busy';
    case 'no-answer': return 'no-answer';
    case 'failed': return 'failed';
    case 'canceled': return 'canceled';
    default: return null;
  }
}

const TERMINAL = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  try {
    const form = new URLSearchParams(await req.text());
    if (!(await validSignature(req, form))) {
      console.warn('[twilio-status] rejected: bad or missing X-Twilio-Signature');
      return new Response('Forbidden', { status: 403 });
    }

    const childSid = form.get('CallSid') || '';
    const parentSid = form.get('ParentCallSid') || '';
    const status = mapStatus(form.get('CallStatus') || '');
    const durationSec = parseInt(form.get('CallDuration') || '', 10);

    if (!status || (!parentSid && !childSid)) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), { headers: jsonHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // The PSTN leg's ParentCallSid is the browser leg we stored in
    // twilio-voice; fall back to child_call_sid for any repeat events.
    let { data: row } = await supabase.from('dialer_calls')
      .select('id, status').eq('provider_call_sid', parentSid).maybeSingle();
    if (!row && childSid) {
      const r = await supabase.from('dialer_calls')
        .select('id, status').eq('child_call_sid', childSid).maybeSingle();
      row = r.data;
    }
    if (!row) {
      return new Response(JSON.stringify({ ok: true, ignored: 'unknown call' }), { headers: jsonHeaders });
    }

    const patch: Record<string, unknown> = {
      status,
      child_call_sid: childSid || undefined,
      updated_at: new Date().toISOString(),
      updated_by: 'twilio-status',
    };
    if (TERMINAL.has(status)) {
      patch.ended_at = new Date().toISOString();
      if (Number.isFinite(durationSec)) patch.duration_sec = durationSec;
    }
    await supabase.from('dialer_calls').update(patch).eq('id', row.id);

    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  } catch (e) {
    console.error('[twilio-status]', (e as Error).message || String(e));
    // Ack 200 so Twilio doesn't retry-storm us.
    return new Response(JSON.stringify({ ok: false }), { headers: jsonHeaders });
  }
});
