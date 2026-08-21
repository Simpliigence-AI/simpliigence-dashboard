/**
 * Renders an inbound email body.
 *
 * `ticket_messages.body_html` is the real message body straight out of
 * Microsoft Graph — i.e. attacker-controlled, since anyone can email the desk
 * mailbox. It goes through `sanitizeEmailHtml` before it is ever handed to
 * `dangerouslySetInnerHTML`; see src/lib/sanitizeHtml.ts for the allowlist.
 *
 * Inline images arrive as `<img src="cid:...">`. The bytes are in the private
 * `ticket-attachments` bucket, so we mint short-lived signed URLs for this
 * ticket's inline attachments and rewrite the `cid:` references to them.
 * References with no matching attachment are dropped by the sanitizer rather
 * than rendering as a broken image.
 *
 * Falls back to the plain-text body when there is no HTML (or nothing survives
 * sanitizing).
 */
import { useEffect, useMemo, useState } from 'react';
import { useConciergeStore, type ConciergeAttachment } from '../../store/useConciergeStore';
import { rewriteCidReferences, sanitizeEmailHtml } from '../../lib/sanitizeHtml';

interface Props {
  html: string | null;
  text: string | null;
  /** Inline attachments for this body's `cid:` references. MUST be a stable
   *  reference (memoized by the caller) — it is an effect dependency. */
  inlineAttachments: ConciergeAttachment[];
  className?: string;
}

export function EmailBody({ html, text, inlineAttachments, className = '' }: Props) {
  const attachmentSignedUrls = useConciergeStore((s) => s.attachmentSignedUrls);
  const [cidUrls, setCidUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const withCid = inlineAttachments.filter((a) => a.contentId);
    if (withCid.length === 0) return;
    let cancelled = false;
    void attachmentSignedUrls(withCid.map((a) => a.storagePath)).then((byPath) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const a of withCid) {
        const url = byPath[a.storagePath];
        if (url && a.contentId) next[a.contentId] = url;
      }
      setCidUrls(next);
    });
    return () => { cancelled = true; };
  }, [inlineAttachments, attachmentSignedUrls]);

  // Rewrite cid: first, then sanitize — see sanitizeHtml.ts.
  //
  // Only THIS body's own inline attachments may resolve a `cid:`. `cidUrls` can
  // still hold the map resolved for a previous body — this component instance is
  // reused when the drawer switches ticket, and the effect above leaves the last
  // map in place when the new body has no inline attachments at all — so it is
  // scoped to the current attachments here rather than trusted wholesale.
  // Outlook `cid:` values ("image001.png@01D...") are not unique across senders,
  // so an unscoped map can render one ticket's image inside another's body.
  const cleanHtml = useMemo(() => {
    if (!html) return '';
    const allowed = new Set<string>();
    for (const a of inlineAttachments) if (a.contentId) allowed.add(a.contentId);
    const scoped: Record<string, string> = {};
    for (const [cid, url] of Object.entries(cidUrls)) if (allowed.has(cid)) scoped[cid] = url;
    return sanitizeEmailHtml(rewriteCidReferences(html, scoped));
  }, [html, cidUrls, inlineAttachments]);

  if (cleanHtml.trim()) {
    return (
      <div
        className={`email-html ${className}`}
        // Sanitized immediately above; never pass raw body_html here.
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
      />
    );
  }

  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {text?.trim() ? text : <em className="text-muted/70">(empty)</em>}
    </div>
  );
}
