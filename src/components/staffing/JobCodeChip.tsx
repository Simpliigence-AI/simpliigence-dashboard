/**
 * The requisition's job ID (REQ-1042) as a small chip that copies itself on click.
 * TAs paste it into an email subject, or give it to a vendor, so resumes sent to the
 * intake mailbox are filed against the right role.
 */
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function JobCodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the code is still readable on the chip */ }
  };
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); void copy(); }}
      title={copied ? 'Copied' : `Copy job ID ${code}`} aria-label={`Copy job ID ${code}`}
      className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] font-bold text-ink/70 bg-surface-2 border border-line rounded px-1.5 py-0.5 hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors">
      {code}
      {copied ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} className="opacity-60" />}
    </button>
  );
}
