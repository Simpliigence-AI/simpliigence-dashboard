# Dialer setup (Twilio browser softphone)

The **Dialer** page (`/dialer`, sidebar → Account Management) is a browser
softphone: search a contact in Salesforce / ZoomInfo (or type any number),
call them from Chrome, and get a recording, a Deepgram transcript and
Claude-written call notes attached to the call automatically.

Everything is already deployed. The only thing missing is a set of Twilio
secrets — until they're set, the page shows a "Softphone not ready" banner
(contact search and history still work).

## What's already in place

| Piece | Status |
|---|---|
| `dialer_calls` table + `call-recordings` bucket (migration 016) | ✅ applied |
| Edge functions `twilio-token`, `twilio-voice`, `twilio-status`, `twilio-recording`, `twilio-ping`, `dialer-contact-search` | ✅ deployed |
| Salesforce contact/lead search (uses existing `SF_*` secrets) | ✅ working |
| Deepgram transcription + Claude notes (existing `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`) | ✅ keys set |
| ZoomInfo search | ⏳ needs `ZOOMINFO_USERNAME`, `ZOOMINFO_CLIENT_ID`, `ZOOMINFO_PRIVATE_KEY` (same secrets account-research wants) |
| Twilio calling | ⏳ needs the secrets below |

## Twilio secrets to add

In [Supabase → Edge Functions → Secrets](https://supabase.com/dashboard/project/mhmxlubithnidopmkwgt/settings/functions) (or `supabase secrets set KEY=value --project-ref mhmxlubithnidopmkwgt`):

| Secret | Where to get it |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Console home → Account Info (starts `AC…`) |
| `TWILIO_AUTH_TOKEN` | Same place (used for webhook signature checks + downloading recordings) |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Console → Account → API keys & tokens → **Create API key** (standard). Secret is shown once. |
| `TWILIO_TWIML_APP_SID` | Console → Voice → TwiML Apps → **Create** (starts `AP…`) — see below |
| `TWILIO_CALLER_ID` | A voice-capable Twilio number you own, E.164 (e.g. `+14155551234`). `twilio-ping` lists candidates. |

### TwiML App configuration

Create a TwiML App (Console → Voice → TwiML apps) with:

- **Voice request URL** (POST):
  `https://mhmxlubithnidopmkwgt.supabase.co/functions/v1/twilio-voice`
- Leave everything else empty.

Note: if the India number lives inside Vapi's Twilio subaccount, you may not
have direct API access to it — for US outbound calling, buying a cheap US
local number (~$1.15/mo) on the main account is the fastest path.

### Verify

```bash
curl -s -X POST "https://mhmxlubithnidopmkwgt.supabase.co/functions/v1/twilio-ping" \
  -H "Authorization: Bearer <anon key>" | jq
```

`twilio-ping` reports: which secrets are set, whether they authenticate,
your available phone numbers (caller-ID candidates), and whether the TwiML
app's Voice URL matches the expected `twilio-voice` URL.

## How a call flows

1. Dialer page mints a Voice token (`twilio-token`) and registers a `Device`.
2. **Call** inserts a `dialer_calls` row, then `Device.connect({ To, callId })`.
3. Twilio hits `twilio-voice` (TwiML app) → `<Dial record="record-from-answer-dual">`
   bridges browser → PSTN with the `TWILIO_CALLER_ID` shown to the callee.
4. `twilio-status` callbacks drive status: ringing → in-progress → completed /
   no-answer / busy / failed (live in the UI via Supabase realtime).
5. On hangup, `twilio-recording`: downloads the dual-channel mp3 → mirrors it
   into the private `call-recordings` bucket → Deepgram (`nova-2`, multichannel:
   ch0 = you, ch1 = contact) → Claude (`claude-sonnet-4-5`) writes structured
   notes: summary, key points, action items, objections, opportunity signals,
   sentiment, recommended follow-up.

Webhook functions are deployed `--no-verify-jwt` and instead validate
Twilio's `X-Twilio-Signature` (HMAC-SHA1 with `TWILIO_AUTH_TOKEN`). If a
webhook 403s because of a URL mismatch, set `DIALER_SKIP_TWILIO_SIG=true`
temporarily to isolate, then remove it.

## Costs (rough)

- Outbound US call: ~$0.014/min (browser leg ~$0.004 + PSTN ~$0.010)
- Recording: $0.0025/min; storage mirrored to Supabase (free tier scale)
- Deepgram nova-2: ~$0.0043/min · Claude notes: <$0.01/call
- **≈ $0.02–0.03 per minute all-in**
